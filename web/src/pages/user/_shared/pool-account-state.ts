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
