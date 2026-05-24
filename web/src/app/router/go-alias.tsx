/**
 * `/go/:target` — stable alias redirects for external launchers.
 *
 * The aikey CLI opens the web UI via `aikey web [--import|--keys|…]` and
 * builds URLs like `<base>/go/<alias>`. The alias → real-path mapping
 * lives HERE, not in the CLI, so future route reorganisations (e.g.
 * /user/virtual-keys → /user/keys or a reshuffle under /app/*) don't
 * require shipping a new CLI. The CLI only needs to know alias keys;
 * web is free to move destinations.
 *
 * Adding an alias: drop a new key into GO_TARGETS. Adding a CLI flag
 * that triggers it is a separate CLI change — the alias is valid the
 * moment it lands here even for older CLIs that go via `/go/<alias>`
 * from a query param or custom URL.
 *
 * Unknown alias: falls through to /user/overview so a user who typed a
 * stale or mistyped alias still lands somewhere useful instead of a
 * blank 404.
 *
 * The auth-token fragment ingestion in main.tsx runs before the router
 * mounts, so redirecting here is safe — the token is already in the
 * Zustand store by the time <Navigate /> fires.
 */
import { Navigate, useParams } from 'react-router-dom';

export const GO_TARGETS: Record<string, string> = {
  // Canonical aliases — local-server-served pages on A.
  overview: '/user/overview',
  import: '/user/import',
  vault: '/user/vault',
  account: '/user/account',
  usage: '/user/usage-ledger',
  referrals: '/user/referrals',
  // Degrade-detector M5 trust-check page (Personal-only at the sidebar
  // level; on Trial / Production the redirect lands on the page but it
  // may render empty / hidden state — same UX as accessing the URL
  // directly). Added 2026-05-24 after user surfaced `aikey web
  // trust-check` errored "Unknown page" despite the route existing.
  'trust-check': '/user/trust-check',

  // Historical / alternate names the CLI may still send. Keep them
  // mapped so older binaries or muscle-memory commands don't break.
  profile: '/user/account',
  'usage-ledger': '/user/usage-ledger',
  'bulk-import': '/user/import',
  'quick-import': '/user/import',
  // Common spellings for the personal credential vault.
  secrets: '/user/vault',
  'my-vault': '/user/vault',
  // Short alias for trust-check (`aikey web trust`).
  trust: '/user/trust-check',
  // Phase 3B R7 (2026-05-11): team-keys / virtual-keys / keys aliases
  // previously pointed at A's local /user/virtual-keys stub. The
  // canonical Team Keys page now lives on B (the team server) and the
  // sidebar reaches it via cross-app menu (a real cross-origin link).
  // From a `/go/<alias>` redirect we can't easily emit a cross-origin
  // <a>; map to overview where the sidebar's Team Keys link is visible.
  // CLI users wanting the team page directly: `aikey master keys` opens
  // the team server's URL straight in the browser.
  keys: '/user/overview',
  'virtual-keys': '/user/overview',
  'team-keys': '/user/overview',
};

const FALLBACK = '/user/overview';

export function GoAliasRedirect() {
  const { target } = useParams<{ target: string }>();
  const key = (target ?? '').toLowerCase();
  const dest = GO_TARGETS[key] ?? FALLBACK;
  return <Navigate to={dest} replace />;
}
