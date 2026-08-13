import type {
  MyOauthGroup,
  MyPoolAccount,
} from '@/shared/api/team/oauth-contribute';

export type AccountScopeFilter = 'all' | 'personal' | 'agent_pool';
export type AccountScopeSection = Exclude<AccountScopeFilter, 'all'>;

const ALL_SECTIONS: readonly AccountScopeSection[] = ['personal', 'agent_pool'];

/**
 * A group id alone does not say who owns the pool. Agents may use either the
 * member's own Agent pool or an advanced-path company pool. Only the API's
 * authoritative `is_owner` flag may select the full Agent-pool projection;
 * company-pool members must stay on their permitted routed/history view.
 */
export function initialAccountScope(
  poolFilter: string | null,
  groups: readonly MyOauthGroup[],
): AccountScopeFilter {
  if (!poolFilter) return 'all';
  const group = groups.find((candidate) => candidate.oauth_group_id === poolFilter);
  if (!group) return 'all';
  return group.is_owner ? 'agent_pool' : 'personal';
}

/** Whether an explicit group deep link still belongs to the signed-in caller.
 * A successful groups response is authoritative; false lets the page discard a
 * bookmark to a deleted pool or a pool whose membership has been removed. */
export function isKnownPoolFilter(
  poolFilter: string | null,
  groups: readonly MyOauthGroup[],
): boolean {
  return !poolFilter || groups.some((group) => group.oauth_group_id === poolFilter);
}

/** Personal accounts always precede Agent pools in the combined view. */
export function accountScopeSections(scope: AccountScopeFilter): readonly AccountScopeSection[] {
  if (scope === 'all') return ALL_SECTIONS;
  return [scope];
}

function normalizedSearch(search: string): string {
  return search.trim().toLowerCase();
}

export function filterPersonalAccounts(
  accounts: readonly MyPoolAccount[],
  poolFilter: string | null,
  search: string,
): MyPoolAccount[] {
  const needle = normalizedSearch(search);
  return accounts.filter((account) => {
    if (poolFilter && account.oauth_group_id !== poolFilter) return false;
    return !needle || account.identity.toLowerCase().includes(needle);
  });
}

export function filterAgentPools(
  pools: readonly MyOauthGroup[],
  poolFilter: string | null,
  search: string,
): MyOauthGroup[] {
  const scopedPools = poolFilter
    ? pools.filter((pool) => pool.oauth_group_id === poolFilter)
    : pools.slice();
  const needle = normalizedSearch(search);
  if (!needle) return scopedPools;

  return scopedPools
    .map((pool) => ({
      ...pool,
      accounts: (pool.accounts ?? []).filter((account) =>
        account.identity.toLowerCase().includes(needle)),
    }))
    .filter((pool) => (pool.accounts?.length ?? 0) > 0);
}

export interface AccountScopeCounts {
  all: number;
  personal: number;
  agent_pool: number;
}

/** Counts use one unit everywhere: the account rows visible in each scope. */
export function accountScopeCounts(
  accounts: readonly MyPoolAccount[],
  pools: readonly MyOauthGroup[],
  poolFilter: string | null,
): AccountScopeCounts {
  const personal = filterPersonalAccounts(accounts, poolFilter, '').length;
  const agentPool = filterAgentPools(pools, poolFilter, '')
    .reduce((total, pool) => total + (pool.accounts?.length ?? 0), 0);
  return {
    all: personal + agentPool,
    personal,
    agent_pool: agentPool,
  };
}
