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
	EventControlOAuthGroupUtilizationReadFailed            = "control.oauth_group.utilization_read_failed"
	EventControlSnapshotOAuthGroupResolveFailed            = "control.snapshot.oauth_group_resolve_failed"
	EventControlSnapshotOAuthGroupBumpFailed               = "control.snapshot.oauth_group_bump_failed"
	EventControlOrgDeliveryAssignmentReadFailed            = "control.org_delivery.assignment_read_failed"
	EventControlUsageReportingTimeZoneReadFailed           = "control.usage.reporting_time_zone_read_failed"
	EventControlUsageReportingTimeZoneInvalid              = "control.usage.reporting_time_zone_invalid"
	// EventControlConvAuditSeatSearchFailed fires when the usage facade cannot
	// resolve a conversation-audit seat-name search (?q=) against org_seats. The
	// request is answered with an explicit 500 (never silently forwarded
	// unfiltered — a failed search must not masquerade as "everyone matched").
	EventControlConvAuditSeatSearchFailed      = "control.conversation_audit.seat_search_failed"
	// EventControlConvAuditSeatSearchNarrowed fires when a seat search resolved
	// more keys than query-service accepts and the facade intersected them with
	// the keys that actually carry conversation rows. INFO, not WARN: the search
	// succeeded — this records that the payload was reduced, and by how much, so
	// an operator seeing a surprising result count can tell narrowing apart from
	// a genuinely empty match.
	EventControlConvAuditSeatSearchNarrowed    = "control.conversation_audit.seat_search_narrowed"
	EventControlAgentPoolStatusReadFailed      = "control.onlineagent.pool_status_read_failed"
	EventControlAgentPoolUtilizationReadFailed = "control.onlineagent.pool_utilization_read_failed"
	EventControlAgentLastRouteReadFailed       = "control.onlineagent.last_route_read_failed"
	// EventControlAdminAgentVKAction records an ADMIN minting or rotating an
	// online agent's VK from the master console. Privileged: a rotate
	// invalidates the credential another member currently has configured, so
	// the actor, the target agent seat and the action are auditable. Never
	// carries token material (the plaintext is returned to the caller only).
	EventControlAdminAgentVKAction = "control.onlineagent.admin_vk_action"
	// EventControlLegacyAPIPathUsed fires when a request arrives on a renamed
	// endpoint's retired path (see HandleWithLegacyPath). It is the ONLY evidence
	// that lets a later release delete the alias: zero occurrences across a
	// release window means no shipped client still calls it. WARN, not INFO —
	// it must survive default log levels, otherwise the evidence is missing
	// exactly where it is needed (production).
	EventControlLegacyAPIPathUsed = "control.api.legacy_path_used"
	// EventControlMemberAgentVKAction is the member self-service twin of
	// EventControlAdminAgentVKAction: the OWNER ensuring, rotating or revealing
	// their own agent's VK. Kept as a separate name (rather than reusing the
	// admin one with an actor field) so "someone acted on a credential that is
	// not theirs" stays a distinct, alertable signal. Never carries token
	// material.
	EventControlMemberAgentVKAction = "control.onlineagent.member_vk_action"
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
	// EventUserAPICliBridgeStderr fires when an `aikey _internal` subprocess
	// wrote to stderr yet still returned a well-formed envelope, i.e. the call
	// SUCCEEDED but degraded. Before 2026-08-01 that stderr was discarded on
	// the success path, so a cli that silently dropped rows from a response
	// (the vault list skipping entries it could not decrypt) produced a page
	// with missing data and not one line of evidence anywhere on the server.
	// Partial success is exactly the case that needs a log line — a total
	// failure at least surfaces an error code to the user.
	EventUserAPICliBridgeStderr = "userapi.cli_bridge.stderr"
	// EventUserLocalComplianceWireDriftDetected fires when the Personal/Trial
	// local compliance ingest decodes a payload carrying JSON fields this build
	// does not know: the detector is ahead of the local-server and the extra
	// fields were silently dropped into the void. Before 2026-08-10 this lane
	// had NO strict check at all, so a wire addition on the detector side just
	// evaporated — the event still landed, minus data, with zero evidence
	// anywhere. The team lane surfaces the same drift as a 400 (it can afford
	// to: aikey-proxy dead-letters and replays it); this lane cannot, so it
	// keeps the event and raises the alarm instead.
	//
	// STATE, NOT STREAM: emitted only on the CLEAN → DRIFT transition. Drift is
	// a standing condition — once the detector adds a field, EVERY batch trips
	// it — so per-request logging would be a flood. See the paired _cleared
	// name for the DRIFT → CLEAN edge, which carries the episode's damage total.
	EventUserLocalComplianceWireDriftDetected = "userlocal.compliance_ingest.wire_drift_detected"
	// EventUserLocalComplianceWireDriftCleared fires on the DRIFT → CLEAN edge
	// (or when the drift signature changes), carrying how many requests were
	// suppressed while the condition stood. Logged at WARN, not INFO, on
	// purpose: it is the ONLY place the damage total appears, so an operator
	// filtering on WARN must not be shown the start of an episode without its
	// end. Bounded at one line per episode.
	EventUserLocalComplianceWireDriftCleared = "userlocal.compliance_ingest.wire_drift_cleared"
)
