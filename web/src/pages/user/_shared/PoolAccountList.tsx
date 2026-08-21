import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { routedGroupAccount, type GroupAccountRef } from '@/shared/api/user/delivery';
import { formatDateTime, formatRelativeTime } from '@/shared/utils/datetime-intl';
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

function UsageRow(props: { label: string; percent: number; cap?: number; danger: boolean; valueText?: string }) {
  return (
    <div className="pool-account-usage-row">
      <div className="pool-account-usage-label">
        <span>{props.label}{props.cap != null ? ` · ${props.cap}%` : ''}</span>
        <span>{props.valueText ?? `${props.percent}%`}</span>
      </div>
      <div
        className="pool-account-usage-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.percent}
        aria-label={`${props.label} ${props.percent}%`}
      >
        <span
          className={`pool-account-usage-fill${props.danger ? ' danger' : ''}`}
          style={{ width: `${props.percent}%` }}
        />
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
        const hasUsage = util5h != null || util7d != null;
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
              {hasUsage ? (
                <>
                  {util5h != null && <UsageRow label={t('poolAccount.util5h')} percent={util5h} cap={account.window_max_util_pct} danger={exhausted || (account.window_max_util_pct != null ? util5h >= account.window_max_util_pct : util5h >= 100)} valueText={showRemaining ? t('poolAccount.usedAndRemaining', { used: util5h, remaining: Math.max(0, 100 - util5h) }) : undefined} />}
                  {util7d != null && <UsageRow label={t('poolAccount.util7d')} percent={util7d} cap={account.window_7d_max_util_pct} danger={exhausted || (account.window_7d_max_util_pct != null ? util7d >= account.window_7d_max_util_pct : util7d >= 100)} valueText={showRemaining ? t('poolAccount.usedAndRemaining', { used: util7d, remaining: Math.max(0, 100 - util7d) }) : undefined} />}
                </>
              ) : (
                <div className="pool-account-usage-empty">{t('poolAccount.noObservation')}</div>
              )}

              <div className="pool-account-observation">
                {helpText && <span>{helpText}</span>}
                {account.util_observed_at != null && (
                  <span>{t('poolAccount.observed', { time: formatRelativeTime(account.util_observed_at * 1000) || formatDateTime(account.util_observed_at * 1000) })}</span>
                )}
                {account.window_max_util_pct != null && (
                  <span>{t('poolAccount.util5h')} {t('poolAccount.protectionLine', { percent: account.window_max_util_pct })}</span>
                )}
                {account.window_7d_max_util_pct != null && (
                  <span>{t('poolAccount.util7d')} {t('poolAccount.protectionLine', { percent: account.window_7d_max_util_pct })}</span>
                )}
                {reset5h != null && !resetShownAbove && (
                  <span>{t('poolAccount.windowResetAt', { window: '5h', time: formatDateTime(reset5h * 1000) })}</span>
                )}
                {reset7d != null && (
                  <span>{t('poolAccount.windowResetAt', { window: '7d', time: formatDateTime(reset7d * 1000) })}</span>
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
