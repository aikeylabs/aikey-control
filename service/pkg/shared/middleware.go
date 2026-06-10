package shared

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type contextKey string

const (
	correlationIDKey contextKey = "correlation_id"
	claimsKey        contextKey = "jwt_claims"
)

// LocalOwnerAccountID is the sentinel account identity injected by
// LocalIdentityMiddleware when a request arrives without a Bearer token.
// Handlers that respond with profile-like data should recognise this value
// and synthesise a response from the middleware claims instead of querying
// the DB (the trial edition does not seed a DB row for this sentinel).
const (
	LocalOwnerAccountID = "local-owner"
	LocalOwnerEmail     = "local@localhost"
)

// CorrelationID returns the request correlation ID from context, or empty string.
func CorrelationID(ctx context.Context) string {
	if v, ok := ctx.Value(correlationIDKey).(string); ok {
		return v
	}
	return ""
}

// CorrelationIDMiddleware attaches a correlation/request ID to every request context.
// It honours the X-Correlation-ID header if present; otherwise generates a new UUID.
func CorrelationIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Correlation-ID")
		if id == "" {
			id = uuid.New().String()
		}
		ctx := context.WithValue(r.Context(), correlationIDKey, id)
		w.Header().Set("X-Correlation-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// AccountID returns the authenticated account ID from context, or empty string.
func AccountID(ctx context.Context) string {
	if c, ok := ctx.Value(claimsKey).(*Claims); ok && c != nil {
		return c.AccountID
	}
	return ""
}

// LocalIdentityMiddleware provides a permissive auth layer for local/trial modes.
// If the request carries a valid Bearer JWT, it extracts the real account identity
// (needed for CLI sync where each member must see their own keys). Otherwise it
// falls back to the fixed "local-owner" identity so web pages work without login.
func LocalIdentityMiddleware(ts ...*TokenService) func(http.Handler) http.Handler {
	var tokenSvc *TokenService
	if len(ts) > 0 {
		tokenSvc = ts[0]
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Try JWT first if a Bearer token is present and we have a token service.
			if tokenSvc != nil {
				if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
					if claims, err := tokenSvc.Verify(strings.TrimPrefix(auth, "Bearer ")); err == nil {
						ctx := context.WithValue(r.Context(), claimsKey, claims)
						next.ServeHTTP(w, r.WithContext(ctx))
						return
					}
				}
			}
			// Fallback: anonymous access as local-owner (web pages, no-auth mode).
			claims := &Claims{
				AccountID: LocalOwnerAccountID,
				Email:     LocalOwnerEmail,
			}
			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// JWTMiddleware validates the Bearer token in Authorization header and injects
// Claims into the request context. Returns 401 if the token is missing or invalid.
func JWTMiddleware(ts *TokenService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "Bearer token required")
				return
			}
			claims, err := ts.Verify(strings.TrimPrefix(auth, "Bearer "))
			if err != nil {
				Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid or expired token")
				return
			}
			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireNonServiceAccount rejects requests whose JWT belongs to a
// digital-employee machine account (account_type='service'). It must be
// composed INSIDE an auth middleware that has already injected Claims (e.g.
// JWTMiddleware(RequireNonServiceAccount(handler))) — it reads the claims set
// in context, it does not parse the token itself.
//
// Why: a service account's daemon refresh_token can mint a normal access JWT
// (CLILoginService.Refresh intentionally does not reject service accounts so
// the daemon can pull its own assigned key). That JWT must NOT reach the
// master/admin surface (issue/list virtual keys, mint join tokens) — VKs are
// assigned by an admin, never self-issued. This enforces, at the API layer,
// the "master console is admin-only" design that was previously only a UI
// property. See requirements/2026-06-10-digital-employee-authz-boundary.md R1.
//
// Tokens with an empty account_type (legacy / human) pass through unchanged.
func RequireNonServiceAccount(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, ok := r.Context().Value(claimsKey).(*Claims); ok && c != nil &&
			c.AccountType == AccountTypeService {
			DomainErrorResponse(w, BizAuthAccessDenied())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// CORSAllowControlPanelURL is the sentinel value that, when present in
// allowedOrigins, makes CORSMiddleware reflect the Origin matching
// `controlPanelUrl` from `~/.aikey/config/config.json` (Phase 3B R20).
//
// Single source of truth: `aikey login --control-url X` and
// `aikey set-control-url X` both write X to that JSON file. Trial /
// aikey-local-server CORS therefore tracks "where the user said the
// team server lives" with no separate config to drift. The file is
// re-read on every CORS check (cached for 30 s) so a CLI URL update
// takes effect without restarting the server.
//
// Plain JSON (not encrypted): the file is a runtime config artefact,
// not a secret store — vault credentials live in vault.db. The shape
// is `{"controlPanelUrl": "http://...", "version": "1"}`.
//
// When the file is missing, unreadable, lacks `controlPanelUrl`, or
// the URL is malformed, the sentinel matches nothing and CORS falls
// through to the next rule (explicit allowlist or deny).
const CORSAllowControlPanelURL = "<control-panel-url>"

// CORSAllowLocalNetworks is the sentinel value that, when present in
// allowedOrigins, makes CORSMiddleware reflect any Origin whose
// hostname resolves to a loopback or RFC 1918 / RFC 4193 private
// network address (or the literal `localhost`).
//
// Use case: dev / advanced deployments where the cross-fetcher's
// origin is hard to pin down (multiple browsers, ephemeral docker
// LAN IPs, office VPN). NOT the default for trial/local — the
// preferred default is `<control-panel-url>` (single source of truth
// via `aikey login`). Available as an opt-in for setups that want
// "any local browser may cross-fetch this server" without going
// through aikey login first.
//
// Threat model: public origins (evil.com, 8.8.8.8) fail the
// private-network match and stay blocked from /api/user/vault/*
// enumeration. A malicious page running on the user's LAN (e.g.
// compromised printer admin UI at http://192.168.1.50/) could reach
// 127.0.0.1:8090 — acceptable because any LAN-side attacker already
// has broader options than CORS.
const CORSAllowLocalNetworks = "<local-networks>"

// controlPanelOriginCache caches the parsed config.json origin so the
// CORS hot path doesn't stat the file on every request. 30 s TTL is
// short enough that `aikey login` URL changes propagate quickly without
// requiring a server restart, long enough to amortise file I/O.
type controlPanelOriginCacheEntry struct {
	origin string
	at     time.Time
}

var controlPanelOriginCache atomic.Value // controlPanelOriginCacheEntry

const controlPanelOriginCacheTTL = 30 * time.Second

// readControlPanelOrigin reads `controlPanelUrl` from `~/.aikey/config/
// config.json` and returns its origin (scheme://host[:port]), or empty
// string if the file is missing / unparseable / the URL is malformed.
// Result is cached for `controlPanelOriginCacheTTL`.
//
// We deliberately do NOT inject the path via env — single source of
// truth is the home-relative path that aikey-cli also reads/writes
// (see commands_account/mod.rs `read_remote_control_url` and
// `handle_set_control_url`). Mismatching paths between CLI and server
// would re-introduce the drift the sentinel exists to avoid.
func readControlPanelOrigin() string {
	if c, ok := controlPanelOriginCache.Load().(controlPanelOriginCacheEntry); ok &&
		time.Since(c.at) < controlPanelOriginCacheTTL {
		return c.origin
	}
	origin := loadControlPanelOriginFromDisk()
	controlPanelOriginCache.Store(controlPanelOriginCacheEntry{
		origin: origin,
		at:     time.Now(),
	})
	return origin
}

// loadControlPanelOriginFromDisk is the uncached read path. Exposed for
// tests via a thin wrapper that lets us point at a temp dir.
func loadControlPanelOriginFromDisk() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return loadControlPanelOriginFromPath(filepath.Join(home, ".aikey", "config", "config.json"))
}

func loadControlPanelOriginFromPath(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var parsed struct {
		ControlPanelURL string `json:"controlPanelUrl"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ""
	}
	if parsed.ControlPanelURL == "" {
		return ""
	}
	u, err := url.Parse(parsed.ControlPanelURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// CORSMiddleware sets CORS headers per an origin allowlist that supports
// three sentinel values + explicit exact-match entries.
//
// Semantics:
//   - Empty allowedOrigins → deny all cross-origin requests. Same-origin
//     requests (where the browser omits Origin, or Origin matches the
//     served host) are unaffected. This is the safe default for
//     production servers that don't want any cross-origin reads.
//   - allowedOrigins contains `<control-panel-url>` (CORSAllowControlPanelURL) →
//     reflect the Origin matching `controlPanelUrl` in
//     `~/.aikey/config/config.json` (the URL `aikey login` writes).
//     This is the **single source of truth** for "where is the team
//     server" and the preferred default for trial / local-server.
//   - allowedOrigins contains `<local-networks>` (CORSAllowLocalNetworks) →
//     reflect the Origin when its hostname is loopback (127.0.0.0/8,
//     ::1), private LAN (RFC 1918 IPv4: 10/8, 172.16/12, 192.168/16),
//     IPv6 ULA (RFC 4193 fc00::/7), or the literal `localhost`. Use
//     when the cross-fetcher's URL isn't known via `aikey login`.
//   - allowedOrigins contains "*" → reflect any request Origin
//     (dev/testing only — do not use in prod).
//   - Otherwise → reflect the Origin only when it's an exact match
//     against the allowlist.
//
// Multiple modes combine. Example for a deployment that wants both the
// CLI-tracked URL and an explicit secondary URL:
// `<control-panel-url>,https://other-team.example.com`.
//
// Why the default flipped (2026-04-24 security review): the previous
// behavior treated an empty allowlist as "allow all", which contradicted
// the documented "Empty = same-origin only" contract and let any website
// read /api/user/vault/* via the browser when combined with local_bypass
// auth (anonymous → LocalOwnerAccountID). A malicious page could enumerate
// vault metadata including route_token — a usable proxy bearer.
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	originSet := make(map[string]bool, len(allowedOrigins))
	allowAny := false
	allowLocalNetworks := false
	allowControlPanelURL := false
	for _, o := range allowedOrigins {
		switch o {
		case "*":
			allowAny = true
		case CORSAllowLocalNetworks:
			allowLocalNetworks = true
		case CORSAllowControlPanelURL:
			allowControlPanelURL = true
		default:
			originSet[o] = true
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allow := origin != "" && (allowAny ||
				originSet[origin] ||
				(allowControlPanelURL && origin == readControlPanelOrigin()) ||
				(allowLocalNetworks && isLocalNetworkOrigin(origin)))
			if allow {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Correlation-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")

			// Handle preflight
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// isLocalNetworkOrigin reports whether the given Origin header value
// parses to a hostname that's `localhost`, a loopback IP, or an
// RFC 1918 / RFC 4193 private-network IP. Used by CORSMiddleware when
// the allowlist contains the `<local-networks>` sentinel.
//
// Public DNS names (example.com), public-internet IPs, and malformed
// origins all return false — the goal is to recognise origins that
// genuinely belong to "this machine or its private network", not to be
// a permissive default.
//
// Localhost name resolution is intentionally NOT done via net.LookupHost
// here — that would let an attacker register a public DNS name that
// resolves to 127.0.0.1 and bypass the check. We only trust the literal
// hostname `localhost` plus parsed IP literals.
func isLocalNetworkOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() {
		return true
	}
	// `IsPrivate` covers RFC 1918 + RFC 4193; loopback covers 127.0.0.0/8
	// and ::1. Link-local (169.254.0.0/16, fe80::/10) is intentionally
	// NOT included — those addresses indicate failed DHCP and shouldn't
	// host trusted team-server deployments.
	return false
}

// LoggingMiddleware logs every request with method, path, and correlation ID.
func LoggingMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cid := CorrelationID(r.Context())
			logger.Info("request",
				slog.String("service", "aikey-control-service"),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("correlation_id", cid),
			)
			next.ServeHTTP(w, r)
		})
	}
}

// ── Locale negotiation (Phase E: backend error message i18n) ──────────────────
//
// Why a ResponseWriter wrapper instead of a context value: the ~87 call sites that
// emit errors call DomainErrorResponse(w, err) / HandleDomainErr(w, err) with only
// the ResponseWriter — no *http.Request / context.Context. Threading locale through
// all of them would be an 87-site signature change (and would collide with a
// concurrent edit to master's router.go). LocaleMiddleware wraps w so the negotiated
// locale rides on the value every handler already has; respond.go reads it back.
//
// Supported locales: "en" (default) and "zh". Any tag starting with "zh" → "zh";
// everything else, incl. a missing header (CLI / curl) → "en".
type localeResponseWriter struct {
	http.ResponseWriter
	locale string
}

func (w *localeResponseWriter) Locale() string { return w.locale }

// Flush / Hijack forwarded so the wrapper is transparent to SSE / long-poll /
// websocket handlers that type-assert the ResponseWriter.
func (w *localeResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *localeResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := w.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

// LocaleFromWriter returns the negotiated locale from a wrapped ResponseWriter,
// defaulting to "en" when w is not a localeResponseWriter (e.g. a future middleware
// re-wrapped it without forwarding Locale()). Callers always get a valid locale.
func LocaleFromWriter(w http.ResponseWriter) string {
	if lw, ok := w.(interface{ Locale() string }); ok {
		if loc := lw.Locale(); loc != "" {
			return loc
		}
	}
	return "en"
}

// ParseAcceptLanguage maps an Accept-Language header to a supported locale. We only
// support en/zh, so a cheap first-tag scan is enough (no RFC 7231 q-value parsing).
func ParseAcceptLanguage(header string) string {
	h := strings.TrimSpace(strings.ToLower(header))
	if h == "" {
		return "en"
	}
	first := h
	if i := strings.IndexAny(h, ",;"); i >= 0 {
		first = strings.TrimSpace(h[:i])
	}
	if strings.HasPrefix(first, "zh") {
		return "zh"
	}
	return "en"
}

// LocaleMiddleware negotiates the response locale from Accept-Language and wraps the
// ResponseWriter so DomainErrorResponse can localise messages without a per-call-site
// signature change. Register at the top-level handler (each edition's handler factory
// or cmd/main), NOT in router.go.
func LocaleMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		loc := ParseAcceptLanguage(r.Header.Get("Accept-Language"))
		next.ServeHTTP(&localeResponseWriter{ResponseWriter: w, locale: loc}, r)
	})
}
