package cli

import (
	"encoding/json"
	"errors"
	"net/http"
)

// WriteInvokeError maps a Bridge.Invoke error to an HTTP response with the
// correct status code. Uses the InvokeError.Code when available and falls
// back to ErrCliSpawnFailed (500) for anything else.
func WriteInvokeError(w http.ResponseWriter, err error) {
	var ierr *InvokeError
	if errors.As(err, &ierr) {
		WriteErr(w, ierr.Code, ierr.Msg)
		return
	}
	WriteErr(w, ErrCliSpawnFailed, err.Error())
}

// WriteCliError writes a 4xx/5xx response mirroring the cli Result error
// branch. It maps a small set of known cli codes to HTTP status and falls
// back to 500 for the rest.
func WriteCliError(w http.ResponseWriter, result *Result) {
	WriteErr(w, result.ErrorCode, result.ErrorMessage)
}

// WriteErr writes a JSON error response with a status chosen from the code.
//
// Status-code mapping (kept deliberately narrow so the Web UI and CLI can
// both reason about it):
//
//   - 401 Unauthorized      — missing session cookie; top-level auth problem.
//   - 422 Unprocessable     — vault-specific business errors (wrong master
//                             password, cli says I_VAULT_KEY_INVALID).
//                             NOT 401 because the global httpClient interceptor
//                             treats 401 as "JWT expired" and redirects to
//                             /login, which would be wrong UX for a vault
//                             password typo. Self-review 2026-04-22 caught
//                             this.
//   - 400 Bad Request       — malformed JSON / schema violation.
//   - 503 Service Unavail.  — cli binary missing (production container).
//   - 504 Gateway Timeout   — cli spawn timed out.
//   - 500 Internal          — everything else.
func WriteErr(w http.ResponseWriter, code, msg string) {
	status := http.StatusInternalServerError
	switch code {
	case ErrVaultNoSession:
		status = http.StatusUnauthorized
	case ErrVaultLocked,
		"I_VAULT_KEY_INVALID",
		"I_VAULT_KEY_MALFORMED",
		"I_VAULT_NOT_INITIALIZED", // precondition: vault doesn't exist yet
		ErrVaultUnlockFailed:
		// 422 Unprocessable Entity is the right family for "request well-
		// formed but the vault state can't satisfy it". Handlers that want
		// to render a normal empty-state UI for I_VAULT_NOT_INITIALIZED
		// (e.g. vault/list on first-run) special-case it BEFORE calling
		// WriteErr — see crud.go ListHandler. The 422 here is the safe
		// default for any other endpoint that hits the same code.
		status = http.StatusUnprocessableEntity
	case "I_VAULT_ALREADY_INITIALIZED":
		// 409 Conflict: vault.db exists; second init request collides
		// with current state. FE renders "vault already set up — unlock
		// instead" affordance.
		status = http.StatusConflict
	case ErrBadRequest, ErrCliMalformedReply, "I_STDIN_INVALID_JSON", "I_CREDENTIAL_CONFLICT":
		status = http.StatusBadRequest
	case ErrOAuthAddViaCLI:
		// 403: the operation is valid protocol-wise but intentionally denied
		// for this target. The UI should stop trying and switch to the CLI
		// guidance affordance (done-like view for OAuth add). The earlier
		// companion case for I_OAUTH_REVEAL_FORBIDDEN was dropped when the
		// reveal endpoint itself was removed.
		status = http.StatusForbidden
	case ErrUnknownTarget:
		// 400: client sent an unknown target ("team" is valid in the protocol
		// but not implemented yet; other values are malformed). Either way
		// this is client error, not server.
		status = http.StatusBadRequest
	case "I_CREDENTIAL_NOT_FOUND":
		status = http.StatusNotFound
	case ErrAliasSuffixExhausted:
		// 409: we ran out of `-2/-3/...` suffixes (up to 20) which means the
		// user has twenty pre-existing collisions on the same stem — treat
		// as a Conflict rather than a server bug.
		status = http.StatusConflict
	case ErrUnlockRateLimited:
		status = http.StatusTooManyRequests
	case ErrCliNotFound:
		// 503: feature requires local cli; this happens when aikey is not on
		// the host (e.g., in a production control-service container that
		// doesn't ship the cli). The /user/import page still renders; only
		// action endpoints degrade.
		status = http.StatusServiceUnavailable
	case ErrCliTimeout:
		status = http.StatusGatewayTimeout
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(JSONError{Status: "error", ErrorCode: code, ErrorMessage: msg})
}

// WriteEnvelope relays a cli Result verbatim to the HTTP client. ok branch
// → 200 + {status, data}; error branch → status-mapped + {status,
// error_code, error_message}. Preserves request_id if the cli echoed one.
func WriteEnvelope(w http.ResponseWriter, r *Result) {
	if r.Status != "ok" {
		WriteCliError(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	out := map[string]any{"status": "ok"}
	if len(r.Data) > 0 {
		out["data"] = json.RawMessage(r.Data)
	}
	if r.RequestID != "" {
		out["request_id"] = r.RequestID
	}
	_ = json.NewEncoder(w).Encode(out)
}
