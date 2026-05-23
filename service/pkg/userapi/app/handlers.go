// Package app hosts the HTTP handler surface for the Phase 4 third-party
// Agent management Web page (/user/apps). All endpoints orchestrate the
// Rust aikey CLI through the shared `cli.Bridge` (one subprocess per
// request); Go owns only the HTTP surface, the unlock session cookie,
// and small request/response shaping.
//
// Routes (mounted by appkit/user-local Register):
//
//	GET  /api/user/apps/list           — list all registered apps with their bindings
//	POST /api/user/apps/get            — fetch detail for one app (body: {slug})
//	POST /api/user/apps/route          — set per-upstream binding (body: {slug, upstream, key_source_type, key_source_ref})
//	POST /api/user/apps/revoke         — revoke all active keys for slug (body: {slug})
//	POST /api/user/apps/pause          — pause active keys (body: {slug})
//	POST /api/user/apps/resume         — resume paused keys (body: {slug})
//	POST /api/user/apps/rotate         — atomic revoke + reissue with same bindings (body: {slug})
//
// Unlock policy (revised 2026-05-21):
//   - list / get        — public read; no unlock required. The data is
//     registration metadata only (slug / name / vendor / upstreams /
//     binding alias refs / timestamps). No ciphertext, no bearer value.
//   - route / revoke / pause / resume / rotate — mutation; require
//     unlock. Caller is guarded by Store.RequireUnlock at the route
//     level (see pkg/userapi/handlers.go); these handlers pull the
//     session vault_key from request context via invokeBridge.
//
// list / get use invokeBridgeNoVault — same Bridge call but with an
// empty vault_key_hex. The CLI side (`_internal app.list` / `app.get`)
// does not need the key because those queries don't decrypt anything.
//
// Design anchors:
//   - 路线图 §5.2.4 "走 local-api, 不是通用 REST" — local-only, CSRF-gated, no public API
//   - CLAUDE.md `_internal 隐藏命令必须复用公开命令逻辑` — CLI side wraps
//     `commands_app::{list_apps, get_app_record, set_app_binding, ...}`
//     pub fn cores; Go side wraps that CLI via Bridge subprocess
//   - 路线图 Day 9.5 register UX redesign — no "Authorize" endpoint;
//     registration happens via CLI / vendor installer, the Web is for
//     post-registration management only
package app

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/vault"
)

// Handlers bundles the /api/user/apps/* endpoints. Depends on the vault
// Store (for session cookie + vault_key) and cli.Bridge (for subprocess
// dispatch to aikey-cli).
type Handlers struct {
	Store  *vault.Store
	Bridge *cli.Bridge
}

// NewHandlers wires a Handlers with shared deps.
func NewHandlers(store *vault.Store, bridge *cli.Bridge) *Handlers {
	return &Handlers{Store: store, Bridge: bridge}
}

// invokeBridge is the shared wrapper around Bridge.Invoke for the
// mutation endpoints (route / revoke / pause / resume / rotate). It
// pulls the session vault_key from request context (the route is
// guarded by Store.RequireUnlock so the key must be present) and
// converts cli errors / non-ok envelopes to HTTP responses. Returns
// true when the caller should keep going (envelope was status=ok);
// false means a response was already written.
func (h *Handlers) invokeBridge(
	w http.ResponseWriter,
	r *http.Request,
	action string,
	payload any,
) (*cli.Result, bool) {
	hex, ok := vault.KeyFrom(r.Context())
	if !ok {
		// RequireUnlock middleware should have caught this; safety net.
		cli.WriteErr(w, cli.ErrVaultLocked, "session missing — unlock again")
		return nil, false
	}
	return h.invokeBridgeRaw(w, r, action, hex, payload)
}

// invokeBridgeNoVault is the read-path variant for list / get. The
// route is NOT guarded by RequireUnlock, so we deliberately pass an
// empty vault_key_hex — `_internal app.list` / `app.get` ignore it.
func (h *Handlers) invokeBridgeNoVault(
	w http.ResponseWriter,
	r *http.Request,
	action string,
	payload any,
) (*cli.Result, bool) {
	return h.invokeBridgeRaw(w, r, action, "", payload)
}

func (h *Handlers) invokeBridgeRaw(
	w http.ResponseWriter,
	r *http.Request,
	action string,
	vaultKeyHex string,
	payload any,
) (*cli.Result, bool) {
	res, err := h.Bridge.Invoke(r.Context(), "app", action, vaultKeyHex, "", payload)
	if err != nil {
		cli.WriteInvokeError(w, err)
		return nil, false
	}
	if res.Status != "ok" {
		cli.WriteCliError(w, res)
		return nil, false
	}
	return res, true
}

// ---------------------------------------------------------------------------
// list — GET /api/user/apps/list
// ---------------------------------------------------------------------------

// ListHandler returns the list of all registered apps with their per-
// upstream bindings + active-key summary. Drives the Web "Connected
// Apps" list page.
//
// Response shape mirrors what aikey-cli's `_internal app list` emits:
//
//	{
//	  "status": "ok",
//	  "data": {
//	    "apps": [
//	      {
//	        "slug": "security-audit",
//	        "name": "Security Audit Agent",
//	        "vendor": "...",
//	        "upstreams": ["anthropic", "openai"],
//	        "app_kind": "third-party",
//	        "follow_user_active": false,
//	        "has_active_key": true,
//	        "key_id": "uuid",
//	        "last_used_at": 1716300000,
//	        "key_created_at": 1716200000,
//	        "bindings": [
//	          {"upstream": "anthropic", "key_source_type": "personal", "key_source_ref": "my-claude"}
//	        ],
//	        "created_at": 1716100000,
//	        "updated_at": 1716200000
//	      }
//	    ]
//	  }
//	}
func (h *Handlers) ListHandler(w http.ResponseWriter, r *http.Request) {
	res, ok := h.invokeBridgeNoVault(w, r, "list", struct{}{})
	if !ok {
		return
	}
	cli.WriteEnvelope(w, res)
}

// ---------------------------------------------------------------------------
// get — POST /api/user/apps/get
// ---------------------------------------------------------------------------

// getReq is the POST body for /api/user/apps/get. POST (not GET with
// query params) because the slug carries no sensitive info but the
// pattern matches the mutation endpoints below — consistent CSRF token
// handling, consistent error responses.
type getReq struct {
	Slug string `json:"slug"`
}

// GetHandler returns full detail for one app: AppRecord + per-upstream
// bindings + currently active keys list. Drives the Web "App Detail"
// page.
func (h *Handlers) GetHandler(w http.ResponseWriter, r *http.Request) {
	var req getReq
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Slug == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "slug required")
		return
	}
	res, ok := h.invokeBridgeNoVault(w, r, "get", req)
	if !ok {
		return
	}
	cli.WriteEnvelope(w, res)
}

// ---------------------------------------------------------------------------
// route — POST /api/user/apps/route
// ---------------------------------------------------------------------------

// routeReq is the POST body for /api/user/apps/route.
//
// `key_source_type` must be one of:
//   - "personal" / "personal_api_key" → personal vault alias
//   - "team" / "managed_virtual_key"  → team-managed virtual key
//   - "personal_oauth_account"         → personal OAuth account id
//
// `key_source_ref` is the alias / virtual_key_id / oauth_account_id
// matching the chosen key_source_type.
type routeReq struct {
	Slug          string `json:"slug"`
	Upstream      string `json:"upstream"`
	KeySourceType string `json:"key_source_type"`
	KeySourceRef  string `json:"key_source_ref"`
}

// RouteHandler upserts the per-upstream binding for an app. This is the
// "Switch Key" action in the Web Detail page.
func (h *Handlers) RouteHandler(w http.ResponseWriter, r *http.Request) {
	var req routeReq
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Slug == "" || req.Upstream == "" || req.KeySourceType == "" || req.KeySourceRef == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "slug, upstream, key_source_type, key_source_ref are all required")
		return
	}
	res, ok := h.invokeBridge(w, r, "route", req)
	if !ok {
		return
	}
	cli.WriteEnvelope(w, res)
}

// ---------------------------------------------------------------------------
// revoke / pause / resume / rotate — POST /api/user/apps/{action}
//
// All four share the same {slug} payload shape, so they reuse one
// helper. Why POST (not DELETE for revoke / PATCH for pause-resume):
// consistent CSRF / origin-check / audit-log machinery, and the
// frontend invokes them all the same way.
// ---------------------------------------------------------------------------

func (h *Handlers) RevokeHandler(w http.ResponseWriter, r *http.Request) {
	h.slugOnlyAction(w, r, "revoke")
}

func (h *Handlers) PauseHandler(w http.ResponseWriter, r *http.Request) {
	h.slugOnlyAction(w, r, "pause")
}

func (h *Handlers) ResumeHandler(w http.ResponseWriter, r *http.Request) {
	h.slugOnlyAction(w, r, "resume")
}

func (h *Handlers) RotateHandler(w http.ResponseWriter, r *http.Request) {
	h.slugOnlyAction(w, r, "rotate")
}

// Apps whose bearer is wired into an AiKey-internal pipeline. Revoke /
// rotate on these would tear down the internal component — e.g. the
// degrade-detector bearer feeds trust-local's reporter and the proxy's
// rhythm observer; revoking it leaves Check / observations 401-ing.
// Pause / resume stay allowed because they're recoverable: resume re-
// activates the same bearer without forcing a re-register.
//
// SCOPED PER USER REQUEST (2026-05-23): only degrade-detector. We
// considered locking ALL first-party apps but the user explicitly chose
// the narrow rule — future first-party additions must opt into this
// list explicitly so the policy decision is visible at code review.
// See workflow/CI/bugfix/20260523-app-mutation-policy.md.
var mutationLockedSlugs = map[string]struct{}{
	"degrade-detector": {},
}

// slugOnlyAction is the shared body for revoke / pause / resume / rotate
// — all take a {slug} payload + return whatever the CLI emits verbatim.
func (h *Handlers) slugOnlyAction(w http.ResponseWriter, r *http.Request, action string) {
	var req struct {
		Slug string `json:"slug"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Slug == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "slug required")
		return
	}
	if action == "revoke" || action == "rotate" {
		if _, locked := mutationLockedSlugs[req.Slug]; locked {
			cli.WriteErr(w, cli.ErrAppMutationDenied,
				"app '"+req.Slug+"' is wired into an AiKey-internal pipeline; "+
					action+" would break the internal component. "+
					"Use pause/resume if you want to temporarily stop it.")
			return
		}
	}
	res, ok := h.invokeBridge(w, r, action, req)
	if !ok {
		return
	}
	cli.WriteEnvelope(w, res)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// decodeBody reads the JSON body into `dst`. Returns false (and writes
// an error response) on read / decode failure so callers can bail with
// a clean `if !decodeBody(...) { return }`.
//
// Limits body to 64 KiB — these endpoints carry slugs / aliases at most,
// so a runaway body is a sign of probe traffic.
func decodeBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, "read body: "+err.Error())
		return false
	}
	if len(body) == 0 {
		cli.WriteErr(w, cli.ErrBadRequest, "empty body")
		return false
	}
	if err := json.Unmarshal(body, dst); err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, "decode body: "+err.Error())
		return false
	}
	return true
}
