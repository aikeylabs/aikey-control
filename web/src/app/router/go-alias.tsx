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
  // Canonical aliases
  overview: '/user/overview',
  import: '/user/import',
  keys: '/user/virtual-keys',
  vault: '/user/vault',
  account: '/user/account',
  usage: '/user/usage-ledger',
  referrals: '/user/referrals',

  // Historical / alternate names the CLI may still send. Keep them
  // mapped so older binaries or muscle-memory commands don't break.
  'virtual-keys': '/user/virtual-keys',
  'team-keys': '/user/virtual-keys',
  profile: '/user/account',
  'usage-ledger': '/user/usage-ledger',
  'bulk-import': '/user/import',
  'quick-import': '/user/import',
  // Common spellings for the personal credential vault.
  secrets: '/user/vault',
  'my-vault': '/user/vault',
};

const FALLBACK = '/user/overview';

export function GoAliasRedirect() {
  const { target } = useParams<{ target: string }>();
  const key = (target ?? '').toLowerCase();
  const dest = GO_TARGETS[key] ?? FALLBACK;
  return <Navigate to={dest} replace />;
}
