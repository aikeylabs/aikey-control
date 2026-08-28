export type PoolAccountTone = 'danger' | 'warning' | 'muted';

export function poolAccountTone(status?: string): PoolAccountTone {
  if (status === 'window_exhausted' || status === 'auth_failed') return 'danger';
  if (status === 'window_protected' || status === 'rate_limited' || status === 'upstream_unavailable') return 'warning';
  return 'muted';
}

export function quotaPercent(value?: number): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function retryTimeState(retryAt?: number, nowMs = Date.now()): 'none' | 'future' | 'elapsed' {
  if (!retryAt || !Number.isFinite(retryAt)) return 'none';
  return retryAt * 1000 > nowMs ? 'future' : 'elapsed';
}

export function showRetryTime(routeStatus: string | undefined, retryState: 'none' | 'future' | 'elapsed'): boolean {
  return Boolean(routeStatus) && retryState !== 'none';
}

/** knownEpoch returns a usable unix-seconds epoch, or undefined.
 *
 * Absent / zero / non-finite are all the SAME thing here — "not observed" —
 * and must stay undefined rather than becoming a timestamp: window resets are
 * only learned when a request to the account came back carrying the upstream
 * reset header, so a freshly attached, never-routed, or aggregate-header-only
 * account legitimately has none. Rendering 0 would print 1970 and read as a
 * window that already reset.
 */
export function knownEpoch(value?: number): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}
