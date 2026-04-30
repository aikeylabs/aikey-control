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
// referral handler depends on the SaaS-only `pkg/referral` package which now
// lives in `aikey-control-master`. Master appkit/core wires its own referral
// handler directly; Personal local-server doesn't expose referrals.
package user

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/intake"
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
//	POST   /api/user/import/parse        -> Import.ParseHandler
//	POST   /api/user/import/confirm      -> Import.ConfirmHandler        (requires unlock)
//	GET    /api/user/import/rules        -> Import.RulesHandler          (unauthed)
//
// The former POST /api/user/vault/reveal endpoint (plaintext secret read)
// was removed 2026-04-24 security review round 2; see vault/crud.go.
func (h *Handlers) Register(mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Vault session endpoints.
	mux.Handle("POST /api/user/vault/unlock", authMW(http.HandlerFunc(h.Vault.UnlockHandler)))
	mux.Handle("POST /api/user/vault/lock", authMW(http.HandlerFunc(h.Vault.LockHandler)))
	mux.HandleFunc("GET /api/user/vault/status", h.Vault.StatusHandler)

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
			authMW(http.HandlerFunc(h.VaultCRUD.ListHandler)))
		mux.Handle("PATCH /api/user/vault/entry/alias",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.AliasPatchHandler))))
		mux.Handle("POST /api/user/vault/entry",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.EntryAddHandler))))
		mux.Handle("DELETE /api/user/vault/entry",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.EntryDeleteHandler))))
		mux.Handle("POST /api/user/vault/use",
			authMW(http.HandlerFunc(h.Store.RequireUnlock(h.VaultCRUD.UseHandler))))
	}

	// Import endpoints. ConfirmHandler needs an unlocked session.
	mux.Handle("POST /api/user/import/parse", authMW(http.HandlerFunc(h.Import.ParseHandler)))
	mux.Handle("POST /api/user/import/confirm",
		authMW(http.HandlerFunc(h.Store.RequireUnlock(h.Import.ConfirmHandler))))
	mux.HandleFunc("GET /api/user/import/rules", h.Import.RulesHandler)
}
