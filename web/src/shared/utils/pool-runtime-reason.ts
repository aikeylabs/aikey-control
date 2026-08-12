/**
 * Pool runtime reasons — the console-side half of the service contract in
 * `accesstoken/service.go` (`PoolRuntimeReason*`).
 *
 * # Why this table exists (2026-08-12)
 *
 * `runtime.state === 'unavailable'` alone conflated causes decided from
 * Control's OWN allocation ledger — where no Worker is ever contacted — with
 * real Worker faults, and both consoles painted them the same red. A token that
 * had simply never served a request was reported as "Worker unavailable",
 * sending troubleshooting at a Worker nobody asked about.
 *
 * `alarm` answers ONE of the two questions a reason carries, and the two must
 * not be collapsed — collapsing them is what produced the original bug:
 *   - WHO DECIDED IT (not encoded here, it is the reason's own meaning): a
 *     binding-side reason comes from Control's ledger with Hub never contacted,
 *     so it is never evidence about a Worker.
 *   - IS SOMETHING BROKEN (`alarm`): `false` means an ordinary state — the
 *     token is disabled, has no pool, has no binding yet, or this deployment
 *     has no Hub. `true` means a real failure worth attention.
 *
 * `binding_unavailable` (the ledger read itself failed) is quiet on the first
 * axis and alarming on the second — the case that proves one flag cannot serve
 * both.
 *
 * # Why it lives in shared/utils
 *
 * Both the member console (user/web) and the Master console (master/web) render
 * the same `runtime.reason` field from the same endpoint. The trial composer
 * resolves `@/shared/*` to master/web, so the two copies must stay
 * byte-identical — enforced by `make -f workflow/CI/Makefile web-drift-check`.
 */
export interface PoolRuntimeReasonSpec {
  /** i18n key under the shared `poolRuntime.reason` namespace. */
  key: string;
  alarm: boolean;
}

export const POOL_RUNTIME_REASON: Record<string, PoolRuntimeReasonSpec> = {
  token_inactive: { key: 'poolRuntime.reason.tokenInactive', alarm: false },
  source_unavailable: { key: 'poolRuntime.reason.sourceUnavailable', alarm: false },
  not_configured: { key: 'poolRuntime.reason.notConfigured', alarm: false },
  not_bound: { key: 'poolRuntime.reason.notBound', alarm: false },
  binding_stale: { key: 'poolRuntime.reason.bindingStale', alarm: false },
  binding_unavailable: { key: 'poolRuntime.reason.bindingUnavailable', alarm: true },
  credential_missing: { key: 'poolRuntime.reason.credentialMissing', alarm: false },
  hub_unreachable: { key: 'poolRuntime.reason.hubUnreachable', alarm: true },
  node_absent: { key: 'poolRuntime.reason.nodeAbsent', alarm: true },
  node_down: { key: 'poolRuntime.reason.nodeDown', alarm: true },
};

/**
 * i18n key for a reason, or undefined when the server sent one this build does
 * not know yet. Callers fall back to their page's generic sentence rather than
 * rendering a raw enum value at the user.
 */
export function poolRuntimeReasonKey(reason?: string): string | undefined {
  return reason ? POOL_RUNTIME_REASON[reason]?.key : undefined;
}

/**
 * Whether a non-available runtime deserves the alarm tone. An UNKNOWN reason
 * stays alarming on purpose: a reason we cannot classify is not evidence that
 * everything is fine.
 */
export function isPoolRuntimeAlarm(reason?: string): boolean {
  return POOL_RUNTIME_REASON[reason ?? '']?.alarm ?? true;
}
