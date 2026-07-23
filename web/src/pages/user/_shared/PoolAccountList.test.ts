import { describe, expect, it } from 'vitest';

import { poolAccountTone, quotaPercent, retryTimeState } from './pool-account-state';

describe('PoolAccountList display derivations', () => {
  it('uses danger only for exhausted and authentication-failed accounts', () => {
    expect(poolAccountTone('window_exhausted')).toBe('danger');
    expect(poolAccountTone('auth_failed')).toBe('danger');
    expect(poolAccountTone('rate_limited')).toBe('warning');
    expect(poolAccountTone('window_protected')).toBe('warning');
    expect(poolAccountTone('upstream_unavailable')).toBe('warning');
    expect(poolAccountTone()).toBe('muted');
  });

  it('preserves unknown utilization and renders an observed zero honestly', () => {
    expect(quotaPercent()).toBeUndefined();
    expect(quotaPercent(Number.NaN)).toBeUndefined();
    expect(quotaPercent(0)).toBe(0);
    expect(quotaPercent(0.424)).toBe(42);
    expect(quotaPercent(2)).toBe(100);
    expect(quotaPercent(-1)).toBe(0);
  });

  it('distinguishes a future recovery from an elapsed window', () => {
    const nowMs = 2_000_000;
    expect(retryTimeState(undefined, nowMs)).toBe('none');
    expect(retryTimeState(2_001, nowMs)).toBe('future');
    expect(retryTimeState(2_000, nowMs)).toBe('elapsed');
    expect(retryTimeState(1_999, nowMs)).toBe('elapsed');
  });
});
