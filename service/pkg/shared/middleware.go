package shared

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

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

// CORSMiddleware sets CORS headers per an explicit origin allowlist.
//
// Semantics:
//   - Empty allowedOrigins → deny all cross-origin requests. Same-origin
//     requests (where the browser omits Origin, or Origin matches the
//     served host) are unaffected because browsers don't enforce CORS on
//     them. This is the safe default for local/trial installs.
//   - allowedOrigins contains "*" → echo back the request Origin for any
//     cross-origin caller (dev/testing only — do not use in prod).
//   - Otherwise → echo back the Origin only when it's in the allowlist.
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
	for _, o := range allowedOrigins {
		if o == "*" {
			allowAny = true
			continue
		}
		originSet[o] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && (allowAny || originSet[origin]) {
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
