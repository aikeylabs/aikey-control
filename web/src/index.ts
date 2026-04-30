// Public package entry — re-exports user pages and shared subset for consumption
// by sibling repos (aikey-control-master/web, aikey-trial-server/web).
//
// Why this file exists: aikey-control/web is published as the npm package
// `aikey-control-web` so that master/web and trial/web can compose user-side
// SPA fragments without duplicating source. See
// roadmap20260320/技术实现/update/20260430-边界纯化-web+go-extraction.md.
//
// Pages are also reachable via subpath imports, e.g.
//   import LoginPage from 'aikey-control-web/pages/login';
// (mapped via package.json `exports` field). The barrel below is for callers
// that want to consume multiple pages in one import.

export { default as UserLoginPage } from './pages/user/login';
export { default as SessionExpiredPage } from './pages/user/session-expired';
export { default as UserOverviewPage } from './pages/user/overview';
export { default as MyAccountPage } from './pages/user/account';
export { default as UserVirtualKeysPage } from './pages/user/virtual-keys';
export { default as UserUsageLedgerPage } from './pages/user/usage-ledger';
export { default as UserBulkImportPage } from './pages/user/import';
export { default as UserVaultPage } from './pages/user/vault';
export { default as UserReferralsPage } from './pages/user/referrals';
export { default as CLIGuidePage } from './pages/user/cli-guide';
export { default as MyKeysPage } from './pages/user/my-keys';
export { default as MySeatsPage } from './pages/user/my-seats';
export { default as PendingKeysPage } from './pages/user/pending-keys';
