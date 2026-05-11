/**
 * Public surface of the cross-app-menu module on A (Personal) side.
 *
 * Exports both side-specific names AND a generic alias set so that
 * shared sidebar code (rendered in both UserShells) can import the
 * same names regardless of which side it's compiled into.
 */

export type {
  CrossAppMenuEntry,
  CrossAppMenuGroup,
  CrossAppMenuResponse,
  CrossAppMenuVisibility,
} from './types';
export { CROSS_APP_MENU_SCHEMA_VERSION } from './types';

// ── Side-specific names (for direct/explicit use) ────────────────────────
export { OWN_PERSONAL_MENU } from './own-menu';
export { TEAM_MENU_FALLBACK } from './team-menu-fallback';
export {
  readTeamMenu,
  refreshTeamMenu,
  isTeamMenuStale,
  clearTeamMenu,
} from './client';

// ── Generic alias set (for byte-identical sidebar code across both
//    UserShell.tsx files — see roadmap update 20260510-personal-team-数
//    据隔离与合并显示.md decision 4 / dual-edit invariant) ──────────────
import { OWN_PERSONAL_MENU as _own } from './own-menu';
import {
  readTeamMenu as _readOther,
  refreshTeamMenu as _refreshOther,
  isTeamMenuStale as _isOtherStale,
} from './client';
import { isVisible as _isVisible } from './visibility';
export { isVisible, type VisibilityState } from './visibility';
export {
  getOtherBaseUrl,
  setOtherBaseUrl,
  refreshOtherBaseUrl,
  OTHER_BASE_URL_STORAGE_KEY,
} from './other-base-url';

/** Generic: this side's own menu (Personal entries). */
export const OWN_MENU = _own;
/** Generic: synchronous read of opposite side's menu (cached or fallback). */
export const readOtherMenu = _readOther;
/** Generic: async fetch of opposite side's menu. */
export const refreshOtherMenu = _refreshOther;
/** Generic: cache freshness check. */
export const isOtherMenuStale = _isOtherStale;
/** Generic: visibility predicate (re-export under alias). */
export const isVisibleEntry = _isVisible;

import type { VisibilityState as _VS } from './visibility';
import { getOtherBaseUrl as _getOtherUrl } from './other-base-url';

/**
 * A-side visibility state: `team-logged-in` is satisfied when the user
 * has configured a team server URL (proxy for "logged into team", since
 * having the URL implies a successful `aikey login --control-url`).
 *
 * MVP simplification: derives the bool from getOtherBaseUrl() rather than
 * inspecting auth-store JWT presence, so the same predicate works during
 * boot before stores hydrate. When auto-discovery of team URL via Go
 * endpoint lands, this can switch to a richer signal.
 */
export function useVisibilityState(): _VS {
  // Synchronous read — we accept that DevTools-edits to localStorage
  // don't re-render until next route change. Avoids needing a store
  // subscription for an MVP-grade signal.
  const teamUrl = _getOtherUrl();
  return { teamLoggedIn: teamUrl !== null };
}
