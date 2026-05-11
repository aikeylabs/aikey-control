/**
 * Runtime fetcher + cache for the OPPOSITE side's cross-app menu.
 *
 * On A (Personal) side: fetches Team menu from `${team_url}/system/cross-app-menu`.
 * Cache lives in localStorage with TTL; fetches asynchronously after
 * sidebar mount; falls back to TEAM_MENU_FALLBACK on any failure path.
 *
 * Stale-while-revalidate: cached value is served immediately even if
 * past TTL; a fresh fetch fires in the background to update for next
 * render. This keeps initial sidebar render synchronous and snappy.
 *
 * Why localStorage (not in-memory): user-perceived sidebar should be
 * stable across page reloads / navigations within A — refetching on
 * every reload would briefly show a stale snapshot during the network
 * window even when we have a recently-cached good copy.
 */

import { CROSS_APP_MENU_SCHEMA_VERSION } from './types';
import type { CrossAppMenuEntry, CrossAppMenuResponse } from './types';
import { TEAM_MENU_FALLBACK } from './team-menu-fallback';

const STORAGE_KEY = 'aikey-cross-app-menu:team';
const TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5000;

interface CachedMenu {
  /** Unix epoch ms when fetch landed. Used for TTL checks. */
  cached_at: number;
  /** The fetched response payload. */
  response: CrossAppMenuResponse;
}

function readCache(): CachedMenu | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMenu;
    if (typeof parsed.cached_at !== 'number') return null;
    if (parsed.response?.source !== 'team') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(response: CrossAppMenuResponse): void {
  try {
    const payload: CachedMenu = { cached_at: Date.now(), response };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage full / disabled — silently degrade. Next call falls
    // through to fallback.
  }
}

/**
 * Synchronous read of the best available Team menu:
 * cache (if present) → fallback (if not).
 *
 * Use this for the initial render. The async refresh happens via
 * refreshTeamMenu().
 */
export function readTeamMenu(): CrossAppMenuEntry[] {
  const cached = readCache();
  if (cached) return cached.response.entries;
  return TEAM_MENU_FALLBACK;
}

/**
 * Async refresh from the team server's /system/cross-app-menu.
 *
 * Returns the fresh entries on success; returns null on any failure
 * (network error, timeout, HTTP non-200, schema mismatch). Failure does
 * NOT clear the existing cache — the previous cached snapshot keeps
 * serving readTeamMenu() callers.
 *
 * `teamBaseUrl` should be the configured team server origin (e.g.,
 * "http://192.168.3.62:3000"). Pass empty string to skip the fetch
 * (e.g., user not logged into a team).
 */
export async function refreshTeamMenu(
  teamBaseUrl: string
): Promise<CrossAppMenuEntry[] | null> {
  if (!teamBaseUrl) return null;
  const url = `${teamBaseUrl.replace(/\/$/, '')}/system/cross-app-menu`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      // Same-origin credentials are useless across origin; explicit omit.
      credentials: 'omit',
    });
    if (!res.ok) {
      console.warn(
        `[cross-app-menu] team fetch returned HTTP ${res.status}; using cache/fallback`
      );
      return null;
    }
    const data = (await res.json()) as CrossAppMenuResponse;
    if (data.source !== 'team') {
      console.warn(
        `[cross-app-menu] team fetch source mismatch: expected "team", got "${data.source}"`
      );
      return null;
    }
    if (data.schema_version > CROSS_APP_MENU_SCHEMA_VERSION) {
      // Forward-compatible: keep going, log for awareness. We render
      // entries with the fields we understand; unknown fields are
      // ignored by the consumer.
      console.warn(
        `[cross-app-menu] team schema_version ${data.schema_version} newer than client ${CROSS_APP_MENU_SCHEMA_VERSION}; rendering best-effort`
      );
    }
    if (!Array.isArray(data.entries)) {
      console.warn('[cross-app-menu] team response missing entries[]');
      return null;
    }
    writeCache(data);
    return data.entries;
  } catch (err) {
    // Aborted, network error, JSON parse error — all collapse to "use
    // the cache/fallback". Logged for debug but not user-visible.
    console.warn('[cross-app-menu] team fetch failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when the cache is older than TTL_MS (or absent). Drives the
 * decision in the sidebar mount effect about whether to fire a refresh.
 * Returns true (= should refresh) when there's no cache at all.
 */
export function isTeamMenuStale(): boolean {
  const cached = readCache();
  if (!cached) return true;
  return Date.now() - cached.cached_at > TTL_MS;
}

/**
 * Phase 3B R6 (2026-05-11): explicitly drop the cached team menu.
 *
 * Called by `refreshOtherBaseUrl()` when the local-server's /system/team-url
 * endpoint returns an empty `team_url` (= user logged out / never logged in)
 * OR when the team URL has changed (= login switched to a different team).
 *
 * Without this, the sidebar would keep showing the previous team's menu
 * entries after `aikey logout` until the cache TTL expires (1 hour) or
 * the user manually clears localStorage. Spec: requirements/2026-05-11-
 * aikey-web-local-first-team-merge.md R6.
 */
export function clearTeamMenu(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage disabled — nothing to clear, nothing to log.
  }
}
