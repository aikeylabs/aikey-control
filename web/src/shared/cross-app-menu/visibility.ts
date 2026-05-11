/**
 * A-side mapping of CrossAppMenuVisibility sentinels to runtime predicates.
 *
 * The sentinels are interpreted differently on each side (see
 * CrossAppMenuVisibility doc in types.ts) — here is A's interpretation:
 *
 *   `always`              → always render
 *   `team-logged-in`      → only when local vault has a team JWT
 *   `local-server-online` → always render (A IS the local server)
 *
 * This file is the single place A decides "is the user logged into a
 * team" and similar predicates. If you need to add a new sentinel,
 * extend types.ts CrossAppMenuVisibility AND add a case here AND add
 * a case on B's side (visibility mapping in master/web).
 */

import type { CrossAppMenuVisibility } from './types';

export interface VisibilityState {
  /** True if the user has logged into a team via `aikey login --control-url`
   * — derived from vault state (team JWT presence). The sidebar polls /
   * subscribes to this through the auth store. */
  teamLoggedIn: boolean;
}

export function isVisible(
  visibility: CrossAppMenuVisibility,
  state: VisibilityState
): boolean {
  switch (visibility) {
    case 'always':
      return true;
    case 'team-logged-in':
      return state.teamLoggedIn;
    case 'local-server-online':
      // A IS the local server — if A's web is rendering, local-server is up.
      return true;
    default: {
      // Unknown sentinel from a newer wire schema: hide for safety.
      // Logged via console so we surface schema drift in dev tools.
      console.warn(`[cross-app-menu] unknown visibility sentinel: ${visibility}`);
      return false;
    }
  }
}
