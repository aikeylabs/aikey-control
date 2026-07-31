package shared

// Central event-name registry. WARN/ERROR call sites must use these constants
// so dashboards and alerts cannot drift through ad-hoc string literals.
const (
	EventControlLoginApprovalCleanupFail                   = "control.login.approval_cleanup_failed"
	EventControlSSOProviderDisabled                        = "control.sso.provider_disabled"
	EventControlSSOExchangeFailed                          = "control.sso.exchange_failed"
	EventControlSSOUserInfoFallback                        = "control.sso.userinfo_fallback"
	EventControlSSOAliasBackfillFail                       = "control.sso.alias_backfill_failed"
	EventControlMockProviderConfigInvalid                  = "control.mock_provider.config_invalid"
	EventControlMockProviderRouteReconcileFailed           = "control.mock_provider.route_reconcile_failed"
	EventControlMockProviderRouteInvalid                   = "control.mock_provider.route_invalid"
	EventControlMockProviderProtocolMissing                = "control.group_runtime.mock_protocol_missing"
	EventControlMockProviderBaseURLMissing                 = "control.group_runtime.mock_base_url_missing"
	EventControlOAuthGroupAutoVKFailed                     = "control.oauth_group.auto_vk_failed"
	EventControlOAuthGroupVKInvalidationFailed             = "control.oauth_group.vk_invalidation_failed"
	EventControlOAuthGroupVKInvalidationCompensationFailed = "control.oauth_group.vk_invalidation_compensation_failed"
	EventControlOAuthGroupAttachMemberListFailed           = "control.oauth_group.attach_member_list_failed"
	EventControlOAuthGroupEnableMemberListFailed           = "control.oauth_group.enable_member_list_failed"
	EventControlSnapshotOAuthGroupResolveFailed            = "control.snapshot.oauth_group_resolve_failed"
	EventControlSnapshotOAuthGroupBumpFailed               = "control.snapshot.oauth_group_bump_failed"
	EventControlUsageReportingTimeZoneReadFailed           = "control.usage.reporting_time_zone_read_failed"
	EventControlUsageReportingTimeZoneInvalid              = "control.usage.reporting_time_zone_invalid"
	// EventControlConvAuditSeatSearchFailed fires when the usage facade cannot
	// resolve a conversation-audit seat-name search (?q=) against org_seats. The
	// request is answered with an explicit 500 (never silently forwarded
	// unfiltered — a failed search must not masquerade as "everyone matched").
	EventControlConvAuditSeatSearchFailed      = "control.conversation_audit.seat_search_failed"
	EventControlAgentPoolStatusReadFailed      = "control.onlineagent.pool_status_read_failed"
	EventControlAgentPoolUtilizationReadFailed = "control.onlineagent.pool_utilization_read_failed"
	EventControlAgentLastRouteReadFailed       = "control.onlineagent.last_route_read_failed"
	// EventControlAdminAgentVKAction records an ADMIN minting or rotating an
	// online agent's VK from the master console. Privileged: a rotate
	// invalidates the credential another member currently has configured, so
	// the actor, the target agent seat and the action are auditable. Never
	// carries token material (the plaintext is returned to the caller only).
	EventControlAdminAgentVKAction = "control.onlineagent.admin_vk_action"
	// EventControlSSOStateRejected fires when a `state` handle is presented that
	// was already consumed or was issued for another provider. A handle goes to
	// the provider exactly once, so this is an attack signal — alert on it rather
	// than treating it as retry noise.
	EventControlSSOStateRejected = "control.sso.state_rejected"
	// EventControlSSOIdentityWriteBlocked fires when the write-once guard stops a
	// second pending identity from replacing the first on one login session.
	EventControlSSOIdentityWriteBlocked = "control.sso.identity_write_blocked"
	// EventControlSSOAccountCreated fires on an SSO first login, when the provider
	// subject had no mapping and a new account was created for it.
	// 🚫 Carries account_id / request correlation only — never the subject
	// (a union_id identifies a real person) and never a plaintext address.
	EventControlSSOAccountCreated = "control.sso.account_created"
	// EventControlSSOSeatAutoProvisioned fires on every SSO first login that
	// reaches the seat branch — including the outcomes where NO seat was opened
	// (switch off, quota reached, no resolvable org). A zero is the observation
	// that matters: it is the difference between "the admin left it off" and
	// "auto-provisioning is broken", and only an emitted event can tell them
	// apart. The tech scheme wrote these two names as `auth.sso.*`; the central
	// registry's format is <service>.<area>.<state> and this service is control,
	// so they join their siblings above.
	EventControlSSOSeatAutoProvisioned = "control.sso.seat_auto_provisioned"
)
