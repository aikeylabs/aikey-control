// Package user is the top-level orchestrator for the user-facing HTTP
// surface (vault + import) shipped from the public repo.
//
// Page rendering lives in aikey-control/web (React + Vite); the built SPA
// is embedded into the trial-server / local-server binaries at compile time
// and served for every unmatched non-API path. There are no Go-side page
// handlers in this layer.
//
// Composition (post 2026-04-30 deep split):
//
//   - cli — Bridge subprocess + shared error model
//   - session   — vault session store + RequireUnlock middleware
//   - vault     — unlock/lock/status/init + Vault-page CRUD
//   - intake — bulk-import parse/confirm/rules + VK list cache
//
// Handlers ties these four together with one shared vault.Store and
// cli.Bridge, then mounts every /api/user/{vault,import}/* route via
// Register().
//
// Referral was removed from this struct on 2026-04-30 (Path A round 2): the
// referral handler depends on a SaaS-only package and is wired separately
// in the SaaS edition. Personal local-server doesn't expose referrals.
package user

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/app"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/hook"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/intake"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/oauth"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/vault"
)

// Config knobs the caller can tune at boot. Zero-valued fields fall back to
// the defaults below.
type Config struct {
	// SessionTTL is the idle timeout for an unlocked vault.
	// v4.1 Stage 13: 默认 15 分钟(之前 10 分钟),让用户在一次导入流程里(粘贴 → 解析 →
	// 编辑 → 逐个 OAuth 登录跳转)不会中途被强制 re-unlock。超过 15 分钟未操作仍自动锁,
	// 保持闲置时的安全边界。
	SessionTTL time.Duration
	// VKCacheTTL is the per-entry TTL for the virtual-key list cache.
	VKCacheTTL time.Duration
	// CliTimeout bounds every `aikey _internal` subprocess invocation.
	CliTimeout time.Duration
}

func defaults() Config {
	return Config{
		SessionTTL: 15 * time.Minute,
		VKCacheTTL: 5 * time.Minute,
		CliTimeout: 15 * time.Second,
	}
}

// Handlers is the user-facing API bundle. Construct via NewHandlers — direct
// struct literals are supported but require pre-built sub-handlers and a
// shared vault.Store, which is what NewHandlers does for you.
type Handlers struct {
	// Store is the shared vault session store. Exposed so callers can stash
	// it in tests (most production callers won't touch it after NewHandlers).
	Store *vault.Store

	// Vault hosts the unlock/lock/status/init endpoints.
	Vault *vault.Handlers

	// VaultCRUD hosts the Vault-page list/add/rename/delete/use endpoints.
	VaultCRUD *vault.CRUDHandlers

	// Import hosts the bulk-import parse/confirm/rules endpoints.
	Import *intake.ImportHandlers

	// Hook hosts the shell-hook rc-wiring endpoint (POST /api/user/hook/install).
	// Only mounted on local-user / trial-full editions — see RegisterHook.
	// Per 20260507-web-hook-rc-modal-自动注入.md.
	Hook *hook.Handlers

	// App hosts the Phase 4 third-party Agent management endpoints
	// (/api/user/apps/*) — list / get / route / revoke / pause / resume /
	// rotate. All endpoints subprocess to aikey-cli `_internal app.<action>`
	// via the shared Bridge. Mounted by Register() under the unlock-gated
	// authMW path (vault session required for all routes, including list).
	App *app.Handlers
}

// NewHandlers constructs the user-facing Handlers bundle. A nil cfg triggers
// defaults (15min session TTL, 5min VK cache, 15s cli timeout).
func NewHandlers(cfg *Config, logger *slog.Logger) *Handlers {
	c := defaults()
	if cfg != nil {
		if cfg.SessionTTL > 0 {
			c.SessionTTL = cfg.SessionTTL
		}
		if cfg.VKCacheTTL > 0 {
			c.VKCacheTTL = cfg.VKCacheTTL
		}
		if cfg.CliTimeout > 0 {
			c.CliTimeout = cfg.CliTimeout
		}
	}

	bridge := cli.New(logger)
	bridge.Timeout = c.CliTimeout
	store := vault.NewStore(c.SessionTTL)
	vkCache := intake.NewVKCache(c.VKCacheTTL)

	return &Handlers{
		Store:     store,
		Vault:     vault.NewHandlers(store, bridge),
		VaultCRUD: vault.NewCRUDHandlers(store, bridge),
		Import:    &intake.ImportHandlers{Bridge: bridge, VKCache: vkCache},
		Hook:      hook.NewHandlers(bridge, logger),
		App:       app.NewHandlers(store, bridge),
	}
}

// Register mounts every /api/user/{vault,import}/* route on mux. authMW is
// the caller's auth middleware — applied to every endpoint EXCEPT
// /vault/status (unauthed probe) and /vault/init (web-driven first-run path,
// pre-auth by design).
//
// Route ownership:
//
//	POST   /api/user/vault/unlock        -> Vault.UnlockHandler
//	POST   /api/user/vault/lock          -> Vault.LockHandler
//	GET    /api/user/vault/status        -> Vault.StatusHandler  (unauthed probe)
//	POST   /api/user/vault/init          -> Vault.InitHandler    (unauthed; first-run web flow)
//	GET    /api/user/vault/list          -> VaultCRUD.ListHandler        (locked-aware; no unlock required)
//	PATCH  /api/user/vault/entry/alias   -> VaultCRUD.AliasPatchHandler  (requires unlock)
//	POST   /api/user/vault/entry         -> VaultCRUD.EntryAddHandler    (requires unlock)
//	DELETE /api/user/vault/entry         -> VaultCRUD.EntryDeleteHandler (requires unlock)
//	POST   /api/user/vault/use           -> VaultCRUD.UseHandler         (requires unlock)
//	POST   /api/user/vault/test          -> VaultCRUD.TestHandler        (no unlock required — probe metadata only)
//	POST   /api/user/vault/test-raw      -> VaultCRUD.TestRawHandler     (no unlock required — pre-save probe, plaintext in body)
//	POST   /api/user/oauth/login         -> oauth.LoginHandler           (no unlock; forwards to aikey-proxy broker)
//	GET    /api/user/oauth/status        -> oauth.StatusHandler          (no unlock; broker session poll for Codex auth_code)
//	POST   /api/user/oauth/poll          -> oauth.PollHandler            (no unlock; broker Device-Code poll for Kimi)
//	POST   /api/user/import/parse        -> Import.ParseHandler
//	POST   /api/user/import/confirm      -> Import.ConfirmHandler        (requires unlock)
//	GET    /api/user/import/rules        -> Import.RulesHandler          (unauthed)
//
// The former POST /api/user/vault/reveal endpoint (plaintext secret read)
// was removed 2026-04-24 security review round 2; see vault/crud.go.
//
// Phase 3B R23 (2026-05-11): `readCORSMW` wraps the read-only vault
// endpoints (`GET /api/user/vault/list`, `GET /api/user/vault/status`)
// so the team server's Overview page can cross-fetch them via the
// `<control-panel-url>` sentinel allowlist. Pass nil to disable
// cross-origin reads entirely (the default for production deployments
// where vault doesn't exist server-side).
//
// Why only `list` + `status` get the CORS wrap (NOT `use`):
//   - `list` returns the keys-with-route_tokens payload the Overview
//     "Accessible Keys" card and the cross-server merge UI need.
//     route_token is a usable proxy bearer — accepted risk per
//     2026-05-11 decision: the `<control-panel-url>` sentinel
//     restricts readers to the single origin the user `aikey login`'d
//     to. (Locked path returns route_token=null; B side reconstructs
//     `aikey_team_<vk_id>` client-side per rc.3 2026-05-12 fix.)
//   - `status` is a probe (initialised / locked) with no secrets.
//   - Mutation endpoints (`unlock`, `lock`, `init`, entry add/patch/
//     delete, `use`) stay same-origin only — a malicious cross-origin
//     POST is much more dangerous than a leaked metadata read.
//
// rc.3 2026-05-12: attempted to open POST /api/user/vault/use to the
// same allowlist for B-side TeamKeys "Use" button but hit a deeper
// I_VAULT_NO_SESSION 401 (vault session cookie deliberately doesn't
// cross origins). The fix moved to the UI: B side renders Use as a
// link opening A's local vault page where the user has a session.
// Reverted the brief POST /vault/use CORS wrap; mutation endpoints
// stay strictly same-origin per the 2026-04-24 vault-leak rule.
func (h *Handlers) Register(
	mux *http.ServeMux,
	authMW func(http.Handler) http.Handler,
	readCORSMW func(http.Handler) http.Handler,
) {
	// Default to passthrough if no CORS wrap supplied (production
	// multi-tenant deployments don't expose vault to the team page).
	if readCORSMW == nil {
		readCORSMW = func(h http.Handler) http.Handler { return h }
	}
	// Vault session endpoints.
	mux.Handle("POST /api/user/vault/unlock", authMW(http.HandlerFunc(h.Vault.UnlockHandler)))
	mux.Handle("POST /api/user/vault/lock", authMW(http.HandlerFunc(h.Vault.LockHandler)))
	mux.Handle("GET /api/user/vault/status", readCORSMW(http.HandlerFunc(h.Vault.StatusHandler)))
	mux.Handle("OPTIONS /api/user/vault/status", readCORSMW(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))

	// Vault first-run init (web-driven path) — per
	// 20260430-个人vault-Web首次设置-方案A.md, only mounted on local-user /
	// trial-full editions. Production multi-tenant deployments don't expose
	// vault-init through the master appkit because that flow would surface
	// a personal-vault concept on team deployments. Mounting here is
	// already gated by the same edition check at the caller.
	mux.HandleFunc("POST /api/user/vault/init", h.Vault.InitHandler)

	// Vault CRUD endpoints. Mutations require an unlocked session; list
	// intentionally does NOT — it serves a safe metadata-only view when
	// locked (2026-04-23 user decision A). See vault/crud.go::ListHandler
	// for the session-dispatch logic.
	if h.VaultCRUD != nil {
		mux.Handle("GET /api/user/vault/list",
			readCORSMW(authMW(http.HandlerFunc(h.VaultCRUD.ListHandler))))
		mux.Handle("OPTIONS /api/user/vault/list", readCORSMW(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})))
		mux.Handle("PATCH /api/user/vault/entry/alias",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.AliasPatchHandler))))
		mux.Handle("POST /api/user/vault/entry",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.EntryAddHandler))))
		mux.Handle("DELETE /api/user/vault/entry",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.EntryDeleteHandler))))
		// /api/user/vault/use stays same-origin only (2026-04-24
		// vault-leak rule). B-side TeamKeys "Use" button opens A's
		// local vault page in a new tab instead — Phase 3B rc.3
		// 2026-05-12 design realization, see 20260511 doc decision 8.
		mux.Handle("POST /api/user/vault/use",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.UseHandler))))

		// Vault connectivity probe (2026-05-22). NOT gated behind
		// RequireUnlock — the underlying CLI action doesn't verify
		// vault_key_hex and doesn't read ciphertext columns; the probe
		// itself runs through aikey-proxy which decrypts server-side.
		// Same stance as `record_usage`: telemetry-class writes shouldn't
		// require the user to type their master password. authMW still
		// gates on the session cookie so only the logged-in owner can
		// trigger probes against their own keys.
		mux.Handle("POST /api/user/vault/test",
			authMW(http.HandlerFunc(h.VaultCRUD.TestHandler)))
		// Pre-save Run-test for Add Key Guided flow (spec §3.1 / §5.1).
		// Same auth posture as /test: session-authenticated owner only;
		// no master-password unlock because the secret comes from the
		// request body and the probe never touches the vault.
		mux.Handle("POST /api/user/vault/test-raw",
			authMW(http.HandlerFunc(h.VaultCRUD.TestRawHandler)))

		// Web-side OAuth Broker forwarding (spec §6). Web browsers
		// can't speak directly to aikey-proxy:27200 (CORS + different
		// origin), so local-server stands in as a same-origin relay
		// to the broker's POST /oauth/login / GET /oauth/status /
		// POST /oauth/poll endpoints. authMW gates by session cookie
		// only — no master-password unlock required because the
		// broker writes refreshed tokens through aikey-proxy which
		// already holds the vault key (Plan D).
		mux.Handle("POST /api/user/oauth/login",
			authMW(http.HandlerFunc(oauth.LoginHandler)))
		mux.Handle("GET /api/user/oauth/status",
			authMW(http.HandlerFunc(oauth.StatusHandler)))
		mux.Handle("POST /api/user/oauth/poll",
			authMW(http.HandlerFunc(oauth.PollHandler)))
	}

	// Import endpoints. ConfirmHandler needs an unlocked session.
	mux.Handle("POST /api/user/import/parse", authMW(http.HandlerFunc(h.Import.ParseHandler)))
	mux.Handle("POST /api/user/import/confirm",
		authMW(http.HandlerFunc(h.Store.RequireUnlock(h.Import.ConfirmHandler))))
	mux.HandleFunc("GET /api/user/import/rules", h.Import.RulesHandler)

	// Phase 4 third-party Agent management endpoints (/api/user/apps/*).
	//
	// Unlock policy (revised 2026-05-21 per dashboard-UX vs vault-leak
	// trade-off):
	//   - list / get        — NO unlock. The data is registration
	//     metadata only (slug / name / vendor / upstreams / app_kind /
	//     binding alias references / timestamps). No ciphertext, no
	//     bearer values. Requiring unlock for a daily-monitoring page
	//     was over-gating; binding alias references like "my-claude"
	//     are not sensitive enough to justify the friction.
	//   - route / revoke / pause / resume / rotate — REQUIRE unlock.
	//     These mutate security-relevant state (re-binding a key,
	//     killing a bearer, issuing a new bearer in rotate's case).
	//
	// All flow through subprocess `aikey _internal app.<action>` via
	// Bridge → JSON response. See pkg/userapi/app/handlers.go for the
	// per-handler shape.
	if h.App != nil {
		mux.Handle("GET /api/user/apps/list",
			authMW(http.HandlerFunc(h.App.ListHandler)))
		mux.Handle("POST /api/user/apps/get",
			authMW(http.HandlerFunc(h.App.GetHandler)))
		// register: Web UI self-service path (added 2026-05-25). Requires
		// unlock because it issues a fresh bearer + writes app_records /
		// app_keys / user_profile_provider_bindings rows. See
		// commands_internal/app.rs::handle_register for the server-side
		// invariants (forces app_kind=third-party, blocks reserved slugs).
		mux.Handle("POST /api/user/apps/register",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.RegisterHandler))))
		mux.Handle("POST /api/user/apps/route",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.RouteHandler))))
		mux.Handle("POST /api/user/apps/revoke",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.RevokeHandler))))
		mux.Handle("POST /api/user/apps/pause",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.PauseHandler))))
		mux.Handle("POST /api/user/apps/resume",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.ResumeHandler))))
		mux.Handle("POST /api/user/apps/rotate",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.RotateHandler))))
		mux.Handle("POST /api/user/apps/uninstall",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.UninstallHandler))))
		// reveal-token: re-read the active bearer plaintext. Requires
		// unlock because the response carries the token. Added
		// 2026-05-25 to address the "I lost the token, my only
		// recovery is Rotate which disrupts the agent" UX gap. See
		// pkg/userapi/app/handlers.go::RevealTokenHandler for the
		// design rationale on why a dedicated endpoint vs. folding
		// into /get.
		mux.Handle("POST /api/user/apps/reveal-token",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.App.RevealTokenHandler))))
	}
}

// RegisterHook mounts POST /api/user/hook/install behind authMW.
//
// **Edition guard**: callers MUST only invoke this on local-user /
// trial-full editions (i.e., wherever the trial-server / local-server
// process and the user's terminal share the same `~/.zshrc`).
// Production multi-tenant deployments where the service runs on a
// remote box must NOT call RegisterHook — writing the server's
// dotfile would do nothing for the user's terminal and pollutes the
// service host. The decision lives at the caller (serve.go) so the
// edition check stays close to the rest of the deployment-mode logic.
//
// Per 20260507-web-hook-rc-modal-自动注入.md.
func (h *Handlers) RegisterHook(mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	if h.Hook == nil {
		return
	}
	mux.Handle("POST /api/user/hook/install",
		authMW(http.HandlerFunc(h.Hook.InstallHandler)))
}
