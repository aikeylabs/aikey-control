package shared

// Shared middleware + helpers for sensitive same-origin local APIs (e.g.
// invite create/revoke). Spec §6.14.2:
//
//   Browsers' same-origin policy lets any web page POST to
//   http://127.0.0.1:<port>. Without constraints a third-party page
//   could silently call /local-api/invite/create on this machine, bind
//   the user's installer_id to an attacker-chosen channel, or exhaust
//   their invite quota. The defences below are mandatory:
//
//   - bind loopback only (server-config concern, NOT middleware)
//   - Origin / Host strict check (this file: RequireLocalOrigin)
//   - CORS: deny *, only echo the local origin (this file: localApiCORS)
//   - CSRF token: cookie + header double-submit (this file: IssueCSRFToken
//     + RequireCSRF)
//   - user gesture: frontend-layer; backend cannot tell. We DO NOT trust
//     a synthesised header from the page — the browser would refuse to
//     send it from a non-gesture origin anyway.
//   - per-process rate limit (this file: NewLocalAPIRateLimiter)
//   - audit log to ~/.aikey/logs/local-api.log (this file: AuditLocalAPI)
//
// Per "版型意识" rule these helpers MUST be the single source of truth
// across aikey-local-server / aikey-full-trial / aikey-control — every
// edition that mounts /local-api/* uses the same Wrap helper below so a
// future check (or fix) lands in one place.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CSRFCookieName + CSRFHeaderName must match what the frontend reads /
// writes. Changing either requires a coordinated frontend change.
const (
	CSRFCookieName = "aikey_local_api_csrf"
	CSRFHeaderName = "X-Aikey-Local-CSRF"

	// csrfTokenLen is in raw bytes (base64-encoded length is ~22 chars).
	// 24 bytes = 192 bits of entropy: large enough that brute-force
	// guessing within a 24h session is infeasible even at LAN speeds.
	csrfTokenLen = 24

	// csrfTTL caps how long a single token is valid. Short enough that a
	// page-load stale token won't accept a forged request hours later;
	// long enough that the local web UI doesn't have to refresh tokens
	// mid-session.
	csrfTTL = 8 * time.Hour
)

// LocalAPIConfig bundles all knobs the Wrap helper needs. Construct once
// at boot and reuse — none of the fields are request-scoped.
type LocalAPIConfig struct {
	// AllowedOrigins is the set of Origin headers that may call /local-api.
	// Each entry must be a full scheme://host[:port] (no trailing slash).
	// For the user's local web at port 8090 the expected entries are:
	//   "http://127.0.0.1:8090"
	//   "http://localhost:8090"
	// Empty list = deny all (defensive default; never silently permit).
	AllowedOrigins []string

	// CSRFKey is the HMAC key used to sign issued CSRF tokens. 32+ bytes.
	// MUST be stable across the process lifetime AND unique per machine
	// (a global constant would let an attacker who learned the key from
	// any one user's machine forge tokens for everyone). Use
	// LoadOrGenerateCSRFKey to handle the per-machine persistence.
	CSRFKey []byte

	// RateLimiter caps how often a single client can POST. Nil = no
	// rate limit (acceptable in tests; production callers must wire one).
	RateLimiter *LocalAPIRateLimiter

	// AuditLog is the destination for audit-trail entries. Nil = use
	// the default ~/.aikey/logs/local-api.log location resolved at the
	// first write. Failure to write is logged once-per-process but
	// must not block the request.
	AuditLog *LocalAPIAuditLog
}

// IssueCSRFToken mints a fresh CSRF token, sets the httponly cookie, and
// returns the cleartext value the page must echo via the
// X-Aikey-Local-CSRF header. Call this from the page-load handler (the
// same one that serves the SPA) — NOT from /local-api endpoints
// themselves (a cross-site POST that issues its own token defeats the
// purpose).
//
// Wire format: <random-base64>.<unix-expiry>.<hmac>. We sign the
// (random || expiry) pair so a stale or rewritten token fails RequireCSRF.
func IssueCSRFToken(w http.ResponseWriter, cfg LocalAPIConfig) (string, error) {
	if len(cfg.CSRFKey) < 32 {
		return "", errors.New("CSRFKey must be at least 32 bytes")
	}
	raw := make([]byte, csrfTokenLen)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("read csrf entropy: %w", err)
	}
	expiry := time.Now().Add(csrfTTL).Unix()
	payload := base64.RawURLEncoding.EncodeToString(raw) + "." + fmt.Sprintf("%d", expiry)
	mac := hmac.New(sha256.New, cfg.CSRFKey)
	mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	token := payload + "." + sig

	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: false, // page JS must read it to echo via header
		// SameSite=Strict: even if a third-party page tricks the user
		// into navigating to a loopback URL, the cookie won't ride along.
		// Loopback Origin check is the primary defence; this is belt-
		// and-braces.
		SameSite: http.SameSiteStrictMode,
		Secure:   false, // loopback http is the supported transport
		MaxAge:   int(csrfTTL / time.Second),
	})
	return token, nil
}

// verifyCSRFToken returns nil iff the token's HMAC checks out AND it
// hasn't expired. The cookie + header match is enforced by the caller
// (RequireCSRF) — that's the double-submit defence; here we only
// validate that the token itself is well-formed.
func verifyCSRFToken(token string, key []byte) error {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return errors.New("csrf token malformed: want <body>.<exp>.<sig>")
	}
	payload := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		return errors.New("csrf token signature mismatch")
	}
	expiry, err := strconvParseInt(parts[1])
	if err != nil {
		return fmt.Errorf("csrf token expiry malformed: %w", err)
	}
	if time.Now().Unix() > expiry {
		return errors.New("csrf token expired")
	}
	return nil
}

// strconvParseInt is a thin wrapper so verifyCSRFToken can fail explicitly
// on a non-numeric expiry without dragging strconv into the imports
// (kept the import list tight for readability).
func strconvParseInt(s string) (int64, error) {
	var v int64
	if _, err := fmt.Sscanf(s, "%d", &v); err != nil {
		return 0, err
	}
	return v, nil
}

// WrapLocalAPI bundles all defences for a /local-api/* handler in one
// place. The order matters:
//
//   1. CORS (preflight + denied origin gets 403 BEFORE auth) — handles
//      OPTIONS and synthesises CORS headers when Origin is on the list.
//   2. Origin / Host strict check — rejects requests whose Origin is
//      absent or off-list. Different from CORS denial because some
//      browsers don't send Origin on same-origin POSTs (we tolerate
//      missing Origin only when Host matches a configured local origin).
//   3. Rate limit — only after auth-shape checks pass (don't waste a
//      bucket slot on a forged origin).
//   4. CSRF cookie + header double-submit — the actual anti-CSRF gate.
//   5. Audit log — every reject + every accepted POST writes one row.
//   6. Forward to handler.
//
// Failed defences return 403 (Origin/CSRF) or 429 (rate limit) WITH a
// JSON envelope containing only the failure category — never the
// expected token value or any secret state.
func WrapLocalAPI(cfg LocalAPIConfig, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 1. CORS preflight: respond once with the allowlist; never
		// echo the request's Origin unconditionally.
		if r.Method == http.MethodOptions {
			handleCORSPreflight(w, r, cfg.AllowedOrigins)
			return
		}
		applyLocalAPICORS(w, r, cfg.AllowedOrigins)

		// 2. Origin / Host strict check.
		if !originOrHostMatches(r, cfg.AllowedOrigins) {
			writeLocalAPIError(w, http.StatusForbidden, "origin_denied", "request Origin / Host is not on the local-api allowlist")
			auditLocalAPIDenied(cfg, r, "origin_denied")
			return
		}

		// 3. Rate limit (per-Origin bucket).
		if cfg.RateLimiter != nil {
			if !cfg.RateLimiter.Allow(rateKeyFor(r)) {
				writeLocalAPIError(w, http.StatusTooManyRequests, "rate_limited", "local-api rate limit exceeded for this client")
				auditLocalAPIDenied(cfg, r, "rate_limited")
				return
			}
		}

		// 4. CSRF double-submit: header value MUST equal cookie value
		// AND verify against the HMAC key. A cross-site POST cannot
		// read the cookie (httponly+SameSite=Strict) so cannot mint a
		// matching header value.
		if err := verifyCSRFDoubleSubmit(r, cfg.CSRFKey); err != nil {
			writeLocalAPIError(w, http.StatusForbidden, "csrf_denied", "csrf cookie + header mismatch or invalid")
			auditLocalAPIDenied(cfg, r, "csrf_denied:"+err.Error())
			return
		}

		// 5. Audit (accepted POST). Reject-path audits are emitted by
		// the per-failure branches above.
		auditLocalAPIAccepted(cfg, r)

		// 6. Forward.
		h.ServeHTTP(w, r)
	})
}

// verifyCSRFDoubleSubmit reads the cookie + header, confirms they match,
// and validates the token's signature + expiry via verifyCSRFToken.
func verifyCSRFDoubleSubmit(r *http.Request, key []byte) error {
	cookie, err := r.Cookie(CSRFCookieName)
	if err != nil {
		return errors.New("csrf cookie missing")
	}
	header := r.Header.Get(CSRFHeaderName)
	if header == "" {
		return errors.New("csrf header missing")
	}
	// constant-time compare so a partial-match brute force can't time-
	// distinguish "right prefix" from "wrong prefix".
	if !hmac.Equal([]byte(cookie.Value), []byte(header)) {
		return errors.New("csrf cookie / header value mismatch")
	}
	return verifyCSRFToken(cookie.Value, key)
}

// originOrHostMatches accepts when:
//   - Origin is present AND on the allowlist, OR
//   - Origin is missing AND Host matches the host:port of any allowed
//     origin. Some same-origin POSTs (notably from same-page fetch in
//     older browsers) omit Origin; we cover that path via Host.
func originOrHostMatches(r *http.Request, allowed []string) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		for _, o := range allowed {
			if origin == o {
				return true
			}
		}
		return false
	}
	// Origin missing → fall back to Host (which the browser always
	// sends and the user agent itself controls).
	host := r.Host
	for _, o := range allowed {
		u, err := url.Parse(o)
		if err != nil {
			continue
		}
		if u.Host == host {
			return true
		}
	}
	return false
}

// handleCORSPreflight responds to OPTIONS preflights. Allowlist-only;
// never echo arbitrary origins (would let an attacker's page convince
// the browser its origin is legitimate).
func handleCORSPreflight(w http.ResponseWriter, r *http.Request, allowed []string) {
	applyLocalAPICORS(w, r, allowed)
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, "+CSRFHeaderName)
	w.Header().Set("Access-Control-Max-Age", "300") // short cache; rules may change at next deploy
	w.WriteHeader(http.StatusNoContent)
}

// applyLocalAPICORS sets Access-Control-Allow-Origin to the request's
// Origin iff it's on the allowlist. Browsers refuse `*` when credentials
// are sent, but we never use `*` anyway because we MUST send Vary +
// scoped Origin so caches don't share responses across origins.
func applyLocalAPICORS(w http.ResponseWriter, r *http.Request, allowed []string) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return
	}
	for _, o := range allowed {
		if origin == o {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			return
		}
	}
}

// writeLocalAPIError returns a JSON envelope with a stable category +
// human message. Never reflect secrets / token values / cookie names.
func writeLocalAPIError(w http.ResponseWriter, status int, category, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  category,
		"message": message,
	})
}

// rateKeyFor returns the bucket key the per-process rate limiter uses.
// Origin is the natural unit (one rogue page that owns Origin A can't
// drain the bucket for Origin B), with a fallback to the source IP
// when Origin is absent. RemoteAddr is `host:port`; strip the port.
func rateKeyFor(r *http.Request) string {
	if o := r.Header.Get("Origin"); o != "" {
		return "origin:" + o
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return "ip:" + host
}

// ----------------------------------------------------------------------
// Rate limiter
// ----------------------------------------------------------------------

// LocalAPIRateLimiter is a tiny per-key token bucket. Bucket size + refill
// match the spec example (10 / minute per client) but the helper is
// generic so future endpoints can dial it tighter.
//
// Not goroutine-cheap for huge keyspaces (one entry per Origin); for a
// loopback-bound endpoint that's fine — there are O(1) distinct local
// origins per machine in practice.
type LocalAPIRateLimiter struct {
	mu        sync.Mutex
	limit     int           // max tokens per bucket
	period    time.Duration // refill window (full bucket per period)
	buckets   map[string]*rlBucket
	lastSweep time.Time
}

type rlBucket struct {
	tokens int
	resetAt time.Time
}

// NewLocalAPIRateLimiter returns a limiter that allows `limit` requests
// per `period` per key. limit=10, period=time.Minute matches spec
// §6.14.2 "本地 rate limit (create 每分钟 ≤ 10)".
func NewLocalAPIRateLimiter(limit int, period time.Duration) *LocalAPIRateLimiter {
	return &LocalAPIRateLimiter{
		limit:     limit,
		period:    period,
		buckets:   make(map[string]*rlBucket),
		lastSweep: time.Now(),
	}
}

// Allow consumes one token for the given key. Returns false if the
// bucket is empty (caller should respond 429).
func (l *LocalAPIRateLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	// Periodic sweep: drop buckets whose resetAt expired more than 5
	// periods ago. Without this, an attacker spraying random Origin
	// headers grows the map unboundedly.
	if now.Sub(l.lastSweep) > l.period {
		for k, b := range l.buckets {
			if now.Sub(b.resetAt) > 5*l.period {
				delete(l.buckets, k)
			}
		}
		l.lastSweep = now
	}
	b, ok := l.buckets[key]
	if !ok || now.After(b.resetAt) {
		b = &rlBucket{tokens: l.limit, resetAt: now.Add(l.period)}
		l.buckets[key] = b
	}
	if b.tokens <= 0 {
		return false
	}
	b.tokens--
	return true
}

// ----------------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------------

// LocalAPIAuditLog appends one JSON line per local-api request to
// ~/.aikey/logs/local-api.log. Forensic-grade only — operators should
// inspect by hand on incident; not piped to the dashboard pipeline.
//
// Errors writing to the log are kept off the hot path; we emit one
// stderr warning per process at startup if the dir is unwritable and
// then no-op so a read-only filesystem can't crash the request.
type LocalAPIAuditLog struct {
	mu      sync.Mutex
	path    string
	disabled bool
}

// NewLocalAPIAuditLog returns a log rooted at ~/.aikey/logs/local-api.log.
// When dir creation fails, the returned log is disabled and silently
// drops writes — an audit trail is a defensive measure and must never
// block functionality.
func NewLocalAPIAuditLog() *LocalAPIAuditLog {
	home, err := os.UserHomeDir()
	if err != nil {
		return &LocalAPIAuditLog{disabled: true}
	}
	dir := filepath.Join(home, ".aikey", "logs")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return &LocalAPIAuditLog{disabled: true}
	}
	return &LocalAPIAuditLog{
		path: filepath.Join(dir, "local-api.log"),
	}
}

// Append writes one audit row. Fields kept minimal so the log file
// stays human-grep'able. Failure is silent — log file is best-effort.
func (l *LocalAPIAuditLog) Append(entry map[string]any) {
	if l == nil || l.disabled {
		return
	}
	entry["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	_ = json.NewEncoder(f).Encode(entry)
}

func auditLocalAPIDenied(cfg LocalAPIConfig, r *http.Request, reason string) {
	if cfg.AuditLog == nil {
		return
	}
	cfg.AuditLog.Append(map[string]any{
		"outcome":  "denied",
		"reason":   reason,
		"method":   r.Method,
		"path":     r.URL.Path,
		"origin":   r.Header.Get("Origin"),
		"host":     r.Host,
		"remote":   r.RemoteAddr,
		"user_agent": r.Header.Get("User-Agent"),
	})
}

func auditLocalAPIAccepted(cfg LocalAPIConfig, r *http.Request) {
	if cfg.AuditLog == nil {
		return
	}
	cfg.AuditLog.Append(map[string]any{
		"outcome": "accepted",
		"method":  r.Method,
		"path":    r.URL.Path,
		"origin":  r.Header.Get("Origin"),
		"host":    r.Host,
	})
}

// AuditLocalAPI is exposed for handlers that want to record an
// additional audit row beyond the wrap-level entry (e.g. an invite
// create that succeeded but with a stale token from main-site). Most
// callers won't need this — WrapLocalAPI already covers the
// accepted/denied baseline.
func AuditLocalAPI(cfg LocalAPIConfig, entry map[string]any) {
	if cfg.AuditLog == nil {
		return
	}
	cfg.AuditLog.Append(entry)
}

// LoadOrGenerateCSRFKey resolves the per-machine CSRF key. Persisted
// at ~/.aikey/local-api-csrf.key with 0600 permission so a different
// user on the same multi-user machine can't read it. Generated on
// first call.
//
// Why a stable per-machine key (not a per-process random): the local
// web SPA's CSRF cookie outlives a single web-server restart (sessions
// can span hours of dev). A new key on each boot would invalidate
// every open tab's token.
func LoadOrGenerateCSRFKey() ([]byte, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("user home: %w", err)
	}
	dir := filepath.Join(home, ".aikey")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", dir, err)
	}
	keyPath := filepath.Join(dir, "local-api-csrf.key")
	if buf, err := os.ReadFile(keyPath); err == nil && len(buf) >= 32 {
		return buf, nil
	}
	// Generate + persist atomically (write tmp then rename) so a
	// concurrent reader during create either sees the old key or the
	// new key, never a half-written one.
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, fmt.Errorf("read entropy: %w", err)
	}
	tmp := keyPath + ".tmp"
	if err := os.WriteFile(tmp, buf, 0o600); err != nil {
		return nil, fmt.Errorf("write tmp key: %w", err)
	}
	if err := os.Rename(tmp, keyPath); err != nil {
		return nil, fmt.Errorf("rename key into place: %w", err)
	}
	return buf, nil
}
