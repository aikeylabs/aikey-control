// Type-only import: never pull the runtimeConfig VALUE here — it reads
// window.__AIKEY_CONFIG__ at module load, which breaks node-env unit tests.
// Callers pass runtimeConfig explicitly.
import type { RuntimeConfig } from '../../app/config/runtime';

/**
 * Whether the usage-analytics pages (Usage Ledger / Usage Detail / Performance /
 * Overview) should query their OWN box's data with `org_id=personal` rather than
 * the logged-in member's `account_id`.
 *
 * The four deployment quadrants and the correct scope for each:
 *   - Personal local-server (authMode=local_bypass, no teamGateway) → LOCAL
 *     (org_id=personal): the local events DB tags rows with org_id=personal.
 *   - Trial single-binary (authMode=local_bypass, no teamGateway)   → LOCAL:
 *     one backend, same org_id=personal tagging. (unchanged)
 *   - Composing-gateway forwarded TEAM page (authMode=local_bypass BUT
 *     teamGateway=true) → NOT local: the gateway patch masquerades the team
 *     page as local_bypass, but its data lives on the team server keyed by
 *     account_id. Querying org_id=personal there returns EMPTY — the exact
 *     bug this predicate fixes (2026-07-04 team-usage-ledger empty).
 *   - Direct team-server visit (authMode=jwt) → NOT local: account_id.
 *
 * This is the identity twin of usageApiBase (which fixes WHICH backend): both
 * must key off explicit injected signals, never infer scope from authMode
 * alone (see the usageApiBase doc in runtime.ts).
 */
export function isLocalUsageScope(
  cfg: Pick<RuntimeConfig, 'authMode' | 'teamGateway'>,
): boolean {
  return cfg.authMode === 'local_bypass' && !cfg.teamGateway;
}
