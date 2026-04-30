package vault

// User Vault Web page — CRUD HTTP handlers.
//
// This file is the Go shell for the /user/vault React page. All endpoints
// delegate vault reads/writes to the Rust cli via the shared `cli.Bridge`
// (one subprocess per request); Go owns only the HTTP surface, the unlock
// session cookie, and orchestration (alias-conflict auto-suffix, response
// flattening).
//
// Routes (mounted by the userapi top-level Register):
//
//	GET    /api/user/vault/list                — merged Personal + OAuth list.
//	                                             Locked: returns metadata only (alias, provider, base_url, created_at);
//	                                             Unlocked: same shape PLUS secret_prefix/_suffix/_len for Personal rows.
//	PATCH  /api/user/vault/entry/alias          — rename (target-aware, auto-suffix on conflict) (unlock required)
//	DELETE /api/user/vault/entry                — delete (target-aware) (unlock required)
//	POST   /api/user/vault/entry                — add Personal (OAuth returns 403 with guidance) (unlock required)
//
// The former POST /api/user/vault/reveal endpoint was removed 2026-04-24
// (security review round 2) — plaintext secrets never travel CLI → Go →
// browser anymore. The drawer shows a copyable `aikey get <alias>` command
// so users retrieve the plaintext in their terminal.
//
// Design anchors (see 阶段3-增强版KEY管理/个人vault-Web页面-技术方案.md):
//   - §2.0 unified `target` field flows end-to-end — every record and every
//     write carries it, so the front end picks chips / actions by target.
//   - OAuth tokens are never revealed (D3). Enforced structurally (no endpoint).
//   - Alias conflicts auto-retry with `-2/-3/...` up to 20 times (D7).

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// CRUDHandlers bundles the User-Vault-page endpoints. Depends on
// Store + cli.Bridge already built by the orchestrator.
type CRUDHandlers struct {
	Store  *Store
	Bridge *cli.Bridge
}

// NewCRUDHandlers wires a CRUDHandlers with shared deps.
func NewCRUDHandlers(store *Store, bridge *cli.Bridge) *CRUDHandlers {
	return &CRUDHandlers{Store: store, Bridge: bridge}
}

// ============================================================================
// GET /api/user/vault/list
// ============================================================================

// listResponse wraps both target slices merged into one `records` array plus
// per-target counts so the footer stat strip ("14 active · 2 stale · ...")
// doesn't need a second round trip.
type listResponse struct {
	Status string           `json:"status"`
	Data   listResponseData `json:"data"`
}
type listResponseData struct {
	Records []json.RawMessage `json:"records"`
	Counts  map[string]int    `json:"counts"`
	Locked  bool              `json:"locked"`
}

// ListHandler: GET /api/user/vault/list.
//
// Dispatches to one of two cli paths based on whether the caller has an
// unlocked vault session:
//
//   - Unlocked → spawns `query list_personal_with_masked` + `query list_oauth`
//     in parallel and merges the two into a single `records[]` array.
//   - Locked → spawns the single `query list_metadata_locked` action.
//
// Why this handler does its own session lookup instead of running under
// RequireUnlock middleware: we intentionally SHOULD serve this endpoint
// when locked, so the middleware would be wrong for it. See also
// `list_metadata_locked` in aikey-cli/src/commands_internal/query.rs
// for the security reasoning (2026-04-23 user decision A).
func (h *CRUDHandlers) ListHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var hex string
	var haveSession bool
	if c, err := r.Cookie(SessionCookie); err == nil {
		if key, _, ok := h.Store.Get(c.Value); ok {
			hex = key
			haveSession = true
		}
	}

	if !haveSession {
		// Locked path — single cli call, no decryption.
		res, err := h.Bridge.Invoke(ctx, "query", "list_metadata_locked", cli.PlaceholderHex, "", struct{}{})
		if err != nil {
			cli.WriteInvokeError(w, err)
			return
		}
		if res.Status != "ok" {
			// First-run case: vault DB doesn't exist yet, so the cli reports
			// I_VAULT_NOT_INITIALIZED. The /user/vault page must still render
			// (it's the "set master password" empty state) — surfacing this as
			// a 500 makes the FE show "Failed to load: 500" instead of the
			// first-run UI. Treat as success with empty records; the FE
			// already polls /api/user/vault/status separately to decide the
			// "set master password" affordance.
			if res.ErrorCode == "I_VAULT_NOT_INITIALIZED" {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status": "ok",
					"data": map[string]any{
						"records": []json.RawMessage{},
						"counts":  map[string]int{"personal": 0, "oauth": 0, "team": 0, "total": 0},
						"locked":  true,
					},
				})
				return
			}
			cli.WriteCliError(w, res)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		out := map[string]any{"status": "ok", "data": json.RawMessage(res.Data)}
		if res.RequestID != "" {
			out["request_id"] = res.RequestID
		}
		_ = json.NewEncoder(w).Encode(out)
		return
	}

	// Unlocked path — two parallel cli calls. Per-goroutine channels are
	// deliberate: the earlier single-channel version read results back in
	// completion order, so whichever call finished first got labeled
	// "personal". Symptom: identity strip occasionally showed the Personal
	// / OAuth counts swapped. Separate channels guarantee source-accurate
	// labeling regardless of which cli subprocess returns first.
	type result struct {
		records []json.RawMessage
		count   int
		err     error
	}
	personalCh := make(chan result, 1)
	oauthCh := make(chan result, 1)

	go func() {
		res, err := h.Bridge.Invoke(ctx, "query", "list_personal_with_masked", hex, "", struct{}{})
		personalCh <- collectRecords(res, err, "entries")
	}()
	go func() {
		res, err := h.Bridge.Invoke(ctx, "query", "list_oauth", hex, "", struct{}{})
		oauthCh <- collectRecords(res, err, "accounts")
	}()

	personal := <-personalCh
	oauth := <-oauthCh
	if personal.err != nil {
		cli.WriteInvokeError(w, personal.err)
		return
	}
	if oauth.err != nil {
		cli.WriteInvokeError(w, oauth.err)
		return
	}

	merged := make([]json.RawMessage, 0, len(personal.records)+len(oauth.records))
	merged = append(merged, personal.records...)
	merged = append(merged, oauth.records...)

	resp := listResponse{
		Status: "ok",
		Data: listResponseData{
			Records: merged,
			Counts: map[string]int{
				"personal": personal.count,
				"oauth":    oauth.count,
				"team":     0,
				"total":    personal.count + oauth.count,
			},
			Locked: false,
		},
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(resp)
}

// collectRecords extracts the array-of-objects payload from either list_*
// cli response into a uniform shape. `arrayField` is the JSON key that holds
// the array in data (`entries` for personal, `accounts` for oauth).
func collectRecords(res *cli.Result, err error, arrayField string) struct {
	records []json.RawMessage
	count   int
	err     error
} {
	out := struct {
		records []json.RawMessage
		count   int
		err     error
	}{}
	if err != nil {
		out.err = err
		return out
	}
	if res.Status != "ok" {
		out.err = &cli.InvokeError{Code: res.ErrorCode, Msg: res.ErrorMessage}
		return out
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(res.Data, &data); err != nil {
		out.err = &cli.InvokeError{Code: cli.ErrCliMalformedReply, Msg: err.Error()}
		return out
	}
	raw, ok := data[arrayField]
	if !ok {
		return out
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		out.err = &cli.InvokeError{Code: cli.ErrCliMalformedReply, Msg: err.Error()}
		return out
	}
	out.records = arr
	out.count = len(arr)
	return out
}

// ============================================================================
// PATCH /api/user/vault/entry/alias
// ============================================================================

type aliasPatchRequest struct {
	Target   string `json:"target"`    // personal | oauth | team
	ID       string `json:"id"`        // alias (personal) or provider_account_id (oauth)
	NewValue string `json:"new_value"` // new alias / display_identity
}

// AliasPatchHandler: PATCH /api/user/vault/entry/alias.
func (h *CRUDHandlers) AliasPatchHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := KeyFrom(r.Context())
	if !ok {
		cli.WriteErr(w, cli.ErrVaultLocked, "vault not unlocked")
		return
	}
	var req aliasPatchRequest
	if err := decodeBody(r, &req); err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, err.Error())
		return
	}
	switch req.Target {
	case "personal", "oauth":
	case "team":
		cli.WriteErr(w, cli.ErrUnknownTarget, "target 'team' is not implemented in v1.0")
		return
	default:
		cli.WriteErr(w, cli.ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}
	if req.ID == "" || req.NewValue == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "id and new_value must be non-empty")
		return
	}

	if req.Target != "personal" {
		h.invokeRenameOnce(w, r, hex, req.Target, req.ID, req.NewValue)
		return
	}

	name := req.NewValue
	for attempt := 0; attempt < 20; attempt++ {
		res, err := h.Bridge.Invoke(r.Context(), "update-alias", "rename_target", hex, "", aliasPatchRequest{
			Target: "personal", ID: req.ID, NewValue: name,
		})
		if err != nil {
			cli.WriteInvokeError(w, err)
			return
		}
		if res.Status == "ok" {
			cli.WriteEnvelope(w, res)
			return
		}
		if res.ErrorCode != "I_CREDENTIAL_CONFLICT" {
			cli.WriteCliError(w, res)
			return
		}
		name = nextSuffix(req.NewValue, attempt+2)
	}
	cli.WriteErr(w, cli.ErrAliasSuffixExhausted, "20 consecutive alias conflicts — pick a different stem")
}

func (h *CRUDHandlers) invokeRenameOnce(w http.ResponseWriter, r *http.Request, hex, target, id, newValue string) {
	res, err := h.Bridge.Invoke(r.Context(), "update-alias", "rename_target", hex, "", aliasPatchRequest{
		Target: target, ID: id, NewValue: newValue,
	})
	if err != nil {
		cli.WriteInvokeError(w, err)
		return
	}
	cli.WriteEnvelope(w, res)
}

// nextSuffix turns `foo` into `foo-2`, `foo-3`, ...  If the stem already ends
// with `-N` we replace the N (so `foo-5` with attempt=2 becomes `foo-2`, not
// `foo-5-2`). This keeps the UI-visible name short even after multiple races.
func nextSuffix(stem string, n int) string {
	if idx := strings.LastIndex(stem, "-"); idx > 0 && idx < len(stem)-1 {
		tail := stem[idx+1:]
		allDigits := true
		for _, ch := range tail {
			if ch < '0' || ch > '9' {
				allDigits = false
				break
			}
		}
		if allDigits {
			stem = stem[:idx]
		}
	}
	return stem + "-" + itoa(n)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ============================================================================
// DELETE /api/user/vault/entry
// ============================================================================

type entryDeleteRequest struct {
	Target string `json:"target"`
	ID     string `json:"id"`
}

// EntryDeleteHandler: DELETE /api/user/vault/entry.
func (h *CRUDHandlers) EntryDeleteHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := KeyFrom(r.Context())
	if !ok {
		cli.WriteErr(w, cli.ErrVaultLocked, "vault not unlocked")
		return
	}
	var req entryDeleteRequest
	if err := decodeBody(r, &req); err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, err.Error())
		return
	}
	if req.ID == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "id must be non-empty")
		return
	}
	switch req.Target {
	case "personal", "oauth":
	case "team":
		cli.WriteErr(w, cli.ErrUnknownTarget, "target 'team' is not implemented in v1.0")
		return
	default:
		cli.WriteErr(w, cli.ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}

	res, err := h.Bridge.Invoke(r.Context(), "vault-op", "delete_target", hex, "", req)
	if err != nil {
		cli.WriteInvokeError(w, err)
		return
	}
	cli.WriteEnvelope(w, res)
}

// ============================================================================
// POST /api/user/vault/entry
// ============================================================================

type entryAddRequest struct {
	Target      string   `json:"target"`                     // personal (required; oauth/team rejected)
	Alias       string   `json:"alias"`                      // required
	SecretPlain string   `json:"secret_plaintext,omitempty"` // for personal add
	Provider    string   `json:"provider,omitempty"`         // single-protocol shorthand
	Providers   []string `json:"providers,omitempty"`        // multi-protocol (takes precedence)
	BaseURL     string   `json:"base_url,omitempty"`
}

// EntryAddHandler: POST /api/user/vault/entry.
func (h *CRUDHandlers) EntryAddHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := KeyFrom(r.Context())
	if !ok {
		cli.WriteErr(w, cli.ErrVaultLocked, "vault not unlocked")
		return
	}
	var req entryAddRequest
	if err := decodeBody(r, &req); err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, err.Error())
		return
	}
	switch req.Target {
	case "", "personal":
		req.Target = "personal"
	case "oauth":
		cli.WriteErr(w, cli.ErrOAuthAddViaCLI,
			"OAuth accounts must be added via `aikey account login <provider>` from the CLI")
		return
	case "team":
		cli.WriteErr(w, cli.ErrUnknownTarget, "target 'team' is not implemented in v1.0")
		return
	default:
		cli.WriteErr(w, cli.ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}
	if req.Alias == "" || req.SecretPlain == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "alias and secret_plaintext must be non-empty")
		return
	}

	name := req.Alias
	stem := req.Alias
	for attempt := 0; attempt < 20; attempt++ {
		payload := map[string]any{
			"alias":            name,
			"secret_plaintext": req.SecretPlain,
			"on_conflict":      "error",
		}
		if len(req.Providers) > 0 {
			payload["providers"] = req.Providers
		} else if req.Provider != "" {
			payload["provider"] = req.Provider
		}
		if req.BaseURL != "" {
			payload["base_url"] = req.BaseURL
		}
		res, err := h.Bridge.Invoke(r.Context(), "vault-op", "add", hex, "", payload)
		if err != nil {
			cli.WriteInvokeError(w, err)
			return
		}
		if res.Status == "ok" {
			cli.WriteEnvelope(w, res)
			return
		}
		if res.ErrorCode != "I_CREDENTIAL_CONFLICT" {
			cli.WriteCliError(w, res)
			return
		}
		name = nextSuffix(stem, attempt+2)
	}
	cli.WriteErr(w, cli.ErrAliasSuffixExhausted, "20 consecutive alias conflicts — pick a different stem")
}

// ============================================================================
// POST /api/user/vault/use
// ============================================================================

type useRequest struct {
	Target string `json:"target"`
	ID     string `json:"id"`
}

// UseHandler: POST /api/user/vault/use.
//
// Switches the default-profile provider binding(s) for the given key.
// Multi-provider semantics match `aikey use` non-interactive mode.
//
// Unlock required — the underlying vault-op verifies the vault_key against
// password_hash. The routing binding table isn't encrypted, but unlock is
// still required because the operation also refreshes `~/.aikey/active.env`.
func (h *CRUDHandlers) UseHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := KeyFrom(r.Context())
	if !ok {
		cli.WriteErr(w, cli.ErrVaultLocked, "vault not unlocked")
		return
	}
	var req useRequest
	if err := decodeBody(r, &req); err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, err.Error())
		return
	}
	if req.ID == "" {
		cli.WriteErr(w, cli.ErrBadRequest, "id must be non-empty")
		return
	}
	switch req.Target {
	// Stage 7-1 (active-state cross-shell sync, 2026-04-27): team accepted.
	// CLI resolves vk by virtual_key_id, local_alias, or server alias and
	// validates local_state / key_status before writing the binding. The
	// CLI returns I_KEY_DISABLED / I_KEY_STALE / I_KEY_NO_PROVIDER for
	// unusable team keys; those flow through WriteInvokeError unchanged.
	case "personal", "oauth", "team":
	default:
		cli.WriteErr(w, cli.ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}

	res, err := h.Bridge.Invoke(r.Context(), "vault-op", "use", hex, "", req)
	if err != nil {
		cli.WriteInvokeError(w, err)
		return
	}
	cli.WriteEnvelope(w, res)
}

// decodeBody decodes a JSON request body with a 256 KiB cap.
func decodeBody(r *http.Request, v any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, v)
}
