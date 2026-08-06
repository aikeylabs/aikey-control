package shared

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

// JSON writes a JSON-encoded body with the given status code.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Error writes a structured JSON error response without meta context.
// Prefer DomainErrorResponse for typed errors.
func Error(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, map[string]string{"error": code, "message": message})
}

// HandleDomainErr converts service errors to HTTP responses.
// Uses errors.As to unwrap DomainErrors through fmt.Errorf chains.
// All other errors are logged and returned as SYS_INTERNAL.
// Exported so that handler sub-packages (master/, user/) can use it
// without importing the api package (which would cause circular imports).
func HandleDomainErr(w http.ResponseWriter, err error) {
	var de *DomainError
	if errors.As(err, &de) {
		DomainErrorResponse(w, de)
		return
	}
	slog.Error("unhandled internal error", slog.String("error", err.Error()))
	DomainErrorResponse(w, SysInternal())
}

// DomainErrorResponse converts a DomainError to an HTTP response,
// including any structured meta fields (field, rule, upstream_status, etc.).
// Internal-only meta (db_detail, constraint) is stripped from the response
// but logged server-side for debugging. See Issue #17.
func DomainErrorResponse(w http.ResponseWriter, err *DomainError) {
	if internal := err.InternalMeta(); len(internal) > 0 {
		attrs := []any{slog.String("error_code", err.Code)}
		for k, v := range internal {
			attrs = append(attrs, slog.Any(k, v))
		}
		slog.Debug("domain error internal detail (stripped from response)", attrs...)
	}
	JSON(w, DomainErrorHTTPStatus(err.Code), err.LocalizedResponseBody(LocaleFromWriter(w)))
}

// DomainErrorHTTPStatus is the single HTTP status mapping for JSON and HTML
// transports. Keeping it exported prevents an HTML handler from inventing a
// second status contract for the same domain error code.
func DomainErrorHTTPStatus(code string) int {
	switch code {
	// ── 400 Bad Request ────────────────────────────────────────────────────────
	// CodeBizAuthWrongCurrentPwd / CodeBizAuthWeakPassword (added 2026-06-02):
	// 400, not 401 — the caller IS already authenticated (JWT verified by
	// middleware). The request body is "bad" because it carries either the
	// wrong current password or a new password that violates the policy.
	// Mapping to 401 here would trip the web client's response interceptor
	// (which clears the session + redirects to /master/login on 401), which
	// is exactly the wrong UX for "you typed the current password wrong".
	case CodeDataInvalidBody, CodeDataMissingField, CodeDataInvalidField,
		CodeBizAuthWrongCurrentPwd, CodeBizAuthWeakPassword,
		CodeBizSSOStateInvalid:
		return http.StatusBadRequest

	// ── 401 Unauthorised ──────────────────────────────────────────────────────
	case CodeBizAuthInvalidCredentials, CodeBizAuthTokenInvalid,
		CodeBizRefreshTokenInvalid,
		CodeBizLoginSessionNotFound, CodeBizLoginSessionExpired,
		CodeBizLoginTokenInvalid, CodeBizLoginTokenAlreadyUsed,
		CodeBizJoinTokenInvalid:
		return http.StatusUnauthorized

	// ── 403 Forbidden ─────────────────────────────────────────────────────────
	case CodeBizAuthAccountInactive, CodeBizAuthTokenRevoked,
		CodeBizAuthTokenExpired, CodeBizAuthTokenRecycled,
		CodeBizAuthTokenNotActive, CodeBizAuthAccessDenied,
		CodeBizRefreshTokenRevoked, CodeBizLoginSessionDenied,
		CodeBizSSOTenantMismatch,
		CodeBizOauthMemberTokenForbidden,
		CodeBizOauthExitIPAdminManaged,
		CodeBizAgentGroupNotMember, CodeBizAgentPoolNotOwner,
		// Refused BY DESIGN (form-①): still a 403, but the code tells the client
		// it's policy, not a permission fault (2026-07-13).
		CodeBizDeliveryCentralOnly:
		return http.StatusForbidden

	// ── 404 Not Found ─────────────────────────────────────────────────────────
	case CodeBizOrgNotFound, CodeBizSeatNotFound, CodeBizKeyNotFound,
		CodeBizBindNotFound, CodeBizCredNotFound, CodeBizProvNotFound,
		CodeBizOauthGroupNotFound, CodeBizOauthLoginCredNotProvisioned,
		// An upstream-fallback template the organization does not have. Beside
		// CodeBizOauthGroupNotFound because it is the same fact about a different
		// object — and deliberately not sharing its code, since the next action
		// differs ("create a route group" vs "create an account pool").
		// Unmapped until 2026-08-06: naming a template that does not exist
		// answered 500, and the code never reached the client at all (the apply
		// path returned a bare error, so HandleDomainErr emitted SYS_INTERNAL).
		CodeBizRouteGroupNotFound,
		CodeBizReferencedNotFound:
		return http.StatusNotFound

	// ── 409 Conflict ──────────────────────────────────────────────────────────
	case CodeBizAuthEmailTaken, CodeBizSeatEmailTaken,
		CodeBizBindAliasTaken, CodeBizKeyAliasTaken, CodeBizCredNameTaken, CodeBizProvCodeTaken,
		CodeBizOauthGroupCredInUse, CodeBizOauthGroupRatioRejected,
		CodeBizAgentLimitReached, CodeBizAgentNonClusterOrg,
		CodeBizAgentParentSeatRequired, CodeBizAgentStatusConflict,
		CodeBizOauthLoginBindingChanged,
		CodeBizOauthLoginContextUnavailable,
		CodeBizOauthRoutedAccountAmbiguous,
		// R39 recycle-bin guard: live references block deletion — a resource-state
		// conflict the admin resolves (migrate channels / detach from group).
		CodeBizCredHasActiveRefs,
		CodeBizLoginSessionTerminated, CodeBizSSOIdentityConflict,
		// The virtual key ALREADY has an active binding for this
		// (protocol_type, provider_id) pair. Like the R39 guard above this is a
		// conflict with state that already exists, not a malformed request —
		// 🚫 not CodeBizKeyDuplicateProtocol's 422, which is about a duplicate
		// inside the submitted binding LIST. Unmapped until 2026-08-04, so
		// applying a route group twice answered 500 and the console showed
		// "an unexpected error occurred" instead of the reason it had computed.
		CodeBizBindDuplicateTarget,
		// 0b.9d: this (key, protocol) already has a chain from a DIFFERENT origin
		// — an ungrouped hop, or another template. Same shape as the two above:
		// the request is well formed and the administrator's intent is
		// achievable, it is the state that already exists which conflicts, and
		// the remedy is to detach that chain first. 🚫 Not 422 — nothing about
		// the submitted body is wrong.
		//
		// Unmapped until 2026-08-06, which made the refusal self-defeating: its
		// own doc comment says it was made a typed error precisely so it would
		// stop arriving as a 500, and it went on arriving as a 500 because
		// nobody added it here.
		CodeBizRouteGroupOriginConflict,
		// 2026-07-03 (owner-approved delivery-family contract unification): "no
		// active / not-deliverable binding" is a RESOURCE-STATE conflict an admin
		// resolves by configuring the binding — not a service outage. As 503s these
		// made web consoles/CLIs read a normal not-configured state as "server down".
		// 503 stays reserved for CodeExtProviderUnavailable (a genuinely
		// unavailable dependency).
		CodeBizBindNoActive, CodeBizBindNotDelivered:
		return http.StatusConflict

	// ── 422 Unprocessable ─────────────────────────────────────────────────────
	case CodeBizSeatAlreadyClaimed, CodeBizKeyNotActive,
		CodeBizKeyDuplicateProtocol, CodeBizBindProtocolMismatch,
		CodeBizCredInactive, CodeBizOauthGroupDefaultProtected,
		CodeBizOauthGroupDisabled, CodeBizBindTargetInvalid,
		CodeBizVKGroupExclusive, CodeBizSSOProviderDisabled,
		// Same family as CodeBizVKGroupExclusive directly above: an OAuth account
		// credential is not bindable to a seat at all, so the request cannot be
		// processed as asked. Also unmapped until 2026-08-04 (found by the
		// class fence below, not by a report) — it too answered 500.
		CodeBizBindOAuthDirect,
		CodeBizProviderProtocolUnsupported,
		CodeBizOauthGroupProviderUnsupported, CodeBizOauthGroupProviderMixed,
		CodeBizOauthGroupProtocolMixed, CodeBizOauthGroupProtocolInvalid,
		CodeBizOauthGroupBotSeat, CodeBizRouteGroupProtocolMismatch,
		// The template the admin chose cannot be applied as asked — it is
		// archived, or it has no upstreams to generate hops from. Same shape as
		// CodeBizCredInactive above: the chosen OBJECT is unusable, and the
		// remedy is to choose another or to fix that one. 🚫 Not 409: nothing
		// about the KEY's current state is in the way.
		//
		// Both were bare errors until 2026-08-06, so both answered 500 — found by
		// auditing the whole function after two of its siblings were reported,
		// which is the same move that turned one BIZ_BIND report into two defects.
		CodeBizRouteGroupArchived, CodeBizRouteGroupEmpty:
		return http.StatusUnprocessableEntity

	// ── 429 Too Many Requests ─────────────────────────────────────────────────
	case CodeExtProviderRateLimited, CodeBizLoginResendCooldown:
		return http.StatusTooManyRequests

	// ── 502 Bad Gateway ───────────────────────────────────────────────────────
	case CodeExtProviderUpstream, CodeExtProviderAuthFailure,
		CodeBizSSOExchangeFailed,
		CodeExtMailSendFailed:
		return http.StatusBadGateway

	// ── 503 Service Unavailable ───────────────────────────────────────────────
	// CodeSysMailNotConfigured: 503 (not 500) — the feature is unavailable by
	// deployment state, not broken by a bug; retrying without an operator fix
	// cannot succeed.
	case CodeExtProviderUnavailable, CodeSysAllocationEngineUnavailable,
		CodeSysMailNotConfigured, CodeSysAgentVKInvalidationUnavailable:
		return http.StatusServiceUnavailable

	// ── 500 Internal Server Error (default) ──────────────────────────────────
	default:
		return http.StatusInternalServerError
	}
}
