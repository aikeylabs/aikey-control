import { useTranslation } from 'react-i18next';
import { Badge, type BadgeVariant } from './Badge';
import { describeTokenExpiry, type TokenExpiryLevel } from '@/shared/utils/token-expiry';
import { formatDateTime } from '@/shared/utils/datetime-intl';

/**
 * "How long is this provider token still good for" — the one number that was on
 * the wire all along and rendered nowhere (2026-09-02). See `token-expiry.ts`
 * for why it exists and why 24h is the warn threshold.
 *
 * Renders NOTHING when the wire carries no expiry: an account that never signed
 * in, or an older server that omits the field, must not be painted "expired" —
 * that would send an admin to re-login a healthy account. Absence of evidence is
 * shown as absence, not as a verdict.
 */
const LEVEL_VARIANT: Record<Exclude<TokenExpiryLevel, 'unknown'>, BadgeVariant> = {
  expired: 'red',
  // Same yellow the login-status badge uses for `expired`-adjacent states: this
  // token is inside the renewal pump's preempt window, i.e. about to be
  // re-exchanged upstream — worth a look, not yet a failure.
  due: 'yellow',
  ok: 'gray',
};

export function TokenExpiryBadge({ expiresAtUnixSeconds }: { expiresAtUnixSeconds?: number }) {
  const { t } = useTranslation();
  const view = describeTokenExpiry(expiresAtUnixSeconds);
  if (view.level === 'unknown') return null;

  // Literal t() keys only — a computed key is invisible to the i18n fence and
  // lets the catalog drift away from this component (same rule as STATUS_LABEL
  // in OAuthLoginStatusBadge).
  const label = (() => {
    if (view.level === 'expired') return t('tokenExpiry.expired');
    switch (view.unit) {
      case 'minutes': return t('tokenExpiry.inMinutes', { count: view.count });
      case 'hours': return t('tokenExpiry.inHours', { count: view.count });
      case 'days': return t('tokenExpiry.inDays', { count: view.count });
      default: return t('tokenExpiry.expired');
    }
  })();

  return (
    <span title={t('tokenExpiry.absoluteHint', { at: formatDateTime((expiresAtUnixSeconds ?? 0) * 1000) })}>
      <Badge variant={LEVEL_VARIANT[view.level]}>{label}</Badge>
    </span>
  );
}
