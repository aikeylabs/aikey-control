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
import UserUsageDetailPage from '../../pages/user/usage-detail';
import UserPerformancePage from '../../pages/user/performance';
// M5 Day 1 (2026-05-21): degrade-detector trust-check page. Sits under
// /user/trust-check in the Insights group of the sidebar. Calls
// trust-local 8801 from Day 2 onwards; Day 1 ships with mock data only.
import UserTrustCheckPage from '../../pages/user/trust-check';
// Phase 3 (2026-06-02): local compliance self-view page. /user/compliance in
// the Quality group; reads the user's own events from local-server control.db.
import UserCompliancePage from '../../pages/user/compliance';
// Phase 4 阶段 3 (2026-05-21): third-party Agent management UI.
// Lives under /user/apps (list) + /user/apps/:slug (detail). Calls
// /api/user/apps/* (前置 2 — pkg/userapi/app), which subprocess-bridges
// to `aikey _internal app.<action>`. Pages stay relative-imported
// (same convention as the rest of this file) so the trial composer
// resolves them from user/web, not master/web.
import UserAppsListPage from '../../pages/user/apps';
import UserAppDetailPage from '../../pages/user/apps/detail';
import UserBulkImportPage from '../../pages/user/import';
import UserVaultPage from '../../pages/user/vault';
import UserReferralsPage from '../../pages/user/referrals';
import UserInvitesPage from '../../pages/user/invites';
// Phase 4G (2026-06-01): Web Console Settings page. Consolidates
// Control URL edit + Master Password CLI guidance + Sign out into a
// single page reachable from the top-bar gear icon and the sidebar
// user-chip. Replaces the prior sidebar-bottom logout button which was
// a front-end-only `clearAuth()` that left vault state intact.
import UserSettingsPage from '../../pages/user/settings';
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
        // 2026-06-05: per-request Usage Detail (last 7d). NO sidebar entry —
        // reached only via drill-down links (cost card 未计价 / by-key/model/
        // session / day bar). Route exists for those links + bookmarks.
        { path: 'usage-detail', element: <UserUsageDetailPage /> },
        // 2026-05-21: full rename `/user/cost` → `/user/performance`
        // (URL + sidebar label + page H1 + directory + function + CSS
        // class). Trailer ID `personal-cost` and icon `cost` kept on
        // purpose for cross-version A↔B menu compat. The old `/user/cost`
        // URL is kept as a Navigate-replace redirect below for bookmark
        // compatibility.
        { path: 'performance', element: <UserPerformancePage /> },
        { path: 'cost', element: <Navigate to="/user/performance" replace /> },
        { path: 'trust-check', element: <UserTrustCheckPage /> },
        { path: 'compliance', element: <UserCompliancePage /> },
        // Phase 4 阶段 3 — third-party Agent management.
        // List shows all registered apps; Detail shows binding + usage + audit.
        // Registration itself happens via CLI (`aikey app register`) — no
        // Web-side "Add new app" CTA per the Day 9.5 UX redesign.
        { path: 'apps', element: <UserAppsListPage /> },
        { path: 'apps/:slug', element: <UserAppDetailPage /> },
        { path: 'referrals', element: <UserReferralsPage /> },
        { path: 'invites', element: <UserInvitesPage /> },
        { path: 'settings', element: <UserSettingsPage /> },
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
