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

const STORAGE_KEY = 'aikey-cross-app:team-base-url';
const ENDPOINT = '/system/team-url';
const REFRESH_TIMEOUT_MS = 3000;

interface TeamUrlResponse {
  team_url: string;
}

/** Synchronous read: localStorage cache or null. Used for the initial
 * render path so the sidebar can show team entries immediately if the
 * endpoint has been resolved on a prior visit. */
export function getOtherBaseUrl(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !raw.trim()) return null;
    const trimmed = raw.trim().replace(/\/$/, '');
    try {
      // eslint-disable-next-line no-new
      new URL(trimmed);
    } catch {
      console.warn(`[cross-app-menu] team-base-url is not a valid URL: ${raw}`);
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
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
      // sidebar renders the logged-out state on next read.
      const previous = getOtherBaseUrl();
      if (previous !== null) {
        setOtherBaseUrl(null);
        clearTeamMenu();
      }
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
