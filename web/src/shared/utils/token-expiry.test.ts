import { describe, expect, it } from 'vitest';
import { describeTokenExpiry, TOKEN_RENEWAL_PREEMPT_WINDOW_SECONDS } from './token-expiry';

const NOW_MS = 1_800_000_000_000;
const nowSec = NOW_MS / 1000;

describe('provider token expiry classification', () => {
  it('reports absence as unknown — never as expired', () => {
    // The failure this guards: an older server omits the field, the UI paints
    // "expired", and an admin re-logins a perfectly healthy account. Absence of
    // evidence must render as absence, not as a verdict.
    for (const missing of [0, undefined, null, NaN, -1]) {
      expect(describeTokenExpiry(missing as number, NOW_MS).level).toBe('unknown');
    }
  });

  it('marks a token inside the pump preempt window as due, not ok', () => {
    // 24h is the renewal pump's own window (tokenrefresh.preemptWindow): a row
    // expiring inside it becomes a renewal candidate on the very next sweep.
    const justInside = describeTokenExpiry(nowSec + TOKEN_RENEWAL_PREEMPT_WINDOW_SECONDS - 60, NOW_MS);
    const justOutside = describeTokenExpiry(nowSec + TOKEN_RENEWAL_PREEMPT_WINDOW_SECONDS + 60, NOW_MS);
    expect(justInside.level).toBe('due');
    expect(justOutside.level).toBe('ok');
  });

  it('separates the incident shape from the assumed one', () => {
    // The whole reason this display exists (2026-08-31 customer report): a
    // freshly issued 1-hour token and a 7-day token must not look the same.
    const shortLived = describeTokenExpiry(nowSec + 3600, NOW_MS);
    const sevenDay = describeTokenExpiry(nowSec + 7 * 24 * 3600, NOW_MS);
    expect(shortLived.level).toBe('due');
    expect(sevenDay.level).toBe('ok');
    expect([shortLived.unit, shortLived.count]).toEqual(['hours', 1]);
    expect([sevenDay.unit, sevenDay.count]).toEqual(['days', 7]);
  });

  it('treats an already-past expiry as expired with nothing to count', () => {
    const past = describeTokenExpiry(nowSec - 1, NOW_MS);
    expect(past.level).toBe('expired');
    expect(past.unit).toBeNull();
    expect(past.remainingSeconds).toBe(0);
  });

  it('carries no i18n key — computed keys are invisible to the i18n fence', () => {
    // Keeping the key literals in the component (not here) is what lets the
    // cross-repository i18n fence prove the catalog still has a caller.
    // `as unknown as` rather than a direct cast: TokenExpiryView has no index
    // signature, so TS2352 rejects the one-step conversion. The erasure is
    // deliberate — this assertion is about the ABSENCE of a labelKey field.
    const view = describeTokenExpiry(nowSec + 3600, NOW_MS) as unknown as Record<string, unknown>;
    expect(view.labelKey).toBeUndefined();
  });
});
