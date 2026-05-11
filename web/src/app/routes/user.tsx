import { Navigate, type RouteObject } from 'react-router-dom';

import { UserShell } from '@/layouts/UserShell';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AuthGuard } from '@/app/guards/AuthGuard';

// Page imports use RELATIVE paths (not @/...) so that when this file is
// consumed cross-package by aikey-trial-server/web's composer, vite resolves
// the page modules from THIS package (user/web) rather than the composer's
// `@` alias target. Shared-layer imports above can stay on `@/` since the
// composer aliases that to the canonical shared layer.
import UserLoginPage from '../../pages/user/login';
import SessionExpiredPage from '../../pages/user/session-expired';
import UserOverviewPage from '../../pages/user/overview';
import MyAccountPage from '../../pages/user/account';
// NOTE: pages/user/virtual-keys/index.tsx is intentionally NOT routed here
// (Phase 3B R7, 2026-05-11). The Team Keys experience canonically lives on
// the team server (B side); A's stub showed an empty state because A's
// local-server has no team data source. The page file stays in this repo
// because B's master/web imports it via npm-link
// (`import UserVirtualKeysPage from 'aikey-control-web/pages/virtual-keys'`).
// Removing only A's route entry: same file, two consumers (A no, B yes).
// Spec: requirements/2026-05-11-aikey-web-local-first-team-merge.md R7.
import UserUsageLedgerPage from '../../pages/user/usage-ledger';
import UserCostPage from '../../pages/user/cost';
import UserBulkImportPage from '../../pages/user/import';
import UserVaultPage from '../../pages/user/vault';
import UserReferralsPage from '../../pages/user/referrals';
import CLIGuidePage from '../../pages/user/cli-guide';
import { GoAliasRedirect } from '../router/go-alias';

// User-edition route table — exported so Trial-edition composer at
// aikey-trial-server/web can mount these routes alongside master routes.
//
// Imports are static (not lazy) on the assumption that the user-side bundle
// is small enough that code-splitting brings minimal benefit and risks
// async-loading hiccups in the embedded local-server. If that changes,
// switch to React.lazy + Suspense like master/web's routes/master.tsx.
export function buildUserRoutes(): RouteObject[] {
  return [
    // Standalone pages (no shell, no auth — open in a new tab from the CLI).
    { path: '/user/cli-guide', element: <CLIGuidePage /> },

    // `/go/:target` — stable alias used by `aikey web --<page>`.
    { path: '/go/:target', element: <GoAliasRedirect /> },

    // User app routes (protected in JWT mode, open in local_bypass mode).
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
        // /user/virtual-keys removed from A's routes — see import-block
        // comment above. Users who type the URL get the AuthGuard's
        // 404-or-redirect behavior; sidebar Team Keys link points at the
        // team server's canonical page via cross-app menu.
        { path: 'vault', element: <UserVaultPage /> },
        { path: 'import', element: <UserBulkImportPage /> },
        { path: 'usage-ledger', element: <UserUsageLedgerPage /> },
        { path: 'cost', element: <UserCostPage /> },
        { path: 'referrals', element: <UserReferralsPage /> },
        // Legacy redirects → overview. Phase 3B R7 removed A's
        // /user/virtual-keys route; the canonical Team Keys page lives
        // on the team server (B). Users who follow my-keys / pending-keys
        // bookmarks land on overview, where the sidebar shows the
        // cross-app Team Keys link to the team server.
        { path: 'my-keys', element: <Navigate to="/user/overview" replace /> },
        { path: 'pending-keys', element: <Navigate to="/user/overview" replace /> },
        { path: 'my-seats', element: <Navigate to="/user/account" replace /> },
      ],
    },

    // Auth pages — separate layout so they show without the user shell.
    // Kept after the protected /user routes so route matching prefers protected pages.
    {
      path: '/user',
      element: <AuthLayout />,
      children: [
        { path: 'login', element: <UserLoginPage /> },
        { path: 'session-expired', element: <SessionExpiredPage /> },
      ],
    },
  ];
}
