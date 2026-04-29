package importpkg

import (
	"log/slog"
	"net/http"
	"time"
)

// Handlers is the top-level bundle mounted on /api/user/{import,vault}/*.
// Keeping the two sub-groups together simplifies wiring: the user package's
// Handlers struct only needs one Import *importpkg.Handlers field, and the
// router in internal/api/router.go only needs one Register call.
type Handlers struct {
	Vault     *VaultHandlers
	Import    *ImportHandlers
	VaultCRUD *VaultCRUDHandlers
}

// Config knobs the caller can tune at boot.
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

// defaults returns Config values aligned with the UX v2 recommendations.
func defaults() Config {
	return Config{
		SessionTTL: 15 * time.Minute,
		VKCacheTTL: 5 * time.Minute,
		CliTimeout: 15 * time.Second,
	}
}

// NewHandlers constructs the Handlers bundle. A nil cfg triggers defaults.
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

	bridge := NewCliBridge(logger)
	bridge.Timeout = c.CliTimeout
	store := NewSessionStore(c.SessionTTL)
	vkCache := NewVKCache(c.VKCacheTTL)

	return &Handlers{
		Vault:     &VaultHandlers{Store: store, Bridge: bridge},
		Import:    &ImportHandlers{Bridge: bridge, VKCache: vkCache},
		VaultCRUD: NewVaultCRUDHandlers(store, bridge),
	}
}

// Register attaches the HTTP routes to the given mux under the standard
// /api/user/ prefix. authMW should be the caller's JWT auth middleware
// (same one used for /accounts/me); we apply it to everything except
// /vault/status which the Web UI probes before login.
//
// Route ownership:
//
//	POST   /api/user/vault/unlock        -> VaultHandlers.UnlockHandler
//	POST   /api/user/vault/lock          -> VaultHandlers.LockHandler
//	GET    /api/user/vault/status        -> VaultHandlers.StatusHandler (unauthed probe)
//	GET    /api/user/vault/list          -> VaultCRUDHandlers.ListHandler        (requires unlock)
//	PATCH  /api/user/vault/entry/alias   -> VaultCRUDHandlers.AliasPatchHandler  (requires unlock)
//	POST   /api/user/vault/entry         -> VaultCRUDHandlers.EntryAddHandler    (requires unlock)
//	DELETE /api/user/vault/entry         -> VaultCRUDHandlers.EntryDeleteHandler (requires unlock)
//	POST   /api/user/vault/use           -> VaultCRUDHandlers.UseHandler         (requires unlock)
//
// The former POST /api/user/vault/reveal endpoint (plaintext secret read)
// was removed 2026-04-24 security review round 2; see vault_crud.go.
//	POST   /api/user/import/parse        -> ImportHandlers.ParseHandler
//	POST   /api/user/import/confirm      -> ImportHandlers.ConfirmHandler        (requires unlock)
//	GET    /api/user/import/rules        -> ImportHandlers.RulesHandler
func (h *Handlers) Register(mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Vault session endpoints.
	mux.Handle("POST /api/user/vault/unlock", authMW(http.HandlerFunc(h.Vault.UnlockHandler)))
	mux.Handle("POST /api/user/vault/lock", authMW(http.HandlerFunc(h.Vault.LockHandler)))
	mux.HandleFunc("GET /api/user/vault/status", h.Vault.StatusHandler)

	// Vault CRUD endpoints (User Vault Web page). Mutations + reveal require
	// an unlocked session; list intentionally does NOT — it serves a safe
	// metadata-only view when locked (2026-04-23 user decision A). See
	// vault_crud.go::ListHandler for the session-dispatch logic.
	// Registered only when VaultCRUD is wired — older NewHandlers invocations
	// that pre-date the vault page will leave it nil and skip these routes.
	if h.VaultCRUD != nil {
		mux.Handle("GET /api/user/vault/list",
			authMW(http.HandlerFunc(h.VaultCRUD.ListHandler)))
		mux.Handle("PATCH /api/user/vault/entry/alias",
			authMW(http.HandlerFunc(h.Vault.RequireUnlock(h.VaultCRUD.AliasPatchHandler))))
		mux.Handle("POST /api/user/vault/entry",
			authMW(http.HandlerFunc(h.Vault.RequireUnlock(h.VaultCRUD.EntryAddHandler))))
		mux.Handle("DELETE /api/user/vault/entry",
			authMW(http.HandlerFunc(h.Vault.RequireUnlock(h.VaultCRUD.EntryDeleteHandler))))
		// POST /api/user/vault/reveal was removed 2026-04-24 (security review
		// round 2). The drawer now shows `aikey get <alias>` as a copyable
		// command so plaintext never crosses the HTTP boundary. See
		// vault_crud.go for the rationale block.
		mux.Handle("POST /api/user/vault/use",
			authMW(http.HandlerFunc(h.Vault.RequireUnlock(h.VaultCRUD.UseHandler))))
	}

	// Import endpoints. ConfirmHandler needs an unlocked session, enforced by
	// VaultHandlers.RequireUnlock middleware.
	// 2026-04-23: removed /api/user/import/history route along with the un-
	// shipped import_jobs / import_items tables.
	mux.Handle("POST /api/user/import/parse", authMW(http.HandlerFunc(h.Import.ParseHandler)))
	mux.Handle("POST /api/user/import/confirm",
		authMW(http.HandlerFunc(h.Vault.RequireUnlock(h.Import.ConfirmHandler))))
	mux.HandleFunc("GET /api/user/import/rules", h.Import.RulesHandler)
}
