/**
 * Resolves the OTHER side's base URL — for A (Personal) that's the
 * team server URL the user is logged into.
 *
 * Resolution order:
 *   1. localStorage cache (synchronous, available on first render)
 *   2. localStorage manual override (DevTools / future Settings page)
 *   3. Async refresh via local-server's /system/team-url endpoint —
 *      reads CLI vault's `platform_account.control_url`, populates
 *      cache for next render
 *
 * Returns null when team URL is unknown — callers MUST handle null by
 * hiding cross-app team entries (no half-broken state).
 *
 * Manual override (when the endpoint can't reach vault, e.g. CLI
 * never logged in successfully):
 *
 *   localStorage.setItem('aikey-cross-app:team-base-url', 'http://192.168.3.62:3000')
 */

import { resolveCrossAppPeer } from '@/shared/utils/cross-app-peer';

const STORAGE_KEY = 'aikey-cross-app:team-base-url';
/** THIS side's own base URL, as cached by the B-side bundle when the composing
 *  gateway makes both sides share one localStorage. Read ONLY to detect poison:
 *  a peer value equal to it is definitionally wrong (see resolveCrossAppPeer). */
const OWN_SIDE_KEY = 'aikey-cross-app:personal-base-url';
const ENDPOINT = '/system/team-url';
const REFRESH_TIMEOUT_MS = 3000;

interface TeamUrlResponse {
  team_url: string;
  /** 2026-07-03 composing gateway: present+true when this local server
   * forwards team routes on the same origin. Optional — older servers
   * omit it and every consumer must treat absence as false. */
  gateway?: boolean;
}

/** Synchronous read: localStorage cache or null. Used for the initial
 * render path so the sidebar can show team entries immediately if the
 * endpoint has been resolved on a prior visit. */
export function getOtherBaseUrl(): string | null {
  let stored: string | null = null;
  let own: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
    own = localStorage.getItem(OWN_SIDE_KEY);
  } catch {
    return null; // localStorage disabled — treat as "no team configured".
  }

  // Shares the pure resolver with the B-side copy (shared/utils is dual-edit
  // enforced; THIS file is not, and the two sides drifting is how the
  // 2026-07-26 poison bug lived on one side only). A passes
  // peerServedByThisOrigin:false — its peer is the TEAM server, which stays
  // remote even when the gateway forwards team routes on this origin — and
  // fallback:null so "no team configured" keeps returning null, which callers
  // use as the cross-app menu VISIBILITY signal.
  const r = resolveCrossAppPeer({
    gatewayActive: isTeamGatewayActive(),
    peerServedByThisOrigin: false,
    currentOrigin: typeof window === 'undefined' ? '' : window.location.origin,
    storedPeer: stored,
    storedOwn: own,
    fallback: null,
  });

  if (r.rejected) {
    console.warn(`[cross-app-menu] rejected team-base-url: ${r.rejected}`);
  }
  try {
    if (r.heal) localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage disabled — resolution above is still correct for this render. */
  }
  return r.url;
}

/** Programmatic setter — used by future Settings UI / login post-flow
 * AND by refreshOtherBaseUrl(). Pass empty string or null to clear. */
export function setOtherBaseUrl(url: string | null): void {
  try {
    if (!url) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/$/, ''));
    }
  } catch {
    // localStorage disabled — nothing we can do.
  }
}

/**
 * Async fetch from local-server's /system/team-url. Same-origin call
 * (no CORS — A web is served by local-server itself). Updates
 * localStorage cache to follow the endpoint's authoritative answer.
 *
 * Returns the resolved URL on success, or null in three cases — each
 * with distinct cache-side-effect semantics (Phase 3B R6, 2026-05-11):
 *
 *   1. HTTP 200 + empty `team_url` (= user logged out / never logged in):
 *      EXPLICIT signal "no team" → CLEAR cache + clear team menu cache.
 *      Returning the cached value here would leave stale team entries in
 *      the sidebar after `aikey logout` until the menu TTL expires
 *      (1 hour) — the bug R6 was written to fix.
 *
 *   2. HTTP 200 + valid URL different from cached (= switched login):
 *      Update base URL + clear stale team menu cache so the next render
 *      fetches the new team's menu rather than serving the old team's.
 *
 *   3. Anything else (HTTP error / network failure / abort / parse error):
 *      KEEP existing cache. Transient failure shouldn't drop a valid
 *      previous answer; the next refresh will heal automatically.
 *
 * The caller decides UI behavior based on `getOtherBaseUrl()` reading
 * the cache after refresh — null/empty → hide team entries.
 */
export async function refreshOtherBaseUrl(): Promise<string | null> {
  // Dynamic import to avoid a static cycle with client.ts (which already
  // imports from team-menu-fallback + types; pulling client.ts back here
  // would create a tight ring). The function is only called on idle
  // refresh, never the sidebar critical path, so a one-time dynamic
  // resolution cost is invisible.
  const { clearTeamMenu } = await import('./client');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REFRESH_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (!res.ok) {
      // Case 3: transient HTTP failure. Keep cache.
      console.warn(`[cross-app-menu] /system/team-url returned HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as TeamUrlResponse;
    const url = (data.team_url || '').trim().replace(/\/$/, '');
    if (!url) {
      // Case 1: server explicitly says "no team URL". Clear both caches so
      // sidebar renders the logged-out state on next read. The gateway flag
      // follows the same lifecycle — logged out means nothing to compose.
      const previous = getOtherBaseUrl();
      if (previous !== null) {
        setOtherBaseUrl(null);
        clearTeamMenu();
      }
      setTeamGatewayActive(false);
      return null;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      // Case 3-ish: server returned a malformed URL. Keep cache (next
      // refresh may correct itself); don't accept the broken value.
      console.warn(`[cross-app-menu] /system/team-url returned invalid URL: ${data.team_url}`);
      return null;
    }
    // Case 2: valid URL. If it differs from cached, also clear the stale
    // team menu so the next render fetches the new team's entries.
    const previous = getOtherBaseUrl();
    if (previous !== url) {
      clearTeamMenu();
    }
    setOtherBaseUrl(url);
    // Gateway capability rides the same authoritative answer. Absent field
    // (older local-server) → false → links stay cross-origin (original
    // behavior preserved).
    setTeamGatewayActive(data.gateway === true);
    return url;
  } catch (err) {
    // Case 3: network error / timeout / abort. Keep cache.
    console.warn('[cross-app-menu] team-url refresh failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const OTHER_BASE_URL_STORAGE_KEY = STORAGE_KEY;

// ── Composing-gateway awareness (2026-07-03, 20260703-web统一origin design) ──
//
// User-mandated invariant (2026-07-03): the login/non-login MENU SCOPE must
// keep the ORIGINAL implementation — visibility, runtime menu sync, the
// single-binary-composed detection and the cross-origin data clients all
// keep reading the REAL team URL exactly as before. The gateway changes ONE
// thing only: where menu clicks NAVIGATE. So the gateway flag is stored
// alongside (not instead of) the team URL, and only the link-base helper
// below consumes it.

const GATEWAY_KEY = 'aikey-cross-app:team-gateway';

/** Persist the gateway capability learned from /system/team-url. */
export function setTeamGatewayActive(active: boolean): void {
  try {
    if (active) localStorage.setItem(GATEWAY_KEY, '1');
    else localStorage.removeItem(GATEWAY_KEY);
  } catch {
    // localStorage disabled — degrade to cross-origin links.
  }
}

/** True when the local server composes the team side on this origin. */
export function isTeamGatewayActive(): boolean {
  try {
    return localStorage.getItem(GATEWAY_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Base for cross-app NAVIGATION hrefs. Gateway active → '' (same-origin
 * relative: a full-document load that the local gateway forwards to the
 * team server); otherwise the real team URL (original cross-origin jump).
 * Returns null exactly when getOtherBaseUrl() does — callers keep gating
 * VISIBILITY on getOtherBaseUrl() so menu scope is byte-identical to the
 * pre-gateway implementation.
 */
export function getCrossAppLinkBase(): string | null {
  const real = getOtherBaseUrl();
  if (real === null) return null;
  return isTeamGatewayActive() ? '' : real;
}
