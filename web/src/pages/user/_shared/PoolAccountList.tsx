import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { routedGroupAccount, type GroupAccountRef } from '@/shared/api/user/delivery';
import { formatDateTime, formatRelativeTime } from '@/shared/utils/datetime-intl';
import { providerBrandColor } from './provider-brand';
import { poolAccountTone, quotaPercent, retryTimeState } from './pool-account-state';

interface PoolAccountListProps {
  accounts?: GroupAccountRef[] | null;
  loginHref?: (credentialId?: string) => string;
  loginTitle?: string;
  loginLabel?: string;
}

function UsageRow(props: { label: string; percent: number; cap?: number; danger: boolean }) {
  return (
    <div className="pool-account-usage-row">
      <div className="pool-account-usage-label">
        <span>{props.label}{props.cap != null ? ` · ${props.cap}%` : ''}</span>
        <span>{props.percent}%</span>
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
export function PoolAccountList({ accounts, loginHref, loginTitle, loginLabel }: PoolAccountListProps) {
  const { t } = useTranslation();
  const routed = routedGroupAccount(accounts);
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

  return (
    <>
      {sorted.map((account) => {
        const isRouted = account.account_id === routed?.account_id;
        const tone = poolAccountTone(account.route_status);
        const exhausted = account.route_status === 'window_exhausted';
        const util5h = quotaPercent(account.util_5h);
        const util7d = quotaPercent(account.util_7d);
        const hasUsage = util5h != null || util7d != null;
        const retryAt = account.route_retry_at ?? account.window_reset_at;
        const retryState = retryTimeState(retryAt);

        return (
          <div
            key={account.account_id}
            className={`pool-account-card${isRouted ? ' current' : ''}${exhausted ? ' exhausted' : ''}`}
          >
            <div className="pool-account-heading">
              <span className="pool-account-identity">{account.identity || account.account_id}</span>
              {account.assigned && <span className="chip">{t('poolAccount.default')}</span>}
              {isRouted && <span className="chip info">{t('poolAccount.currentRouted')}</span>}
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
                  {util5h != null && <UsageRow label={t('poolAccount.util5h')} percent={util5h} cap={account.window_max_util_pct} danger={exhausted || (account.window_max_util_pct != null ? util5h >= account.window_max_util_pct : util5h >= 100)} />}
                  {util7d != null && <UsageRow label={t('poolAccount.util7d')} percent={util7d} cap={account.window_7d_max_util_pct} danger={exhausted || (account.window_7d_max_util_pct != null ? util7d >= account.window_7d_max_util_pct : util7d >= 100)} />}
                </>
              ) : (
                <div className="pool-account-usage-empty">{t('poolAccount.noObservation')}</div>
              )}

              <div className="pool-account-observation">
                {account.util_observed_at != null && (
                  <span>{t('poolAccount.observed', { time: formatRelativeTime(account.util_observed_at * 1000) || formatDateTime(account.util_observed_at * 1000) })}</span>
                )}
                {account.window_max_util_pct != null && (
                  <span>{t('poolAccount.util5h')} {t('poolAccount.protectionLine', { percent: account.window_max_util_pct })}</span>
                )}
                {account.window_7d_max_util_pct != null && (
                  <span>{t('poolAccount.util7d')} {t('poolAccount.protectionLine', { percent: account.window_7d_max_util_pct })}</span>
                )}
                {retryState === 'future' && retryAt != null && (
                  <span>
                    {exhausted
                      ? t('poolAccount.windowRefresh', { time: formatDateTime(retryAt * 1000) })
                      : t('poolAccount.expectedRecovery', { time: formatDateTime(retryAt * 1000) })}
                  </span>
                )}
                {retryState === 'elapsed' && account.route_status && (
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
