/**
 * Team Vault store — caches team-key records fetched from B and tracks
 * the fetch lifecycle as a discriminated state machine.
 *
 * State machine: idle → loading → (loaded | not-logged-in | unauth |
 *                                  unreachable | parse-error)
 *
 * Re-entry: setting status back to 'loading' from any non-loading
 * state restarts the fetch. The vault page invokes refresh() on mount
 * and from the "Retry" button on the unreachable banner.
 *
 * Why zustand (not React context): vault page is the only consumer
 * today, but `aikey use` propagation later may need other surfaces
 * (Overview cards, Invoke history) to read team-key metadata too.
 * Zustand subscription model lets those subscribe without prop-
 * drilling through the route tree.
 *
 * Phase 3B revised (2026-05-11): the local-alias overlay layer
 * (aliasOverrides + setAliasOverride + selectEffectiveTeamRecords)
 * was removed once vault.list started emitting team records inline
 * with `alias = local_alias ?? server_alias` directly. The store now
 * exists only as a reachability/health probe — its `records` field is
 * not the display source for the vault page anymore (which reads
 * `listData.records` instead), but `status` + `error` still drive the
 * "team server unreachable" banner.
 *
 * See roadmap update 20260511-vault-page-team-key-merged-display.md
 * §3 (add) + §5 (data flow) for the design.
 */

import { create } from 'zustand';
import { fetchTeamManagedKeys } from '../shared/api/team/managed-keys';
import type { TeamFetchError } from '../shared/api/team/managed-keys';
import type { TeamVaultRecord } from '../shared/types/team-vault';

export type TeamVaultStatus =
  | 'idle'
  | 'loading'
  | 'loaded'
  | TeamFetchError['kind'];

interface TeamVaultState {
  status: TeamVaultStatus;
  /** Server-fetched records. Retained for the Team Keys drawer on the
   * virtual-keys page (cross-origin lookup of route_url / route_token).
   * Not the display source for the vault page anymore — that reads
   * `listData.records` directly with team rows emitted inline by the
   * CLI. */
  records: TeamVaultRecord[];
  /** Set to the error categorization on failure for downstream use
   * (banner copy, telemetry). Null in non-error states. */
  error: TeamFetchError | null;
  /** Last successful or attempted fetch instant — populated on every
   * status transition out of 'loading' so banners can show "fetched
   * X seconds ago" if they want. */
  fetched_at: string | null;
  /** Trigger a fresh fetch. Idempotent if already in 'loading' (the
   * inflight call wins; the second call is a no-op). */
  refresh: () => Promise<void>;
  /** Imperatively clear records + reset to idle. Used on logout. */
  reset: () => void;
}

export const useTeamVaultStore = create<TeamVaultState>((set, get) => ({
  status: 'idle',
  records: [],
  error: null,
  fetched_at: null,
  refresh: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    const result = await fetchTeamManagedKeys();
    if ('records' in result) {
      set({
        status: 'loaded',
        records: result.records,
        error: null,
        fetched_at: result.fetched_at,
      });
      return;
    }
    // Error path. Empty records array so consumers don't render stale
    // data alongside an error banner — the design says hide-on-failure,
    // not show-stale.
    set({
      status: result.kind,
      records: [],
      error: result,
      fetched_at: new Date().toISOString(),
    });
  },
  reset: () => set({ status: 'idle', records: [], error: null, fetched_at: null }),
}));

/** Selector: records grouped by protocol_family. Used by the vault
 * page to merge with personal records inside the same group sections. */
export function selectTeamRecordsByProtocol(
  s: Pick<TeamVaultState, 'records'>,
): Record<string, TeamVaultRecord[]> {
  const out: Record<string, TeamVaultRecord[]> = {};
  for (const r of s.records) {
    const key = r.protocol_family || 'unknown';
    if (!out[key]) out[key] = [];
    out[key].push(r);
  }
  return out;
}
