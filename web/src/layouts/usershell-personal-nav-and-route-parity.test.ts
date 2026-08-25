// @ts-nocheck — vitest-only test file using Node built-ins. Same pragma
// rationale as pages/user/no-silent-query-errors.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 Fence for ONE concept with many outlets: an SPA soft-navigation must
 * never target a path the hosting bundle does not register.
 *
 * Four instances of this concept shipped broken before this fence existed
 * (2026-08-24/25 debugging run — see bugfix
 * 20260825-trial-bundle-missing-team-usage-route +
 * 20260825-team-page-topbar-navigates-to-unregistered-route):
 *
 *   1. Sidebar entries as NavLinks on the composed/team side (fixed 2026-07-27
 *      via the teamGateway signal — the FIRST outlet).
 *   2. The top-bar Invite CTA: raw navigate('/user/invites') from the team
 *      bundle, which has no such route and no catch-all → raw full-viewport
 *      "Unexpected Application Error! 404 Not Found".
 *   3. The trial composer drew the Team Usage sidebar entry but never
 *      registered /user/team-usage-ledger (the 2026-07-03 canonical-path
 *      change propagated to master router + gateway table + menus — 3 of 4).
 *   4. Any stale bundle in a long-lived tab after a server upgrade.
 *
 * Per-outlet fixes kept missing the next outlet, so this fence pins the
 * CONCEPT three ways:
 *
 *   A. Both UserShell mirrors: no raw `navigate('/user/…')` literals outside
 *      the openPersonalPage helper (top-bar CTAs must use it).
 *   B. Trial composer parity: every teamOnly sidebar path (rendered as a
 *      local NavLink in composed mode) is registered in the trial router.
 *   C. Both no-per-block-fallback routers (master + trial) mount the
 *      RouteReloadFallback catch-all — the class-kill for outlets 1/4 and
 *      any future one: a route miss retries once as a full-document load
 *      (the server's ownership tables then pick the owning bundle), instead
 *      of rendering the raw error page.
 *
 * Cross-repo source reads mirror the precedent of
 * shared/ui/glass-header-scroll-contract.test.ts (byte-compares the master
 * mirror). Repo layout is fixed by the aikeylabs workspace.
 */
const WEB_ROOT = join(__dirname, '..', '..');           // aikey-control/web
const REPOS_ROOT = join(WEB_ROOT, '..', '..');          // aikeylabs/

const SHELLS = [
  join(WEB_ROOT, 'src/layouts/UserShell.tsx'),
  join(REPOS_ROOT, 'aikey-control-master/web/src/layouts/UserShell.tsx'),
];
const TRIAL_ROUTER = join(REPOS_ROOT, 'aikey-trial-server/web/src/router.tsx');
const MASTER_ROUTER = join(REPOS_ROOT, 'aikey-control-master/web/src/app/router/index.tsx');
const USER_ROUTES = join(WEB_ROOT, 'src/app/routes/user.tsx');

describe('UserShell personal-page navigation goes through the ONE helper', () => {
  for (const shell of SHELLS) {
    it(`no raw navigate('/user/…') outside openPersonalPage — ${shell.includes('master') ? 'master' : 'control'} mirror`, () => {
      const src = readFileSync(shell, 'utf8');
      // The helper's own body is the single allowed raw call site.
      const helperBody = src.split('const openPersonalPage')[1]?.split('const onOpenSettings')[0] ?? '';
      expect(helperBody, 'openPersonalPage helper must exist (its removal re-opens outlet #2)').toContain('navigate(path)');
      // Strip line comments first: the helper's own doc comment names the
      // pre-fix call as history, which is not a call site.
      const outside = src
        .replace(helperBody, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
      const raw = outside.match(/navigate\('\/user\/[a-z-]+'\)/g) ?? [];
      expect(
        raw,
        "raw navigate('/user/…') outside openPersonalPage — on the team bundle that path may be unregistered (no catch-all there renders the raw 404); route it through openPersonalPage",
      ).toEqual([]);
    });
  }
});

describe('trial composer registers every teamOnly sidebar path', () => {
  it('teamOnly navGroups paths ⊆ trial router (user routes + composer injections)', () => {
    const shell = readFileSync(SHELLS[0], 'utf8');
    // teamOnly sidebar entries — drawn as local NavLinks in composed mode.
    const teamOnlyPaths = [...shell.matchAll(/path:\s*'\/user\/([a-z-]+)',[^\n]*teamOnly:\s*true/g)].map((m) => m[1]);
    expect(teamOnlyPaths.length, 'sanity: the sidebar declares teamOnly entries').toBeGreaterThan(0);

    const trial = readFileSync(TRIAL_ROUTER, 'utf8');
    const userRoutes = readFileSync(USER_ROUTES, 'utf8');
    for (const p of teamOnlyPaths) {
      const registered = trial.includes(`path: '${p}'`) || userRoutes.includes(`path: '${p}'`);
      expect(
        registered,
        `teamOnly sidebar path /user/${p} is not registered in the trial composer — composed mode renders it as a NavLink, so clicking it is outlet #3 all over again (add it to withVirtualKeysOnUser's injections)`,
      ).toBe(true);
    }
  });
});

describe('no-fallback routers mount the RouteReloadFallback catch-all', () => {
  it('master router', () => {
    const src = readFileSync(MASTER_ROUTER, 'utf8');
    expect(src).toContain("{ path: '*', element: <RouteReloadFallback /> }");
  });
  it('trial composer router', () => {
    const src = readFileSync(TRIAL_ROUTER, 'utf8');
    expect(src).toContain("{ path: '*', element: <RouteReloadFallback /> }");
  });
});
