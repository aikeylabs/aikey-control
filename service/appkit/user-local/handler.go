// Package userlocal assembles the Personal-edition local-server HTTP handler.
//
// This is the minimal Personal control surface — vault management + batch
// import + a stub identity endpoint — and exists so that `aikey-local-server`
// (the binary that runs on a Personal user's machine to serve the local Web
// Console on port 8090 by default) compiles without pulling in any
// SaaS-only modules.
//
// It imports only:
//   - pkg/userapi             (top-level orchestrator: vault + import)
//   - pkg/userapi/{cli,session,vault,intake} (transitively)
//   - pkg/shared              (DB + middleware utilities)
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
//   - any backend admin route (SaaS-only, never compiled in)
package userlocal

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/crossappmenu"
	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
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

	// ComplianceDB is the local data SQLite DB (control.db) used by the
	// Phase-3 local compliance self-view store. When non-nil, NewHandler
	// mounts two routes:
	//   POST /v1/compliance/events        — ingest (machine endpoint; the
	//       local detector POSTs here. No auth: the local-server binds
	//       127.0.0.1 only, and original text never leaves the box — DC5.)
	//   GET  /api/user/compliance/events  — read the user's own events
	//       (local_bypass; metadata + redacted snippet only, never原文).
	// Nil = both routes absent (404). Wired from trial-server cmd/local
	// (the same *sql.DB serve.Run opened + migrated). The tables
	// (local_compliance_events / local_compliance_findings) are created by
	// the rc.9 ComponentData migration.
	ComplianceDB *sql.DB

	// ReadTeamURL returns the team-server base URL the user has logged
	// into via `aikey login --control-url`, or "" if not logged in.
	// Nil = endpoint disabled (returns 404). Used by /system/team-url
	// to let the local web auto-discover where to fetch the Team
	// cross-app menu from, so users don't have to manually configure
	// the URL in localStorage.
	//
	// Why a function (not a string): vault may evolve at runtime
	// (logout / re-login between requests). Each call re-reads.
	// Caller wires this from trial-server (which has the SQLite dep)
	// — see cmd/local/main.go.
	ReadTeamURL func() (string, error)

	// ReadTeamJWT returns the team-server JWT the CLI obtained during
	// `aikey login`, or "" if not logged in. Nil = endpoint disabled
	// (returns 404). Used by /system/team-jwt — Phase 3A vault-merge
	// needs the JWT to authorise cross-origin fetches against the
	// team server's /accounts/me/all-keys.
	//
	// Security: the endpoint is intentionally same-origin only (no
	// CORS headers — see handleTeamJWT) so other web apps in the
	// browser can't read this user's JWT. The Personal local web
	// (port 8090) is the only legitimate caller, and it runs in the
	// same origin as local-server itself.
	ReadTeamJWT func() (string, error)

	// ReadLoggedInEmail returns the email of the user currently logged
	// in via `aikey login` (from vault's platform_account.email), or
	// "" when no login session exists. Nil = endpoint falls back to
	// the default `local@aikey.local` stub.
	//
	// Why: the sidebar avatar in the Personal local web (port 8090)
	// reads /accounts/me to render its identity. Without this hook
	// it would always show `local@aikey.local` even after the user
	// logged into a team server — confusing because the same web
	// also surfaces team-key data fetched under that account. Reading
	// the vault on every request keeps the badge in lockstep with
	// login / logout state changes between requests.
	ReadLoggedInEmail func() (string, error)

	// LogoutCmd, if set, enables POST /system/logout. It's expected to
	// subprocess to `aikey logout --json` (same as the user typing the
	// command in their terminal) — that clears vault platform_account,
	// disables team keys, and wipes ghost bindings in one go. Nil =
	// endpoint absent (404). Wired in trial-server cmd/local/main.go.
	LogoutCmd func(ctx context.Context) error

	// SetControlURLCmd, if set, enables POST /system/team-url. It's
	// expected to subprocess to `aikey account set-url <url> --json`
	// which atomically updates vault platform_account.control_url +
	// config.json default URL + aikey-proxy.yaml
	// events.collector_routes.team. Nil = endpoint absent (404).
	SetControlURLCmd func(ctx context.Context, url string) error

	// CORSOrigins is the allowlist passed to shared.CORSMiddleware
	// for the endpoints the **team server's web** is allowed to
	// cross-fetch (Phase 3B R23, 2026-05-11). Surface kept narrow:
	//
	//   - /accounts/me                 (identity for Overview header)
	//   - /accounts/me/seats           (seat counter)
	//   - /v1/usage/personal/*         (charts + Recent Requests)
	//
	// Other endpoints (vault, intake, hook, system/*) intentionally
	// stay same-origin only — see the 2026-04-24 vault-leak
	// protection rule in pkg/shared/middleware.go.
	//
	// The expected value in trial-edition yaml is the sentinel
	// `<control-panel-url>` which `shared.CORSMiddleware` resolves
	// at request time by reading `controlPanelUrl` from
	// `~/.aikey/config/config.json` (`aikey login` writes this file
	// — single source of truth for the team server URL). Empty list
	// disables cross-origin reads entirely.
	CORSOrigins []string
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

	// Phase 3B R23 (2026-05-11): cross-origin read CORS for
	// /api/user/vault/{list,status} — passed as 3rd arg to Register.
	// Uses the same CORSOrigins allowlist (sentinel `<control-panel-url>`
	// resolves to the team URL from `aikey login`) as the /accounts/me
	// and /v1/usage/* wraps below.
	vaultReadCORS := shared.CORSMiddleware(cfg.CORSOrigins)
	userHandlers.Register(mux, passThrough, vaultReadCORS)
	// Web-modal "Allow" → POST /api/user/hook/install (Hook coverage v1
	// update 2026-05-07). Personal local-server always runs on the same
	// machine as the user's terminal, so the route is unconditionally
	// mounted here. Production gates by Mode at the master router; see
	// aikey-control-master/service/internal/api/router.go.
	userHandlers.RegisterHook(mux, passThrough)

	// /accounts/me/* stubs — Personal has no orgs / seats / team-managed keys,
	// but the SPA's My Account / Overview / Pending Keys pages still call
	// these endpoints. Returning fixed-shape empty responses lets the React
	// types stay shared with SaaS (no Personal-specific branch) and lets each
	// page render its empty state rather than a "loading" spinner forever.
	//
	// Why these are inline stubs rather than handlers in pkg/userapi:
	//   - they are HTTP-shape compatibility shims, not domain logic
	//   - they exist solely because Personal has no team-key / seat / org
	//     domain at all; in SaaS they are served by the Delivery handlers
	// Phase 3B R23 (2026-05-11): /accounts/me + /accounts/me/seats +
	// /v1/usage/* are cross-fetched by the team server's web (Overview
	// page reads local-server identity + usage data over CORS so the
	// Personal user's view on the team URL shows their own machine's
	// data). Wrapped with `shared.CORSMiddleware(cfg.CORSOrigins)` —
	// in trial-edition the allowlist is the `<control-panel-url>`
	// sentinel, which reflects only the origin matching
	// `controlPanelUrl` from `~/.aikey/config/config.json` (the URL
	// `aikey login` wrote — single source of truth).
	//
	// Vault / intake / hook / system/team-jwt stay outside this wrap:
	// they're sensitive (JWT, secret keys, request mutations) and
	// remain same-origin only per the 2026-04-24 vault-leak rule.
	corsWrap := shared.CORSMiddleware(cfg.CORSOrigins)
	mux.Handle("GET /accounts/me", corsWrap(localAccountsMe(cfg.ReadLoggedInEmail, logger)))
	mux.Handle("OPTIONS /accounts/me",
		corsWrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})))
	// Bare array matches FE accountsApi.mySeats: `httpClient.get<SeatSummaryDTO[]>`.
	mux.Handle("GET /accounts/me/seats", corsWrap(http.HandlerFunc(emptyJSONArray)))
	mux.Handle("OPTIONS /accounts/me/seats",
		corsWrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})))
	// /v1/usage/* — mount the in-proc query-service facade if the caller
	// supplied one. The trial server's serve.Run constructs
	// querykit.NewHandler on the local SQLite DB and passes it through
	// ControlConfig.UsageFacade. Personal users thereby read their own
	// collector→DWD usage data without any extra process or HTTP hop.
	// When the facade isn't supplied the SPA charts simply 404 → useQuery
	// falls back to empty arrays (non-fatal). Same R23 CORS wrap as
	// above so the team server's Overview page can cross-fetch the
	// timeline / by-protocol / recent endpoints from this local-server.
	if cfg.UsageFacade != nil {
		mux.Handle("/v1/usage/", corsWrap(cfg.UsageFacade))
	}
	// Phase 3 local compliance self-view store (control.db). Ingest is a
	// machine endpoint (no CORS/auth — 127.0.0.1 bind + DC5); read is a
	// local_bypass browser endpoint wrapped with the same R23 CORS so the
	// team server's web can cross-fetch the user's own events. See the
	// Config.ComplianceDB doc + compliance_handlers.go.
	if cfg.ComplianceDB != nil {
		mux.Handle("POST /v1/compliance/events", complianceIngestHandler(cfg.ComplianceDB, logger))
		mux.Handle("GET /api/user/compliance/events", corsWrap(complianceListHandler(cfg.ComplianceDB, logger)))
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
	// the day, but mirroring the SaaS wire format is the correct fix rather
	// than relying on the absence of a JS prototype property.
	mux.HandleFunc("GET /accounts/me/pending-keys", emptyPendingKeysEnvelope)
	mux.HandleFunc("GET /accounts/me/sync-version", localSyncVersion)
	mux.HandleFunc("GET /accounts/me/managed-keys-snapshot", localKeysSnapshot)

	// /system/cross-app-menu — exposes the Personal sidebar menu so that
	// a Team-side web (running at the user's team server origin) can
	// fetch this list at runtime and render Personal entries in its own
	// sidebar (M scheme, see roadmap update 20260510-personal-team-数据隔
	// 离与合并显示.md). Wrapped in CORS so the cross-origin fetch from
	// the team web works.
	mux.Handle("GET /system/cross-app-menu",
		withCrossAppMenuCORS(crossappmenu.Handler(crossappmenu.SourcePersonal, crossappmenu.PersonalMenu)))
	mux.Handle("OPTIONS /system/cross-app-menu",
		withCrossAppMenuCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})))

	// /system/team-url — auto-discovery for the local web. Returns the
	// team-server URL the user has logged into via `aikey login
	// --control-url <REMOTE>` (read from the CLI vault). The web uses
	// this to populate cross-app sidebar links without making the user
	// manually paste the URL into localStorage / Settings.
	//
	// Response shape: {"team_url": "http://..."} when set, {"team_url": ""}
	// when not logged in (still 200 — empty is a valid state, not an
	// error). Endpoint absent (404) when the host process didn't supply
	// ReadTeamURL — typically only in test harnesses.
	if cfg.ReadTeamURL != nil {
		mux.Handle("GET /system/team-url", withCrossAppMenuCORS(handleTeamURL(cfg.ReadTeamURL, logger)))
		mux.Handle("OPTIONS /system/team-url",
			withCrossAppMenuCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})))
	}

	// /system/team-jwt — same-origin-only endpoint that returns the
	// team-server JWT for the local web's vault-page Team-key merge.
	// Phase 3A only — see roadmap update 20260511-vault-page-team-key-
	// merged-display.md.
	//
	// SECURITY: NO CORS headers. The browser default deny on cross-origin
	// reads keeps this endpoint accessible only from the same origin
	// (http://localhost:8090 / http://127.0.0.1:8090) where local-server
	// itself serves the SPA. JWT is sensitive — never reflect Origin.
	if cfg.ReadTeamJWT != nil {
		mux.HandleFunc("GET /system/team-jwt", handleTeamJWT(cfg.ReadTeamJWT, logger))
	}

	// /system/logout — POST. Same-origin only (no CORS). Clears vault
	// platform_account + team-key bindings via the injected LogoutCmd.
	// Used by the Web Console's Settings page sign-out button.
	if cfg.LogoutCmd != nil {
		mux.HandleFunc("POST /system/logout", handleLogout(cfg.LogoutCmd, logger))
	}

	// /system/team-url — POST. Same-origin only (no CORS). Updates the
	// control URL via the injected SetControlURLCmd (which mirrors
	// `aikey account set-url <url>`). The matching GET is registered
	// above under withCrossAppMenuCORS for cross-app menu discovery;
	// the POST stays same-origin because it mutates vault state.
	if cfg.SetControlURLCmd != nil {
		mux.HandleFunc("POST /system/team-url", handleSetTeamURL(cfg.SetControlURLCmd, logger))
	}

	// /system/team-url/probe — POST. Same-origin only. GET <url>/health
	// against the user-typed URL with a 5s timeout and report reachable
	// true/false. Lets the Web Console's "Test connectivity" button
	// verify a URL before committing it. No injector needed — the
	// endpoint owns its http.Client.
	mux.HandleFunc("POST /system/team-url/probe", handleProbeTeamURL(logger))

	// /api/internal/services/<name>/<action> — service-control endpoint
	// for the trust-check page's "Start service" button (M5 Day 5
	// follow-up Z6). Whitelisted to trust-local only (web/proxy are
	// in the CLI but not here — see service_handler.go header).
	//
	// localhost-only by virtue of local-server's bind; no CORS wrap
	// because the only caller is the SPA served from the same origin.
	// Uses Go 1.22+ pattern placeholders so the SPA catch-all doesn't
	// shadow this route.
	mux.HandleFunc("POST /api/internal/services/{name}/{action}", HandleServiceAction(logger))

	// Wrap the whole control handler so every API response carries the
	// negotiated locale (Accept-Language → resolved locale header). One wrap
	// here covers Personal local-server AND the control routes composed into
	// the trial bundle — both build their handler via this NewHandler.
	return shared.LocaleMiddleware(mux)
}

// withCrossAppMenuCORS allows the /system/cross-app-menu endpoint to be
// fetched cross-origin from any origin. The endpoint serves only static
// menu metadata (labels + paths + sentinels) — no secrets, no user data,
// no mutation — so a permissive Access-Control-Allow-Origin is safe and
// avoids the operator having to enumerate every team-server origin a
// Personal user might log into. Method/header restrictions still scope
// the surface to harmless GETs.
//
// Why not localhost-only: the team web runs at the user's team server
// origin (e.g., http://team.example.com:3000), not localhost. A
// fixed allowlist would force per-deploy config. For a static
// metadata-only endpoint that's overkill.
func withCrossAppMenuCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", strings.Join([]string{"GET", "OPTIONS"}, ", "))
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		h.ServeHTTP(w, r)
	})
}

// handleTeamJWT serves GET /system/team-jwt. Same-origin only (no CORS
// headers anywhere in the chain — see /system/team-jwt registration).
// Returns the JWT from the CLI vault, or "" when the user hasn't logged
// in. Read errors collapse to empty (same convention as handleTeamURL)
// so the caller can treat both "no JWT" and "vault unreachable" the
// same way (degrade to no team data).
func handleTeamJWT(read func() (string, error), logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		jwt, err := read()
		if err != nil {
			logger.Warn("read team JWT from vault", "error", err)
			jwt = ""
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		// Vault state can change between requests (logout/login); JWT
		// also rotates on refresh. Don't cache.
		w.Header().Set("Cache-Control", "no-store")
		// Defence-in-depth: even if some intermediary tries to inject
		// a CORS header, also signal we don't want this in any cache
		// keyed off Origin or Authorization.
		w.Header().Set("Vary", "Origin, Authorization")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"jwt": jwt})
	}
}

// handleTeamURL serves GET /system/team-url. Calls the injected
// ReadTeamURL on every request (vault may have changed since boot).
// Read errors collapse to empty — the caller treats empty same as
// "not logged in", and the operator sees the actual error in the log.
func handleTeamURL(read func() (string, error), logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		url, err := read()
		if err != nil {
			logger.Warn("read team URL from vault", "error", err)
			url = ""
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store") // vault state changes shouldn't be cached
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"team_url": url})
	}
}

// localAccountsMe returns the Personal-user identity. The fields match what
// the SaaS /accounts/me endpoint would return so the SPA's TypeScript types
// don't need a Personal-specific branch.
//
// When readEmail is supplied and returns a non-empty value, the response
// reflects the email the user logged in with via `aikey login` (read from
// vault's platform_account row on every call so the sidebar stays in lockstep
// with login / logout between requests). Otherwise it falls back to the
// `local@aikey.local` stub — the not-logged-in default.
func localAccountsMe(readEmail func() (string, error), logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		email := "local@aikey.local"
		if readEmail != nil {
			if v, err := readEmail(); err != nil {
				logger.Warn("read logged-in email from vault", "error", err)
			} else if v != "" {
				email = v
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		// Vault state can change between requests (login / logout); don't
		// cache. Same convention as /system/team-url and /system/team-jwt.
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"account_id":   "personal-local",
			"email":        email,
			"display_name": "Personal User",
			"auth_mode":    "local_bypass",
			"orgs":         []any{}, // Personal has no orgs
		})
	}
}

// emptyJSONArray serves `[]` for endpoints that the SaaS Delivery handler
// would populate from team / seat tables. Personal has neither, so every
// collection-shaped /accounts/me/* endpoint resolves to empty.
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
