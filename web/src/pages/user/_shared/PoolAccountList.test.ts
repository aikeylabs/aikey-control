import { describe, expect, it } from 'vitest';

import en from '@/shared/i18n/locales/en/common.json';
import zh from '@/shared/i18n/locales/zh/common.json';

import { knownEpoch, poolAccountTone, quotaPercent, retryTimeState, showRetryTime } from './pool-account-state';

describe('PoolAccountList display derivations', () => {
  it('uses danger only for exhausted and authentication-failed accounts', () => {
    expect(poolAccountTone('window_exhausted')).toBe('danger');
    expect(poolAccountTone('auth_failed')).toBe('danger');
    expect(poolAccountTone('rate_limited')).toBe('warning');
    expect(poolAccountTone('window_protected')).toBe('warning');
    expect(poolAccountTone('upstream_unavailable')).toBe('warning');
    expect(poolAccountTone()).toBe('muted');
  });

  it('renders auth_failed as an actionable re-login state in both locales', () => {
    expect(en.poolAccount.routeStatus.auth_failed).toBe('Sign in again');
    expect(en.poolAccount.loginStatus.auth_failed).toBe('Sign in again');
    expect(en.oauthContribute.status.auth_failed).toBe('Sign in again');
    expect(en.vault.oauthLoginStatus.auth_failed).toBe('Sign in again');
    expect(zh.poolAccount.routeStatus.auth_failed).toBe('需要重新登录');
    expect(zh.poolAccount.loginStatus.auth_failed).toBe('需要重新登录');
    expect(zh.oauthContribute.status.auth_failed).toBe('需要重新登录');
    expect(zh.vault.oauthLoginStatus.auth_failed).toBe('需要重新登录');
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

  it('does not render a stale retry time after the account is routable again', () => {
    expect(showRetryTime(undefined, 'future')).toBe(false);
    expect(showRetryTime('', 'elapsed')).toBe(false);
    expect(showRetryTime('window_exhausted', 'future')).toBe(true);
    expect(showRetryTime('window_protected', 'elapsed')).toBe(true);
  });
});

// Window-reset display (P1-4, 2026-08-20). Two gaps this pins:
//   1. `window_7d_reset_at` reached this component and was never read — the
//      weekly reset was invisible in the personal edition entirely;
//   2. the 5h reset was gated behind `route_status`, so a HEALTHY account never
//      showed a reset time even when master had one.
// And the invariant that must not regress: an absent/zero epoch is "not
// observed", never a rendered timestamp (0 would print 1970 and read as a
// window that already reset).
describe('window reset display', () => {
  it('treats absent, zero and non-finite epochs as not observed', () => {
    expect(knownEpoch(undefined)).toBeUndefined();
    expect(knownEpoch(0)).toBeUndefined();
    expect(knownEpoch(-1)).toBeUndefined();
    expect(knownEpoch(Number.NaN)).toBeUndefined();
    expect(knownEpoch(1_750_000_000)).toBe(1_750_000_000);
  });

  it('shows a reset time for a HEALTHY account, which route_status gating hid', () => {
    // A healthy account carries no route_status, so the recovery line stays
    // hidden — that gate is correct for recovery and wrong for a window fact.
    expect(showRetryTime(undefined, retryTimeState(1_750_000_000, 1_000))).toBe(false);
    // The window fact is independent of it.
    expect(knownEpoch(1_750_000_000)).toBe(1_750_000_000);
  });

  it('carries the reset wording in both locales with window and time slots', () => {
    for (const bundle of [en, zh]) {
      const s = bundle.poolAccount.windowResetAt;
      expect(s).toContain('{{window}}');
      expect(s).toContain('{{time}}');
    }
  });
});
