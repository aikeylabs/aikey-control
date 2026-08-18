/**
 * Member scheduling-log client — GET /accounts/me/scheduling-logs (master).
 *
 * The member's OWN scheduling EVENTS (seat-scoped SERVER-SIDE — the caller can
 * only ever receive rows whose seat belongs to them; update/20260817 P8).
 * Engine DECISIONS are deliberately not duplicated on this wire: the page
 * merges them client-side from the battle-tested account-decisions read, so
 * the affected_seats visibility logic stays single-sourced.
 * Same two-hop team-fetch path as oauth-contribute / switch-log.
 */
import { teamGetJSON, type TeamFetchError } from './team-fetch';

export interface MySchedulingLogRow {
  /**
   * 'event' = proxy scheduling event; 'decision' = allocation-engine decision.
   * Both halves arrive from this one endpoint since 2026-08-18 (server-side
   * merge); before that it was events only, hence the previously narrower type.
   */
  kind: 'event' | 'decision';
  id: string;
  ts_ms: number;
  name: string;
  severity?: string;
  error_code?: string;
  account_id?: string;
  seat_id?: string;
  seat_display?: string;
  /** 'provider' = upstream response triggered it; 'aikey' = aikey scheduling/protection. */
  origin?: 'provider' | 'aikey';
  oauth_group_id?: string;
  detail?: Record<string, unknown>;
}

export interface FetchMySchedulingLogsParams {
  /** '' or omitted = both halves of the merged timeline. */
  kind?: '' | 'event' | 'decision';
  origin?: 'provider' | 'aikey';
  severity?: string;
  name?: string;
  /** Decision-half display filters (server-enforced visibility is separate). */
  scope?: '' | 'personal' | 'pools';
  decision?: string;
  group?: string;
  since_ms?: number;
  until_ms?: number;
  limit?: number;
  offset?: number;
}

/**
 * One page of the MERGED timeline. `total` is the merged, filtered count, so the
 * pager can show real page numbers.
 *
 * Why the merge is server-side (2026-08-18): asking each source for its own
 * offset N returns "each source's Nth slice", not "the Nth slice of the merge" —
 * which both skips and repeats rows at every page boundary.
 */
export interface MySchedulingLogPage {
  rows: MySchedulingLogRow[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchMySchedulingLogs(
  params: FetchMySchedulingLogsParams = {},
): Promise<MySchedulingLogPage | TeamFetchError> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // offset=0 is meaningful (page 1) — only drop undefined/empty.
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await teamGetJSON<MySchedulingLogPage>(`/accounts/me/scheduling-logs${suffix}`);
  // A TeamFetchError is discriminated by its `kind` STRING union. The page wire
  // has no top-level `kind`, but its rows do — so match on the error values, not
  // on the key's presence.
  if (res && typeof res === 'object' && 'kind' in res && typeof (res as { kind: unknown }).kind === 'string'
      && ['not-logged-in', 'unauth', 'unreachable', 'parse-error'].includes((res as { kind: string }).kind)) {
    return res as TeamFetchError;
  }
  const page = res as MySchedulingLogPage;
  return {
    rows: page?.rows ?? [],
    total: page?.total ?? page?.rows?.length ?? 0,
    limit: page?.limit ?? 0,
    offset: page?.offset ?? 0,
  };
}
