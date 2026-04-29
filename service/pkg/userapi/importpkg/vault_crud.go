package importpkg

// User Vault Web page — CRUD HTTP handlers.
//
// This file is the Go shell for the /user/vault React page. All endpoints
// delegate vault reads/writes to the Rust cli via the shared `CliBridge`
// (one subprocess per request); Go owns only the HTTP surface, the unlock
// session cookie, and orchestration (alias-conflict auto-suffix, response
// flattening).
//
// Routes (mounted in importpkg.Handlers.Register):
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
// so users retrieve the plaintext in their terminal (where it lands in the
// clipboard with auto-clear, and never crosses the HTTP boundary).
//
// Design anchors (see 阶段3-增强版KEY管理/个人vault-Web页面-技术方案.md):
//   - §2.0 unified `target` field flows end-to-end — every record and every
//     write carries it, so the front end picks chips / actions by target.
//   - OAuth tokens are never revealed (D3). This is now enforced by the
//     absence of any reveal endpoint rather than by a 403 branch.
//   - Alias conflicts auto-retry with `-2/-3/...` up to 20 times (D7).

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// VaultCRUDHandlers bundles the five User-Vault-page endpoints. Depends on
// SessionStore + CliBridge already built by NewHandlers.
type VaultCRUDHandlers struct {
	Store  *SessionStore
	Bridge *CliBridge
}

// NewVaultCRUDHandlers wires a VaultCRUDHandlers with shared deps.
func NewVaultCRUDHandlers(store *SessionStore, bridge *CliBridge) *VaultCRUDHandlers {
	return &VaultCRUDHandlers{
		Store:  store,
		Bridge: bridge,
	}
}

// ============================================================================
// GET /api/user/vault/list
// ============================================================================

// listResponse wraps both target slices merged into one `records` array plus
// per-target counts so the footer stat strip ("14 active · 2 stale · ...")
// doesn't need a second round trip.
type listResponse struct {
	Status string             `json:"status"`
	Data   listResponseData   `json:"data"`
}
type listResponseData struct {
	Records []json.RawMessage `json:"records"`
	Counts  map[string]int    `json:"counts"`
	// Locked: true when the caller had no valid vault session. In that
	// mode Personal records carry secret_prefix/_suffix/_len = null and
	// the UI renders a fully-masked secret pill. Kept explicit in the
	// payload so the front end doesn't have to infer it from the field
	// shape of the first record.
	Locked  bool              `json:"locked"`
}

// ListHandler: GET /api/user/vault/list.
//
// Dispatches to one of two cli paths based on whether the caller has an
// unlocked vault session:
//
//   - Unlocked (valid session cookie in Store) → spawns `query
//     list_personal_with_masked` + `query list_oauth` in parallel and
//     merges the two into a single `records[]` array. Personal rows
//     carry secret_prefix / secret_suffix / secret_len so the UI can
//     render `sk-ant-api03-•••••-afef3`.
//
//   - Locked (no cookie / expired session) → spawns the single `query
//     list_metadata_locked` action, which reads ONLY plaintext columns
//     from vault.db (no AES-GCM decryption, no password_hash check).
//     Personal rows carry secret_prefix / secret_suffix / secret_len
//     = null; the UI renders a pure-asterisk secret pill.
//
// Why this handler does its own session lookup instead of running under
// RequireUnlock middleware: we intentionally SHOULD serve this endpoint
// when locked, so the middleware would be wrong for it. See also
// `list_metadata_locked` in aikey-cli/src/commands_internal/query.rs
// for the security reasoning (2026-04-23 user decision A).
func (h *VaultCRUDHandlers) ListHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Look up the session cookie directly. This is the same path
	// RequireUnlock uses internally, but without returning an error when
	// missing. If present-but-expired, Store.get() deletes the entry and
	// returns ok=false — we treat both as "locked".
	var hex string
	var haveSession bool
	if c, err := r.Cookie(sessionCookie); err == nil {
		if key, _, ok := h.Store.get(c.Value); ok {
			hex = key
			haveSession = true
		}
	}

	if !haveSession {
		// Locked path — single cli call, no decryption. placeholderHex is
		// a 64-char all-zero string; the cli-side `list_metadata_locked`
		// action format-validates but does not compare to password_hash.
		res, err := h.Bridge.Invoke(ctx, "query", "list_metadata_locked", placeholderHex, "", struct{}{})
		if err != nil {
			writeInvokeError(w, err)
			return
		}
		if res.Status != "ok" {
			writeCliError(w, res)
			return
		}
		// The locked cli path already emits the flat {records, counts,
		// locked} shape — relay verbatim so the front end has one schema
		// across both paths (with `locked` flag to tell them apart).
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		out := map[string]any{"status": "ok", "data": json.RawMessage(res.Data)}
		if res.RequestID != "" {
			out["request_id"] = res.RequestID
		}
		_ = json.NewEncoder(w).Encode(out)
		return
	}

	// Unlocked path — two parallel cli calls. The cli is stateless so
	// concurrent subprocess is safe (see CliBridge doc).
	//
	// Per-goroutine channels are deliberate: the earlier single-channel
	// version read results back in completion order, so whichever call
	// finished first got labeled "personal". Symptom: identity strip
	// occasionally showed the Personal / OAuth counts swapped (the user
	// report that led to this fix). Separate channels guarantee
	// source-accurate labeling regardless of which cli subprocess
	// returns first.
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
		writeInvokeError(w, personal.err)
		return
	}
	if oauth.err != nil {
		writeInvokeError(w, oauth.err)
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
				"team":     0, // reserved for future use (§2.0 unified target)
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
func collectRecords(res *resultEnvelope, err error, arrayField string) struct {
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
		out.err = &InvokeError{Code: res.ErrorCode, Msg: res.ErrorMessage}
		return out
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(res.Data, &data); err != nil {
		out.err = &InvokeError{Code: ErrCliMalformedReply, Msg: err.Error()}
		return out
	}
	raw, ok := data[arrayField]
	if !ok {
		// empty vault: cli returns {"count":0, "entries":[]}; but if the key
		// is missing entirely we treat as empty rather than erroring out.
		return out
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		out.err = &InvokeError{Code: ErrCliMalformedReply, Msg: err.Error()}
		return out
	}
	out.records = arr
	out.count = len(arr)
	return out
}

// ============================================================================
// PATCH /api/user/vault/entry/alias
// ============================================================================

// aliasPatchRequest is the browser-side body for a rename. `target` flows
// directly to cli `update-alias rename_target`.
type aliasPatchRequest struct {
	Target   string `json:"target"`    // personal | oauth | team
	ID       string `json:"id"`        // alias (personal) or provider_account_id (oauth)
	NewValue string `json:"new_value"` // new alias / display_identity
}

// AliasPatchHandler: PATCH /api/user/vault/entry/alias.
func (h *VaultCRUDHandlers) AliasPatchHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := vaultKeyFrom(r.Context())
	if !ok {
		writeErr(w, ErrVaultLocked, "vault not unlocked")
		return
	}
	var req aliasPatchRequest
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, ErrBadRequest, err.Error())
		return
	}
	switch req.Target {
	case "personal", "oauth":
	case "team":
		writeErr(w, ErrUnknownTarget, "target 'team' is not implemented in v1.0")
		return
	default:
		writeErr(w, ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}
	if req.ID == "" || req.NewValue == "" {
		writeErr(w, ErrBadRequest, "id and new_value must be non-empty")
		return
	}

	// For personal we auto-suffix on I_CREDENTIAL_CONFLICT (§D7). OAuth has no
	// UNIQUE constraint on display_identity, so single-shot is sufficient.
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
			writeInvokeError(w, err)
			return
		}
		if res.Status == "ok" {
			writeEnvelope(w, res)
			return
		}
		if res.ErrorCode != "I_CREDENTIAL_CONFLICT" {
			writeCliError(w, res)
			return
		}
		// Append / bump a -N suffix on the *original* requested name, not on
		// the last attempt — so repeated conflicts produce `foo-2`, `foo-3`,
		// not `foo-2-3-4`.
		name = nextSuffix(req.NewValue, attempt+2)
	}
	writeErr(w, ErrAliasSuffixExhausted, "20 consecutive alias conflicts — pick a different stem")
}

// invokeRenameOnce is the non-retry path used for oauth (and any future
// target that doesn't need alias uniqueness).
func (h *VaultCRUDHandlers) invokeRenameOnce(w http.ResponseWriter, r *http.Request, hex, target, id, newValue string) {
	res, err := h.Bridge.Invoke(r.Context(), "update-alias", "rename_target", hex, "", aliasPatchRequest{
		Target: target, ID: id, NewValue: newValue,
	})
	if err != nil {
		writeInvokeError(w, err)
		return
	}
	writeEnvelope(w, res)
}

// nextSuffix turns `foo` into `foo-2`, `foo-3`, ...  If the stem already ends
// with `-N` we replace the N (so `foo-5` with attempt=2 becomes `foo-2`, not
// `foo-5-2`). This keeps the UI-visible name short even after multiple races.
func nextSuffix(stem string, n int) string {
	// Strip trailing `-<digits>` if present.
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

// itoa is a tiny int-to-string that avoids pulling in strconv just here.
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
func (h *VaultCRUDHandlers) EntryDeleteHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := vaultKeyFrom(r.Context())
	if !ok {
		writeErr(w, ErrVaultLocked, "vault not unlocked")
		return
	}
	var req entryDeleteRequest
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, ErrBadRequest, err.Error())
		return
	}
	if req.ID == "" {
		writeErr(w, ErrBadRequest, "id must be non-empty")
		return
	}
	switch req.Target {
	case "personal", "oauth":
	case "team":
		writeErr(w, ErrUnknownTarget, "target 'team' is not implemented in v1.0")
		return
	default:
		writeErr(w, ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}

	res, err := h.Bridge.Invoke(r.Context(), "vault-op", "delete_target", hex, "", req)
	if err != nil {
		writeInvokeError(w, err)
		return
	}
	writeEnvelope(w, res)
}

// ============================================================================
// POST /api/user/vault/entry
// ============================================================================

// entryAddRequest mirrors cli `vault-op add` payload. We only accept
// `target=personal` at this layer — OAuth add is explicitly routed through
// the CLI (`aikey account login <provider>`) per 2026-04-23 decision D6.
type entryAddRequest struct {
	Target         string   `json:"target"`                    // personal (required; oauth/team rejected)
	Alias          string   `json:"alias"`                     // required
	SecretPlain    string   `json:"secret_plaintext,omitempty"`// for personal add
	Provider       string   `json:"provider,omitempty"`        // single-protocol shorthand
	Providers      []string `json:"providers,omitempty"`       // multi-protocol (takes precedence)
	BaseURL        string   `json:"base_url,omitempty"`
}

// EntryAddHandler: POST /api/user/vault/entry.
func (h *VaultCRUDHandlers) EntryAddHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := vaultKeyFrom(r.Context())
	if !ok {
		writeErr(w, ErrVaultLocked, "vault not unlocked")
		return
	}
	var req entryAddRequest
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, ErrBadRequest, err.Error())
		return
	}
	switch req.Target {
	case "", "personal":
		req.Target = "personal"
	case "oauth":
		writeErr(w, ErrOAuthAddViaCLI,
			"OAuth accounts must be added via `aikey account login <provider>` from the CLI")
		return
	case "team":
		writeErr(w, ErrUnknownTarget, "target 'team' is not implemented in v1.0")
		return
	default:
		writeErr(w, ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}
	if req.Alias == "" || req.SecretPlain == "" {
		writeErr(w, ErrBadRequest, "alias and secret_plaintext must be non-empty")
		return
	}

	// Auto-suffix on conflict, same loop as rename. We inject the stem into
	// a fresh payload each iteration (not a pointer — Invoke marshals every
	// call) so the trailing `-N` is the only mutating field.
	name := req.Alias
	stem := req.Alias
	for attempt := 0; attempt < 20; attempt++ {
		payload := map[string]any{
			"alias":            name,
			"secret_plaintext": req.SecretPlain,
			"on_conflict":      "error", // we want the conflict surfaced so we can retry
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
			writeInvokeError(w, err)
			return
		}
		if res.Status == "ok" {
			writeEnvelope(w, res)
			return
		}
		if res.ErrorCode != "I_CREDENTIAL_CONFLICT" {
			writeCliError(w, res)
			return
		}
		name = nextSuffix(stem, attempt+2)
	}
	writeErr(w, ErrAliasSuffixExhausted, "20 consecutive alias conflicts — pick a different stem")
}

// POST /api/user/vault/reveal was removed 2026-04-24 (security review round
// 2). Plaintext credentials never travel CLI → Go → browser anymore; users
// who need a plaintext read run `aikey get <alias>` in a terminal. The Web
// drawer surfaces that command as a copyable instruction. Removing the
// endpoint eliminates an entire cross-site exfiltration path (a stolen
// session cookie, XSS payload, or CORS-misconfigured attacker page can no
// longer pull plaintext out of the HTTP surface) — vault_key in Go memory
// is still required for metadata-masking and write flows, but there is no
// longer any HTTP path that turns that key into cleartext on the wire.

// ============================================================================
// POST /api/user/vault/use
// ============================================================================

// useRequest drives the `aikey use <alias>` web equivalent. The pair
// (target, id) maps 1:1 to cli vault-op `use` payload:
//   - personal → id is the alias
//   - oauth    → id is the provider_account_id
//   - team     → id is virtual_key_id, local_alias, or server alias
//                (CLI resolves all three; canonical vk_id wins on ties)
type useRequest struct {
	Target string `json:"target"`
	ID     string `json:"id"`
}

// UseHandler: POST /api/user/vault/use.
//
// Switches the default-profile provider binding(s) for the given key.
// Multi-provider semantics match `aikey use` non-interactive mode: a personal
// key with `supported_providers: ["anthropic","openai"]` promotes this single
// key across BOTH providers in one call. OAuth accounts always target exactly
// one provider (the OAuth issuer).
//
// Unlock required — the underlying vault-op verifies the vault_key against
// password_hash. The routing binding table isn't encrypted, but unlock is
// still required because the operation also refreshes `~/.aikey/active.env`
// which integrates provider-scoped sentinel tokens that we don't want to
// regenerate without a session.
func (h *VaultCRUDHandlers) UseHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := vaultKeyFrom(r.Context())
	if !ok {
		writeErr(w, ErrVaultLocked, "vault not unlocked")
		return
	}
	var req useRequest
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, ErrBadRequest, err.Error())
		return
	}
	if req.ID == "" {
		writeErr(w, ErrBadRequest, "id must be non-empty")
		return
	}
	switch req.Target {
	// Stage 7-1 (active-state cross-shell sync, 2026-04-27): team accepted.
	// CLI resolves vk by virtual_key_id, local_alias, or server alias and
	// validates local_state / key_status before writing the binding. The
	// CLI returns I_KEY_DISABLED / I_KEY_STALE / I_KEY_NO_PROVIDER for
	// unusable team keys; those flow through writeInvokeError unchanged.
	case "personal", "oauth", "team":
	default:
		writeErr(w, ErrUnknownTarget, "target must be personal|oauth|team")
		return
	}

	res, err := h.Bridge.Invoke(r.Context(), "vault-op", "use", hex, "", req)
	if err != nil {
		writeInvokeError(w, err)
		return
	}
	writeEnvelope(w, res)
}

// ============================================================================
// helpers
// ============================================================================

// decodeBody decodes a JSON request body with a 256 KiB cap. Callers pass a
// pointer to their request struct.
func decodeBody(r *http.Request, v any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, v)
}
