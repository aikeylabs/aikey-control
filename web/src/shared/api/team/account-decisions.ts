/**
 * Account Switch Log client — GET /accounts/me/account-decisions (master).
 *
 * The member-visible allocation-engine decision trail
 * (update/20260731-OAuth账号池-账号切换日志页.md). Visibility is enforced
 * SERVER-SIDE (personal = rows whose decision-time affected_seats snapshot hits
 * my seat; pools = every row of a group I own); the scope param only partitions
 * the already-visible set. Same two-hop team-fetch path as oauth-contribute.
 */
import { teamGetJSON, type TeamFetchError } from './team-fetch';

export interface AccountDecisionSeat {
  seat_id: string;
  email?: string;
  you?: boolean;
}

export interface AccountDecisionEvent {
  decision_id: string;
  oauth_group_id?: string;
  group_alias?: string;
  account_id?: string;
  account_email?: string;
  decision_type: string;
  trigger: string;
  detail: string;
  auto_executed: boolean;
  created_at: number;
  affects_you: boolean;
  owned_pool: boolean;
  /** Absent (undefined) = pre-snapshot row → render "—", never attribute. */
  affected_seats?: AccountDecisionSeat[];
}

export interface AccountDecisionsSummary {
  total: number;
  auto_executed: number;
  advisory: number;
}

export interface AccountDecisionsPage {
  events: AccountDecisionEvent[];
  total: number;
  limit: number;
  offset: number;
  summary: AccountDecisionsSummary;
}

export type SwitchLogScope = '' | 'personal' | 'pools';

export interface FetchAccountDecisionsParams {
  scope?: SwitchLogScope;
  decision?: string;
  group?: string;
  /** Window start, unix seconds (server default: now - 7d). */
  from?: number;
  limit?: number;
  offset?: number;
}

export async function fetchAccountDecisions(
  params: FetchAccountDecisionsParams = {},
): Promise<AccountDecisionsPage | TeamFetchError> {
  const q = new URLSearchParams();
  if (params.scope) q.set('scope', params.scope);
  if (params.decision) q.set('decision', params.decision);
  if (params.group) q.set('group', params.group);
  if (params.from != null) q.set('from', String(params.from));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  const qs = q.toString();
  const res = await teamGetJSON<AccountDecisionsPage>(
    `/accounts/me/account-decisions${qs ? `?${qs}` : ''}`,
  );
  if (res && typeof res === 'object' && 'kind' in res) return res;
  // Older servers without this endpoint reach here as parse/404 errors via
  // teamGetJSON; a well-formed body still normalizes nullable arrays.
  const page = res as AccountDecisionsPage;
  return {
    events: page.events ?? [],
    total: page.total ?? 0,
    limit: page.limit ?? 20,
    offset: page.offset ?? 0,
    summary: page.summary ?? { total: 0, auto_executed: 0, advisory: 0 },
  };
}
