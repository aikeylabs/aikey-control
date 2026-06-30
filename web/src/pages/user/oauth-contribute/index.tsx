/**
 * Team OAuth / pool sign-in — /user/team-oauth (C11 / RW9, per-member
 * pool-login model). Shows the member's logged-into-account HISTORY (kept over
 * time) with the account the allocation engine currently routes them to HIGHLIGHTED
 * — only that current-route account can reveal its admin-stored password and run a
 * pool sign-in. Past accounts are read-only history.
 *
 * Visual language follows the local web's canonical table page (virtual-keys):
 * `vault-page` wrapper → header strip → search → a single `card` wrapping a
 * `table.vault`, with `chip` status pills and inline SVG icons. NOT the
 * two-column / shared-PageHeader layout (which read as off-theme + cluttered).
 *
 * Data (all no-secret except the explicit reveal):
 *   - GET /accounts/me/oauth-member-tokens  → fetchMyPoolAccounts()  (history list)
 *   - GET /accounts/me/group-routed-credential (no id) → reveal password (routed only)
 *   - POST /api/user/oauth/pool/*           → pool sign-in (relay → proxy broker)
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyPoolAccounts,
  fetchRoutedCredential,
  type MyPoolAccount,
  type RoutedCredential,
} from '@/shared/api/team/oauth-contribute';
import { isTeamFetchError, type TeamFetchError } from '@/shared/api/team/team-fetch';
import { poolAuthorizeURL, poolSubmitCode, isPoolLoginError } from '@/shared/api/user/pool-login';
// Shared page CSS (card / chip / vault table / status-dot / row-use-btn / icon-btn
// / alias-main …), all scoped under `.vault-page`. WITHOUT injecting this the
// classes below render unstyled (the page looked "messy"). Same opt-in as the
// virtual-keys / vault pages.
import { KEYS_PAGE_CSS } from '../_shared/keys-page-css';

// MVP is Claude-only (技术方案 N3). When the pool spans providers, MyPoolAccount
// gains a `provider` field and this default is replaced by row.provider.
const MVP_PROVIDER = 'claude';

/** status → chip class + status-dot modifier, matching the local web's chip CSS
 * (success / warning / danger). Mirrors virtual-keys' statusMeta. */
function statusChip(s: string): { cls: string; dot: string } {
  switch (s) {
    case 'logged_in':
      return { cls: 'success', dot: '' };
    case 'needs_login':
      return { cls: 'warning', dot: 'stale' };
    case 'auth_failed':
      return { cls: 'danger', dot: 'error' };
    case 'revoked':
      return { cls: 'danger', dot: 'error' };
    default:
      return { cls: '', dot: 'idle' };
  }
}

function fmtDate(unix: number): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleDateString('en-US');
}

function fetchErrKey(err: TeamFetchError): string {
  return err.kind === 'not-logged-in'
    ? 'oauthContribute.errNotLoggedIn'
    : err.kind === 'unauth'
      ? 'oauthContribute.errUnauth'
      : 'oauthContribute.errUnreachable';
}

export default function OAuthContributePage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [expandedRouted, setExpandedRouted] = useState(false);

  const listQ = useQuery({
    queryKey: ['my-pool-accounts'],
    queryFn: fetchMyPoolAccounts,
  });

  const result = listQ.data;
  const accounts: MyPoolAccount[] = Array.isArray(result) ? result : [];
  const fetchErr: TeamFetchError | undefined =
    result && isTeamFetchError(result) ? result : undefined;

  const filtered = useMemo(
    () =>
      accounts.filter((a) =>
        a.identity.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [accounts, search],
  );
  const routed = accounts.find((a) => a.is_routed);

  const ready = !listQ.isLoading && !fetchErr;

  return (
    <div className="vault-page h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      <style>{KEYS_PAGE_CSS}</style>
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 space-y-5">
          {/* Header strip — icon + title + one-line description. */}
          <section className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <ShareIcon className="w-4 h-4" style={{ color: 'var(--primary)' }} />
            </div>
            <div className="min-w-0">
              <div
                className="text-lg font-bold font-mono tracking-wide"
                style={{ color: 'var(--display-foreground)' }}
              >
                {t('oauthContribute.pageTitle')}
              </div>
              <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {t('oauthContribute.pageDescription')}
              </div>
            </div>
          </section>

          {/* Search — only meaningful once there's history to filter. */}
          {ready && accounts.length > 0 && (
            <div className="relative">
              <SearchIcon
                className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--muted-foreground)' }}
              />
              <input
                type="text"
                className="pl-10 pr-3 py-2 text-sm w-96"
                placeholder={t('oauthContribute.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}

          <section className="card overflow-hidden">
            <div className="card-header flex items-center gap-2 px-4 py-3">
              <span
                className="text-[10px] font-mono uppercase tracking-wider"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {routed ? t('oauthContribute.historyNote') : t('oauthContribute.noRoutedAccount')}
              </span>
            </div>

            <div className="overflow-x-auto">
              {listQ.isLoading && <EmptyState message={t('oauthContribute.loading')} />}
              {fetchErr && <EmptyState message={t(fetchErrKey(fetchErr))} tone="error" />}
              {ready && accounts.length === 0 && <EmptyState message={t('oauthContribute.empty')} />}
              {ready && accounts.length > 0 && filtered.length === 0 && (
                <EmptyState message={t('oauthContribute.empty')} />
              )}
              {ready && filtered.length > 0 && (
                <table className="vault">
                  <thead>
                    <tr>
                      <th style={{ width: '46%' }}>{t('oauthContribute.colEmail')}</th>
                      <th style={{ width: '18%' }}>{t('oauthContribute.colLastLogin')}</th>
                      <th style={{ width: '14%' }}>{t('oauthContribute.colStatus')}</th>
                      <th style={{ width: '22%', textAlign: 'right' }} aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a) => (
                      <AccountRow
                        key={a.credential_id}
                        account={a}
                        expanded={!!a.is_routed && expandedRouted}
                        onToggle={() => setExpandedRouted((v) => !v)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** AccountRow: one history row. The current-route row is highlighted and is the
 * ONLY one with sign-in / reveal-password controls; others are read-only. When the
 * routed row is expanded, an inline sub-row hosts the reveal + pool sign-in flow. */
function AccountRow({
  account,
  expanded,
  onToggle,
}: {
  account: MyPoolAccount;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const sc = statusChip(account.status);
  const isRouted = !!account.is_routed;

  return (
    <>
      <tr
        className={isRouted ? 'row-clickable' : undefined}
        style={
          isRouted
            ? {
                background: 'rgba(74,222,128,0.06)',
                boxShadow: 'inset 3px 0 0 0 var(--primary)',
              }
            : undefined
        }
        onClick={isRouted ? onToggle : undefined}
      >
        <td>
          <div className="alias-main" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ wordBreak: 'break-all' }}>{account.identity || account.credential_id}</span>
            {isRouted && <span className="chip success">{t('oauthContribute.currentBadge')}</span>}
          </div>
        </td>
        <td className="font-mono text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
          {fmtDate(account.last_login_at)}
        </td>
        <td>
          <span className={`chip ${sc.cls}`}>
            {sc.dot !== 'idle' && (
              <span className={`status-dot ${sc.dot}`} style={{ width: 5, height: 5 }} />
            )}
            {t(`oauthContribute.status.${account.status}`, account.status)}
          </span>
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {isRouted ? (
            <button
              type="button"
              className="row-use-btn"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <ZapIcon className="w-3 h-3" />
              {account.status === 'logged_in'
                ? t('oauthContribute.reLogin')
                : t('oauthContribute.logIn')}
            </button>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
              —
            </span>
          )}
        </td>
      </tr>

      {isRouted && expanded && (
        <tr>
          <td colSpan={4} style={{ padding: 0 }}>
            <RoutedActionPanel account={account} />
          </td>
        </tr>
      )}
    </>
  );
}

/** RoutedActionPanel: inline panel for the current-route account — reveal the
 * admin-stored password (lazily fetched; server resolves the routed account, D7
 * minimal exposure) and run the pool sign-in (start → paste code → finish; the
 * proxy exchanges + writes the token back to master). */
function RoutedActionPanel({ account }: { account: MyPoolAccount }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // password reveal (lazy)
  const [revealed, setRevealed] = useState(false);
  const credQ = useQuery({
    queryKey: ['routed-credential'],
    queryFn: () => fetchRoutedCredential(), // no id → server resolves the routed account
    enabled: revealed,
  });
  const cred = credQ.data;
  const credVal: RoutedCredential | undefined =
    cred && !isTeamFetchError(cred) ? (cred as RoutedCredential) : undefined;

  // pool sign-in flow
  const [sessionId, setSessionId] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const startMut = useMutation({
    mutationFn: () => poolAuthorizeURL(MVP_PROVIDER, account.credential_id),
    onSuccess: (res) => {
      if (isPoolLoginError(res)) {
        setErr(res.message);
        return;
      }
      setErr('');
      setSessionId(res.session_id);
      window.open(res.authorize_url, '_blank', 'noopener');
    },
  });

  const finishMut = useMutation({
    mutationFn: () => poolSubmitCode(sessionId, code.trim()),
    onSuccess: (res) => {
      if (isPoolLoginError(res)) {
        setErr(res.message);
        return;
      }
      setErr('');
      setSessionId('');
      setCode('');
      qc.invalidateQueries({ queryKey: ['my-pool-accounts'] });
    },
  });

  return (
    <div
      className="px-4 py-4 space-y-4"
      style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid var(--border)' }}
    >
      {/* Password row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="text-[10px] font-mono uppercase tracking-wider"
          style={{ color: 'var(--muted-foreground)', minWidth: 64 }}
        >
          {t('oauthContribute.colEmail')}
        </span>
        <span className="font-mono text-[12px]" style={{ color: 'var(--foreground)' }}>
          {revealed && credVal ? credVal.login_email : account.identity}
        </span>
        <span className="font-mono text-[12px]" style={{ color: 'var(--foreground)' }}>
          {revealed ? (credVal ? credVal.password : '••••••') : '••••••••'}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setRevealed((v) => !v)}
          title={revealed ? t('oauthContribute.hide') : t('oauthContribute.reveal')}
        >
          {revealed ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Sign-in flow */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          className="row-use-btn"
          onClick={() => startMut.mutate()}
          disabled={startMut.isPending}
        >
          <ZapIcon className="w-3 h-3" />
          {t('oauthContribute.startSignIn')}
        </button>

        {sessionId && (
          <>
            <input
              type="text"
              className="px-3 py-2 text-sm"
              style={{ width: 280 }}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('oauthContribute.codePlaceholder')}
            />
            <button
              type="button"
              className="row-use-btn"
              onClick={() => finishMut.mutate()}
              disabled={finishMut.isPending || !code.trim()}
            >
              {t('oauthContribute.finishSignIn')}
            </button>
          </>
        )}
      </div>

      <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
        {t('oauthContribute.securityNote')}
      </p>
      {err && <p className="text-[11px]" style={{ color: '#fca5a5' }}>{err}</p>}
    </div>
  );
}

function EmptyState({ message, tone }: { message: string; tone?: 'error' }) {
  return (
    <div
      className="text-center py-16"
      style={{ color: tone === 'error' ? '#fca5a5' : 'var(--muted-foreground)' }}
    >
      <div className="text-[12px] font-mono">{message}</div>
    </div>
  );
}

// ── Icons (subset mirrored from virtual-keys' inline icon library) ───────────
function SvgIcon({ d, className = 'w-4 h-4', style }: { d: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
const ICON_SHARE = 'M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z';
const ICON_SEARCH = 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z';
const ICON_EYE = 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z';
const ICON_EYE_OFF = 'M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88';
const ICON_ZAP = 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z';

function ShareIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SHARE} {...p} />; }
function SearchIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SEARCH} {...p} />; }
function EyeIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EYE} {...p} />; }
function EyeOffIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EYE_OFF} {...p} />; }
function ZapIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_ZAP} {...p} />; }
