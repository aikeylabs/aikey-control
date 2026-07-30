import { describe, expect, it } from 'vitest';

import type {
  MyOauthGroup,
  MyPoolAccount,
} from '@/shared/api/team/oauth-contribute';
import {
  accountScopeCounts,
  accountScopeSections,
  filterAgentPools,
  filterPersonalAccounts,
  initialAccountScope,
} from './account-scope';

const personalAccounts: MyPoolAccount[] = [
  {
    credential_id: 'personal-a',
    identity: 'personal-a@example.com',
    status: 'logged_in',
    last_login_at: 0,
    expires_at: 0,
    is_routed: true,
    oauth_group_id: 'agent-group',
  },
  {
    credential_id: 'personal-b',
    identity: 'personal-b@example.com',
    status: 'needs_login',
    last_login_at: 0,
    expires_at: 0,
    is_routed: false,
    oauth_group_id: 'company-group',
  },
];

const agentPools: MyOauthGroup[] = [
  {
    oauth_group_id: 'agent-group',
    alias: 'Agent pool',
    is_default: false,
    is_owner: true,
    accounts: [
      {
        credential_id: 'agent-a',
        identity: 'agent-a@example.com',
        provider_code: 'anthropic',
        enabled: true,
        login_status: 'needs_login',
      },
      {
        credential_id: 'agent-b',
        identity: 'agent-b@example.com',
        provider_code: 'anthropic',
        enabled: true,
        login_status: 'logged_in',
      },
    ],
  },
  {
    oauth_group_id: 'empty-agent-group',
    alias: 'Empty Agent pool',
    is_default: false,
    is_owner: true,
    accounts: [],
  },
];

const companyPool: MyOauthGroup = {
  oauth_group_id: 'company-group',
  alias: 'Company pool',
  is_default: false,
  is_owner: false,
};

describe('Team OAuth account ownership scope', () => {
  it('orders personal accounts before Agent pools in All', () => {
    expect(accountScopeSections('all')).toEqual(['personal', 'agent_pool']);
    expect(accountScopeSections('personal')).toEqual(['personal']);
    expect(accountScopeSections('agent_pool')).toEqual(['agent_pool']);
  });

  it('derives a group deep link from the authoritative owner flag', () => {
    expect(initialAccountScope('agent-group', [...agentPools, companyPool])).toBe('agent_pool');
    expect(initialAccountScope('company-group', [...agentPools, companyPool])).toBe('personal');
    expect(initialAccountScope('unknown-group', [...agentPools, companyPool])).toBe('all');
    expect(initialAccountScope(null, [...agentPools, companyPool])).toBe('all');
  });

  it('counts rendered account rows with one unit across every scope', () => {
    expect(accountScopeCounts(personalAccounts, agentPools, null)).toEqual({
      all: 4,
      personal: 2,
      agent_pool: 2,
    });
    expect(accountScopeCounts(personalAccounts, agentPools, 'agent-group')).toEqual({
      all: 3,
      personal: 1,
      agent_pool: 2,
    });
  });

  it('applies group and email search inside both ownership scopes', () => {
    expect(filterPersonalAccounts(personalAccounts, 'agent-group', '')
      .map((account) => account.credential_id)).toEqual(['personal-a']);
    expect(filterPersonalAccounts(personalAccounts, null, 'PERSONAL-B')
      .map((account) => account.credential_id)).toEqual(['personal-b']);

    const pools = filterAgentPools(agentPools, null, 'AGENT-B');
    expect(pools).toHaveLength(1);
    expect(pools[0].accounts?.map((account) => account.credential_id)).toEqual(['agent-b']);
  });
});
