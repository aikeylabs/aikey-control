package shared

import "fmt"

// DomainError carries an HTTP-visible error code, a human-readable message,
// and optional structured meta for DATA/EXT errors.
//
// Error code format: {LAYER}_{MODULE}_{REASON}
//
// Layers:
//
//	BIZ_{MODULE} — business logic violation (user-visible domain rule)
//	DATA_*       — client-supplied data is invalid or missing
//	EXT_*        — upstream/external service returned an error
//	SYS_*        — internal system fault (message sanitised, raw error logged)
//
// All codes kept in sync with web/src/shared/utils/api-error.ts.
type DomainError struct {
	Code    string
	Message string
	// Meta holds optional structured context included in the JSON response.
	// DATA errors: "field", "rule" keys.
	// EXT  errors: "provider", "upstream_status", "upstream_message" keys.
	Meta map[string]any
}

func (e *DomainError) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// internalMetaKeys lists Meta keys that must never be sent to the client.
// They are logged server-side in DomainErrorResponse for debugging.
var internalMetaKeys = map[string]bool{
	"db_detail":  true,
	"constraint": true,
}

// ResponseBody returns the JSON-serialisable map sent to the client.
// Internal-only meta keys (db_detail, constraint) are stripped here
// to avoid leaking Postgres internals. See Issue #17.
func (e *DomainError) ResponseBody() map[string]any {
	body := map[string]any{
		"error":   e.Code,
		"message": e.Message,
	}
	for k, v := range e.Meta {
		if internalMetaKeys[k] {
			continue
		}
		body[k] = v
	}
	return body
}

// InternalMeta returns Meta entries that are internal-only (e.g. db_detail,
// constraint) for server-side logging. Returns nil when there are none.
func (e *DomainError) InternalMeta() map[string]any {
	var m map[string]any
	for k, v := range e.Meta {
		if internalMetaKeys[k] {
			if m == nil {
				m = make(map[string]any)
			}
			m[k] = v
		}
	}
	return m
}

// ── Error code constants ───────────────────────────────────────────────────────

const (
	// BIZ — Auth
	CodeBizAuthEmailTaken         = "BIZ_AUTH_EMAIL_TAKEN"
	CodeBizAuthInvalidCredentials = "BIZ_AUTH_INVALID_CREDENTIALS"
	CodeBizAuthAccountInactive    = "BIZ_AUTH_ACCOUNT_INACTIVE"
	CodeBizAuthTokenInvalid       = "BIZ_AUTH_TOKEN_INVALID"
	CodeBizAuthTokenRevoked       = "BIZ_AUTH_TOKEN_REVOKED"
	CodeBizAuthTokenExpired       = "BIZ_AUTH_TOKEN_EXPIRED"
	CodeBizAuthTokenRecycled      = "BIZ_AUTH_TOKEN_RECYCLED"
	CodeBizAuthTokenNotActive     = "BIZ_AUTH_TOKEN_NOT_ACTIVE"
	CodeBizAuthAccessDenied       = "BIZ_AUTH_ACCESS_DENIED"

	// BIZ — Organization
	CodeBizOrgNotFound = "BIZ_ORG_NOT_FOUND"

	// BIZ — Seat
	CodeBizSeatNotFound       = "BIZ_SEAT_NOT_FOUND"
	CodeBizSeatEmailTaken     = "BIZ_SEAT_EMAIL_TAKEN"
	CodeBizSeatAlreadyClaimed = "BIZ_SEAT_ALREADY_CLAIMED"

	// BIZ — Virtual Key
	CodeBizKeyNotFound          = "BIZ_KEY_NOT_FOUND"
	CodeBizKeyNotActive         = "BIZ_KEY_NOT_ACTIVE"
	CodeBizKeyDuplicateProtocol = "BIZ_KEY_DUPLICATE_PROTOCOL"

	// BIZ — Protocol Binding
	CodeBizBindNotFound          = "BIZ_BIND_NOT_FOUND"
	CodeBizBindProtocolMismatch  = "BIZ_BIND_PROTOCOL_MISMATCH"
	CodeBizBindNoActive          = "BIZ_BIND_NO_ACTIVE"
	CodeBizBindNotDelivered      = "BIZ_BIND_NOT_DELIVERED"
	// CodeBizBindDuplicateTarget: same (protocol_type, provider_id) pair already active on this VK.
	CodeBizBindDuplicateTarget   = "BIZ_BIND_DUPLICATE_TARGET"

	// BIZ — Login Session / OAuth
	CodeBizLoginSessionNotFound      = "BIZ_LOGIN_SESSION_NOT_FOUND"
	CodeBizLoginSessionExpired       = "BIZ_LOGIN_SESSION_EXPIRED"
	CodeBizLoginSessionDenied        = "BIZ_LOGIN_SESSION_DENIED"
	// CodeBizLoginResendCooldown is returned when Begin is called within the
	// per-session cooldown window after a previous send. Pass remaining
	// seconds via WithMeta("retry_after_seconds", ...) so the browser UI
	// can render a live countdown.
	CodeBizLoginResendCooldown       = "BIZ_LOGIN_RESEND_COOLDOWN"
	// CodeBizLoginSessionTerminated is returned when Begin is called on a
	// session that has already reached a terminal state (approved, denied,
	// cancelled, token_issued). The user must restart `aikey account login`.
	CodeBizLoginSessionTerminated    = "BIZ_LOGIN_SESSION_TERMINATED"
	CodeBizLoginTokenInvalid         = "BIZ_LOGIN_TOKEN_INVALID"
	CodeBizLoginTokenAlreadyUsed     = "BIZ_LOGIN_TOKEN_ALREADY_USED"
	CodeBizRefreshTokenInvalid       = "BIZ_REFRESH_TOKEN_INVALID"
	CodeBizRefreshTokenRevoked       = "BIZ_REFRESH_TOKEN_REVOKED"

	// BIZ — unique-conflict specialisations
	CodeBizBindAliasTaken = "BIZ_BIND_ALIAS_TAKEN"
	CodeBizKeyAliasTaken  = "BIZ_KEY_ALIAS_TAKEN"
	CodeBizCredNameTaken  = "BIZ_CRED_NAME_TAKEN"
	CodeBizProvCodeTaken  = "BIZ_PROV_CODE_TAKEN"

	// BIZ — Credential
	CodeBizCredNotFound = "BIZ_CRED_NOT_FOUND"
	CodeBizCredInactive = "BIZ_CRED_INACTIVE"

	// BIZ — Provider
	CodeBizProvNotFound = "BIZ_PROV_NOT_FOUND"

	// DATA — client input validation
	CodeDataInvalidBody  = "DATA_INVALID_BODY"
	CodeDataMissingField = "DATA_MISSING_FIELD"
	CodeDataInvalidField = "DATA_INVALID_FIELD"
	CodeDataInvalidEmail = "DATA_INVALID_EMAIL"

	// EXT — external / upstream service
	CodeExtProviderUpstream    = "EXT_PROVIDER_UPSTREAM"
	CodeExtProviderAuthFailure = "EXT_PROVIDER_AUTH_FAILURE"
	CodeExtProviderRateLimited = "EXT_PROVIDER_RATE_LIMITED"
	CodeExtProviderUnavailable = "EXT_PROVIDER_UNAVAILABLE"

	// SYS — system / infrastructure (details logged, never exposed)
	CodeSysInternal = "SYS_INTERNAL"
	CodeSysDB       = "SYS_DB"
	CodeSysConfig   = "SYS_CONFIG"
)

// ── BIZ constructors ──────────────────────────────────────────────────────────

func BizAuthEmailTaken(email string) *DomainError {
	return &DomainError{Code: CodeBizAuthEmailTaken,
		Message: fmt.Sprintf("email %q is already registered", email)}
}
func BizAuthInvalidCredentials() *DomainError {
	return &DomainError{Code: CodeBizAuthInvalidCredentials, Message: "invalid email or password"}
}
func BizAuthAccountInactive() *DomainError {
	return &DomainError{Code: CodeBizAuthAccountInactive, Message: "account is not active"}
}
func BizAuthTokenInvalid() *DomainError {
	return &DomainError{Code: CodeBizAuthTokenInvalid, Message: "token is invalid or not recognised"}
}
func BizAuthTokenRevoked() *DomainError {
	return &DomainError{Code: CodeBizAuthTokenRevoked, Message: "token has been revoked"}
}
func BizAuthTokenExpired() *DomainError {
	return &DomainError{Code: CodeBizAuthTokenExpired, Message: "token has expired"}
}
func BizAuthTokenRecycled() *DomainError {
	return &DomainError{Code: CodeBizAuthTokenRecycled, Message: "token has been recycled"}
}
func BizAuthTokenNotActive() *DomainError {
	return &DomainError{Code: CodeBizAuthTokenNotActive, Message: "token is not in an active state"}
}
func BizAuthAccessDenied() *DomainError {
	return &DomainError{Code: CodeBizAuthAccessDenied, Message: "access denied"}
}

func BizOrgNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizOrgNotFound,
		Message: fmt.Sprintf("organization %q not found", id)}
}

func BizSeatNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizSeatNotFound,
		Message: fmt.Sprintf("seat %q not found", id)}
}
func BizSeatEmailTaken(email, orgID string) *DomainError {
	return &DomainError{Code: CodeBizSeatEmailTaken,
		Message: fmt.Sprintf("seat for email %q already exists in org %q", email, orgID)}
}
func BizSeatAlreadyClaimed() *DomainError {
	return &DomainError{Code: CodeBizSeatAlreadyClaimed, Message: "seat has already been claimed"}
}
func BizSeatStatusConflict(msg string) *DomainError {
	return &DomainError{Code: CodeBizSeatAlreadyClaimed, Message: msg}
}

func BizKeyNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizKeyNotFound,
		Message: fmt.Sprintf("virtual key %q not found", id)}
}
func BizKeyNotActive() *DomainError {
	return &DomainError{Code: CodeBizKeyNotActive, Message: "virtual key is not in active state"}
}
func BizKeyDuplicateProtocol(protocol string) *DomainError {
	return &DomainError{Code: CodeBizKeyDuplicateProtocol,
		Message: fmt.Sprintf("duplicate protocol_type %q in binding list", protocol)}
}

func BizBindNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizBindNotFound,
		Message: fmt.Sprintf("binding %q not found", id)}
}
func BizBindProtocolMismatch(bindingProtocol, credProtocol string) *DomainError {
	return &DomainError{Code: CodeBizBindProtocolMismatch,
		Message: fmt.Sprintf("binding protocol %q does not match credential provider protocol %q",
			bindingProtocol, credProtocol)}
}
func BizBindDuplicateTarget(protocol, providerID string) *DomainError {
	return &DomainError{Code: CodeBizBindDuplicateTarget,
		Message: fmt.Sprintf("an active binding for protocol %q / provider %q already exists on this virtual key",
			protocol, providerID),
		Meta: map[string]any{"protocol_type": protocol, "provider_id": providerID}}
}
func BizBindNoActive() *DomainError {
	return &DomainError{Code: CodeBizBindNoActive,
		Message: "no active protocol binding found for this token"}
}
func BizBindNotDelivered() *DomainError {
	return &DomainError{Code: CodeBizBindNotDelivered,
		Message: "binding exists but could not be delivered to the proxy"}
}

func BizCredNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizCredNotFound,
		Message: fmt.Sprintf("credential %q not found", id)}
}
func BizCredInactive(id string) *DomainError {
	return &DomainError{Code: CodeBizCredInactive,
		Message: fmt.Sprintf("credential %q is not active", id)}
}

func BizProvNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizProvNotFound,
		Message: fmt.Sprintf("provider %q not found", id)}
}

func BizLoginSessionNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizLoginSessionNotFound,
		Message: fmt.Sprintf("login session %q not found", id)}
}
func BizLoginSessionExpired() *DomainError {
	return &DomainError{Code: CodeBizLoginSessionExpired,
		Message: "login session has expired — please run aikey login again"}
}
func BizLoginSessionDenied() *DomainError {
	return &DomainError{Code: CodeBizLoginSessionDenied,
		Message: "login session was denied"}
}

// BizLoginResendCooldown signals that the caller hit the per-session email
// resend cooldown. retry_after_seconds is surfaced in both the message and
// structured Meta so frontends can render a live countdown.
func BizLoginResendCooldown(retryAfterSeconds int) *DomainError {
	return &DomainError{Code: CodeBizLoginResendCooldown,
		Message: fmt.Sprintf("please wait %d second(s) before requesting another email", retryAfterSeconds),
		Meta:    map[string]any{"retry_after_seconds": retryAfterSeconds}}
}

// BizLoginSessionTerminated signals that the session is in a terminal state
// (approved/denied/cancelled/token_issued) and cannot accept Begin again.
// The user should restart `aikey account login`.
func BizLoginSessionTerminated(currentStatus string) *DomainError {
	return &DomainError{Code: CodeBizLoginSessionTerminated,
		Message: "this login session has already finished — please run `aikey account login` again to start a new one",
		Meta:    map[string]any{"status": currentStatus}}
}
func BizLoginTokenInvalid() *DomainError {
	return &DomainError{Code: CodeBizLoginTokenInvalid,
		Message: "login token is invalid or does not match the session"}
}
func BizLoginTokenAlreadyUsed() *DomainError {
	return &DomainError{Code: CodeBizLoginTokenAlreadyUsed,
		Message: "login token has already been used"}
}
func BizRefreshTokenInvalid() *DomainError {
	return &DomainError{Code: CodeBizRefreshTokenInvalid,
		Message: "refresh token is invalid or has expired — please run aikey login again"}
}
func BizRefreshTokenRevoked() *DomainError {
	return &DomainError{Code: CodeBizRefreshTokenRevoked,
		Message: "refresh token has been revoked — please run aikey login again"}
}

func BizBindAliasTaken() *DomainError {
	return &DomainError{Code: CodeBizBindAliasTaken,
		Message: "a template binding with this alias already exists in the org"}
}
func BizKeyAliasTaken() *DomainError {
	return &DomainError{Code: CodeBizKeyAliasTaken,
		Message: "a virtual key with this alias already exists for this seat"}
}
func BizCredNameTaken() *DomainError {
	return &DomainError{Code: CodeBizCredNameTaken,
		Message: "a credential with this name already exists for this provider in the org"}
}
func BizProvCodeTaken() *DomainError {
	return &DomainError{Code: CodeBizProvCodeTaken,
		Message: "a provider with this code already exists"}
}

// ── DATA constructors ─────────────────────────────────────────────────────────

// DataInvalidBody indicates the request body could not be parsed.
func DataInvalidBody() *DomainError {
	return &DomainError{Code: CodeDataInvalidBody,
		Message: "request body is not valid JSON or has an unexpected structure"}
}

// DataMissingField indicates a required field is absent.
// field: the JSON field name.
func DataMissingField(field string) *DomainError {
	return &DomainError{Code: CodeDataMissingField,
		Message: fmt.Sprintf("required field %q is missing", field),
		Meta:    map[string]any{"field": field}}
}

// DataInvalidEmail indicates the supplied email address is empty or malformed.
func DataInvalidEmail() *DomainError {
	return &DomainError{Code: CodeDataInvalidEmail,
		Message: "invalid email format",
		Meta:    map[string]any{"field": "invited_email"}}
}

// DataInvalidField indicates a field value fails a validation rule.
// field: JSON field name. rule: machine-readable rule ID. reason: human explanation.
func DataInvalidField(field, rule, reason string) *DomainError {
	return &DomainError{Code: CodeDataInvalidField,
		Message: fmt.Sprintf("field %q is invalid: %s", field, reason),
		Meta:    map[string]any{"field": field, "rule": rule}}
}

// ── EXT constructors ──────────────────────────────────────────────────────────
//
// EXT errors carry structured upstream context so the caller can relay and
// diagnose the root cause without opaque messages.

// ExtProviderUpstream wraps a non-auth, non-rate-limit upstream error.
// upstreamStatus and upstreamMessage are included in the response body.
func ExtProviderUpstream(provider string, upstreamStatus int, upstreamMessage string) *DomainError {
	return &DomainError{Code: CodeExtProviderUpstream,
		Message: fmt.Sprintf("upstream provider %q returned an error (HTTP %d)", provider, upstreamStatus),
		Meta: map[string]any{
			"provider":         provider,
			"upstream_status":  upstreamStatus,
			"upstream_message": upstreamMessage,
		}}
}

// ExtProviderAuthFailure indicates the provider rejected the credential.
func ExtProviderAuthFailure(provider string, upstreamMessage string) *DomainError {
	return &DomainError{Code: CodeExtProviderAuthFailure,
		Message: fmt.Sprintf("provider %q rejected the credential — API key may be invalid or revoked", provider),
		Meta: map[string]any{
			"provider":         provider,
			"upstream_message": upstreamMessage,
		}}
}

// ExtProviderRateLimited indicates the provider is throttling requests.
func ExtProviderRateLimited(provider string) *DomainError {
	return &DomainError{Code: CodeExtProviderRateLimited,
		Message: fmt.Sprintf("provider %q is rate-limiting requests — retry after a short delay", provider),
		Meta:    map[string]any{"provider": provider}}
}

// ExtProviderUnavailable indicates the provider is unreachable or returning 5xx.
func ExtProviderUnavailable(provider string) *DomainError {
	return &DomainError{Code: CodeExtProviderUnavailable,
		Message: fmt.Sprintf("provider %q is unavailable or unreachable", provider),
		Meta:    map[string]any{"provider": provider}}
}

// ── SYS constructors ──────────────────────────────────────────────────────────

// SysInternal returns a sanitised internal-error response.
// Always log the raw error before calling this.
func SysInternal() *DomainError {
	return &DomainError{Code: CodeSysInternal, Message: "an unexpected error occurred"}
}

// SysDB returns a sanitised database-error response.
func SysDB() *DomainError {
	return &DomainError{Code: CodeSysDB, Message: "a database error occurred"}
}

// SysConfig returns a sanitised configuration-error response.
func SysConfig() *DomainError {
	return &DomainError{Code: CodeSysConfig, Message: "service configuration error"}
}
