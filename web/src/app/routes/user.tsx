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
import UserVirtualKeysPage from '../../pages/user/virtual-keys';
import UserUsageLedgerPage from '../../pages/user/usage-ledger';
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
        { path: 'virtual-keys', element: <UserVirtualKeysPage /> },
        { path: 'vault', element: <UserVaultPage /> },
        { path: 'import', element: <UserBulkImportPage /> },
        { path: 'usage-ledger', element: <UserUsageLedgerPage /> },
        { path: 'referrals', element: <UserReferralsPage /> },
        // Legacy routes → redirect to canonical names.
        { path: 'my-keys', element: <Navigate to="/user/virtual-keys" replace /> },
        { path: 'pending-keys', element: <Navigate to="/user/virtual-keys" replace /> },
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
