/**
 * Fences for the "your account is ready, a seat is not" banner
 * (CI/requirements/2026-07-10-member-sso-login.md R7).
 *
 * The banner tells a member something about their own account, so every way it
 * can be wrong is a way of lying to them:
 *
 *  - shown on Personal → an edition with no organizations, no administrators
 *    and no seats at all, telling the user to go and ask one for a seat;
 *  - shown while the answer is in flight → a member with a perfectly good seat
 *    reads "you have none" for as long as the request takes;
 *  - shown because the request FAILED → the same lie, permanently;
 *  - NOT shown when the member really has no usable seat → they conclude the
 *    login failed and retry it, forever.
 *
 * None of those are visible to `tsc` or to `vite build`, and each is one
 * boolean away from the correct behaviour.
 *
 * Mirrored in master/web (dual-edit; see workflow/CI Makefile DRIFT_CHECK_PATHS).
 */
import { describe, it, expect } from 'vitest';

import { seatBannerDecision } from './seat-banner-decision';

const base = {
  teamContext: true,
  dismissed: false,
  pending: false,
  errored: false,
  seats: [] as { seat_status: string }[] | null | undefined,
};

describe('seatBannerDecision — when the member really has no seat', () => {
  it('shows the banner for an answered empty seat list', () => {
    expect(seatBannerDecision(base)).toEqual({ show: true });
  });

  it('shows it when every seat the member has is unusable', () => {
    expect(seatBannerDecision({ ...base, seats: [{ seat_status: 'suspended' }] })).toEqual({ show: true });
    expect(seatBannerDecision({ ...base, seats: [{ seat_status: 'revoked' }] })).toEqual({ show: true });
  });

  it('treats a null body the same as an empty list (the stub answers 200 null)', () => {
    expect(seatBannerDecision({ ...base, seats: null })).toEqual({ show: true });
  });
});

describe('seatBannerDecision — when it must stay quiet', () => {
  it('🔴 stays out of Personal / standalone Trial entirely', () => {
    // 能红: drop the teamContext gate and a Personal user is told to go and ask
    // an administrator for a seat, in an edition that has neither.
    expect(seatBannerDecision({ ...base, teamContext: false })).toEqual({ show: false, reason: 'no-team' });
  });

  it('🔴 does not speak before the query has answered', () => {
    // 能红: drop `pending` and every team member sees "no seat assigned" on
    // first paint, including the ones who have one.
    expect(seatBannerDecision({ ...base, pending: true, seats: undefined })).toEqual({
      show: false,
      reason: 'unknown',
    });
  });

  it('🔴 degrades a FAILED read to silence, never to the warning', () => {
    // 能红: fold `errored` into the empty-list branch and a transport failure
    // becomes a statement about the member's account — the exact
    // transport-misclassified-as-business-state failure the rules forbid.
    expect(seatBannerDecision({ ...base, errored: true, seats: undefined })).toEqual({
      show: false,
      reason: 'unknown',
    });
  });

  it('distinguishes "we do not know" from "we know they have one"', () => {
    // The reason matters: both hide the banner, but only one of them means the
    // member is fine. Asserting only `show` would let a bug swap them silently.
    const unknown = seatBannerDecision({ ...base, errored: true });
    const hasSeat = seatBannerDecision({ ...base, seats: [{ seat_status: 'active' }] });
    expect(unknown).not.toEqual(hasSeat);
    expect(hasSeat).toEqual({ show: false, reason: 'has-seat' });
  });

  it('stays dismissed for the rest of the session', () => {
    expect(seatBannerDecision({ ...base, dismissed: true })).toEqual({ show: false, reason: 'dismissed' });
  });

  it('says nothing to a member who has a usable seat', () => {
    expect(seatBannerDecision({ ...base, seats: [{ seat_status: 'active' }] })).toEqual({
      show: false,
      reason: 'has-seat',
    });
    // Mixed: one usable seat is enough.
    expect(
      seatBannerDecision({ ...base, seats: [{ seat_status: 'revoked' }, { seat_status: 'active' }] }),
    ).toEqual({ show: false, reason: 'has-seat' });
  });
});

describe('seatBannerDecision — gate precedence', () => {
  it('🔴 the Personal gate wins over an answered empty list', () => {
    // Personal's /accounts/me/seats stub answers an empty list, which is
    // indistinguishable from "the team server says you have no seat". If the
    // order ever inverts, Personal gets the banner.
    expect(seatBannerDecision({ ...base, teamContext: false, seats: [] })).toEqual({
      show: false,
      reason: 'no-team',
    });
  });
});
