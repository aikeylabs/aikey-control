// @ts-nocheck — vitest executes this file in Node; the product bundle does not
// need Node ambient types merely for this source-level integration fence.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Merge-regression fence for the Team Keys page.
 *
 * The page is owned by aikey-control/web but bundled by the Master web app.
 * A 2026-07-22 conflict resolution kept the newer model-mapping branch while
 * silently dropping two independent runtime contracts: protocol/provider axes
 * and Personal's live OAuth-pool projection. These assertions pin the composing
 * points that ordinary unit tests cannot see when either side still compiles.
 */
const PAGE = path.resolve(process.cwd(), 'src/pages/user/virtual-keys/index.tsx');
const source = fs.readFileSync(PAGE, 'utf-8');

describe('Team Keys merge-regression contracts', () => {
  it('groups by client route while keeping provider and wire protocol separate', () => {
    expect(source).toContain('bindingClientRoutes(k.bindings, k.protocol_type)');
    expect(source).toContain('bindingProviderLabels(k.bindings, clientRoute)');
    expect(source).toContain('protocolsOf(r.bindings, r.protocol_type)');
    expect(source).toContain("t('teamKeys.colProvider')");
    expect(source).toContain('data-group-client-route={clientRoute}');
    expect(source).not.toContain('data-group-provider=');
  });

  it('carries Personal live pool state into both the table row and drawer', () => {
    expect(source).toContain('group_accounts?: GroupAccountRef[] | null;');
    expect(source).toContain('group_accounts: rec.group_accounts');
    expect(source).toContain('refetchInterval: 15_000');
    expect(source).toContain('localRoute={teamVaultByVk[k.virtual_key_id]}');
    expect(source).toContain('const groupAccounts = props.localRoute?.group_accounts ?? r.group_accounts;');
    expect(source).toContain('<PoolAccountList accounts={groupAccounts} />');
  });

  it('searches binding providers instead of only the legacy scalar provider', () => {
    expect(source).toContain('...(k.bindings ?? []).map((binding) => binding.provider)');
  });
});
