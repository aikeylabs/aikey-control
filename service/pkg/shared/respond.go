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
	JSON(w, domainErrorStatus(err.Code), err.LocalizedResponseBody(LocaleFromWriter(w)))
}

func domainErrorStatus(code string) int {
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
		CodeBizAuthWrongCurrentPwd, CodeBizAuthWeakPassword:
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
		CodeBizRefreshTokenRevoked, CodeBizLoginSessionDenied:
		return http.StatusForbidden

	// ── 404 Not Found ─────────────────────────────────────────────────────────
	case CodeBizOrgNotFound, CodeBizSeatNotFound, CodeBizKeyNotFound,
		CodeBizBindNotFound, CodeBizCredNotFound, CodeBizProvNotFound,
		CodeBizSeatGroupNotFound:
		return http.StatusNotFound

	// ── 409 Conflict ──────────────────────────────────────────────────────────
	case CodeBizAuthEmailTaken, CodeBizSeatEmailTaken,
		CodeBizBindAliasTaken, CodeBizKeyAliasTaken, CodeBizCredNameTaken, CodeBizProvCodeTaken,
		CodeBizSeatGroupCredInUse, CodeBizSeatGroupRatioRejected,
		CodeBizLoginSessionTerminated:
		return http.StatusConflict

	// ── 422 Unprocessable ─────────────────────────────────────────────────────
	case CodeBizSeatAlreadyClaimed, CodeBizKeyNotActive,
		CodeBizKeyDuplicateProtocol, CodeBizBindProtocolMismatch,
		CodeBizCredInactive, CodeBizSeatGroupDefaultProtected,
		CodeBizSeatGroupDisabled, CodeBizBindTargetInvalid:
		return http.StatusUnprocessableEntity

	// ── 429 Too Many Requests ─────────────────────────────────────────────────
	case CodeExtProviderRateLimited, CodeBizLoginResendCooldown:
		return http.StatusTooManyRequests

	// ── 502 Bad Gateway ───────────────────────────────────────────────────────
	case CodeExtProviderUpstream, CodeExtProviderAuthFailure:
		return http.StatusBadGateway

	// ── 503 Service Unavailable ───────────────────────────────────────────────
	case CodeBizBindNoActive, CodeBizBindNotDelivered, CodeExtProviderUnavailable:
		return http.StatusServiceUnavailable

	// ── 500 Internal Server Error (default) ──────────────────────────────────
	default:
		return http.StatusInternalServerError
	}
}
