import { createBrowserRouter, Navigate } from 'react-router-dom';

import { UserShell } from '@/layouts/UserShell';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AuthGuard } from '@/app/guards/AuthGuard';

// User pages (always in bundle — this repo is user-edition only).
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
import { GoAliasRedirect } from './go-alias';

// User-edition router only. The previous combined master+user router lives
// in the private aikey-control-master repo, which composes this user-side
// route table with its own admin routes.

export const router = createBrowserRouter([
  // Default redirect: open the user overview.
  { path: '/', element: <Navigate to="/user/overview" replace /> },

  // Standalone pages (no shell, no auth — open in a new tab from the CLI).
  { path: '/user/cli-guide', element: <CLIGuidePage /> },

  // `/go/:target` — stable alias used by `aikey web --<page>`. The target
  // map is defined in ./go-alias.tsx so the CLI doesn't need to know the
  // real paths; routes can be reorganised without a CLI release.
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
  // Kept after the protected /user routes so route matching prefers
  // protected pages first.
  {
    path: '/user',
    element: <AuthLayout />,
    children: [
      { path: 'login', element: <UserLoginPage /> },
      { path: 'session-expired', element: <SessionExpiredPage /> },
    ],
  },
]);
