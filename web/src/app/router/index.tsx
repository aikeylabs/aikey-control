import React from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { UserShell } from '@/layouts/UserShell';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AuthGuard } from '@/app/guards/AuthGuard';

// User pages (always in bundle — user-only build ships these directly)
import UserLoginPage from '@/pages/user/login';
import SessionExpiredPage from '@/pages/user/session-expired';
import UserOverviewPage from '@/pages/user/overview';
import MyAccountPage from '@/pages/user/account';
import UserVirtualKeysPage from '@/pages/user/virtual-keys';
import UserUsageLedgerPage from '@/pages/user/usage-ledger';
import UserBulkImportPage from '@/pages/user/import';
import UserVaultPage from '@/pages/user/vault';
import UserReferralsPage from '@/pages/user/referrals';
import CLIGuidePage from '@/pages/user/cli-guide';
import MasterNotAvailablePage from '@/pages/user/master-not-available';
import { GoAliasRedirect } from './go-alias';

// Whether this is a user-only build (personal edition, no master routes).
// __AIKEY_AUTH_MODE__ is a compile-time constant injected by vite.config.ts.
const isUserOnlyBuild = __AIKEY_AUTH_MODE__ === 'local_bypass';

// Why this shape — hard exclusion, not just route-gating (2026-04-22):
//
// Master pages AND the AppShell layout are imported with React.lazy INSIDE
// this function, AFTER the `isUserOnlyBuild` early return. Vite replaces
// `__AIKEY_AUTH_MODE__` with a string literal at build time, so in user-mode
// the compiled function body starts with `if ('local_bypass' === 'local_bypass') return [];`
// — the rest becomes statically unreachable. Rollup's DCE drops every
// subsequent line, including the `import('@/pages/master/...')` calls,
// so no master-chunk is emitted, parsed, or shipped in user-only builds.
//
// Full builds pay the standard code-split cost: each master page becomes
// its own `master-*.js` chunk, loaded on demand when the route is visited.
// Single `<Suspense>` per parent element is enough — the outlet-rendered
// child routes resolve their lazy chunks inside the parent boundary.
function buildMasterRoutes(): RouteObject[] {
  if (isUserOnlyBuild) return [];

  const AppShell             = React.lazy(() =>
    import('@/layouts/AppShell').then((m) => ({ default: m.AppShell })));
  const MasterLoginPage      = React.lazy(() => import('@/pages/master/login'));
  const DashboardPage        = React.lazy(() => import('@/pages/master/dashboard'));
  const SeatsPage            = React.lazy(() => import('@/pages/master/orgs/seats'));
  const VirtualKeysPage      = React.lazy(() => import('@/pages/master/orgs/virtual-keys'));
  const BindingsPage         = React.lazy(() => import('@/pages/master/orgs/bindings'));
  const ProviderAccountsPage = React.lazy(() => import('@/pages/master/orgs/provider-accounts'));
  const ControlEventsPage    = React.lazy(() => import('@/pages/master/orgs/control-events'));
  const UsageLedgerPage      = React.lazy(() => import('@/pages/master/orgs/usage-ledger'));

  return [
    // Master auth routes — Suspense at this parent catches MasterLoginPage.
    {
      path: '/master',
      element: (
        <React.Suspense fallback={null}>
          <AuthLayout />
        </React.Suspense>
      ),
      children: [
        { path: 'login', element: <MasterLoginPage /> },
      ],
    },
    // Master app routes (protected) — Suspense inside AuthGuard wraps
    // lazy AppShell + all lazy child pages rendered via <Outlet />.
    {
      path: '/master',
      element: (
        <AuthGuard loginPath="/master/login">
          <React.Suspense fallback={null}>
            <AppShell />
          </React.Suspense>
        </AuthGuard>
      ),
      children: [
        { path: 'dashboard', element: <DashboardPage /> },
        {
          path: 'orgs/:orgId',
          children: [
            { path: 'seats', element: <SeatsPage /> },
            { path: 'virtual-keys', element: <VirtualKeysPage /> },
            { path: 'bindings', element: <BindingsPage /> },
            { path: 'provider-accounts', element: <ProviderAccountsPage /> },
            { path: 'control-events', element: <ControlEventsPage /> },
            { path: 'usage-ledger', element: <UsageLedgerPage /> },
          ],
        },
      ],
    },
  ];
}

// Legacy pages still exist but are no longer routed directly — redirects below.

export const router = createBrowserRouter([
  // Default redirect — user-only build goes to /user/overview.
  {
    path: '/',
    element: <Navigate to={isUserOnlyBuild ? '/user/overview' : '/master/dashboard'} replace />,
  },

  // Master routes (empty array in user-only build).
  ...buildMasterRoutes(),

  // User-only build: catch-all /master/* → edition upgrade prompt.
  //
  // Why: `aikey master` still opens the browser at /master/dashboard in every
  // edition. Without this route, react-router raises "Unexpected Application
  // Error! 404" because no route in the bundle matches. This catch-all turns
  // that into a friendly guidance page without changing CLI behaviour.
  ...(isUserOnlyBuild ? [{ path: '/master/*', element: <MasterNotAvailablePage /> }] : []),

  // User auth routes (no auth required) — skipped in user-only build (no login page).
  ...(isUserOnlyBuild ? [] : [
    {
      path: '/user',
      element: <AuthLayout />,
      children: [
        { path: 'login', element: <UserLoginPage /> },
        { path: 'session-expired', element: <SessionExpiredPage /> },
      ],
    },
  ]),

  // Standalone pages (no shell, no auth, opens in new tab)
  { path: '/user/cli-guide', element: <CLIGuidePage /> },

  // `/go/:target` — stable alias used by `aikey web --<page>`.
  // Target map lives in ./go-alias.tsx so the CLI doesn't need to know
  // the real paths; we can reorganise routes without a CLI release.
  { path: '/go/:target', element: <GoAliasRedirect /> },

  // User app routes (protected in JWT mode, open in local_bypass mode) — uses dedicated UserShell
  {
    path: '/user',
    element: (
      <AuthGuard loginPath="/user/session-expired">
        <UserShell />
      </AuthGuard>
    ),
    children: [
      { path: 'overview', element: <UserOverviewPage /> },
      { path: 'account', element: <MyAccountPage /> },
      { path: 'virtual-keys', element: <UserVirtualKeysPage /> },
      { path: 'vault', element: <UserVaultPage /> },
      { path: 'import', element: <UserBulkImportPage /> },
      { path: 'usage-ledger', element: <UserUsageLedgerPage /> },
      { path: 'referrals', element: <UserReferralsPage /> },
      // Legacy routes — redirect to new paths
      { path: 'my-keys', element: <Navigate to="/user/virtual-keys" replace /> },
      { path: 'pending-keys', element: <Navigate to="/user/virtual-keys" replace /> },
      { path: 'my-seats', element: <Navigate to="/user/account" replace /> },
    ],
  },
]);
