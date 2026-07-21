/**
 * seat-banner-decision — whether to tell a member they have no seat.
 *
 * 🔴 Deliberately a separate, DOM-free module rather than a helper inside
 * SeatPendingBanner.tsx: the component imports the runtime config, which reads
 * `window`, so anything living beside it can only be exercised in a browser.
 * The rule below is the part that can be wrong in ways a build never catches,
 * so it has to be the part a unit fence can reach.
 *
 * Mirrored in master/web (dual-edit; see workflow/CI Makefile DRIFT_CHECK_PATHS).
 */

/** Seat states that give the member nothing to work with. */
const UNUSABLE_SEAT_STATUSES = new Set(['suspended', 'revoked']);

/**
 * Why the banner is or is not on screen.
 *
 * 🔴 Split out of the component as a pure function so the decision can be
 * FENCED. The three ways this goes wrong are all invisible to a build: showing
 * "ask an administrator for a seat" on Personal (an edition with no
 * administrators and no seats), showing it while the answer is still in flight,
 * and showing it because the request FAILED. Each of those tells a member
 * something false about their own account, and each is one boolean away.
 *
 * The reason is carried, not just a boolean, so a test can assert WHY it is
 * hidden — "hidden" alone would pass for the right reason and the wrong one
 * equally.
 */
export type SeatBannerDecision =
  | { show: false; reason: 'no-team' | 'dismissed' | 'unknown' | 'has-seat' }
  | { show: true };

export function seatBannerDecision(input: {
  teamContext: boolean;
  dismissed: boolean;
  /** The query has not answered yet. */
  pending: boolean;
  /** The query failed. 🚫 Not the same as "answered: no seats". */
  errored: boolean;
  seats: { seat_status: string }[] | null | undefined;
}): SeatBannerDecision {
  if (!input.teamContext) return { show: false, reason: 'no-team' };
  if (input.dismissed) return { show: false, reason: 'dismissed' };
  // 🔴 Loading and failure collapse to the SAME outcome — silence — but never to
  // the banner. Telling a member with a perfectly good seat that they have none
  // is worse than saying nothing, so absence of an answer is never evidence.
  if (input.pending || input.errored) return { show: false, reason: 'unknown' };
  const usable = (input.seats ?? []).filter((s) => !UNUSABLE_SEAT_STATUSES.has(s.seat_status));
  if (usable.length > 0) return { show: false, reason: 'has-seat' };
  return { show: true };
}
