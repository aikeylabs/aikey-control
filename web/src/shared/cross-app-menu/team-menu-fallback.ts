/**
 * Snapshot of B's (Team) menu for use ONLY when runtime fetch fails.
 *
 * Refresh policy: manually updated when B's team adds new cross-app
 * entries — they should ping the A team to update this file. If this
 * snapshot lags behind B's actual menu, no harm in normal operation
 * (runtime fetch covers the common case); it only kicks in when A is
 * offline / B's server is unreachable / first launch before fetch
 * completes.
 *
 * Drift tolerance: missing entries here = entries don't show in
 * sidebar when offline; extra entries here that B no longer serves =
 * dead links pointing to 404 pages. Both are recoverable; not a
 * security issue (these are just navigation hints).
 */

import type { CrossAppMenuEntry } from './types';

export const TEAM_MENU_FALLBACK: CrossAppMenuEntry[] = [
  {
    id: 'team-keys',
    group: 'KEYS',
    label: 'Team Keys',
    path: '/user/virtual-keys',
    visibility: 'team-logged-in',
    icon: 'team',
  },
  // Phase 3B R17 (2026-05-11): icon='team-chart' to differentiate
  // Team Usage's glyph from local Usage on A side (renderer maps
  // 'team-chart' to a TeamUsageIcon — people + bars).
  {
    id: 'team-usage',
    group: 'INSIGHTS',
    label: 'Team Usage',
    path: '/user/usage-ledger',
    visibility: 'team-logged-in',
    icon: 'team-chart',
  },
  // Phase 3B R22 (2026-05-11, supersedes R16): Account is teamOnly —
  // A side renders this as cross-app slot pointing at the team server
  // since A's local /user/account stub returns local-owner synthetic
  // data that's not useful. See OWN_TEAM_MENU comment for full
  // rationale.
  {
    id: 'team-account',
    group: 'ACCOUNT',
    label: 'Account',
    path: '/user/account',
    visibility: 'team-logged-in',
    icon: 'team-account',
  },
];
