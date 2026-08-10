// @ts-nocheck — source-level integration fence; production bundle needs no
// Node ambient types for this test.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGE = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/user/access-tokens/index.tsx'), 'utf-8');
const ACCOUNTS_API = fs.readFileSync(path.resolve(process.cwd(), 'src/shared/api/user/accounts.ts'), 'utf-8');
const POOL_LIST = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/user/_shared/PoolAccountList.tsx'), 'utf-8');
const DETAIL_DRAWER = fs.readFileSync(path.resolve(process.cwd(), 'src/shared/ui/DetailDrawer.tsx'), 'utf-8');

describe('My Agents routing and account-pool observability', () => {
  it('keeps public Ingress binding separate from local Vault routing state', () => {
    expect(PAGE).toContain("t('accessTokens.routing.ingressBinding')");
    expect(PAGE).toContain("t('accessTokens.routing.lastServed')");
    expect(PAGE).toContain('binding.account_id !== lastRoute.account_id');
    expect(PAGE).not.toContain('routedGroupAccount(');
  });

  it('loads the safe pool model on demand through the team plane', () => {
    expect(ACCOUNTS_API).toContain('/accounts/me/access-tokens/${seatId}/pool-status');
    expect(ACCOUNTS_API).toContain('teamGetJSON<AgentPoolStatusDTO>');
    expect(PAGE).toContain("queryKey: ['my-agent-pool-status', agent?.seat_id]");
    expect(PAGE).toContain('enabled: Boolean(agent?.seat_id)');
		expect(PAGE).toContain('refetchInterval: agent?.seat_id ? 5_000 : false');
  });

	it('keeps selected-Worker runtime scheduling distinct from the Ingress binding', () => {
		expect(ACCOUNTS_API).toContain("state: 'available' | 'not_reported' | 'unavailable'");
		expect(ACCOUNTS_API).toContain('schedulable_accounts: number');
		expect(PAGE).toContain("t('accessTokens.routing.runtimeScheduling')");
		expect(PAGE).toContain('runtime?.node_id');
		expect(PAGE).toContain('runtime.earliest_retry_at');
		expect(POOL_LIST).toContain('account.node_id');
		expect(POOL_LIST).toContain("t('poolAccount.workerNode'");
		expect(POOL_LIST).toContain("account.runtime_state === 'unavailable'");
	});

  it('receives latest actual account through the ownership-scoped Control model', () => {
    expect(ACCOUNTS_API).toContain("state: 'available' | 'no_data' | 'unavailable'");
    expect(ACCOUNTS_API).toContain('/accounts/me/access-tokens/${seatId}/last-route');
    expect(PAGE).toContain('latestQuery.data?.last_served');
    expect(PAGE).toContain("queryKey: ['my-agent-last-route', agent?.seat_id]");
    expect(PAGE).not.toContain('personalByAgentTotal(');
    expect(PAGE).not.toContain('owner_seat_id }');
  });

  it('adds explicit selection semantics without changing Vault defaults', () => {
    expect(POOL_LIST).toContain('const routed = selection');
    expect(POOL_LIST).toContain(': routedGroupAccount(accounts)');
    expect(PAGE).toContain('primaryLabel: t(\'accessTokens.routing.ingressBindingBadge\')');
    expect(PAGE).toContain('showRemaining');
  });

  it('restores the shared keys-page skin inside the portaled routing drawer', () => {
    expect(DETAIL_DRAWER).toContain('createPortal(');
    expect(DETAIL_DRAWER).toContain('document.body');
    expect(PAGE).toContain('className="vault-page space-y-5 font-mono"');
  });

  it('opens the same routing drawer from both the Agent name and routing account', () => {
    const openCalls = PAGE.match(/setRoutingAgent\(agent\)/g) ?? [];
    expect(openCalls).toHaveLength(2);
    expect(PAGE).toContain("aria-label={t('accessTokens.routing.openTitle', { account: agent.alias })}");
  });
});
