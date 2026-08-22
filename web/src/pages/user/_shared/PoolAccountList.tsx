import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { routedGroupAccount, type GroupAccountRef } from '@/shared/api/user/delivery';
import { formatDateShort, formatDateTime, formatRelativeTime, formatTime } from '@/shared/utils/datetime-intl';
import { providerBrandColor } from './provider-brand';
import { knownEpoch, poolAccountTone, quotaPercent, retryTimeState, showRetryTime } from './pool-account-state';

interface PoolAccountListProps {
  accounts?: GroupAccountRef[] | null;
  loginHref?: (credentialId?: string) => string;
  loginTitle?: string;
  loginLabel?: string;
  /** Explicit selection semantics for non-Vault consumers. When absent, the
   * established local-proxy current_routed → assigned fallback is preserved. */
  selection?: {
    primaryAccountId?: string;
    primaryLabel: string;
    secondaryAccountId?: string;
    secondaryLabel?: string;
    showDefaultBadge?: boolean;
  };
  showRemaining?: boolean;
}

/** Feather `refresh-cw`, the glyph this console already uses for "refresh"
 *  (pages/user/import RefreshIcon). Reused rather than redrawn so the icon
 *  vocabulary stays one set. */
function WindowResetIcon() {
  return (
    <svg className="pool-account-usage-reset-icon" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

/** UsageRow carries its own window-reset time (2026-08-21 user request).
 *
 * Why here and not in the observation block below: the reset is a fact ABOUT
 * this window, so it belongs on this window's row, and the sentence form
 * ("5h 窗口重置 2026年8月11日 14:40") was the single longest string in
 * the card. In the Access Token drawer the whole subtree renders `font-mono`
 * (access-tokens/index.tsx), which widened that sentence enough to wrap the
 * observation block over several lines and visually crush the 4px track
 * between them. Icon + month/day/time says the same thing in ~1/3 the width;
 * the full localized sentence survives as the hover/accessible name so no
 * information is lost.
 */
/** 🔴 Two numbers live on this row and only ONE of them is the usage.
 *
 * Until 2026-08-22 the protection cap was concatenated straight onto the label
 * — `5h 已用 · 93%` — with nothing but a hover title to say the 93 was a cap.
 * An account whose usage had NEVER been observed therefore rendered as
 *
 *     5h 已用 · 93%     —     8/11 14:40
 *
 * which every reader parses as "5h window is 93% used". It is not: 93% is the
 * anti-ban ceiling master rolled for this window (5h ∈ [93,97], 7d ∈ [87,89] —
 * see oauthgroup/window.go), and the real usage is the em dash, i.e. UNKNOWN.
 * The user reported it exactly that way: "看起来像是用了 93%".
 *
 * That misreads in both directions and both are operationally expensive:
 * an idle account looks nearly spent (swap it out for nothing), and an account
 * genuinely at 90% ALSO shows a dash (no warning when there should be one).
 *
 * So: the label carries no number, the cap carries its own noun
 * (`poolAccount.protectionLine` → "保护线 93%"), and "never observed" says so
 * in words instead of hiding behind punctuation. Fenced by
 * `PoolAccountList.test.ts` › "never renders a bare cap number".
 */
function UsageRow(props: {
  label: string;
  /** Absent = this window was never observed. Renders an empty track and the
   *  word "not observed" rather than suppressing the row: the window's cap and
   *  reset are still facts worth showing, and they have nowhere else to live. */
  percent?: number;
  unobservedLabel: string;
  /** Already-worded cap, e.g. "保护线 93%" — never a bare number. */
  capText?: string;
  danger: boolean;
  valueText?: string;
  valueTitle?: string;
  resetAt?: number;
  resetTitle?: string;
}) {
  const observed = props.percent != null;
  return (
    <div className="pool-account-usage-row">
      <div className="pool-account-usage-label">
        {/* The usage sits with its own subject on the LEFT — "5h 已用 未观测"
            is one sentence and has to read as one (2026-08-22 user). The right
            side carries the things this window is measured AGAINST: the
            protection cap and the reset. */}
        <span className="pool-account-usage-lead">
          {props.label}
          <span title={props.valueTitle} aria-label={props.valueTitle}>
            {observed ? props.valueText ?? `${props.percent}%` : props.unobservedLabel}
          </span>
        </span>
        <span className="pool-account-usage-value">
          {props.capText && <span className="pool-account-usage-cap">{props.capText}</span>}
          {props.resetAt != null && (
            <span className="pool-account-usage-reset" title={props.resetTitle} aria-label={props.resetTitle}>
              <WindowResetIcon />
              {`${formatDateShort(props.resetAt * 1000)} ${formatTime(props.resetAt * 1000)}`}
            </span>
          )}
        </span>
      </div>
      <div
        className="pool-account-usage-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.percent}
        aria-valuetext={observed ? undefined : props.unobservedLabel}
        aria-label={`${props.label} ${observed ? `${props.percent}%` : props.unobservedLabel}`}
      >
        {/* No fill at all when nothing was observed — an empty track is the
            honest picture. A 0%-wide fill would be indistinguishable from a
            measured zero. */}
        {observed && (
          <span
            className={`pool-account-usage-fill${props.danger ? ' danger' : ''}`}
            style={{ width: `${props.percent}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Shared pool-account cards for the Vault and Team Keys drawers. The component
 * renders only the existing group-runtime read model; it never derives routing
 * or quota state in the browser.
 */
export function PoolAccountList({ accounts, loginHref, loginTitle, loginLabel, selection, showRemaining = false }: PoolAccountListProps) {
  const { t } = useTranslation();
  const routed = selection
    ? (accounts ?? []).find((account) => account.account_id === selection.primaryAccountId)
    : routedGroupAccount(accounts);
  const sorted = (accounts ?? []).slice().sort((a, b) => a.priority - b.priority || a.account_id.localeCompare(b.account_id));
  const routeStatusLabel = (status: string): string => {
    switch (status) {
      case 'window_exhausted': return t('poolAccount.routeStatus.window_exhausted');
      case 'window_protected': return t('poolAccount.routeStatus.window_protected');
      case 'rate_limited': return t('poolAccount.routeStatus.rate_limited');
      case 'auth_failed': return t('poolAccount.routeStatus.auth_failed');
      case 'upstream_unavailable': return t('poolAccount.routeStatus.upstream_unavailable');
      default: return status;
    }
  };
  const loginStatusLabel = (status: string): string => {
    switch (status) {
      case 'logged_in': return t('poolAccount.loginStatus.logged_in');
      case 'needs_login': return t('poolAccount.loginStatus.needs_login');
      case 'auth_failed': return t('poolAccount.loginStatus.auth_failed');
      case 'revoked': return t('poolAccount.loginStatus.revoked');
      default: return status;
    }
  };
  const routeStatusHelp = (status?: string): string | undefined => {
    switch (status) {
      case 'rate_limited': return t('poolAccount.routeHelp.rate_limited');
      case 'window_exhausted': return t('poolAccount.routeHelp.window_exhausted');
      case 'auth_failed': return t('poolAccount.routeHelp.auth_failed');
      case 'upstream_unavailable': return t('poolAccount.routeHelp.upstream_unavailable');
      default: return undefined;
    }
  };

  return (
    <>
      {sorted.map((account) => {
        const isRouted = account.account_id === routed?.account_id;
        const isSecondary = Boolean(selection?.secondaryAccountId) && account.account_id === selection?.secondaryAccountId;
        const tone = poolAccountTone(account.route_status);
        const exhausted = account.route_status === 'window_exhausted';
        const util5h = quotaPercent(account.util_5h);
        const util7d = quotaPercent(account.util_7d);
        const retryAt = account.route_retry_at ?? account.window_reset_at;
        const retryState = retryTimeState(retryAt);
        const retryVisible = showRetryTime(account.route_status, retryState);
        // Window resets are FACTS about the quota window, shown whenever known —
        // unlike the recovery line above, which is about this route's state and
        // is therefore gated on route_status. A healthy `active` account has no
        // route_status, so before 2026-08-20 its reset time was never displayed
        // even when master had one. The 7d reset was never displayed at all: the
        // field reached this component but nothing read it.
        //
        // The one case the two would say the same thing is an exhausted 5h
        // window, where the recovery line already renders window_reset_at — so
        // the 5h fact is suppressed exactly then, rather than printed twice.
        const reset5h = knownEpoch(account.window_reset_at);
        const reset7d = knownEpoch(account.window_7d_reset_at);
        const resetShownAbove = retryVisible && retryState === 'future' && retryAt === account.window_reset_at;
        // The reset moved onto its own UsageRow (2026-08-21). It can only ride
        // there when that row exists — a window with a known reset but NO
        // utilization observation renders no row, so the observation block below
        // stays its fallback home. Losing that would hide a fact that used to be
        // visible on freshly-attached accounts.
        // One descriptor per quota window (2026-08-22). Before this, a window
        // was rendered ONLY when its utilization had been observed, and its cap
        // and reset fell back to a separate text block — so the same two facts
        // had two completely different layouts depending on whether a request
        // had ever been routed to the account. Rendering the row whenever the
        // window is KNOWN AT ALL collapses that to one layout and makes the
        // "a fact must never be silently dropped" rule structural instead of
        // conditional: there is no longer a branch that can omit it.
        const resetTitle = (window: string, epoch: number) =>
          t('poolAccount.windowResetAt', { window, time: formatDateTime(epoch * 1000) });
        const windows = ([
          { key: '5h', label: t('poolAccount.util5h'), percent: util5h, cap: account.window_max_util_pct,
            reset: resetShownAbove ? undefined : reset5h },
          { key: '7d', label: t('poolAccount.util7d'), percent: util7d, cap: account.window_7d_max_util_pct,
            reset: reset7d },
        ] as const).filter((w) => w.percent != null || w.cap != null || w.reset != null);
        const helpText = routeStatusHelp(account.route_status);

        return (
          <div
            key={account.account_id}
            className={`pool-account-card${isRouted ? ' current' : ''}${exhausted ? ' exhausted' : ''}`}
          >
            <div className="pool-account-heading">
              <span className="pool-account-identity">{account.identity || account.account_id}</span>
              {account.assigned && (selection?.showDefaultBadge ?? true) && <span className="chip">{t('poolAccount.default')}</span>}
              {isRouted && <span className="chip info">{selection?.primaryLabel ?? t('poolAccount.currentRouted')}</span>}
              {isSecondary && !isRouted && <span className="chip">{selection?.secondaryLabel}</span>}
              {account.node_id ? (
                <span
                  className={`chip ${account.runtime_state === 'unavailable' ? 'danger' : account.runtime_state === 'not_reported' ? 'warning' : ''}`}
                  title={t('poolAccount.workerNodeTitle', { node: account.node_id })}
                >
                  {account.runtime_state === 'unavailable'
                    ? t('poolAccount.workerNodeUnavailable', { node: account.node_id })
                    : account.runtime_state === 'not_reported'
                      ? t('poolAccount.workerNodeNotReported', { node: account.node_id })
                      : t('poolAccount.workerNode', { node: account.node_id })}
                </span>
              ) : account.runtime_state === 'unavailable' ? (
                <span className="chip danger">{t('poolAccount.workerUnavailable')}</span>
              ) : account.runtime_state === 'not_reported' ? (
                <span className="chip warning">{t('poolAccount.workerNotReported')}</span>
              ) : null}
              {account.route_status && (
                <span className={`chip ${tone === 'muted' ? '' : tone}`}>
                  {routeStatusLabel(account.route_status)}
                </span>
              )}
              {account.credential_type === 'oauth_account' && account.login_status && (
                <span
                  className={`chip ${account.login_status === 'logged_in' ? 'success' : account.login_status === 'needs_login' ? 'warning' : 'danger'}`}
                >
                  {loginStatusLabel(account.login_status)}
                </span>
              )}
              {loginHref && account.credential_type === 'oauth_account' && account.login_status === 'needs_login' && (
                <Link
                  to={loginHref(account.credential_id)}
                  className="chip warning"
                  style={{ textDecoration: 'none', cursor: 'pointer' }}
                  title={loginTitle}
                  onClick={(event) => event.stopPropagation()}
                >
                  {loginLabel ?? t('poolAccount.login')} →
                </Link>
              )}
            </div>

            <div className="pool-account-meta">
              <span className="pool-account-provider">
                <span
                  className="prov-dot"
                  style={{ background: providerBrandColor(account.provider_code), width: 6, height: 6 }}
                />
                {account.provider_code}
              </span>
              <span className="pool-account-separator">·</span>
              <span>{account.credential_type === 'oauth_account' ? t('poolAccount.oauth') : t('poolAccount.apiKey')}</span>
              <span className="pool-account-separator">·</span>
              <span>{t('poolAccount.priority', { priority: account.priority })}</span>
            </div>

            <div className="pool-account-usage">
              {windows.length > 0 ? (
                windows.map((w) => (
                  <UsageRow
                    key={w.key}
                    label={w.label}
                    percent={w.percent}
                    unobservedLabel={t('poolAccount.noObservationShort')}
                    capText={w.cap != null ? t('poolAccount.protectionLine', { percent: w.cap }) : undefined}
                    danger={exhausted || (w.percent != null && w.percent >= (w.cap ?? 100))}
                    valueText={showRemaining && w.percent != null
                      ? t('poolAccount.usedAndRemainingShort', { used: w.percent, remaining: Math.max(0, 100 - w.percent) })
                      : undefined}
                    valueTitle={showRemaining && w.percent != null
                      ? t('poolAccount.usedAndRemaining', { used: w.percent, remaining: Math.max(0, 100 - w.percent) })
                      : undefined}
                    resetAt={w.reset}
                    resetTitle={w.reset != null ? resetTitle(w.key, w.reset) : undefined}
                  />
                ))
              ) : (
                <div className="pool-account-usage-empty">{t('poolAccount.noObservation')}</div>
              )}

              <div className="pool-account-observation">
                {helpText && <span>{helpText}</span>}
                {account.util_observed_at != null && (
                  <span>{t('poolAccount.observed', { time: formatRelativeTime(account.util_observed_at * 1000) || formatDateTime(account.util_observed_at * 1000) })}</span>
                )}
                {retryVisible && retryState === 'future' && retryAt != null && (
                  <span>
                    {exhausted
                      ? t('poolAccount.windowRefresh', { time: formatDateTime(retryAt * 1000) })
                      : t('poolAccount.expectedRecovery', { time: formatDateTime(retryAt * 1000) })}
                  </span>
                )}
                {retryVisible && retryState === 'elapsed' && (
                  <span>{t('poolAccount.windowElapsed')}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
