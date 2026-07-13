package shared

// Central event-name registry. WARN/ERROR call sites must use these constants
// so dashboards and alerts cannot drift through ad-hoc string literals.
const (
	EventControlLoginApprovalCleanupFail = "control.login.approval_cleanup_failed"
	EventControlSSOProviderDisabled      = "control.sso.provider_disabled"
	EventControlSSOExchangeFailed        = "control.sso.exchange_failed"
	EventControlSSOUserInfoFallback      = "control.sso.userinfo_fallback"
	EventControlSSOAliasBackfillFail     = "control.sso.alias_backfill_failed"
)
