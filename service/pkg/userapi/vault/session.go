package vault

// Vault session — browser-facing unlock state, an in-memory store keyed by an
// HttpOnly session_id cookie, plus a small middleware that gates handlers
// behind a present-and-valid session.
//
// Session lifetime is process-bound — restarts force re-unlock. This is
// intentional for Personal + Trial (local single-user) and acceptable for
// Production (no shared state simplifies cross-pod consistency reasoning).
//
// Why session lives inside the vault package: in DDD terms, session is part
// of the vault aggregate's lifecycle, not a separate bounded context. It has
// no meaning outside vault unlock/lock, so it belongs here. Other contexts
// (intake) consume it as part of vault's published language.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"sync"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// SessionCookie is the HttpOnly session-id cookie name shared by all unlock /
// require-unlock paths.
const SessionCookie = "aikey_vault_session"

// sessionEntry holds the derived vault_key (hex-encoded) plus its TTL. The
// session_id is a random 32-byte base64url string, set as an HttpOnly cookie.
// Only the id leaves the process; the hex stays in memory.
type sessionEntry struct {
	vaultKeyHex string
	expiresAt   time.Time
}

// Store is an in-memory session map keyed by session_id. Sessions survive
// process lifetime only; on restart users re-unlock.
type Store struct {
	mu       sync.Mutex
	sessions map[string]sessionEntry
	ttl      time.Duration
}

// NewStore returns a store with the given idle TTL. Use 10–15 minutes for
// Personal, shorter for high-security deployments.
func NewStore(ttl time.Duration) *Store {
	return &Store{sessions: make(map[string]sessionEntry), ttl: ttl}
}

// TTL returns the configured session TTL.
func (s *Store) TTL() time.Duration { return s.ttl }

// Put records `hex` as a freshly-unlocked session and returns the new
// session id (random 32-byte base64url) along with its absolute expiry.
func (s *Store) Put(hex string) (id string, expiresAt time.Time) {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	id = base64.RawURLEncoding.EncodeToString(buf)
	expiresAt = time.Now().Add(s.ttl)
	s.mu.Lock()
	s.sessions[id] = sessionEntry{vaultKeyHex: hex, expiresAt: expiresAt}
	s.mu.Unlock()
	return
}

// Get resolves a session id to its vault_key hex + remaining TTL. Returns
// ok=false when the id is unknown or has hard-expired (in which case the
// entry is evicted lazily).
//
// Hard-expire: session TTL is fixed at unlock time and never extended.
// Why: the previous sliding TTL caused the 10s front-end status poll in
// index.tsx to defeat idle auto-lock — any open tab kept the session alive
// indefinitely. Idle policy requires password re-entry at expiry regardless
// of background activity.
func (s *Store) Get(id string) (string, time.Duration, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.sessions[id]
	if !ok {
		return "", 0, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(s.sessions, id)
		return "", 0, false
	}
	return entry.vaultKeyHex, time.Until(entry.expiresAt), true
}

// Delete drops a session id (used on explicit lock and after expiry).
func (s *Store) Delete(id string) {
	s.mu.Lock()
	delete(s.sessions, id)
	s.mu.Unlock()
}

// sessionCtxKey is the request-context key under which RequireUnlock stashes
// the resolved vault_key_hex for downstream handlers.
type sessionCtxKey struct{}

// RequireUnlock wraps a handler so it runs only when the request carries a
// valid session cookie. The handler can retrieve the hex via KeyFrom(ctx).
func (s *Store) RequireUnlock(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(SessionCookie)
		if err != nil {
			cli.WriteErr(w, cli.ErrVaultNoSession, "no session cookie")
			return
		}
		key, _, ok := s.Get(c.Value)
		if !ok {
			cli.WriteErr(w, cli.ErrVaultLocked, "session missing or expired — unlock again")
			return
		}
		ctx := context.WithValue(r.Context(), sessionCtxKey{}, key)
		next(w, r.WithContext(ctx))
	}
}

// KeyFrom returns the vault_key hex injected by RequireUnlock.
func KeyFrom(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(sessionCtxKey{}).(string)
	return v, ok && v != ""
}

// InjectKey is a test helper that puts a vault_key_hex into the request
// context as if RequireUnlock had run. Lives here (rather than in test
// files) so handlers in vault and intake can exercise their unlock-required
// code paths without spinning up the full middleware chain.
func InjectKey(ctx context.Context, hex string) context.Context {
	return context.WithValue(ctx, sessionCtxKey{}, hex)
}
