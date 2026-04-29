package importpkg

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

// vaultSession holds the derived vault_key (hex-encoded) plus its TTL. The
// session_id is a random 32-byte base64url string, set as an HttpOnly cookie.
// Only the id leaves the process; the hex stays in memory.
type vaultSession struct {
	vaultKeyHex string
	expiresAt   time.Time
}

// SessionStore is an in-memory session map keyed by session_id. Sessions
// survive process lifetime only; on restart users re-unlock. This is
// acceptable for Personal + Trial editions (local single-user) and
// intentional for Production (users unlock per session, no shared state).
type SessionStore struct {
	mu       sync.Mutex
	sessions map[string]vaultSession
	ttl      time.Duration
}

// NewSessionStore returns a store with the given idle TTL. Use 10 minutes for
// Personal, shorter for high-security deployments.
func NewSessionStore(ttl time.Duration) *SessionStore {
	return &SessionStore{sessions: make(map[string]vaultSession), ttl: ttl}
}

func (s *SessionStore) put(hex string) (id string, expiresAt time.Time) {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	id = base64.RawURLEncoding.EncodeToString(buf)
	expiresAt = time.Now().Add(s.ttl)
	s.mu.Lock()
	s.sessions[id] = vaultSession{vaultKeyHex: hex, expiresAt: expiresAt}
	s.mu.Unlock()
	return
}

func (s *SessionStore) get(id string) (string, time.Duration, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[id]
	if !ok {
		return "", 0, false
	}
	if time.Now().After(session.expiresAt) {
		delete(s.sessions, id)
		return "", 0, false
	}
	// Hard-expire: session TTL is fixed at unlock time and never extended.
	// Why: the previous sliding TTL caused the 10s front-end status poll in
	// index.tsx to defeat idle auto-lock — any open tab kept the session alive
	// indefinitely. Idle policy requires password re-entry at expiry regardless
	// of background activity.
	return session.vaultKeyHex, time.Until(session.expiresAt), true
}

func (s *SessionStore) delete(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
}

// VaultHandlers bundles the /api/user/vault/{unlock,lock,status} endpoints.
type VaultHandlers struct {
	Store  *SessionStore
	Bridge *CliBridge

	// unlockMu / unlockWindow rate-limit /vault/unlock by client IP to blunt
	// online brute-force attacks against the master password. Sliding 60s
	// window, max 10 attempts; exceeding returns 429. Keyed by IP because
	// the session cookie does not exist yet at unlock time; see allowUnlock.
	// 2026-04-24 security review.
	unlockMu     sync.Mutex
	unlockWindow map[string][]time.Time
}

const sessionCookie = "aikey_vault_session"

// unlockRateLimitMax / unlockRateLimitWindow cap the brute-force throughput.
// 10 / minute is deliberately loose for UX (legitimate typos are not blocked
// immediately) but hard enough to keep an online attacker well under any
// meaningful search of the keyspace.
const (
	unlockRateLimitMax    = 10
	unlockRateLimitWindow = 60 * time.Second
)

// allowUnlock checks + records an unlock attempt for rate-limiting. Sliding
// window; returns true if the current call is allowed.
func (h *VaultHandlers) allowUnlock(key string) bool {
	h.unlockMu.Lock()
	defer h.unlockMu.Unlock()
	if h.unlockWindow == nil {
		h.unlockWindow = make(map[string][]time.Time)
	}
	now := time.Now()
	cutoff := now.Add(-unlockRateLimitWindow)
	times := h.unlockWindow[key]
	kept := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= unlockRateLimitMax {
		h.unlockWindow[key] = kept
		return false
	}
	kept = append(kept, now)
	h.unlockWindow[key] = kept
	return true
}

// unlockRateLimitKey derives a coarse client identifier for the unlock rate
// limiter. Prefers the IP portion of RemoteAddr; X-Forwarded-For is ignored
// on purpose because the Personal / Trial deployments bind loopback and are
// not fronted by a trusted proxy (trusting X-F-F here would let a caller set
// their own bucket key).
func unlockRateLimitKey(r *http.Request) string {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if host == "" {
		host = "unknown"
	}
	return host
}

// UnlockHandler: POST /api/user/vault/unlock
// Body: {"password": "..."}
// 1) call cli `vault-op metadata` to fetch salt + KDF params (no secret revealed)
// 2) derive Argon2id(password, salt) locally -> 32-byte key -> hex
// 3) call cli `vault-op verify` with the hex; on "ok", mint session
// 4) zero password bytes asap
func (h *VaultHandlers) UnlockHandler(w http.ResponseWriter, r *http.Request) {
	// Rate-limit before reading the body / derivation: Argon2id is expensive
	// (m=64MiB, t=3) and an attacker can otherwise DoS the host just by
	// spamming requests, independent of whether any guess succeeds.
	if !h.allowUnlock(unlockRateLimitKey(r)) {
		writeErr(w, ErrUnlockRateLimited, "too many unlock attempts — wait a minute and try again")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		writeErr(w, ErrBadRequest, "body must be {password: string} with non-empty password")
		return
	}
	// Defer zeroing the password. Go strings are immutable so we can't truly
	// scrub the original bytes; the best we can do is drop the reference and
	// avoid shadow copies. Argon2id consumes []byte, which is derived once.
	pwdBytes := []byte(req.Password)
	req.Password = ""
	defer func() {
		for i := range pwdBytes {
			pwdBytes[i] = 0
		}
	}()

	ctx := r.Context()

	// 1. metadata
	meta, err := h.Bridge.Invoke(ctx, "vault-op", "metadata", placeholderHex, "", struct{}{})
	if err != nil {
		writeInvokeError(w, err)
		return
	}
	if meta.Status != "ok" {
		writeCliError(w, meta)
		return
	}
	var m struct {
		SaltHex string `json:"salt_hex"`
		KDF     struct {
			Algorithm string `json:"algorithm"`
			MCost     uint32 `json:"m_cost"`
			TCost     uint32 `json:"t_cost"`
			PCost     uint32 `json:"p_cost"`
			KeyLen    uint32 `json:"key_len"`
		} `json:"kdf"`
	}
	if err := json.Unmarshal(meta.Data, &m); err != nil {
		writeErr(w, ErrCliMalformedReply, err.Error())
		return
	}
	if m.KDF.Algorithm != "argon2id" {
		writeErr(w, ErrCliMalformedReply, "unsupported KDF algorithm: "+m.KDF.Algorithm)
		return
	}
	salt, err := hex.DecodeString(m.SaltHex)
	if err != nil {
		writeErr(w, ErrCliMalformedReply, "salt_hex: "+err.Error())
		return
	}

	// 2. derive
	derived := argon2.IDKey(pwdBytes, salt, m.KDF.TCost, m.KDF.MCost, uint8(m.KDF.PCost), m.KDF.KeyLen)
	vaultKeyHex := hex.EncodeToString(derived)

	// 3. verify
	verify, err := h.Bridge.Invoke(ctx, "vault-op", "verify", vaultKeyHex, "", struct{}{})
	if err != nil {
		writeInvokeError(w, err)
		return
	}
	if verify.Status != "ok" {
		// cli emits I_VAULT_KEY_INVALID here; wrap as ErrVaultUnlockFailed so
		// UI sees a single "wrong password" signal regardless of vault shape.
		writeErr(w, ErrVaultUnlockFailed, "password did not match vault")
		return
	}

	id, expiresAt := h.Store.put(vaultKeyHex)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
	})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"unlocked":    true,
		"ttl_seconds": int(h.Store.ttl.Seconds()),
	})
}

// LockHandler: POST /api/user/vault/lock  (explicit lock; session is dropped)
func (h *VaultHandlers) LockHandler(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		h.Store.delete(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// StatusHandler: GET /api/user/vault/status (unauthenticated probe; used by
// the Web UI to render the locked vs unlocked banner).
func (h *VaultHandlers) StatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	resp := map[string]any{"status": "ok", "unlocked": false}
	if c, err := r.Cookie(sessionCookie); err == nil {
		if _, ttl, ok := h.Store.get(c.Value); ok {
			resp["unlocked"] = true
			resp["ttl_seconds"] = int(ttl.Seconds())
		}
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// sessionKey is the request-context key under which the middleware stores
// the resolved vault_key_hex for downstream handlers.
type sessionKey struct{}

// RequireUnlock wraps a handler so it runs only when the request carries a
// valid session cookie. The handler can retrieve the hex via vaultKeyFrom(ctx).
func (h *VaultHandlers) RequireUnlock(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			writeErr(w, ErrVaultNoSession, "no session cookie")
			return
		}
		key, _, ok := h.Store.get(c.Value)
		if !ok {
			writeErr(w, ErrVaultLocked, "session missing or expired — unlock again")
			return
		}
		ctx := context.WithValue(r.Context(), sessionKey{}, key)
		next(w, r.WithContext(ctx))
	}
}

func vaultKeyFrom(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(sessionKey{}).(string)
	return v, ok && v != ""
}

// placeholderHex is the 64-char all-zero vault_key_hex used for cli actions
// that perform only format validation (parse, metadata). See
// aikey-cli/src/commands_internal/parse.rs docblock: "only checks format,
// does not verify against vault".
const placeholderHex = "0000000000000000000000000000000000000000000000000000000000000000"
