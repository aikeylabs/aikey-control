/**
 * SeatPendingBanner — "your account is ready, a seat is not".
 *
 * A member who signs in through Feishu always gets an account. Whether they get
 * a SEAT depends on the administrator: auto-provisioning is off by default, and
 * it stops at the seat cap. Without a seat there is no quota and no key, so the
 * console works but does nothing useful.
 *
 * 🚫 The one thing this must not do is look like a failed login. Silence would
 * leave the member concluding "it didn't work" and retrying; folding it into the
 * session-expired path would be worse — they ARE signed in.
 *
 * Dismissible, per the visibility rules in
 * CI/requirements/2026-07-10-hook-wiring-visibility.md: a stubborn banner is
 * justified when one click fixes it, and this one cannot be fixed from the
 * browser at all — only an administrator can assign a seat. A notice the member
 * can never act on and can never close is how people learn to ignore notices.
 * Dismissal lives in sessionStorage, so it comes back next session if the seat
 * still has not arrived.
 *
 * Mirrored in master/web (dual-edit; see workflow/CI Makefile DRIFT_CHECK_PATHS).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { userAccountsApi } from '@/shared/api/user/accounts';
import { runtimeConfig } from '@/app/config/runtime';
import { isLocalUsageScope } from '@/shared/usage/local-identity';
import { seatBannerDecision } from '@/shared/utils/seat-banner-decision';

const SESSION_DISMISS_KEY = 'aikey:seatPendingBannerDismissed';

export function SeatPendingBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
  });

  // 🔴 A seat is a TEAM concept. On a box with no team behind it — Personal, and
  // a standalone Trial — `/accounts/me/seats` is a compatibility stub that
  // answers `200 null`. That is indistinguishable from "the team server says you
  // have no seat", so without this gate the banner tells a Personal user to go
  // ask an administrator for a seat, in an edition that has no administrators,
  // no organizations and no seats at all.
  //
  // 🚫 Do not key this off authMode alone: the composing gateway serves the TEAM
  // page as local_bypass, and a raw authMode check would hide the banner from
  // exactly the members who need it. isLocalUsageScope is the single predicate
  // that already distinguishes the four deployment quadrants.
  const teamContext = !isLocalUsageScope(runtimeConfig);

  const seatsQuery = useQuery({
    queryKey: ['my-seats'],
    queryFn: userAccountsApi.mySeats,
    enabled: teamContext,
    // A read-only observability probe — never a retry storm.
    retry: 1,
  });

  // 🔴 Only an ANSWERED query saying "zero usable seats" may raise the banner —
  // see seatBannerDecision, which owns that rule and is fenced by
  // SeatPendingBanner.test.ts.
  const decision = seatBannerDecision({
    teamContext,
    dismissed,
    pending: seatsQuery.isPending,
    errored: seatsQuery.isError,
    seats: seatsQuery.data,
  });
  if (!decision.show) return null;

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    }
    setDismissed(true);
  };

  return (
    <div className="seat-pending-banner" role="status">
      <div className="seat-pending-content">
        <div className="seat-pending-text">
          <strong>{t('seatPendingBanner.title')}</strong>
          <p>{t('seatPendingBanner.body')}</p>
        </div>
        <button
          type="button"
          className="seat-pending-dismiss"
          onClick={handleDismiss}
          aria-label={t('seatPendingBanner.dismissAria')}
        >
          {t('seatPendingBanner.dismiss')}
        </button>
      </div>
      <style>{SEAT_PENDING_CSS}</style>
    </div>
  );
}

// Reuses the dismissible half of the hook-readiness banner's visual language
// (same surface token, same border radius, same dismiss affordance) rather than
// inventing a second notice style. 🚫 Not the gold "needs action" treatment:
// that one means "one click fixes this", and nothing here is the member's to fix.
const SEAT_PENDING_CSS = `
.seat-pending-banner {
  margin: 12px 16px 0 16px;
  padding: 10px 14px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--surface-warn, rgba(var(--btn-primary-border-rgb), 0.08));
  color: var(--text);
}
.seat-pending-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.seat-pending-text strong {
  font-size: 13px;
  display: block;
  margin-bottom: 4px;
}
.seat-pending-text p {
  font-size: 12px;
  margin: 0;
  color: var(--text-dim, #888);
}
.seat-pending-dismiss {
  padding: 6px 10px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-dim);
  cursor: pointer;
  flex-shrink: 0;
}
.seat-pending-dismiss:hover {
  color: var(--text);
}
`;
