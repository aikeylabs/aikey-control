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
//	POST /api/user/apps/register       — self-service registration from Web UI (body: {slug, name, vendor?, upstreams[], requested_permissions?[]}) — added 2026-05-25; CLI `aikey app register` remains the canonical vendor-installer path
//	POST /api/user/apps/route          — set per-upstream binding (body: {slug, upstream, key_source_type, key_source_ref})
//	POST /api/user/apps/revoke         — revoke all active keys for slug (body: {slug})
//	POST /api/user/apps/pause          — pause active keys (body: {slug})
//	POST /api/user/apps/resume         — resume paused keys (body: {slug})
//	POST /api/user/apps/rotate         — atomic revoke + reissue with same bindings (body: {slug})
//	POST /api/user/apps/uninstall      — stop service (first-party) OR remove identity (third-party) + revoke / wipe vault rows (body: {slug}) — third-party support added 2026-05-25
//	POST /api/user/apps/reveal-token   — re-read the active bearer plaintext for a slug (body: {slug}) — added 2026-05-25 to spare users a Rotate when they only lost the token, not the app
//	POST /api/user/apps/filter-status  — read content-filter on/off + active stages for a slug (body: {slug}) — added 2026-06-02; backs the local-web AI-compliance toggle
//	POST /api/user/apps/filter-set     — enable / disable the content filter for a slug (body: {slug, enable}) — added 2026-06-02
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
// register — POST /api/user/apps/register
//
// Self-service Web UI registration for third-party apps (claude-mem / Cline /
// Roo Cline / etc.). Added 2026-05-25 as a second path next to the existing
// CLI / vendor-installer flow.
//
// CLI-vs-Web invariants enforced server-side (NOT trusted from client):
//   - app_kind is ALWAYS "third-party". The CLI `_internal app.register`
//     hardcodes first_party=false / follow_user_active=false / rotate_bearer=false
//     for this code path, and rejects reserved first-party slugs early
//     with I_FIRST_PARTY_SLUG_RESERVED.
//   - Reserved slug rejection: any slug in `FIRST_PARTY_SLUGS`
//     (currently {degrade-detector}) returns 409 with code
//     FIRST_PARTY_SLUG_RESERVED.
//
// Response includes the one-time `route_token` plaintext + base_url —
// the Web UI shows this in a token-reveal modal with a Copy button and a
// "this will not be shown again" warning. If the user loses the token,
// the recovery path is `aikey app rotate <slug>` (or the Rotate button
// in the detail page).
// ---------------------------------------------------------------------------

// registerReq is the POST body for /api/user/apps/register. The shape
// intentionally omits app_kind / first_party / follow_user_active —
// those are server-controlled invariants for the Web path. See
// commands_internal/app.rs::handle_register for the matching CLI side.
type registerReq struct {
	Slug                  string   `json:"slug"`
	Name                  string   `json:"name,omitempty"`   // optional; CLI side defaults to slug when empty
	Vendor                string   `json:"vendor,omitempty"` // optional free-text owner tag
	Upstreams             []string `json:"upstreams"`        // at least one required (e.g. ["anthropic"])
	RequestedPermissions  []string `json:"requested_permissions,omitempty"`
}

// RegisterHandler creates a new third-party app + issues a bearer + snapshots
// `aikey use` selections into the per-app binding. This is the Web UI
// equivalent of `aikey app register --slug X --name Y --upstreams Z`.
//
// Validation happens in two layers: this handler checks that required
// fields are non-empty (so the user gets a clean 400 with a clear
// "what's missing" message), and the CLI side runs the deeper checks
// (slug shape, upstream whitelist, reserved-slug policy).
func (h *Handlers) RegisterHandler(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Slug == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "slug required")
		return
	}
	if len(req.Upstreams) == 0 {
		cli.WriteErr(w, cli.ErrBadRequest,
			"upstreams list cannot be empty — pick at least one provider (e.g. \"anthropic\")")
		return
	}

	res, ok := h.invokeBridge(w, r, "register", req)
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

// RevealTokenHandler re-reads the active bearer plaintext for an
// already-registered app. Added 2026-05-25 to address the "I lost the
// token from the register modal, my only recovery is Rotate which
// breaks the running agent" UX gap.
//
// Trade-off intentionally made: the token IS stored plaintext in
// `app_keys.route_token` (UNIQUE + indexed for the proxy registry's
// byToken lookup); any process that can read the vault DB file can
// already retrieve it. Hiding it from the Web UI was security theater
// against the much simpler `sqlite3 vault.db` attack. The reveal
// endpoint instead leans on the genuine gate: vault unlock — which
// covers both this endpoint and the CLI `aikey app reveal-token`.
//
// Why a dedicated endpoint instead of folding into /get: the existing
// /get endpoint is UNLOCK-FREE by design (metadata only, no
// ciphertext). Putting the token there would either require flipping
// /get to require unlock (breaking change for callers that probe
// without a session) or leaking the token to unauthenticated callers.
// The dedicated endpoint preserves the /get policy and explicitly
// requires unlock.
func (h *Handlers) RevealTokenHandler(w http.ResponseWriter, r *http.Request) {
	h.slugOnlyAction(w, r, "reveal-token")
}

// UninstallHandler whole-system removal: stops the plugin's service +
// wipes vault rows. Originally added 2026-05-23 alongside the rc.5
// default-install flip for degrade-detector — users who got the
// service auto-installed needed a UI button to opt out.
//
// **Policy change 2026-05-26**: first-party apps (those in
// `mutationLockedSlugs`) now reject Web-UI uninstall too. The rc.5
// carve-out (uninstall bypassing the lock) was a UX shortcut that
// turned out to be a footgun — accidentally removing Trust Check via
// the Web UI silently breaks the internal pipeline until next CLI
// startup re-asserts the bearer. The CLI path
// (`aikey app uninstall <slug>`) remains the supported channel for
// users who genuinely want to remove a first-party component;
// mirroring `aikey app install <slug>` as the symmetric counterpart.
//
// Web-UI uninstall is still allowed for third-party apps, where the
// CLI side does AiKey-side identity removal only and never touches a
// user-managed binary.
//
// See workflow/CI/bugfix/20260526-first-party-uninstall-blocked.md.
func (h *Handlers) UninstallHandler(w http.ResponseWriter, r *http.Request) {
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
	if _, locked := mutationLockedSlugs[req.Slug]; locked {
		cli.WriteErr(w, cli.ErrAppMutationDenied,
			"app '"+req.Slug+"' is a first-party AiKey component; uninstall is not "+
				"available from the Web UI. Run `aikey app uninstall "+req.Slug+"` "+
				"from the terminal if you really need to remove it.")
		return
	}
	h.slugOnlyAction(w, r, "uninstall")
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
// filter-status / filter-set — content-filter on/off toggle for an app
//
// `filter_stages` on app_records drives whether the local proxy spawns a
// content-filter detector child for that app (NULL = disabled, a
// non-empty stage list like ["pre_forward"] = scan before forwarding).
// Today the only consumer is the ai-compliance-detector fast layer, so
// these endpoints back the local-web "AI compliance detection" on/off
// toggle. They stay generic (slug-parameterized) to match the rest of
// the /api/user/apps/* family and the generic CLI
// `_internal app.filter-status` / `app.filter-set` actions they wrap.
//
// Unlock policy (mirrors the family):
//   - filter-status — read of one metadata column (no ciphertext, no
//     bearer) → no unlock, like list / get.
//   - filter-set    — mutation. Disabling compliance turns OFF a safety
//     control, so it's treated as security-relevant and requires unlock,
//     same as route / pause / resume. The session is already unlocked
//     when the user manages apps, so this adds no prompt in the common
//     path. The CLI side bumps the vault change_seq; the proxy reloads
//     within ~5s and spawns / kills the detector child accordingly.
// ---------------------------------------------------------------------------

// FilterStatusHandler reports whether the content filter is enabled for
// an app + which stages are active. Body: {slug}. Emits the CLI shape
// {slug, enabled, stages}. Drives the compliance toggle's initial state.
func (h *Handlers) FilterStatusHandler(w http.ResponseWriter, r *http.Request) {
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
	res, ok := h.invokeBridgeNoVault(w, r, "filter-status", req)
	if !ok {
		return
	}
	cli.WriteEnvelope(w, res)
}

// FilterSetHandler enables or disables the content filter for an app.
// Body: {slug, enable}. enable=true → filter_stages=["pre_forward"]
// (canonical compliance stage); enable=false → NULL (disabled). Emits
// {slug, enabled}.
func (h *Handlers) FilterSetHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Slug   string `json:"slug"`
		Enable bool   `json:"enable"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Slug == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "slug required")
		return
	}
	res, ok := h.invokeBridge(w, r, "filter-set", req)
	if !ok {
		return
	}
	cli.WriteEnvelope(w, res)
}

// FilterRecordAllowHandler sets whether the local self-view records "allow"
// (clean-scan) events for an app. Body: {slug, enable}. Default off (save
// space). Bridges to `_internal app.filter-record-allow`, which writes the
// vault filter_record_allow flag + bumps change_seq so the proxy reload
// re-spawns the detector with the new AIKEY_COMPLIANCE_RECORD_ALLOW env. Same
// unlock policy as filter-set (a vault mutation). Emits {slug, record_allow}.
func (h *Handlers) FilterRecordAllowHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Slug   string `json:"slug"`
		Enable bool   `json:"enable"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Slug == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "slug required")
		return
	}
	res, ok := h.invokeBridge(w, r, "filter-record-allow", req)
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
