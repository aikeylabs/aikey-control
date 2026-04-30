// Package userlocal assembles the Personal-edition local-server HTTP handler.
//
// This is the minimal Personal control surface — vault management + batch
// import + a stub identity endpoint — and exists so that `aikey-local-server`
// (the binary that runs on a Personal user's machine to serve the local Web
// Console on port 8090 by default) compiles WITHOUT importing any of the
// SaaS-only packages (managedkey / organization / provider / snapshot).
//
// Design intent (Path A refactor, 2026-04-30):
//
//   Before: aikey-local-server pulled in appkit/user → appkit/core → all of
//   the SaaS handler dependencies (managedkey, internal/organization,
//   internal/provider, pkg/snapshot, internal/api). Even though the master
//   route mux was nil-ed out, the type/symbol surface still ended up in the
//   binary (231 master-related strings, 212 ManagedKey type symbols).
//
//   After: aikey-local-server imports this package only. It depends on:
//     - pkg/userapi             (top-level orchestrator: vault + import)
//     - pkg/userapi/{cli,session,vault,intake} (transitively)
//     - pkg/shared              (DB + middleware utilities — public)
//
//   Zero imports from aikey-control-service (master path). The resulting
//   binary's `strings | grep aikey-control-master` count is 0.
//
// Routes provided:
//
//	POST   /api/user/vault/unlock
//	POST   /api/user/vault/lock
//	GET    /api/user/vault/status        (unauthed probe — used by Web UI)
//	POST   /api/user/vault/init          (first-run master-password setup)
//	GET    /api/user/vault/list          (requires unlock)
//	PATCH  /api/user/vault/entry/alias   (requires unlock)
//	POST   /api/user/vault/entry         (requires unlock)
//	DELETE /api/user/vault/entry         (requires unlock)
//	POST   /api/user/vault/use           (requires unlock)
//	POST   /api/user/import/parse        (requires unlock)
//	POST   /api/user/import/confirm      (requires unlock)
//	GET    /api/user/import/rules        (unauthed)
//	GET    /accounts/me                  (local_bypass identity stub)
//	GET    /accounts/me/seats            (empty — Personal has no orgs)
//	GET    /accounts/me/all-keys         (empty — Personal has no team keys)
//	GET    /accounts/me/pending-keys     (empty — Personal has no team keys)
//	GET    /accounts/me/sync-version     (always 0 — no team-key delta cursor)
//	GET    /accounts/me/managed-keys-snapshot (empty)
//
// What this package does NOT provide (out of scope for Personal):
//   - /accounts/login / /accounts/register (Personal uses local_bypass)
//   - /v1/usage/*   (served by aikey-data/query-service if installed)
//   - /v1/keys/resolve  (org-managed VK delivery resolve — SaaS only)
//   - any /master/* route (handled by aikey-control-master, never compiled in)
package userlocal

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	user "github.com/AiKeyLabs/aikey-control/service/pkg/userapi"
)

// Config bundles the optional knobs callers can tune at boot. Zero-valued
// fields fall back to userapi defaults (15min session TTL, 5min VK cache,
// 15s CLI timeout).
type Config struct {
	Logger     *slog.Logger
	SessionTTL time.Duration
	VKCacheTTL time.Duration
	CliTimeout time.Duration

	// UsageFacade is the in-proc query-service handler that owns
	// `/v1/usage/*`. Personal local-server runs the same single-port
	// pattern as cmd/full: trial-server's serve.Run constructs an
	// in-proc querykit.Handler against the local SQLite DB and threads
	// it through ControlConfig.UsageFacade, and we mount it here at
	// `/v1/usage/`. Nil-safe: when the facade isn't supplied, the five
	// `/v1/usage/personal/*` routes the SPA queries 404 (the FE's
	// `useQuery` defensively defaults to empty arrays — charts show
	// empty, no crash).
	UsageFacade http.Handler
}

// NewHandler returns the HTTP handler for the Personal local-server.
//
// Personal local-server runs in `local_bypass` auth mode — the user owns
// the machine, the SPA is served with `authMode:"local_bypass"`, and there
// is no SaaS account to authenticate against. So the auth middleware passed
// to intake is a passthrough (returns the inner handler unchanged).
func NewHandler(cfg Config) http.Handler {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}

	userHandlers := user.NewHandlers(&user.Config{
		SessionTTL: cfg.SessionTTL,
		VKCacheTTL: cfg.VKCacheTTL,
		CliTimeout: cfg.CliTimeout,
	}, logger)

	mux := http.NewServeMux()

	// local_bypass auth: every request is treated as the local user; no JWT.
	// Why a passthrough function (not the userapi constraint relaxed): we
	// want the same Register() call surface across both Personal-local and
	// SaaS deployments so future moves stay one-line edits at the appkit
	// boundary, not changes to userapi itself.
	passThrough := func(h http.Handler) http.Handler { return h }

	userHandlers.Register(mux, passThrough)

	// /accounts/me/* stubs — Personal has no orgs / seats / team-managed keys,
	// but the SPA's My Account / Overview / Pending Keys pages still call
	// these endpoints. Returning fixed-shape empty responses lets the React
	// types stay shared with SaaS (no Personal-specific branch) and lets each
	// page render its empty state rather than a "loading" spinner forever.
	//
	// Why these are inline stubs rather than handlers in pkg/userapi:
	//   - they are HTTP-shape compatibility shims, not domain logic
	//   - they exist solely because Personal has no managedkey / seat / org
	//     domain at all; in SaaS they are served by master Delivery handlers
	mux.HandleFunc("GET /accounts/me", localAccountsMe)
	// Bare array matches FE accountsApi.mySeats: `httpClient.get<SeatSummaryDTO[]>`.
	mux.HandleFunc("GET /accounts/me/seats", emptyJSONArray)
	// /v1/usage/* — mount the in-proc query-service facade if the caller
	// supplied one. Same pattern as cmd/full's master controlkit (the trial
	// server's serve.Run constructs querykit.NewHandler on the local SQLite
	// DB and passes it through ControlConfig.UsageFacade). Personal users
	// thereby read their own collector→DWD usage data without any extra
	// process or HTTP hop. The query-service path is master-free: it lives
	// in aikey-data and only needs the data-component schema, both of which
	// are public. When the facade isn't supplied the SPA charts simply
	// 404 → useQuery falls back to empty arrays (non-fatal).
	if cfg.UsageFacade != nil {
		mux.Handle("/v1/usage/", cfg.UsageFacade)
	}
	// Envelope matches FE deliveryApi.allKeys: `httpClient.get<{keys: UserKeyDTO[]}>`
	// then `res.data.keys ?? []`. Returning bare `[]` here is a footgun because
	// `[].keys` resolves to `Array.prototype.keys` (the iterator factory function),
	// which is truthy → bypasses the `?? []` fallback → caller iterates a function
	// → "TypeError: t is not iterable" at the first `for (const k of allKeys)`
	// callsite (e.g. user/overview's buildProviderRows). Caught by chrome MCP on
	// 2026-04-30 against v1.0.0-rc.1; bugfix log follows.
	mux.HandleFunc("GET /accounts/me/all-keys", emptyKeysEnvelope)
	// Envelope matches FE deliveryApi.pendingKeys: `httpClient.get<{pending_keys: ...}>`.
	// `[].pending_keys` happens to be undefined so the `?? []` fallback saves
	// the day, but mirroring master's exact wire format is the correct fix
	// rather than relying on the absence of a JS prototype property.
	mux.HandleFunc("GET /accounts/me/pending-keys", emptyPendingKeysEnvelope)
	mux.HandleFunc("GET /accounts/me/sync-version", localSyncVersion)
	mux.HandleFunc("GET /accounts/me/managed-keys-snapshot", localKeysSnapshot)

	return mux
}

// localAccountsMe returns a fixed Personal-user identity. The fields match
// what the SaaS /accounts/me endpoint would return (see
// aikey-control-master pkg/identity service.go) so the SPA's TypeScript
// types don't need a Personal-specific branch — Personal just gets a
// default-shaped response.
func localAccountsMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"account_id":   "personal-local",
		"email":        "local@aikey.local",
		"display_name": "Personal User",
		"auth_mode":    "local_bypass",
		"orgs":         []any{}, // Personal has no orgs
	})
}

// emptyJSONArray serves `[]` for endpoints that the SaaS Delivery handler
// would populate from managedkey / seat tables. Personal has neither, so
// every collection-shaped /accounts/me/* endpoint resolves to empty.
func emptyJSONArray(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("[]"))
}

// emptyKeysEnvelope serves `{"keys":[]}` to mirror the SaaS Delivery
// handler's exact wire shape. See the call-site comment for why the bare
// `[]` form crashes the SPA at iteration time.
func emptyKeysEnvelope(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"keys":[]}`))
}

// emptyPendingKeysEnvelope serves `{"pending_keys":[]}` to mirror the SaaS
// Delivery handler's wire shape.
func emptyPendingKeysEnvelope(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"pending_keys":[]}`))
}

// localSyncVersion mirrors the SaaS Delivery.SyncVersion shape with version=0.
// The SPA polls this for the team-key delta cursor; Personal has no team-keys
// so the cursor never advances.
func localSyncVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"sync_version": 0,
	})
}

// localKeysSnapshot serves an empty managed-keys-snapshot payload. Personal
// has no team-managed keys so the snapshot is a fixed empty shape.
func localKeysSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"keys":         []any{},
		"sync_version": 0,
	})
}
