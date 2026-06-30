package shared

import (
	"fmt"
	"strings"
)

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

// ── Localisation (Phase E: backend error message i18n) ─────────────────────────

// LocalizedResponseBody is ResponseBody with the message rendered in the given
// locale. Falls back to the English Message when no zh template exists for the code.
// ResponseBody() (English) is kept as-is for backward compatibility.
func (e *DomainError) LocalizedResponseBody(locale string) map[string]any {
	body := e.ResponseBody()
	if msg := localizeMessage(e.Code, locale, e.Meta); msg != "" {
		body["message"] = msg
	}
	return body
}

func localizeMessage(code, locale string, meta map[string]any) string {
	if locale != "zh" {
		return ""
	}
	tmpl, ok := zhMessages[code]
	if !ok {
		return ""
	}
	return interpolate(tmpl, meta)
}

func interpolate(tmpl string, meta map[string]any) string {
	if meta == nil || !strings.Contains(tmpl, "{{") {
		return tmpl
	}
	out := tmpl
	for k, v := range meta {
		out = strings.ReplaceAll(out, "{{"+k+"}}", fmt.Sprintf("%v", v))
	}
	return out
}

// zhMessages maps each error Code to its zh-locale message template. {{key}}
// placeholders are filled from DomainError.Meta by interpolate(). Codes absent
// from this map (e.g. SeatStatusConflict / DataInvalidField which carry English
// free text) fall back to the English Message automatically.
//
// Glossary (kept in sync with web i18n): 虚拟密钥=virtual key, 保管库=vault,
// 凭据=credential, 供应商=provider, 席位=seat, 组织=org, 绑定=binding,
// 登录会话=login session, 令牌=token, 邮箱=email.
var zhMessages = map[string]string{
	// BIZ — Auth
	CodeBizAuthEmailTaken:         "邮箱 {{email}} 已被注册",
	CodeBizAuthInvalidCredentials: "邮箱或密码错误",
	CodeBizAuthAccountInactive:    "账户未激活",
	CodeBizAuthTokenInvalid:       "令牌无效或无法识别",
	CodeBizAuthTokenRevoked:       "令牌已被吊销",
	CodeBizAuthTokenExpired:       "令牌已过期",
	CodeBizAuthTokenRecycled:      "令牌已被回收",
	CodeBizAuthTokenNotActive:     "令牌不处于激活状态",
	CodeBizAuthAccessDenied:       "访问被拒绝",
	CodeBizAuthWrongCurrentPwd:    "当前密码不正确",
	CodeBizAuthWeakPassword:       "新密码不符合复杂度要求（至少 8 位且包含字母和数字）",

	// BIZ — Organization
	CodeBizOrgNotFound: "组织 {{id}} 不存在",

	// BIZ — Seat
	CodeBizSeatNotFound:       "席位 {{id}} 不存在",
	CodeBizSeatEmailTaken:     "邮箱 {{email}} 的席位已存在于组织 {{org_id}} 中",
	CodeBizSeatAlreadyClaimed: "席位已被认领",

	// BIZ — Virtual Key
	CodeBizKeyNotFound:          "虚拟密钥 {{id}} 不存在",
	CodeBizKeyNotActive:         "虚拟密钥不处于激活状态",
	CodeBizKeyDuplicateProtocol: "绑定列表中存在重复的协议类型 {{protocol_type}}",

	// BIZ — Protocol Binding
	CodeBizBindNotFound:         "绑定 {{id}} 不存在",
	CodeBizBindProtocolMismatch: "绑定协议 {{binding_protocol}} 与凭据供应商协议 {{cred_protocol}} 不匹配",
	CodeBizBindDuplicateTarget:  "该虚拟密钥上已存在协议 {{protocol_type}} / 供应商 {{provider_id}} 的激活绑定",
	CodeBizBindOAuthDirect:      "OAuth 账号凭据只能通过席位组分配，不能直接绑定到席位",
	CodeBizBindNoActive:         "未找到该令牌的激活协议绑定",
	CodeBizBindNotDelivered:     "绑定已存在，但无法下发至代理",

	// BIZ — Login Session / OAuth
	CodeBizLoginSessionNotFound:   "登录会话 {{id}} 不存在",
	CodeBizLoginSessionExpired:    "登录会话已过期，请重新运行 aikey login",
	CodeBizLoginSessionDenied:     "登录会话已被拒绝",
	CodeBizLoginResendCooldown:    "请等待 {{retry_after_seconds}} 秒后再请求新的邮件",
	CodeBizLoginSessionTerminated: "该登录会话已结束，请重新运行 `aikey account login` 开始新的会话",
	CodeBizLoginTokenInvalid:      "登录令牌无效或与会话不匹配",
	CodeBizLoginTokenAlreadyUsed:  "登录令牌已被使用",
	CodeBizJoinTokenInvalid:       "加入令牌无效、已撤销或已过期",
	CodeBizRefreshTokenInvalid:    "刷新令牌无效或已过期，请重新运行 aikey login",
	CodeBizRefreshTokenRevoked:    "刷新令牌已被吊销，请重新运行 aikey login",

	// BIZ — unique-conflict specialisations
	CodeBizBindAliasTaken: "组织中已存在使用该别名的模板绑定",
	CodeBizKeyAliasTaken:  "该席位下已存在使用该别名的虚拟密钥",
	CodeBizCredNameTaken:  "组织中该供应商下已存在使用该名称的凭据",
	CodeBizProvCodeTaken:  "已存在使用该代码的供应商",

	// BIZ — Credential
	CodeBizCredNotFound: "凭据 {{id}} 不存在",
	CodeBizCredInactive: "凭据 {{id}} 未激活",

	// BIZ — Provider
	CodeBizProvNotFound: "供应商 {{id}} 不存在",

	// DATA — client input validation
	CodeDataInvalidBody:  "请求体不是有效的 JSON 或结构不符合预期",
	CodeDataMissingField: "缺少必填字段 {{field}}",
	CodeDataInvalidEmail: "邮箱格式无效",

	// EXT — external / upstream service
	CodeExtProviderUpstream:    "上游供应商 {{provider}} 返回了错误（HTTP {{upstream_status}}）",
	CodeExtProviderAuthFailure: "供应商 {{provider}} 拒绝了凭据，API 密钥可能无效或已吊销",
	CodeExtProviderRateLimited: "供应商 {{provider}} 正在限流，请稍后重试",
	CodeExtProviderUnavailable: "供应商 {{provider}} 不可用或无法连接",

	// SYS — system / infrastructure
	CodeSysInternal: "发生未预期的错误",
	CodeSysDB:       "发生数据库错误",
	CodeSysConfig:   "服务配置错误",
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
	// CodeBizAuthWrongCurrentPwd is returned when /v1/accounts/me/password is
	// called with a current_password that fails bcrypt verification. Distinct
	// from BIZ_AUTH_INVALID_CREDENTIALS (login flow) because the caller is
	// already authenticated — we want the UI to surface "current password is
	// wrong" not "invalid email or password". Added 2026-06-02.
	CodeBizAuthWrongCurrentPwd    = "BIZ_AUTH_WRONG_CURRENT_PWD"
	// CodeBizAuthWeakPassword is returned when a new password does not meet
	// the policy (≥8 chars, ≥1 letter, ≥1 digit). Same policy enforced
	// client-side; server side is the authoritative gate. Added 2026-06-02.
	CodeBizAuthWeakPassword       = "BIZ_AUTH_WEAK_PASSWORD"

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
	// CodeBizJoinTokenInvalid: the org join token presented at digital-employee
	// self-registration is unknown, revoked, or expired (v1.0.1-alpha.2).
	CodeBizJoinTokenInvalid          = "BIZ_JOIN_TOKEN_INVALID"
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

	// BIZ — Seat Group (通用凭证共享组 / oauth_group)
	CodeBizOauthGroupNotFound         = "BIZ_OAUTH_GROUP_NOT_FOUND"
	CodeBizOauthGroupDefaultProtected = "BIZ_OAUTH_GROUP_DEFAULT_PROTECTED"
	CodeBizOauthGroupCredInUse        = "BIZ_OAUTH_GROUP_CRED_IN_USE"
	// CodeBizOauthGroupRatioRejected: issuing to a group would push seats:accounts
	// past the reject threshold (N4 capacity gate). 409 (capacity conflict).
	CodeBizOauthGroupRatioRejected = "BIZ_OAUTH_GROUP_RATIO_REJECTED"
	// CodeBizOauthGroupDisabled: a group binding target was requested but the
	// oauth_group feature is off (OAUTH_GROUP_ENABLED). 422.
	CodeBizOauthGroupDisabled = "BIZ_OAUTH_GROUP_DISABLED"
	// CodeBizBindTargetInvalid: a binding must target exactly one of credential /
	// oauth_group, and an issuance can't mix credential + group (or two groups). 422.
	CodeBizBindTargetInvalid = "BIZ_BIND_TARGET_INVALID"
	// CodeBizBindOAuthDirect: an OAuth-account credential was used as a DIRECT
	// binding target. OAuth accounts can only be assigned through a seat group
	// (their token is delivered at runtime via channel ③, not as a static key),
	// so direct-binding one would silently produce an unusable VK. 422.
	CodeBizBindOAuthDirect = "BIZ_BIND_OAUTH_DIRECT"
	// CodeBizOauthMemberTokenForbidden: a member tried to write back a per-member
	// OAuth token (RW10 POST /accounts/me/oauth-member-token) for an account that
	// is NOT in any group they are an active member of. Defense in depth on the
	// write-back path (R14.1 membership gate, fail-closed). 403.
	CodeBizOauthMemberTokenForbidden = "BIZ_OAUTH_MEMBER_TOKEN_FORBIDDEN"
	// CodeBizOauthLoginCredNotProvisioned: a member pulled the routed account's
	// login credential (RW7 GET /accounts/me/group-routed-credential) but the admin
	// has not stored a login email/password for that account yet. 404.
	CodeBizOauthLoginCredNotProvisioned = "BIZ_OAUTH_LOGIN_CRED_NOT_PROVISIONED"

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
		Message: fmt.Sprintf("email %q is already registered", email),
		Meta:    map[string]any{"email": email}}
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
func BizAuthWrongCurrentPwd() *DomainError {
	return &DomainError{Code: CodeBizAuthWrongCurrentPwd, Message: "current password is incorrect"}
}
func BizAuthWeakPassword() *DomainError {
	return &DomainError{Code: CodeBizAuthWeakPassword,
		Message: "new password is too weak (need at least 8 chars with a letter and a digit)"}
}

func BizOrgNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizOrgNotFound,
		Message: fmt.Sprintf("organization %q not found", id),
		Meta:    map[string]any{"id": id}}
}

func BizSeatNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizSeatNotFound,
		Message: fmt.Sprintf("seat %q not found", id),
		Meta:    map[string]any{"id": id}}
}
func BizSeatEmailTaken(email, orgID string) *DomainError {
	return &DomainError{Code: CodeBizSeatEmailTaken,
		Message: fmt.Sprintf("seat for email %q already exists in org %q", email, orgID),
		Meta:    map[string]any{"email": email, "org_id": orgID}}
}
func BizSeatAlreadyClaimed() *DomainError {
	return &DomainError{Code: CodeBizSeatAlreadyClaimed, Message: "seat has already been claimed"}
}
func BizSeatStatusConflict(msg string) *DomainError {
	return &DomainError{Code: CodeBizSeatAlreadyClaimed, Message: msg}
}

func BizKeyNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizKeyNotFound,
		Message: fmt.Sprintf("virtual key %q not found", id),
		Meta:    map[string]any{"id": id}}
}
func BizKeyNotActive() *DomainError {
	return &DomainError{Code: CodeBizKeyNotActive, Message: "virtual key is not in active state"}
}
func BizKeyDuplicateProtocol(protocol string) *DomainError {
	return &DomainError{Code: CodeBizKeyDuplicateProtocol,
		Message: fmt.Sprintf("duplicate protocol_type %q in binding list", protocol),
		Meta:    map[string]any{"protocol_type": protocol}}
}

func BizBindNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizBindNotFound,
		Message: fmt.Sprintf("binding %q not found", id),
		Meta:    map[string]any{"id": id}}
}
func BizBindProtocolMismatch(bindingProtocol, credProtocol string) *DomainError {
	return &DomainError{Code: CodeBizBindProtocolMismatch,
		Message: fmt.Sprintf("binding protocol %q does not match credential provider protocol %q",
			bindingProtocol, credProtocol),
		Meta: map[string]any{"binding_protocol": bindingProtocol, "cred_protocol": credProtocol}}
}

// BizBindOAuthDirect — an OAuth-account credential was used as a direct binding
// target. OAuth accounts are runtime-delivered (channel ③) and only routable
// through a seat group; a direct bind would yield an unusable VK, so reject it
// up front and point the admin at seat groups.
func BizBindOAuthDirect(credentialID string) *DomainError {
	return &DomainError{Code: CodeBizBindOAuthDirect,
		Message: "OAuth account credentials can only be assigned through a seat group, not bound directly to a seat",
		Meta:    map[string]any{"credential_id": credentialID}}
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
		Message: fmt.Sprintf("credential %q not found", id),
		Meta:    map[string]any{"id": id}}
}
func BizCredInactive(id string) *DomainError {
	return &DomainError{Code: CodeBizCredInactive,
		Message: fmt.Sprintf("credential %q is not active", id),
		Meta:    map[string]any{"id": id}}
}

// BizOauthGroupNotFound — a seat group (or a sub-resource keyed by id within the
// oauth-group domain) was not found / not in this org.
func BizOauthGroupNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizOauthGroupNotFound,
		Message: fmt.Sprintf("seat group %q not found", id),
		Meta:    map[string]any{"id": id}}
}

// BizOauthGroupDefaultProtected — the per-org default group cannot be deleted.
func BizOauthGroupDefaultProtected() *DomainError {
	return &DomainError{Code: CodeBizOauthGroupDefaultProtected,
		Message: "the default seat group cannot be deleted"}
}

// BizOauthGroupCredInUse — a credential already belongs to a seat group
// (credential_id UNIQUE: 1 credential ∈ at most 1 group).
func BizOauthGroupCredInUse(credentialID string) *DomainError {
	return &DomainError{Code: CodeBizOauthGroupCredInUse,
		Message: fmt.Sprintf("credential %q already belongs to a seat group", credentialID),
		Meta:    map[string]any{"credential_id": credentialID}}
}

// BizOauthGroupRatioRejected — issuing to a group would push the seats:accounts
// ratio past the reject threshold (N4). The user must add accounts to the group
// (relieve the bottleneck at the source) before issuing more seats.
func BizOauthGroupRatioRejected(seats, accounts int, limit float64) *DomainError {
	return &DomainError{Code: CodeBizOauthGroupRatioRejected,
		Message: fmt.Sprintf("seat group is over capacity: %d seats vs %d accounts exceeds the %.0f:1 limit — add accounts before issuing more keys", seats, accounts, limit),
		Meta:    map[string]any{"seats": seats, "accounts": accounts, "reject_ratio": limit}}
}

// BizOauthGroupDisabled — a group binding target was requested but the oauth_group
// feature is not enabled in this deployment.
func BizOauthGroupDisabled() *DomainError {
	return &DomainError{Code: CodeBizOauthGroupDisabled,
		Message: "seat group binding targets are not enabled in this deployment"}
}

// BizOauthMemberTokenForbidden — the caller tried to write back a per-member OAuth
// token for an account they have no active group membership for (RW10 write-back
// authz, R14.1 membership gate).
func BizOauthMemberTokenForbidden() *DomainError {
	return &DomainError{Code: CodeBizOauthMemberTokenForbidden,
		Message: "not an active member of a group containing this account"}
}

// BizOauthLoginCredNotProvisioned — the routed account has no admin-stored login
// email/password yet (RW7 pull). 404.
func BizOauthLoginCredNotProvisioned() *DomainError {
	return &DomainError{Code: CodeBizOauthLoginCredNotProvisioned,
		Message: "no login credential has been provisioned for this account"}
}

// BizBindTargetInvalid — a binding's target shape is invalid (must be exactly one
// of credential / oauth_group; an issuance can't mix credential + group or span
// two groups).
func BizBindTargetInvalid(reason string) *DomainError {
	return &DomainError{Code: CodeBizBindTargetInvalid,
		Message: "invalid binding target: " + reason,
		Meta:    map[string]any{"reason": reason}}
}

func BizProvNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizProvNotFound,
		Message: fmt.Sprintf("provider %q not found", id),
		Meta:    map[string]any{"id": id}}
}

func BizLoginSessionNotFound(id string) *DomainError {
	return &DomainError{Code: CodeBizLoginSessionNotFound,
		Message: fmt.Sprintf("login session %q not found", id),
		Meta:    map[string]any{"id": id}}
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
func BizJoinTokenInvalid() *DomainError {
	return &DomainError{Code: CodeBizJoinTokenInvalid,
		Message: "join token is invalid, revoked, or expired"}
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
