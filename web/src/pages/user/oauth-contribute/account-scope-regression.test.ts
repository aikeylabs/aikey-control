// @ts-nocheck -- source-level interaction fence; production needs no Node types.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/user/oauth-contribute/index.tsx'),
  'utf-8',
);

describe('Team OAuth ownership navigation wiring', () => {
  it('uses ownership categories instead of status navigation', () => {
    expect(pageSource).toContain("t('oauthContribute.filterPersonalAccounts')");
    expect(pageSource).toContain("t('oauthContribute.filterAgentPools')");
    expect(pageSource).not.toContain('statusFilter');
    expect(pageSource).not.toContain("t('oauthContribute.filterInactive')");
  });

  it('resolves group deep links from MyGroups ownership instead of the URL alone', () => {
    expect(pageSource).toContain('initialAccountScope(poolFilter, myGroups)');
    expect(pageSource).not.toContain('initialAccountScope(initialPoolFilter)');
    expect(pageSource).toContain('myGroups.find((g) => g.oauth_group_id === poolFilter)');
  });

  it('renders the personal section before the Agent-pool section', () => {
    const personal = pageSource.indexOf('{/* Personal routed/history accounts.');
    const agentPool = pageSource.indexOf('{/* Owner Agent pools.');
    expect(personal).toBeGreaterThan(-1);
    expect(agentPool).toBeGreaterThan(personal);
  });
});
