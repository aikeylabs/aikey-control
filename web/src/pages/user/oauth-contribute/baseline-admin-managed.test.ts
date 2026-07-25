// @ts-nocheck — vitest-only source-level integration fence; the product bundle
// does not need Node ambient types for reading its source file.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/user/oauth-contribute/index.tsx'),
  'utf-8',
);
const apiSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/shared/api/team/oauth-contribute.ts'),
  'utf-8',
);

describe('OAuth exit-IP baseline is administrator-managed', () => {
  it('renders the effective account/group baseline and the admin-pending state', () => {
    expect(pageSource).toContain('egressView?.effective_exit_ip');
    expect(pageSource).toContain("t('oauthContribute.baselineInherited'");
    expect(pageSource).toContain("t('oauthContribute.baselineAccount'");
    expect(pageSource).toContain("t('oauthContribute.baselineAdminPending'");
  });

  it('does not expose a member baseline write helper or save control', () => {
    expect(apiSource).not.toContain('saveAccountExitIP');
    expect(pageSource).not.toContain('saveBaselineMut');
    expect(pageSource).not.toContain("t('oauthContribute.saveBaseline'");
  });
});
