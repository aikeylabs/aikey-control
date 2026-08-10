// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const USER_ROUTES = fs.readFileSync(path.resolve(process.cwd(), 'src/app/routes/user.tsx'), 'utf-8');
const MASTER_ROUTES = fs.readFileSync(
  path.resolve(process.cwd(), '../../aikey-control-master/web/src/app/routes/master.tsx'), 'utf-8');

// 2026-08-10 rename Agents → Access Token moved both pages' URLs. A renamed URL
// without a redirect is a silent 404 for:
//   • members who bookmarked the page,
//   • the customer guide (workflow/Docs/enterprise-delivery/OAuth账号池-使用引导.md),
//   • an older PEER's cross-app menu, which still publishes /user/my-agents —
//     cross-app slotting matches on PATH, so a stale peer sends users to the old
//     URL until it upgrades.
//
// The repo already settled this pattern once: /user/cost → /user/performance kept
// a Navigate. This fence keeps the redirects from being "cleaned up" later.
//
// 能红: delete either legacy route line.
describe('legacy URL redirects survive the Access Token rename', () => {
  it('serves the member page at its new path and redirects the old one', () => {
    expect(USER_ROUTES).toMatch(/path: 'access-tokens', element: <AccessTokensPage \/>/);
    expect(USER_ROUTES).toMatch(
      /path: 'my-agents', element: <Navigate to="\/user\/access-tokens" replace \/>/);
  });

  it('serves the admin page at its new path and redirects the old one', () => {
    expect(MASTER_ROUTES).toMatch(/path: 'access-tokens', element: <AccessTokensPage \/>/);
    expect(MASTER_ROUTES).toMatch(/path: 'agents', element: <Navigate to="access-tokens" replace \/>/);
  });

  it('keeps the redirect RELATIVE on the admin side', () => {
    // /master/orgs/:orgId/agents must land on the SAME org's page. An absolute
    // target would drop :orgId and bounce the admin to another org's roster (or
    // to a 404) — the kind of bug that only shows up for someone who actually
    // had the old link.
    expect(MASTER_ROUTES).not.toMatch(/path: 'agents', element: <Navigate to="\/master/);
  });
});
