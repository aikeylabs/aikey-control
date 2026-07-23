package shared

// Central event-name registry. WARN/ERROR call sites must use these constants
// so dashboards and alerts cannot drift through ad-hoc string literals.
const (
	EventControlLoginApprovalCleanupFail         = "control.login.approval_cleanup_failed"
	EventControlSSOProviderDisabled              = "control.sso.provider_disabled"
	EventControlSSOExchangeFailed                = "control.sso.exchange_failed"
	EventControlSSOUserInfoFallback              = "control.sso.userinfo_fallback"
	EventControlSSOAliasBackfillFail             = "control.sso.alias_backfill_failed"
	EventControlMockProviderConfigInvalid        = "control.mock_provider.config_invalid"
	EventControlMockProviderRouteReconcileFailed = "control.mock_provider.route_reconcile_failed"
	EventControlMockProviderRouteInvalid         = "control.mock_provider.route_invalid"
	EventControlMockProviderProtocolMissing      = "control.group_runtime.mock_protocol_missing"
	EventControlMockProviderBaseURLMissing       = "control.group_runtime.mock_base_url_missing"
	EventControlOAuthGroupAutoVKFailed           = "control.oauth_group.auto_vk_failed"
	EventControlOAuthGroupAttachMemberListFailed = "control.oauth_group.attach_member_list_failed"
	// EventControlSSOStateRejected fires when a `state` handle is presented that
	// was already consumed or was issued for another provider. A handle goes to
	// the provider exactly once, so this is an attack signal — alert on it rather
	// than treating it as retry noise.
	EventControlSSOStateRejected = "control.sso.state_rejected"
	// EventControlSSOIdentityWriteBlocked fires when the write-once guard stops a
	// second pending identity from replacing the first on one login session.
	EventControlSSOIdentityWriteBlocked = "control.sso.identity_write_blocked"
)
