/**
 * Team OAuth / pool sign-in — /user/team-oauth (C11 / RW9, shared-account
 * pool-login model). Shows the member's authorized account HISTORY (kept over
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
import { PageTitleGlyph } from '@/shared/ui/PageHeader';
import { LIVE_PICKER_QUERY } from '@/shared/utils/query-options';
import React, { useMemo, useState, useRef, useCallback, useEffect, useId } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ModalPortal } from '@/shared/ui/ModalShell';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/shared/utils/datetime-intl';
import {
  fetchMyPoolAccounts,
  fetchRoutedCredential,
  fetchMyGroups,
  addOauthAccount,
  fetchAccountEgress,
  setAccountEgress,
  testAccountEgress,
  type MyPoolAccount,
  type RoutedCredential,
  type MyOauthGroup,
  type MemberEgressView,
  type MemberEgressTestResult,
} from '@/shared/api/team/oauth-contribute';
import { deriveEgressPresentation } from './egress-presentation';
import { showsSessionRenewalLabel } from '../_shared/pool-account-state';
import {
  accountScopeCounts,
  accountScopeSections,
  filterAgentPools,
  filterPersonalAccounts,
  initialAccountScope,
  type AccountScopeFilter,
} from './account-scope';
import { isTeamFetchError, isTeamWriteError, type TeamFetchError } from '@/shared/api/team/team-fetch';
import {
  poolAuthorizeURL,
  poolSessionKey,
  poolSessionKeyCapabilities,
  poolSubmitCode,
  poolStatus,
  isPoolLoginError,
  SESSION_KEY_IDENTITY_MISMATCH,
} from '@/shared/api/user/pool-login';
import { copyText } from '@/shared/utils/clipboard';
import { sessionKeyProviderKind } from '@/shared/session-key-capability';
// Relative import keeps this user-owned shared component anchored to the
// Personal package when the page is composed into Trial or Master builds,
// whose generic `@` alias points at the host application.
import { SessionKeyHelp } from '../../../shared/components/SessionKeyHelp';
// Shared page CSS (card / chip / vault table / status-dot / row-use-btn / icon-btn
// / alias-main …), all scoped under `.vault-page`. WITHOUT injecting this the
// classes below render unstyled (the page looked "messy"). Same opt-in as the
// virtual-keys / vault pages.
import { KEYS_PAGE_CSS } from '../_shared/keys-page-css';
import { ToolGlyph } from '../_shared/tool-glyph';
import { PageQueryErrors } from '@/shared/components/PageQueryErrors';
import { TokenExpiryBadge } from '@/shared/ui/TokenExpiryBadge';

// Provider display profile only. Login provider + flow are intentionally absent:
// master resolves and binds those at session initialization. Keeping display
// fallbacks incapable of selecting a broker prevents model/account drift.
interface ProviderDisplayProfile {
  code: string;
  brandSlug: string;
  labelKey: string;
}
const PROVIDER_DISPLAY: ProviderDisplayProfile[] = [
  {
    code: 'anthropic',
    brandSlug: 'claude',
    labelKey: 'oauthContribute.providerClaude',
  },
  {
    code: 'openai',
    brandSlug: 'codex',
    labelKey: 'oauthContribute.providerCodex',
  },
  // Future: { code: 'kimi_code', brandSlug: 'kimi', labelKey: 'oauthContribute.providerKimi' },
];
/** Providers a member can self-contribute accounts for — derived from the display
 * table (matches the server-side pool-supported gate). value = provider CODE. */
const ADDABLE_PROVIDERS = PROVIDER_DISPLAY.map((p) => ({
  code: p.code,
  labelKey: p.labelKey,
}));

/** Resolve the account's tool glyph (ToolGlyph itself lives in
 * ../_shared/tool-glyph — shared with the vault group headers, byte-identical
 * to master's oauth-groups marks). Known provider brands map directly
 * (anthropic→claude, openai→codex) with the full provider label as tooltip.
 * Otherwise (mock / unknown brands serve BOTH protocols) fall back to the
 * PROTOCOL axis (2026-08-01 user request — the pool's protocol still says which
 * tool the account drives): anthropic→claude, openai*→codex, tooltip = the bare
 * tool slug (NOT the provider label — calling a mock account "Claude
 * (Anthropic)" would be misinformation). No glyph when both axes are absent. */
function glyphFor(providerCode?: string, protocolType?: string): { slug: string; labelKey?: string } | null {
  const p = PROVIDER_DISPLAY.find((x) => x.code === providerCode);
  if (p) return { slug: p.brandSlug, labelKey: p.labelKey };
  if (protocolType === 'anthropic') return { slug: 'claude' };
  if (protocolType === 'openai' || protocolType === 'openai_compatible') return { slug: 'codex' };
  return null;
}

// exitIPEcho is the browser-side exit-IP echo (2026-07-19, P1=A). api.ipify.org is
// CORS-enabled and returns a bare/JSON IP, so a browser fetch can actually read it.
// Since 2026-08-14 the master baseline this value is compared against is captured
// server-side from the SAME host (egress.DefaultEchoURL), so the two sides no longer
// depend on two providers agreeing.
// Overridable for tests / air-gapped deployments.
const EXIT_IP_ECHO = 'https://api.ipify.org?format=json';

// fetchBrowserExitIP measures THIS BROWSER's current public exit IP — i.e. the IP
// the OAuth LOGIN (opened in this same browser) will come from. If the member has
// configured this Chrome profile to route through the account's egress (P2 guide),
// it equals the account egress exit IP; otherwise it's the member's raw IP — which
// is exactly the divergence the login-IP self-check is meant to catch.
async function fetchBrowserExitIP(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(EXIT_IP_ECHO, {
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { ip?: string };
    const ip = (data.ip ?? '').trim();
    if (!ip) throw new Error('no ip in echo response');
    return ip;
  } finally {
    clearTimeout(timer);
  }
}

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

/** Account-scope pill — the same `.filter-pill` capsule the vault FilterStrip
 *  uses. Kept inline (2nd consumer; extract to _shared on the 3rd, per the
 *  toast-stack note below). */
function AccountScopePill(props: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.active}
      className={`filter-pill${props.active ? ' active' : ''}`}
      onClick={props.onClick}
    >
      {props.label}
      <span className="count">{props.count}</span>
    </button>
  );
}

function fmtDate(unix: number): string {
  if (!unix) return '—';
  return formatDate(unix * 1000);
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
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialPoolFilter = searchParams.get('group');
  // Ownership, not login status, is the page's primary task boundary. Group
  // ownership arrives asynchronously from MyGroups, so a deep link starts
  // neutral and is resolved once from the authoritative `is_owner` flag below.
  const [scopeFilter, setScopeFilter] = useState<AccountScopeFilter>('all');
  // Which routed account's sign-in panel is open, by credential_id. A member in
  // MULTIPLE pools has one routed account PER pool (2026-07-01) — each must expand
  // independently, so this is a per-account id, not a single shared boolean.
  //
  // Deep-link auto-expand (2026-07-12): the vault page's 登录 CTA arrives with
  // ?expand=<credential_id> — seed it as the INITIAL expanded card so the user
  // lands directly on that account's sign-in panel instead of hunting for it.
  // Initial-state-only (lazy initializer): after that the user's own toggles own
  // the state; the param is not re-applied on re-render. The existing render gate
  // (`is_routed && expandedCred === credential_id`) still applies. The list query
  // sends the same target to Master, which authorizes it and marks it current for
  // this pool; an unauthorized/stale id therefore fails closed instead of opening
  // controls for an arbitrary account.
  const [expandedCred, setExpandedCred] = useState<string | null>(() => searchParams.get('expand'));
  // Owner agent pools (2026-07-18): the caller's own pools with their FULL account
  // composition — every account gets sign-in controls (an unattended agent may be
  // routed to any of them, so all must be pre-logged-in; the "routed-only" gate
  // below is a company-pool rule and does not apply to pools the caller owns).
  const ownerGroupsQ = useQuery({
    queryKey: ['my-oauth-groups'],
    queryFn: fetchMyGroups,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const ownerGroupsErr = ownerGroupsQ.data && isTeamFetchError(ownerGroupsQ.data) ? ownerGroupsQ.data : undefined;

  const myGroups: MyOauthGroup[] = useMemo(() => (Array.isArray(ownerGroupsQ.data) ? ownerGroupsQ.data : []), [ownerGroupsQ.data]);
  const ownerPools: MyOauthGroup[] = useMemo(() => {
    return myGroups.filter((g) => g.is_owner);
  }, [myGroups]);
  // Pool filter (2026-07-22): deep-linked from My Agents
  // (?group=<oauth_group_id>) so Team OAuth lands scoped to that source group.
  // State-only (the URL is just the initial value); the removable toolbar chip
  // clears it back to "all pools". The alias resolves across every visible
  // membership because advanced-path Agents can use a company pool.
  const [poolFilter, setPoolFilter] = useState<string | null>(() => initialPoolFilter);
  // Resolve a deep link once per group so 30-second query refreshes never
  // override a category the user selected manually. Unknown groups remain on
  // All; if eventual consistency makes the group appear later, it then resolves.
  const autoResolvedGroupRef = useRef<string | null>(null);
  useEffect(() => {
    if (!poolFilter || autoResolvedGroupRef.current === poolFilter) return;
    if (!myGroups.some((group) => group.oauth_group_id === poolFilter)) return;
    setScopeFilter(initialAccountScope(poolFilter, myGroups));
    autoResolvedGroupRef.current = poolFilter;
  }, [myGroups, poolFilter]);
  const visibleOwnerPools = useMemo(() => filterAgentPools(ownerPools, poolFilter, search), [ownerPools, poolFilter, search]);
  const poolFilterName = useMemo(
    () => (poolFilter ? (myGroups.find((g) => g.oauth_group_id === poolFilter)?.alias ?? poolFilter) : null),
    [poolFilter, myGroups],
  );
  // The deep-linked id, frozen at mount (a plain ref, NOT re-read from the URL):
  // used only for the one-time scroll-into-view of the auto-expanded row.
  const deepLinkCred = useRef(searchParams.get('expand')).current;
  const [showAdd, setShowAdd] = useState(false);

  // Toast stack — transient feedback for add (mirrors the team-keys page's
  // ToastStack: same shared `.toast*` CSS from KEYS_PAGE_CSS, 5s auto-dismiss).
  // Replicated inline rather than shared-extracted: this is the 2nd toast user
  // on the app, and extraction touches the shipped virtual-keys page — defer
  // until a 3rd consumer justifies a shared component.
  interface ToastEntry {
    id: number;
    kind: 'success' | 'error';
    title: string;
    sub?: string;
  }
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdRef = useRef(0);
  const pushToast = useCallback((entry: Omit<ToastEntry, 'id'>): void => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev, { ...entry, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const listQ = useQuery({
    queryKey: ['my-pool-accounts', deepLinkCred],
    queryFn: () => fetchMyPoolAccounts(deepLinkCred ?? undefined),
    // Routing is live control-plane state. Refresh while the page stays open so
    // a reassignment or recovered resolver does not leave stale login controls.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const result = listQ.data;
  const accounts: MyPoolAccount[] = Array.isArray(result) ? result : [];
  const fetchErr: TeamFetchError | undefined = result && isTeamFetchError(result) ? result : undefined;

  const visiblePersonalAccounts = useMemo(() => filterPersonalAccounts(accounts, poolFilter, search), [accounts, poolFilter, search]);
  // Category counts deliberately ignore search, matching the shared filter-pill
  // convention, but honor an explicit group deep link. Every number uses the
  // same unit: account rows rendered in that ownership scope.
  const scopeCounts = useMemo(() => accountScopeCounts(accounts, ownerPools, poolFilter), [accounts, ownerPools, poolFilter]);
  const visibleSections = accountScopeSections(scopeFilter);
  const showPersonalAccounts = visibleSections.includes('personal');
  const showAgentPools = visibleSections.includes('agent_pool');
  const routed = accounts.find((a) => a.is_routed);

  const listQueryError = listQ.isError ? (listQ.error instanceof Error ? listQ.error.message : String(listQ.error)) : '';
  const ready = !listQ.isLoading && !fetchErr && !listQueryError;

  return (
    <div className="vault-page page-under-header h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      <style>{KEYS_PAGE_CSS}</style>
      <div className="vault-page-scroll flex-1 overflow-y-auto">
        <div className="px-6 py-5 space-y-5">
          {/* Sub-component queries (RoutedActionPanel / AddAccountModal) are
              covered by the global DataFetchErrorBanner. */}
          <PageQueryErrors sources={[ownerGroupsQ.error, listQ.error]} />
          {/* Header strip — icon + title + one-line description. */}
          <section className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--primary-text)',
              }}
            >
              <PageTitleGlyph />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold font-mono tracking-wide" style={{ color: 'var(--display-foreground)' }}>
                {t('oauthContribute.pageTitle')}
              </div>
              <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {t('oauthContribute.pageDescription')}
              </div>
            </div>
            {/* Scheduling-log drill-down (third-level page, no menu item).
                2026-08-18: this replaces the pair of buttons that used to sit
                here — the switch log was a strict subset of this timeline (same
                decision rows, fewer sources), so two entries showed the member
                overlapping content and made them guess which to open. */}
            <button
              type="button"
              className="row-use-btn ml-auto flex-shrink-0"
              style={{ height: 34 }}
              onClick={() => navigate('/user/team-oauth/scheduling-log')}
            >
              {t('mySchedLog.entryButton')}
            </button>
            {/* R24: employee self-service add — opens the modal to store an
                account (email+password) into a pool group the member has joined. */}
            <button
              type="button"
              className="row-use-btn flex-shrink-0"
              /* Slightly taller than the base row-use-btn (28px) — this is a
                 header CTA, not a table-row action, so it can read a bit larger.
                 Inline height override (2026-07-07) beats the two-level
                 `.vault-page .row-use-btn` rule without touching the shared class. */
              style={{ height: 34 }}
              onClick={() => setShowAdd(true)}
            >
              <PlusIcon className="w-3 h-3" />
              {t('oauthContribute.addButton')}
            </button>
          </section>

          {showAdd && (
            <AddAccountModal
              onClose={() => setShowAdd(false)}
              onAdded={() => {
                setShowAdd(false);
                qc.invalidateQueries({ queryKey: ['my-pool-accounts'] });
                qc.invalidateQueries({ queryKey: ['my-oauth-groups'] });
                // Thank-you confirmation: the account is now in the pool and
                // will be assigned to pool-group members on demand.
                pushToast({
                  kind: 'success',
                  title: t('oauthContribute.addToastTitle'),
                  sub: t('oauthContribute.addToastSub'),
                });
              }}
            />
          )}

          {ownerGroupsErr && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded px-4 py-3 flex items-center justify-between gap-3"
              style={{
                color: 'var(--destructive-text-soft)',
                background: 'rgba(var(--destructive-rgb), 0.08)',
                border: '1px solid rgba(var(--destructive-rgb), 0.38)',
              }}
            >
              <span className="text-[12px] font-mono">{t(fetchErrKey(ownerGroupsErr))}</span>
              <button type="button" className="row-use-btn flex-shrink-0" onClick={() => void ownerGroupsQ.refetch()}>
                {t('oauthContribute.retryLoad')}
              </button>
            </div>
          )}

          {/* Search + ownership filter. Kept on the ERROR path (was gated behind
              `ready`, which is false on fetchErr) so a failed load degrades the
              way Team Keys does — page keeps its skeleton, only the table body
              swaps to the message — instead of collapsing to a bare card
              (2026-07-12 alignment). The strip remains available when either
              ownership source has data. */}
          {!listQ.isLoading && (fetchErr || listQueryError || accounts.length > 0 || ownerPools.length > 0) && (
            <div className="flex items-center gap-4 flex-wrap">
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
              <div className="filter-group" role="radiogroup" aria-label={t('oauthContribute.filterByScopeAria')}>
                <AccountScopePill
                  active={scopeFilter === 'all'}
                  onClick={() => setScopeFilter('all')}
                  label={t('oauthContribute.filterAll')}
                  count={scopeCounts.all}
                />
                <AccountScopePill
                  active={scopeFilter === 'personal'}
                  onClick={() => setScopeFilter('personal')}
                  label={t('oauthContribute.filterPersonalAccounts')}
                  count={scopeCounts.personal}
                />
                <AccountScopePill
                  active={scopeFilter === 'agent_pool'}
                  onClick={() => setScopeFilter('agent_pool')}
                  label={t('oauthContribute.filterAgentPools')}
                  count={scopeCounts.agent_pool}
                />
              </div>
              {/* Pool filter chip (2026-07-22) — deep-linked from my-agents'
                  待登录 chip; removable (×) to return to all pools. */}
              {poolFilter && (
                <span
                  className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-mono"
                  style={{
                    color: '#5eead4',
                    background: 'rgba(45,212,191,0.08)',
                    border: '1px solid rgba(45,212,191,0.35)',
                  }}
                  title={`${t('oauthContribute.colPoolGroup')}: ${poolFilterName}`}
                >
                  <span style={{ opacity: 0.7 }}>{t('oauthContribute.colPoolGroup')}:</span>
                  {poolFilterName}
                  <button
                    type="button"
                    onClick={() => {
                      setPoolFilter(null);
                      setScopeFilter('all');
                      autoResolvedGroupRef.current = null;
                    }}
                    aria-label={t('oauthContribute.clearPoolFilter')}
                    style={{
                      marginLeft: '2px',
                      color: 'inherit',
                      opacity: 0.7,
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '13px',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          )}

          {/* Personal routed/history accounts. This section intentionally comes
              before Agent pools in the combined view (2026-07-29 user rule). */}
          {showPersonalAccounts && (
            <section className="card overflow-hidden">
              <div className="card-header flex items-center gap-2 px-4 py-3">
                <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  {t('oauthContribute.personalAccountsTitle')}
                  {' · '}
                  {fetchErr || listQueryError
                    ? t('oauthContribute.accountListUnavailable')
                    : routed
                      ? t('oauthContribute.historyNote')
                      : t('oauthContribute.noRoutedAccount')}
                </span>
              </div>

              <div className="overflow-x-auto">
                {listQ.isLoading && <EmptyState message={t('oauthContribute.loading')} />}
                {(fetchErr || listQueryError) && (
                  <EmptyState
                    message={fetchErr ? t(fetchErrKey(fetchErr)) : listQueryError}
                    tone="error"
                    onRetry={() => void listQ.refetch()}
                    retryLabel={t('oauthContribute.retryLoad')}
                  />
                )}
                {ready && visiblePersonalAccounts.length === 0 && <EmptyState message={t('oauthContribute.empty')} />}
                {ready && visiblePersonalAccounts.length > 0 && (
                  <table className="vault">
                    <thead>
                      <tr>
                        <th style={{ width: '28%' }}>{t('oauthContribute.colEmail')}</th>
                        <th style={{ width: '16%' }}>{t('oauthContribute.colPoolGroup')}</th>
                        <th style={{ width: '14%' }}>{t('oauthContribute.colLastLogin')}</th>
                        <th style={{ width: '14%' }}>{t('oauthContribute.colTokenExpiry')}</th>
                        <th style={{ width: '12%' }}>{t('oauthContribute.colStatus')}</th>
                        <th style={{ width: '16%', textAlign: 'right' }} aria-hidden="true" />
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePersonalAccounts.map((a) => (
                        <AccountRow
                          key={a.credential_id}
                          account={a}
                          expanded={!!a.is_routed && expandedCred === a.credential_id}
                          // Deep-link arrival (2026-07-12): scroll the auto-expanded card
                          // into view once — the vault CTA's whole point is landing the
                          // user ON the right account, not above/below it off-screen.
                          scrollOnMount={deepLinkCred === a.credential_id}
                          onToggle={() => setExpandedCred((c) => (c === a.credential_id ? null : a.credential_id))}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {/* Owner Agent pools. Full composition and every account is sign-in-able
              (2026-07-18); one card per provider-partitioned owner pool. */}
          {showAgentPools &&
            visibleOwnerPools.map((g) => (
              <section key={g.oauth_group_id} className="card overflow-hidden">
                <div className="card-header flex items-center gap-2 px-4 py-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    {t('oauthContribute.ownerPoolTitle', {
                      alias: g.alias,
                      provider: g.provider_code || 'anthropic',
                    })}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  {(g.accounts?.length ?? 0) === 0 ? (
                    <EmptyState compact message={t('oauthContribute.ownerPoolEmpty')} />
                  ) : (
                    <table className="vault">
                      <thead>
                        <tr>
                          <th style={{ width: '28%' }}>{t('oauthContribute.colEmail')}</th>
                          <th style={{ width: '16%' }}>{t('oauthContribute.colPoolGroup')}</th>
                          <th style={{ width: '14%' }}>{t('oauthContribute.colLastLogin')}</th>
                          <th style={{ width: '14%' }}>{t('oauthContribute.colTokenExpiry')}</th>
                          <th style={{ width: '12%' }}>{t('oauthContribute.colStatus')}</th>
                          <th style={{ width: '16%', textAlign: 'right' }} aria-hidden="true" />
                        </tr>
                      </thead>
                      <tbody>
                        {(g.accounts ?? []).map((oa) => (
                          <AccountRow
                            key={'own-' + oa.credential_id}
                            account={{
                              credential_id: oa.credential_id,
                              identity: oa.identity,
                              status: oa.login_status,
                              last_login_at: 0,
                              expires_at: 0,
                              // Owner ⇒ sign-in controls on EVERY account (the server's
                              // member-or-owner predicate authorizes reveal + login).
                              is_routed: true,
                              oauth_group_id: g.oauth_group_id,
                              group_alias: g.alias,
                              provider_code: oa.provider_code,
                              protocol_type: oa.protocol_type,
                              has_egress: oa.has_egress,
                            }}
                            expanded={expandedCred === oa.credential_id}
                            scrollOnMount={deepLinkCred === oa.credential_id}
                            onToggle={() => setExpandedCred((c) => (c === oa.credential_id ? null : oa.credential_id))}
                          />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            ))}

          {showAgentPools && !ownerGroupsQ.isLoading && !ownerGroupsErr && visibleOwnerPools.length === 0 && (
            <section className="card overflow-hidden">
              <EmptyState message={t('oauthContribute.agentPoolsEmpty')} />
            </section>
          )}
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/** ToastStack: transient add-confirmation feedback. Same markup + shared
 * `.toast*` CSS (KEYS_PAGE_CSS) as the team-keys page so the two sibling
 * pages give identical feedback. */
function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Array<{
    id: number;
    kind: 'success' | 'error';
    title: string;
    sub?: string;
  }>;
  onDismiss: (id: number) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.kind === 'error' ? ' error' : ''}`} data-open="true">
          <span className="toast-icon">
            {toast.kind === 'success' ? <ZapIcon className="w-3 h-3" /> : <InfoIcon className="w-3 h-3" />}
          </span>
          <div className="toast-body">
            <div className="toast-title">{toast.title}</div>
            {/* Override the shared `.toast-sub` single-line ellipsis: this
                page's confirmation is a full sentence (esp. the English wire),
                which would clip to "…assigned to poo…". Instance-scoped so the
                team-keys page's short undo subs keep their single-line look. */}
            {toast.sub && (
              <div className="toast-sub" style={{ whiteSpace: 'normal', overflow: 'visible' }}>
                {toast.sub}
              </div>
            )}
          </div>
          <div className="toast-actions">
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => onDismiss(toast.id)}
              aria-label={tr('oauthContribute.toastDismiss')}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** AccountRow: one history row. The current-route row is highlighted and is the
 * ONLY one with sign-in / reveal-password controls; others are read-only. When the
 * routed row is expanded, an inline sub-row hosts the reveal + pool sign-in flow. */
function AccountRow({
  account,
  expanded,
  scrollOnMount,
  onToggle,
}: {
  account: MyPoolAccount;
  expanded: boolean;
  /** Deep-link arrival (2026-07-12): scroll this row into view once on mount so the
   * vault CTA lands the user ON the auto-expanded account. Mount-time only — manual
   * expand/collapse never scrolls. */
  scrollOnMount?: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const sc = statusChip(account.status);
  const isRouted = !!account.is_routed;
  // Keep every wire status mapped explicitly. Besides making unknown future
  // statuses fall back safely, the static keys are also checked by the i18n
  // coverage test (a template-string lookup is invisible to that guardrail).
  const statusLabel = (() => {
    switch (account.status) {
      case 'logged_in':
        return t('oauthContribute.status.logged_in');
      case 'needs_login':
        return t('oauthContribute.status.needs_login');
      case 'auth_failed':
        // Show the specific cause ONLY when the server named the Session Key
        // re-exchange rejection — the one case where the generic "sign in
        // again" hid WHY (2026-08-31 incident). Every other cause (refresh /
        // usage-401 / give-up) and older servers with no reason fall back to
        // the generic label; the boundary decision lives in showsSessionRenewalLabel.
        // spec: R-oauth-token-mint-6.S5 成员看得出 auth_failed 的原因
        return showsSessionRenewalLabel(account.status, account.status_reason)
          ? t('oauthContribute.status.auth_failed_session_renewal')
          : t('oauthContribute.status.auth_failed');
      case 'revoked':
        return t('oauthContribute.status.revoked');
      default:
        return account.status;
    }
  })();
  // Callback ref (not useEffect): fires exactly when the <tr> mounts, which for a
  // deep link is the first data render — no re-fire on expand/collapse re-renders.
  const scrollRef = useCallback(
    (el: HTMLTableRowElement | null) => {
      if (el && scrollOnMount) el.scrollIntoView({ block: 'center' });
    },
    [scrollOnMount],
  );

  return (
    <>
      <tr
        ref={scrollRef}
        className={isRouted ? 'row-clickable' : undefined}
        style={
          isRouted
            ? {
                background: 'rgba(var(--success-rgb), 0.06)',
                boxShadow: 'inset 3px 0 0 0 var(--primary)',
              }
            : undefined
        }
        onClick={isRouted ? onToggle : undefined}
      >
        <td>
          <div className="alias-main" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Tool glyph BEFORE the email (2026-08-01 user request — supersedes
                the 2026-07-19 "brand chip after the email" decision): muted
                claude/codex line icon, aligned with master's oauth-groups pool
                list so the two surfaces speak one icon language. Mock/unknown
                brands resolve via the account's protocol axis (glyphFor);
                nothing renders when both axes are absent. */}
            {(() => {
              const g = glyphFor(account.provider_code, account.protocol_type);
              return g ? <ToolGlyph slug={g.slug} title={g.labelKey ? t(g.labelKey) : g.slug} /> : null;
            })()}
            <span style={{ wordBreak: 'break-all' }}>{account.identity || account.credential_id}</span>
            {/* Egress presence chip (2026-07-19): this account exits through a
                configured egress line (admin per-account override OR inherited
                group default, R46 effective egress). PRESENCE ONLY — the URL is
                never sent to the member plane (may embed proxy creds). Neutral
                chip (not brand-colored): it's a routing FACT, not a provider.
                Why members see it: it explains "my traffic leaves via a
                dedicated line", which also seeds the mental model for the
                planned settings-upstream escape hatch (self-rescue when that
                line is down) — the hint text stays fact-only until that ships. */}
            {account.has_egress && (
              <span className="chip" style={{ padding: '1px 6px', fontSize: 9.5 }} title={t('oauthContribute.egressChipHint')}>
                {t('oauthContribute.egressChip')}
              </span>
            )}
          </div>
        </td>
        {/* Pool group name (group_alias): which OAuth pool this account belongs to.
            Empty for ungrouped accounts / older servers → shows a muted dash. */}
        <td className="font-mono text-[11.5px]" style={{ color: 'var(--foreground)' }}>
          {account.group_alias ? account.group_alias : <span style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>—</span>}
        </td>
        <td className="font-mono text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
          {fmtDate(account.last_login_at)}
        </td>
        {/* Provider-signed token expiry. The field always rode this DTO and was
            never rendered, so a member could not tell a 7-day token from a
            1-hour one — exactly the evidence the 2026-08-31 "登录成功一会儿就失效"
            report needed (bugfix: workflow/CI/bugfix/2026-09-02-token到期时间到达前端却从不显示.md). */}
        <td>
          <TokenExpiryBadge expiresAtUnixSeconds={account.expires_at} />
        </td>
        <td>
          <span className={`chip ${sc.cls}`}>
            {sc.dot !== 'idle' && <span className={`status-dot ${sc.dot}`} style={{ width: 5, height: 5 }} />}
            {statusLabel}
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
              {account.status === 'logged_in' ? t('oauthContribute.reLogin') : t('oauthContribute.logIn')}
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
          <td colSpan={5} style={{ padding: 0 }}>
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
    // Pull THIS account's password by explicit credential_id (2026-07-01): a member in
    // multiple pools has one routed account per pool, so the panel must reveal ITS own
    // account — NOT let the server resolve the single default-routed one (which would
    // return the wrong pool's password for the 2nd panel). Keyed per-account so panels
    // don't share a cache entry.
    queryKey: ['routed-credential', account.credential_id],
    queryFn: () => fetchRoutedCredential(account.credential_id),
    enabled: revealed,
  });
  const cred = credQ.data;
  const credVal: RoutedCredential | undefined = cred && !isTeamFetchError(cred) ? (cred as RoutedCredential) : undefined;

  // pool sign-in flow
  const sessionKeyCapabilitiesQ = useQuery({
    queryKey: ['session-key-capabilities'],
    queryFn: poolSessionKeyCapabilities,
    staleTime: 30_000,
  });
  const sessionKeyCapabilities = sessionKeyCapabilitiesQ.data;
  const sessionKeyKind = sessionKeyProviderKind(account.provider_code || '', account.protocol_type || '');
  const sessionKeyCapabilityError = !sessionKeyCapabilities
    ? sessionKeyCapabilitiesQ.isPending
      ? t('oauthContribute.sessionKeyChecking')
      : t('oauthContribute.sessionKeyCapabilityUnavailable')
    : isPoolLoginError(sessionKeyCapabilities)
      ? `[${sessionKeyCapabilities.code}] ${sessionKeyCapabilities.message}`
      : !sessionKeyCapabilities.available
        ? `[${sessionKeyCapabilities.reason_code || 'SESSION_KEY_UNAVAILABLE'}] ${t('oauthContribute.sessionKeyPlatformUnavailable')}`
        : '';
  const supportsSessionKey = sessionKeyKind !== null && !sessionKeyCapabilityError;
  const [loginMethod, setLoginMethod] = useState<'browser' | 'session_key'>('browser');
  const effectiveLoginMethod = sessionKeyKind ? loginMethod : 'browser';
  const sessionKeyLabel = t(sessionKeyKind === 'codex' ? 'oauthContribute.codexSessionKeyLabel' : 'oauthContribute.sessionKeyLabel');
  const sessionKeyPlaceholder = t(
    sessionKeyKind === 'codex' ? 'oauthContribute.codexSessionKeyPlaceholder' : 'oauthContribute.sessionKeyPlaceholder',
  );
  const sessionKeyHint = t(sessionKeyKind === 'codex' ? 'oauthContribute.codexSessionKeyHint' : 'oauthContribute.sessionKeyHint');
  const sessionKeyInputID = useId();
  const [sessionId, setSessionId] = useState('');
  const [code, setCode] = useState('');
  const [sessionKey, setSessionKey] = useState('');
  const [sessionKeyOperationID, setSessionKeyOperationID] = useState('');
  const [sessionKeyStatus, setSessionKeyStatus] = useState<{
    tone: 'success' | 'error' | 'pending';
    message: string;
  } | null>(null);
  // Cross-account review state (拍板 2026-09-01): the exchanged key belongs to a
  // different provider account. The pending operation is held by the proxy; the
  // member must explicitly confirm before it binds — to their own seat only.
  const [sessionKeyMismatch, setSessionKeyMismatch] = useState<{
    actual: string;
    expected: string;
  } | null>(null);
  const [err, setErr] = useState('');
  // A successful OAuth writeback can still be waiting for the local runtime
  // rail. Keep that distinction visible without forcing the user to repeat
  // the login or holding the form open.
  const [syncWarning, setSyncWarning] = useState('');
  // The provider account email resolved by step-1 exchange. Shown for review; a yellow
  // warning appears if it doesn't match this team slot. `awaitingConfirm` = the token
  // is exchanged + held but NOT yet written — the member must click Confirm to submit.
  const [signedInAs, setSignedInAs] = useState('');
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  // auth_code (codex) only: authorize opened, waiting for the broker's localhost
  // callback to fire (page polls pool/status; no code to paste).
  const [waitingCallback, setWaitingCallback] = useState(false);
  // Provider/flow are immutable session context resolved from the credential by
  // master. Never infer them from the list row: that row is display enrichment
  // and may be absent/stale on an older or degraded control plane.
  const [sessionFlow, setSessionFlow] = useState<'setup_token' | 'auth_code' | ''>('');
  const [expectedLoginIdentity, setExpectedLoginIdentity] = useState(account.identity);
  const pollFlow = sessionFlow === 'auth_code';

  // ── egress management + exit-IP self-check (2026-07-19, P3/P4/P5) ──
  // egressView: resolved effective config + baseline. Editing lives entirely in
  // the modal so the compact step summary has a single, unambiguous entry point.
  const egressQ = useQuery({
    queryKey: ['account-egress', account.credential_id],
    queryFn: () => fetchAccountEgress(account.credential_id),
  });
  const egressView: MemberEgressView | undefined =
    egressQ.data && !isTeamFetchError(egressQ.data) ? (egressQ.data as MemberEgressView) : undefined;
  const [egressConfigOpen, setEgressConfigOpen] = useState(false);
  const [egressModalDraft, setEgressModalDraft] = useState('');
  const [egressModalDirty, setEgressModalDirty] = useState(false);
  const [egressTestedDraft, setEgressTestedDraft] = useState('');
  const [egressDraftTest, setEgressDraftTest] = useState<MemberEgressTestResult | null>(null);
  const [egressDraftTesting, setEgressDraftTesting] = useState(false);
  const effectiveEgress = (egressView?.effective_egress_url ?? '').trim();
  const egressPresentation = deriveEgressPresentation(egressView, egressQ.isPending);
  const egressPresentationKey = {
    loading: 'oauthContribute.egressLoading',
    load_failed: 'oauthContribute.egressLoadFailed',
    overridden: 'oauthContribute.egressOverridden',
    inherited: 'oauthContribute.egressInherited',
    not_configured: 'oauthContribute.egressNotConfigured',
  }[egressPresentation];
  const egressConfigHintKey = {
    loading: 'oauthContribute.egressConfigLoading',
    load_failed: 'oauthContribute.egressConfigLoadFailed',
    overridden: 'oauthContribute.egressConfigOverriddenHint',
    inherited: 'oauthContribute.egressConfigInheritedHint',
    not_configured: 'oauthContribute.egressConfigNotConfiguredHint',
  }[egressPresentation];
  const egressMut = useMutation({
    mutationFn: (url: string) => setAccountEgress(account.credential_id, url),
    onSuccess: (res, url) => {
      if (isTeamFetchError(res) || isTeamWriteError(res)) {
        setEgressDraftTest({
          ok: false,
          error: isTeamWriteError(res) ? res.message : t('oauthContribute.egressSaveFailed'),
        });
        return;
      }
      setErr('');
      setEgressModalDraft(url);
      setEgressModalDirty(false);
      setEgressTestedDraft('');
      setEgressDraftTest(null);
      setEgressConfigOpen(false);
      // The authoritative save re-tested this exact spec. Because the route
      // changed, the server clears any stale account baseline; an administrator
      // must test the new route before members receive a new trusted baseline.
      setIpTested(false);
      egressQ.refetch();
    },
  });

  function openEgressConfig() {
    // Preserve the server's verbatim YAML / URL text. The UI never parses or
    // serializes the config, so comments, indentation and key order survive.
    setEgressModalDraft(effectiveEgress);
    setEgressModalDirty(false);
    setEgressTestedDraft('');
    setEgressDraftTest(null);
    setEgressConfigOpen(true);
    if (!egressView) void egressQ.refetch();
  }

  // A fast click can open the modal before the account egress GET finishes.
  // Seed it when the server value arrives, but never overwrite text the user
  // has already started editing.
  React.useEffect(() => {
    if (egressConfigOpen && egressView && !egressModalDirty) {
      setEgressModalDraft(effectiveEgress);
    }
  }, [egressConfigOpen, egressView, egressModalDirty, effectiveEgress]);

  async function onTestEgressDraft() {
    const draft = egressModalDraft.trim();
    if (!draft) return;
    setEgressDraftTesting(true);
    setEgressDraftTest(null);
    setEgressTestedDraft('');
    const res = await testAccountEgress(account.credential_id, draft);
    if (isTeamFetchError(res) || isTeamWriteError(res)) {
      setEgressDraftTest({
        ok: false,
        error: isTeamWriteError(res) ? res.message : t('oauthContribute.egressTestFailed'),
      });
    } else {
      const usable = res.ok && !!res.exit_ip;
      setEgressDraftTest(
        usable
          ? res
          : {
              ok: false,
              error: res.error ?? t('oauthContribute.egressTestNoExitIp'),
            },
      );
      if (usable) setEgressTestedDraft(draft);
    }
    setEgressDraftTesting(false);
  }

  // Exit-IP self-check state. ipTested gates login (req 4); currentIP vs baseline
  // (effective_exit_ip: account baseline or inherited group baseline) drives
  // the mismatch warning. Baseline writes are administrator-only.
  const [ipTested, setIpTested] = useState(false);
  const [ipTesting, setIpTesting] = useState(false);
  const [currentIP, setCurrentIP] = useState('');
  const [ipErr, setIpErr] = useState('');
  const baselineIP = (egressView?.effective_exit_ip ?? egressView?.last_exit_ip ?? '').trim();
  const ipMismatch = ipTested && !!currentIP && !!baselineIP && currentIP !== baselineIP;

  async function onTestExitIP() {
    setIpTesting(true);
    setIpErr('');
    try {
      const ip = await fetchBrowserExitIP();
      setCurrentIP(ip);
      setIpTested(true);
    } catch (e) {
      setIpErr(e instanceof Error ? e.message : String(e));
      setIpTested(false);
    } finally {
      setIpTesting(false);
    }
  }

  // Login gate confirm dialog (req 4): a mismatched exit IP turns the login button
  // red; clicking it opens this confirm instead of logging in directly.
  const [loginConfirmOpen, setLoginConfirmOpen] = useState(false);
  function onLoginClick() {
    if (ipMismatch) {
      setLoginConfirmOpen(true);
      return;
    }
    startMut.mutate();
  }

  const startMut = useMutation({
    mutationFn: () => poolAuthorizeURL(account.credential_id),
    onSuccess: (res, variables) => {
      if (isPoolLoginError(res)) {
        setErr(res.message);
        return;
      }
      setErr('');
      setSyncWarning('');
      setSessionId(res.session_id);
      setSessionFlow(res.flow);
      setExpectedLoginIdentity(res.expected_identity || account.identity);
      if (res.flow === 'auth_code') setWaitingCallback(true);
      window.open(res.authorize_url, '_blank', 'noopener');
    },
  });

  // Step 1 — exchange only (confirm=false): resolve the Claude account for review;
  // NOTHING is written to master yet. On success we reveal the review + Confirm step.
  const finishMut = useMutation({
    mutationFn: () => poolSubmitCode(sessionId, code.trim(), false),
    onSuccess: (res, variables) => {
      if (isPoolLoginError(res)) {
        setErr(res.message);
        return;
      }
      // Rolling-upgrade fence: an older Proxy may still return a reviewable
      // mismatch. Never surface a confirm action for it because the token would
      // become the shared login for every authorized member.
      if (res.identity_mismatch) {
        setErr(
          t('oauthContribute.loginIdentityMismatchError', {
            actual: res.identity || t('oauthContribute.sessionKeyIdentityUnknown'),
            expected: res.expected_identity || account.identity,
          }),
        );
        setSignedInAs('');
        setAwaitingConfirm(false);
        setSessionId('');
        setCode('');
        setSessionFlow('');
        return;
      }
      setErr('');
      setSignedInAs(res.identity ?? '');
      setAwaitingConfirm(true); // keep sessionId + code so Confirm can replay the token
    },
  });

  // Step 2 — confirm (confirm=true): write the reviewed token back. WRITEBACK_FAILED
  // keeps everything so the member can retry Confirm (idempotent replay, no re-login).
  const confirmMut = useMutation({
    mutationFn: () => poolSubmitCode(sessionId, code.trim(), true),
    onSuccess: (res) => {
      if (isPoolLoginError(res)) {
        setErr(res.code === 'WRITEBACK_FAILED' ? t('oauthContribute.writebackRetryHint') : res.message);
        return;
      }
      setErr('');
      setSyncWarning(
        res.sync_status === 'pending'
          ? t('oauthContribute.loginSyncPending', {
              detail: res.sync_error || t('oauthContribute.loginSyncPendingFallback'),
            })
          : '',
      );
      setSignedInAs('');
      setAwaitingConfirm(false);
      setSessionId('');
      setCode('');
      setSessionFlow('');
      setExpectedLoginIdentity(account.identity);
      qc.invalidateQueries({ queryKey: ['my-pool-accounts'] });
      qc.invalidateQueries({ queryKey: ['my-oauth-groups'] });
    },
  });

  const sessionKeyStartMut = useMutation({
    mutationFn: ({ value, operationID }: { value: string; operationID: string }) =>
      poolSessionKey(account.credential_id, value, operationID, false),
    onSuccess: (res, variables) => {
      if (isPoolLoginError(res)) {
        if (res.code === SESSION_KEY_IDENTITY_MISMATCH) {
          setSessionKey('');
          setSessionKeyOperationID('');
        }
        setSessionKeyStatus({
          tone: 'error',
          message: `[${res.code}] ${res.message}`,
        });
        return;
      }
      // The provider secret leaves React state as soon as the local exchanger
      // confirms it has created a reviewable operation. The access token stays
      // inside aikey-proxy and is never returned to this page.
      setSessionKey('');
      setErr('');
      setSyncWarning('');
      const confirmedOperationID = res.operation_id || variables.operationID;
      setSessionKeyOperationID(confirmedOperationID);
      // Cross-account review (拍板 2026-09-01): the proxy now holds the mismatched
      // exchange as a pending operation. Surface the warning and require the
      // member's explicit confirmation — never auto-confirm a mismatch. The
      // confirmed token binds to this member's own seat only; the pool account's
      // identity (email) is not changed.
      if (res.identity_mismatch) {
        setSessionKeyMismatch({
          actual: res.identity || t('oauthContribute.sessionKeyIdentityUnknown'),
          expected: res.expected_identity || account.identity,
        });
        setSessionKeyStatus({
          tone: 'error',
          message: t('oauthContribute.sessionKeyMismatchWarning', {
            actual: res.identity || t('oauthContribute.sessionKeyIdentityUnknown'),
            expected: res.expected_identity || account.identity,
          }),
        });
        return;
      }
      setSessionKeyMismatch(null);
      setSessionKeyStatus({
        tone: 'pending',
        message: t('oauthContribute.sessionKeySaving'),
      });
      sessionKeyConfirmMut.mutate({
        operationID: confirmedOperationID,
      });
    },
  });

  const sessionKeyConfirmMut = useMutation({
    mutationFn: ({
      operationID,
      identityMismatchConfirmed = false,
    }: {
      operationID: string;
      identityMismatchConfirmed?: boolean;
    }) => poolSessionKey(account.credential_id, '', operationID, true, identityMismatchConfirmed),
    onSuccess: (res) => {
      if (isPoolLoginError(res)) {
        setSessionKeyStatus({
          tone: 'error',
          message:
            res.code === 'WRITEBACK_FAILED'
              ? `${t('oauthContribute.writebackRetryHint')} [${res.code}] ${res.message}`
              : `[${res.code}] ${res.message}`,
        });
        return;
      }
      setErr('');
      setSyncWarning(
        res.sync_status === 'pending'
          ? t('oauthContribute.loginSyncPending', {
              detail: res.sync_error || t('oauthContribute.loginSyncPendingFallback'),
            })
          : '',
      );
      setSignedInAs('');
      setAwaitingConfirm(false);
      setSessionKeyOperationID('');
      setSessionKeyMismatch(null);
      setSessionKeyStatus({
        tone: 'success',
        message: t('oauthContribute.sessionKeyLoginSuccess', {
          identity: res.identity || account.identity,
        }),
      });
      setExpectedLoginIdentity(account.identity);
      qc.invalidateQueries({ queryKey: ['my-pool-accounts'] });
      qc.invalidateQueries({ queryKey: ['my-oauth-groups'] });
    },
  });

  // codex polling leg: OpenAI redirects to the broker's localhost:1455 callback,
  // which exchanges in-place — poll pool/status until it flips, then run the SAME
  // step-1 review path as claude via an EMPTY-code submit (idempotent replay; the
  // broker returns the cached exchange without re-spending anything).
  const finishRef = React.useRef<() => void>(() => {});
  finishRef.current = () => finishMut.mutate(); // fresh closure each render (poll timer calls via ref)
  React.useEffect(() => {
    if (!pollFlow || !waitingCallback || !sessionId) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const res = await poolStatus(sessionId);
      if (stopped) return;
      if (isPoolLoginError(res)) {
        // Transient relay/proxy hiccups shouldn't kill the wait — only a dead
        // session should (UNKNOWN_SESSION / SESSION_EXPIRED are terminal).
        if (res.code === 'UNKNOWN_SESSION' || res.code === 'SESSION_EXPIRED') {
          setErr(res.message);
          setWaitingCallback(false);
        }
        return;
      }
      if (res.status === 'success') {
        setWaitingCallback(false);
        finishRef.current();
      } else if (res.status === 'failed' || res.status === 'expired') {
        setErr(res.error_detail || t('oauthContribute.codexAuthFailed'));
        setWaitingCallback(false);
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pollFlow, waitingCallback, sessionId, t]);

  function onCancelConfirm() {
    setErr('');
    setSignedInAs('');
    setAwaitingConfirm(false);
    setSessionId('');
    setCode('');
    setWaitingCallback(false);
    setSessionFlow('');
    setSessionKey('');
    setSessionKeyOperationID('');
    setSessionKeyStatus(null);
    setSessionKeyMismatch(null);
    setExpectedLoginIdentity(account.identity);
  }

  function selectLoginMethod(method: 'browser' | 'session_key') {
    if (method === effectiveLoginMethod || awaitingConfirm) return;
    onCancelConfirm();
    setErr('');
    setLoginMethod(method);
  }

  function startSessionKeySignIn() {
    const value = sessionKey.trim();
    if (!value) return;
    let operationID = sessionKeyOperationID;
    if (!operationID) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      operationID = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    setSessionKeyOperationID(operationID);
    setSessionKeyStatus({
      tone: 'pending',
      message: t('oauthContribute.sessionKeySigningIn'),
    });
    sessionKeyStartMut.mutate({ value, operationID });
  }

  // Current Proxy builds reject a mismatch before this review state. Retain the
  // comparison as a rolling-upgrade safety fence and never enable confirmation
  // if an older Proxy still returns mismatched identity metadata.
  const expectedEmail = expectedLoginIdentity.trim().toLowerCase();
  const actualEmail = signedInAs.trim().toLowerCase();
  const emailMismatch = !!actualEmail && !!expectedEmail && actualEmail !== expectedEmail;

  return (
    <div
      className="px-4 py-4 space-y-4"
      style={{
        background: 'rgba(var(--lift-rgb), 0.02)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {sessionKeyKind && (
        <div
          className="flex items-center gap-1 border-b"
          style={{ borderBottomColor: 'var(--border)' }}
          role="tablist"
          aria-label={t('oauthContribute.loginMethodLabel')}
          data-login-method-tabs
        >
          {(['browser', 'session_key'] as const).map((method) => (
            <button
              key={method}
              type="button"
              role="tab"
              aria-selected={effectiveLoginMethod === method}
              disabled={awaitingConfirm}
              className="px-3 py-2 text-[11px] font-mono"
              style={{
                color: effectiveLoginMethod === method ? 'var(--foreground)' : 'var(--muted-foreground)',
                borderBottom: effectiveLoginMethod === method ? '2px solid var(--primary)' : '2px solid transparent',
              }}
              onClick={() => selectLoginMethod(method)}
            >
              {t(method === 'browser' ? 'oauthContribute.browserLoginTab' : 'oauthContribute.sessionKeyLoginTab')}
            </button>
          ))}
        </div>
      )}

      {/* Step 1: egress config + exit-IP self-check. Both pool types can view/copy
          the resolved config; edits remain account-level overrides. It belongs
          to Browser OAuth, not to the Session Key flow. */}
      {effectiveLoginMethod === 'browser' && (
        <div
          data-browser-oauth-step="egress-check"
          className="rounded px-3 py-3 space-y-2"
          style={{
            border: '1px solid var(--border)',
            background: 'rgba(var(--sink-rgb), 0.15)',
          }}
        >
          <div
            className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full"
              style={{
                color: 'var(--primary-text)',
                border: '1px solid var(--primary)',
              }}
            >
              1
            </span>
            {t('oauthContribute.egressSectionTitle')}
          </div>
          {/* The scope chip names the active source. View opens the potentially long
            socks5 chain or mihomo fragment in a copy-friendly modal. */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', minWidth: 64 }}>
              {t('oauthContribute.egressLabel')}
            </span>
            <span className="chip" style={{ padding: '1px 6px', fontSize: 9.5 }}>
              {t(egressPresentationKey)}
            </span>
            <button type="button" className="row-use-btn" onClick={openEgressConfig}>
              {t('oauthContribute.viewEgressConfig')}
            </button>
          </div>
          {/* baseline + test */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', minWidth: 64 }}>
              {t('oauthContribute.exitIpLabel')}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--foreground)' }}>
              {baselineIP
                ? egressView?.exit_ip_scope === 'group'
                  ? t('oauthContribute.baselineInherited', { ip: baselineIP })
                  : t('oauthContribute.baselineAccount', { ip: baselineIP })
                : t('oauthContribute.baselineAdminPending')}
            </span>
            <button type="button" className="row-use-btn" onClick={() => void onTestExitIP()} disabled={ipTesting}>
              {ipTesting ? t('oauthContribute.testing') : t('oauthContribute.testExitIp')}
            </button>
            {ipTested && currentIP && (
              <span
                className="text-[11px] font-mono"
                style={{
                  color: ipMismatch ? 'var(--warning, #f97316)' : '#4ade80',
                }}
              >
                {t('oauthContribute.currentExitIp', { ip: currentIP })}
                {ipMismatch ? ` — ${t('oauthContribute.exitIpMismatch')}` : ''}
              </span>
            )}
          </div>
          {!baselineIP && (
            <p className="text-[11px] font-mono" style={{ color: 'var(--warning, #f97316)' }}>
              {t('oauthContribute.baselineAdminHint')}
            </p>
          )}
          {ipErr && (
            <p className="text-[11px]" style={{ color: 'var(--destructive-text-soft)' }}>
              {t('oauthContribute.exitIpTestFailed')}: {ipErr}
            </p>
          )}
          <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.75 }}>
            {t('oauthContribute.egressGuideNote')}
          </p>
        </div>
      )}

      {/* Browser OAuth step 2, or the independent Session Key flow. */}
      <div
        data-login-flow={effectiveLoginMethod}
        className="rounded px-3 py-3 space-y-3"
        style={{
          border: '1px solid var(--border)',
          background: 'rgba(var(--sink-rgb), 0.15)',
        }}
      >
        {effectiveLoginMethod === 'browser' && (
          <div
            data-browser-oauth-step="account-login"
            className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full"
              style={{
                color: 'var(--primary-text)',
                border: '1px solid var(--primary)',
              }}
            >
              2
            </span>
            {t('oauthContribute.loginSectionTitle')}
          </div>
        )}

        {/* The admin-stored password is useful only for the existing browser flow. */}
        {effectiveLoginMethod === 'browser' && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)', minWidth: 64 }}>
              {t('oauthContribute.colEmail')}
            </span>
            <span className="font-mono text-[12px]" style={{ color: 'var(--foreground)' }}>
              {revealed && credVal ? credVal.login_email : account.identity}
            </span>
            <CopyBtn value={revealed && credVal ? credVal.login_email : account.identity} label={t('oauthContribute.copyEmail')} />
            <span className="font-mono text-[12px]" style={{ color: 'var(--foreground)' }}>
              {revealed ? (credVal ? credVal.password : '••••••') : '••••••••'}
            </span>
            <CopyBtn value={revealed && credVal ? credVal.password : ''} label={t('oauthContribute.copyPassword')} />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setRevealed((v) => !v)}
              title={revealed ? t('oauthContribute.hide') : t('oauthContribute.reveal')}
            >
              {revealed ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* Sign-in flow */}
        {effectiveLoginMethod === 'browser' ? (
          <div className="flex items-center gap-3 flex-wrap">
            {!ipTested && (
              <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {t('oauthContribute.testBeforeLogin')}
              </span>
            )}
            <button
              type="button"
              className="row-use-btn"
              onClick={onLoginClick}
              disabled={startMut.isPending || !ipTested}
              style={
                ipMismatch
                  ? {
                      color: 'var(--destructive-text-soft)',
                      borderColor: 'var(--destructive, #ef4444)',
                    }
                  : undefined
              }
              title={ipMismatch ? t('oauthContribute.loginMismatchTitle') : undefined}
            >
              <ZapIcon className="w-3 h-3" />
              {t('oauthContribute.startSignIn')}
            </button>

            {/* claude: paste the code shown by the provider page. codex has NO code —
            the broker's localhost callback exchanges in-place, so show a waiting
            hint while the page polls pool/status instead. */}
            {sessionId && !awaitingConfirm && !pollFlow && (
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
                  {finishMut.isPending ? t('oauthContribute.resolving') : t('oauthContribute.finishSignIn')}
                </button>
              </>
            )}
            {sessionId && !awaitingConfirm && pollFlow && (waitingCallback || finishMut.isPending) && (
              <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {finishMut.isPending ? t('oauthContribute.resolving') : t('oauthContribute.codexWaiting')}
              </span>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {sessionKeyHint}
            </p>
            {sessionKeyCapabilityError && (
              <div
                role="alert"
                className="rounded border px-3 py-2 text-[11px] font-mono"
                style={{
                  color: 'var(--destructive-text-soft)',
                  borderColor: 'rgba(var(--destructive-rgb), 0.4)',
                  background: 'rgba(var(--destructive-rgb), 0.08)',
                }}
              >
                {sessionKeyCapabilityError}
              </div>
            )}
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1.5" style={{ width: 360, maxWidth: '100%' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor={sessionKeyInputID}
                    className="text-[10px] font-mono uppercase tracking-wider"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {sessionKeyLabel}
                  </label>
                  {sessionKeyKind && <SessionKeyHelp providerKind={sessionKeyKind} />}
                </div>
                {/* textarea has no native password type. The supported desktop
                  engines use WebkitTextSecurity to preserve masking while the
                  long Session Key soft-wraps across multiple visual lines. */}
                <textarea
                  id={sessionKeyInputID}
                  rows={4}
                  wrap="soft"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full px-3 py-2 text-sm font-mono resize-y"
                  style={
                    {
                      minHeight: 96,
                      WebkitTextSecurity: 'disc',
                    } as React.CSSProperties
                  }
                  value={sessionKey}
                  onChange={(e) => {
                    setSessionKey(e.target.value);
                    setSessionKeyOperationID('');
                    setSessionKeyStatus(null);
                    setSessionKeyMismatch(null);
                  }}
                  placeholder={sessionKeyPlaceholder}
                  disabled={!supportsSessionKey || sessionKeyStartMut.isPending || sessionKeyConfirmMut.isPending}
                />
              </div>
              <button
                type="button"
                className="row-use-btn"
                onClick={startSessionKeySignIn}
                disabled={
                  !supportsSessionKey ||
                  sessionKeyStartMut.isPending ||
                  sessionKeyConfirmMut.isPending ||
                  !sessionKey.trim()
                }
              >
                <ZapIcon className="w-3 h-3" aria-hidden="true" />
                {sessionKeyStartMut.isPending || sessionKeyConfirmMut.isPending
                  ? t('oauthContribute.sessionKeySigningIn')
                  : t('oauthContribute.sessionKeyConfirmLogin')}
              </button>
              {sessionKeyOperationID && sessionKeyMismatch && (
                <button
                  type="button"
                  className="row-use-btn"
                  onClick={() =>
                    sessionKeyConfirmMut.mutate({
                      operationID: sessionKeyOperationID,
                      identityMismatchConfirmed: true,
                    })
                  }
                  disabled={sessionKeyConfirmMut.isPending}
                >
                  {t('oauthContribute.sessionKeyConfirmMismatch')}
                </button>
              )}
              {sessionKeyOperationID && !sessionKeyMismatch && sessionKeyStatus?.tone === 'error' && !sessionKey.trim() && (
                <button
                  type="button"
                  className="row-use-btn"
                  onClick={() =>
                    sessionKeyConfirmMut.mutate({
                      operationID: sessionKeyOperationID,
                    })
                  }
                  disabled={sessionKeyConfirmMut.isPending}
                >
                  {t('oauthContribute.sessionKeyRetrySave')}
                </button>
              )}
            </div>
            {sessionKeyStatus && (
              <div
                role={sessionKeyStatus.tone === 'error' ? 'alert' : 'status'}
                className="rounded border px-3 py-2 text-[11px] font-mono"
                style={{
                  color:
                    sessionKeyStatus.tone === 'success'
                      ? '#4ade80'
                      : sessionKeyStatus.tone === 'error'
                        ? '#fca5a5'
                        : 'var(--muted-foreground)',
                  borderColor:
                    sessionKeyStatus.tone === 'success'
                      ? 'rgba(var(--success-rgb), 0.35)'
                      : sessionKeyStatus.tone === 'error'
                        ? 'rgba(var(--destructive-rgb), 0.4)'
                        : 'var(--border)',
                  background:
                    sessionKeyStatus.tone === 'success'
                      ? 'rgba(var(--success-rgb), 0.06)'
                      : sessionKeyStatus.tone === 'error'
                        ? 'rgba(var(--destructive-rgb), 0.08)'
                        : 'rgba(var(--sink-rgb), 0.15)',
                }}
              >
                {sessionKeyStatus.message}
              </div>
            )}
            <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.75 }}>
              {t('oauthContribute.sessionKeyPlatformNote')}
            </p>
          </div>
        )}

        {/* Step-2 review + confirm: the token is exchanged + held but NOT written yet.
          A mismatch is zero-write and never reaches this state on current builds. */}
        {awaitingConfirm && signedInAs && (
          <div className="space-y-3">
            <div
              className="text-[11px] font-mono rounded px-3 py-2"
              style={
                emailMismatch
                  ? {
                      color: '#facc15',
                      background: 'rgba(250,204,21,0.08)',
                      border: '1px solid rgba(250,204,21,0.35)',
                    }
                  : {
                      color: 'var(--success-text)',
                      background: 'rgba(var(--success-rgb), 0.06)',
                      border: '1px solid rgba(var(--success-rgb), 0.25)',
                    }
              }
            >
              {emailMismatch
                ? t('oauthContribute.signedInMismatch', {
                    actual: signedInAs,
                    expected: expectedLoginIdentity,
                  })
                : t('oauthContribute.signedInMatch', { actual: signedInAs })}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="row-use-btn" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || emailMismatch}>
                {confirmMut.isPending ? t('oauthContribute.submitting') : t('oauthContribute.confirmSubmit')}
              </button>
              <button
                type="button"
                className="text-[11px]"
                style={{ color: 'var(--muted-foreground)' }}
                onClick={onCancelConfirm}
                disabled={confirmMut.isPending}
              >
                {t('oauthContribute.cancel')}
              </button>
            </div>
          </div>
        )}

        <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
          {t(effectiveLoginMethod === 'session_key' ? 'oauthContribute.sessionKeySecurityNote' : 'oauthContribute.securityNote')}
        </p>
        {/* Tip: log into different accounts in separate, isolated Chrome profiles so
          their sessions don't overwrite each other. Opens the how-to in a new tab. */}
        {effectiveLoginMethod === 'browser' && (
          <a
            href="/user/browser-profile-guide"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px]"
            style={{ color: 'var(--primary-text)', textDecoration: 'none' }}
          >
            💡 {t('oauthContribute.profileGuideHint')}
            <span aria-hidden="true">→</span>
          </a>
        )}
        {err && (
          <div
            role="alert"
            aria-live="assertive"
            className="text-[11px] font-mono rounded px-3 py-2"
            style={{
              color: 'var(--destructive-text-soft)',
              background: 'rgba(var(--destructive-rgb), 0.08)',
              border: '1px solid rgba(var(--destructive-rgb), 0.38)',
            }}
          >
            {err}
          </div>
        )}
        {syncWarning && (
          <div
            role="status"
            aria-live="polite"
            className="text-[11px] font-mono rounded px-3 py-2"
            style={{
              color: '#facc15',
              background: 'rgba(250,204,21,0.08)',
              border: '1px solid rgba(250,204,21,0.38)',
            }}
          >
            {syncWarning}
          </div>
        )}
      </div>

      {/* The editor must open even when the effective config is empty or its
          initial GET failed. Requiring effectiveEgress here made the button a
          no-op for exactly the accounts that need to create their first
          override (and hid backend errors behind a missing modal). */}
      {egressConfigOpen && (
        <ModalPortal scopeClassName="vault-page">
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'var(--overlay-sink)' }}
            onClick={() => setEgressConfigOpen(false)}
          >
            <div
              className="card w-[640px] max-w-[92vw] p-5 space-y-4"
              style={{ background: 'var(--surface-1)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold font-mono" style={{ color: 'var(--display-foreground)' }}>
                    {t('oauthContribute.egressConfigTitle')}
                  </div>
                  <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
                    {t(egressConfigHintKey)}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setEgressConfigOpen(false)}
                  aria-label={t('oauthContribute.close')}
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
              {!egressView && (
                <p
                  className="text-[11px] font-mono"
                  style={{
                    color: egressQ.isPending ? 'var(--muted-foreground)' : '#fca5a5',
                  }}
                >
                  {egressQ.isPending ? t('oauthContribute.egressConfigLoading') : t('oauthContribute.egressConfigLoadFailed')}
                </p>
              )}
              <label className="block space-y-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  {t('oauthContribute.egressConfigEditorLabel')}
                </span>
                <textarea
                  className="w-full min-h-[240px] max-h-[55vh] resize-y rounded p-3 text-[11px] font-mono leading-relaxed"
                  style={{
                    color: 'var(--foreground)',
                    background: 'rgba(var(--sink-rgb), 0.2)',
                    border: '1px solid var(--border)',
                  }}
                  value={egressModalDraft}
                  onChange={(e) => {
                    setEgressModalDraft(e.target.value);
                    setEgressModalDirty(true);
                    setEgressTestedDraft('');
                    setEgressDraftTest(null);
                  }}
                  disabled={!egressView || egressMut.isPending}
                  spellCheck={false}
                  aria-label={t('oauthContribute.egressConfigEditorLabel')}
                />
              </label>
              <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {t('oauthContribute.egressConfigFormatHint')}
              </p>
              {egressDraftTest && (
                <p
                  className="text-[11px] font-mono break-all"
                  style={{
                    color: egressDraftTest.ok ? 'var(--success, #16a34a)' : 'var(--destructive, #ef4444)',
                  }}
                  role="status"
                >
                  {egressDraftTest.ok
                    ? t('oauthContribute.egressTestPassed', {
                        ip: egressDraftTest.exit_ip,
                        ms: egressDraftTest.latency_ms ?? 0,
                      })
                    : `${t('oauthContribute.egressTestFailed')}: ${egressDraftTest.error ?? ''}`}
                </p>
              )}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                    {t('oauthContribute.copyEgressConfig')}
                  </span>
                  <CopyBtn value={egressModalDraft} label={t('oauthContribute.copyEgressConfig')} />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-[11px]"
                    style={{ color: 'var(--muted-foreground)' }}
                    onClick={() => setEgressConfigOpen(false)}
                    disabled={egressMut.isPending}
                  >
                    {t('oauthContribute.cancel')}
                  </button>
                  <button
                    type="button"
                    className="row-use-btn"
                    onClick={() => void onTestEgressDraft()}
                    disabled={!egressView || egressMut.isPending || egressDraftTesting || !egressModalDraft.trim()}
                  >
                    {egressDraftTesting ? t('oauthContribute.testing') : t('oauthContribute.testEgressConfig')}
                  </button>
                  <button
                    type="button"
                    className="row-use-btn"
                    onClick={() => egressMut.mutate(egressModalDraft.trim())}
                    disabled={
                      !egressView ||
                      egressMut.isPending ||
                      egressDraftTesting ||
                      egressModalDraft.trim() === effectiveEgress ||
                      (!!egressModalDraft.trim() && egressTestedDraft !== egressModalDraft.trim())
                    }
                  >
                    {egressMut.isPending
                      ? t('oauthContribute.submitting')
                      : egressView?.scope === 'overridden'
                        ? t('oauthContribute.updateEgressOverride')
                        : t('oauthContribute.saveEgressOverride')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Login-gate confirm (req 4): exit IP ≠ baseline → logging in would register
          this account from a different IP than it normally uses (login IP ≠ usage
          IP = a ban signal). Force an explicit confirm before opening the login. */}
      {loginConfirmOpen && (
        <ModalPortal scopeClassName="vault-page">
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'var(--overlay-sink)' }}
            onClick={() => setLoginConfirmOpen(false)}
          >
            <div
              className="rounded p-5 space-y-4"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--destructive, #ef4444)',
                maxWidth: 460,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[13px] font-bold" style={{ color: 'var(--destructive, #ef4444)' }}>
                {t('oauthContribute.loginMismatchTitle')}
              </div>
              <p className="text-[12px]" style={{ color: 'var(--foreground)' }}>
                {t('oauthContribute.loginMismatchBody', {
                  current: currentIP,
                  baseline: baselineIP,
                })}
              </p>
              <div className="flex items-center gap-3 justify-end">
                <button
                  type="button"
                  className="text-[12px]"
                  style={{ color: 'var(--muted-foreground)' }}
                  onClick={() => setLoginConfirmOpen(false)}
                >
                  {t('oauthContribute.cancel')}
                </button>
                <button
                  type="button"
                  className="row-use-btn"
                  style={{
                    color: 'var(--destructive-text-soft)',
                    borderColor: 'var(--destructive, #ef4444)',
                  }}
                  onClick={() => {
                    setLoginConfirmOpen(false);
                    startMut.mutate();
                  }}
                >
                  {t('oauthContribute.loginMismatchConfirm')}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

/** AddAccountModal: the R24 employee self-service add form. Stores a provider
 * account (email+password) into a pool group the member has joined — NO OAuth
 * here; the account is logged into later, on demand, when the scheduler routes a
 * member to it. Group dropdown = the member's joined groups (default first). */
function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [groupID, setGroupID] = useState('');
  const [providerCode, setProviderCode] = useState<string>(ADDABLE_PROVIDERS[0].code);
  const [err, setErr] = useState('');

  const groupsQ = useQuery({
    queryKey: ['my-oauth-groups'],
    queryFn: fetchMyGroups,
    ...LIVE_PICKER_QUERY,
  });
  const groups: MyOauthGroup[] = Array.isArray(groupsQ.data) ? groupsQ.data : [];
  const groupsErr = groupsQ.data && isTeamFetchError(groupsQ.data) ? groupsQ.data : undefined;

  // R34 前置防呆: only groups whose declared provider matches the picked provider
  // (an openai account can't go into a Claude pool). Fallback: older servers send
  // no provider_code → show all (the AttachAccount gate still enforces).
  const filteredGroups = useMemo(() => groups.filter((g) => !g.provider_code || g.provider_code === providerCode), [groups, providerCode]);
  // Default to the first filtered group; if the current pick fell out of the set
  // (provider just changed), snap back to the first match.
  const selectedGroup = filteredGroups.some((g) => g.oauth_group_id === groupID) ? groupID : filteredGroups[0]?.oauth_group_id || '';

  const addMut = useMutation({
    mutationFn: () =>
      addOauthAccount({
        // Send the provider CODE — the backend resolves it to the provider_id.
        provider_id: providerCode,
        login_email: email.trim(),
        password,
        oauth_group_id: selectedGroup,
      }),
    onSuccess: (res) => {
      // TeamWriteError (domain) → show the server's precise reason; TeamFetchError
      // (transport) → generic. Success → close + refresh the list.
      if (isTeamWriteError(res)) {
        setErr(res.message || t('oauthContribute.addErrGeneric'));
        return;
      }
      if (isTeamFetchError(res)) {
        setErr(t('oauthContribute.addErrGeneric'));
        return;
      }
      onAdded();
    },
  });

  const canSubmit = !!email.trim() && !!password && !!selectedGroup && !addMut.isPending;

  // ModalPortal (2026-07-08 bugfix): rendered inline, this modal sat as a
  // DIRECT CHILD of the page's `space-y-5` container — Tailwind's sibling
  // rule applies margin-top to position:fixed boxes too, shoving the mask
  // 20px down (uncovered strip at the top). scopeClassName="vault-page" is
  // REQUIRED, not decorative: this page's card / input / button styles are
  // scoped under `.vault-page ...` in KEYS_PAGE_CSS, and the portal moves
  // the modal out of the page wrapper (without it the modal renders
  // unstyled — transparent card, UA-default white inputs; regression caught
  // by user 2026-07-08). Full background: shared/ui/ModalShell.tsx docstring.
  return (
    <ModalPortal scopeClassName="vault-page">
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(var(--scrim-rgb), 0.5)' }} onClick={onClose}>
        <div
          className="card w-[440px] max-w-[92vw] p-5 space-y-4"
          style={{ background: 'var(--surface-1)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-bold font-mono tracking-wide" style={{ color: 'var(--display-foreground)' }}>
                {t('oauthContribute.addTitle')}
              </div>
              <div className="text-[11px] font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
                {t('oauthContribute.addSubtitle')}
              </div>
            </div>
            {/* Header close X (2026-07-08, user request): overlay-click and the
              footer Cancel both exist but are invisible affordances — the X
              matches the master dialogs' pattern (bindings / packs). */}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('oauthContribute.addClose')}
              className="flex-shrink-0 mt-0.5"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Provider picker (R34 codex pools): which provider this account belongs
            to. The server enforces one-provider-per-group; picking the wrong one
            surfaces the server's mixed-provider error on submit. */}
          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
              {t('oauthContribute.addProviderLabel')}
            </span>
            <select className="w-full px-3 py-2 text-sm" value={providerCode} onChange={(e) => setProviderCode(e.target.value)}>
              {ADDABLE_PROVIDERS.map((p) => (
                <option key={p.code} value={p.code}>
                  {t(p.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
              {t('oauthContribute.addEmailLabel')}
            </span>
            <input
              type="email"
              className="w-full px-3 py-2 text-sm"
              placeholder={t('oauthContribute.addEmailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
              {t('oauthContribute.addPasswordLabel')}
            </span>
            <input
              type="password"
              className="w-full px-3 py-2 text-sm"
              placeholder={t('oauthContribute.addPasswordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
              {t('oauthContribute.addGroupLabel')}
            </span>
            {groupsQ.isLoading ? (
              <div className="text-[11px] font-mono py-2" style={{ color: 'var(--muted-foreground)' }}>
                {t('oauthContribute.addGroupsLoading')}
              </div>
            ) : groupsErr ? (
              // A LOAD failure (500 / transport) must NOT be shown as "you haven't
              // joined any pool" — that masked a real server error (e.g. the
              // GroupsForSeats column-count bug) and sent people to the wrong fix.
              // Surface it as a distinct load error so the actual problem is visible.
              <div className="text-[11px] font-mono py-2" style={{ color: 'var(--destructive-text-soft)' }}>
                {t('oauthContribute.addGroupsLoadFailed')}
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="text-[11px] font-mono py-2" style={{ color: '#facc15' }}>
                {/* Genuinely no matching group: none joined at all, or none for the
                  picked provider (e.g. joined only Claude pools but picked Codex). */}
                {groups.length === 0 ? t('oauthContribute.addNoGroups') : t('oauthContribute.addNoGroupsForProvider')}
              </div>
            ) : (
              <select className="w-full px-3 py-2 text-sm" value={selectedGroup} onChange={(e) => setGroupID(e.target.value)}>
                {filteredGroups.map((g) => (
                  <option key={g.oauth_group_id} value={g.oauth_group_id}>
                    {g.alias || g.oauth_group_id}
                    {g.is_default ? ` (${t('oauthContribute.defaultGroupTag')})` : ''}
                  </option>
                ))}
              </select>
            )}
          </label>

          {/* ToS note — advisory, not a blocker (R24). */}
          <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.8 }}>
            {t('oauthContribute.addTos')}
          </p>

          {err && (
            <p className="text-[11px]" style={{ color: 'var(--destructive-text-soft)' }}>
              {err}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              className="text-[11px]"
              style={{ color: 'var(--muted-foreground)' }}
              onClick={onClose}
              disabled={addMut.isPending}
            >
              {t('oauthContribute.cancel')}
            </button>
            <button
              type="button"
              className="row-use-btn"
              onClick={() => {
                setErr('');
                addMut.mutate();
              }}
              disabled={!canSubmit}
            >
              <PlusIcon className="w-3 h-3" />
              {addMut.isPending ? t('oauthContribute.adding') : t('oauthContribute.addSubmit')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function EmptyState({
  message,
  tone,
  compact,
  onRetry,
  retryLabel,
}: {
  message: string;
  tone?: 'error';
  /** ~3-text-lines tall instead of the roomy default (2026-07-29 user
   *  request: a per-pool empty notice shouldn't occupy a full panel). */
  compact?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const isError = tone === 'error';
  return (
    <div
      role={isError ? 'alert' : undefined}
      aria-live={isError ? 'assertive' : undefined}
      className={`text-center px-4 ${compact ? 'py-5' : 'py-16'}`}
      style={
        isError
          ? {
              color: 'var(--destructive-text-soft)',
              background: 'rgba(var(--destructive-rgb), 0.08)',
              border: '1px solid rgba(var(--destructive-rgb), 0.38)',
            }
          : { color: 'var(--muted-foreground)' }
      }
    >
      <div className="text-[12px] font-mono">{message}</div>
      {onRetry && retryLabel && (
        <button type="button" className="row-use-btn mt-3" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
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
const ICON_SHARE =
  'M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z';
const ICON_SEARCH = 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z';
const ICON_EYE =
  'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z';
const ICON_EYE_OFF =
  'M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88';
const ICON_ZAP = 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z';
const ICON_COPY =
  'M16.5 8.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v8.25A2.25 2.25 0 006 16.5h2.25m8.25-8.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-7.5A2.25 2.25 0 018.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 00-2.25 2.25v6';
const ICON_CHECK = 'M4.5 12.75l6 6 9-13.5';
const ICON_PLUS = 'M12 4.5v15m7.5-7.5h-15';
const ICON_X = 'M6 18L18 6M6 6l12 12';
const ICON_INFO =
  'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z';

function ShareIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_SHARE} {...p} />;
}
function SearchIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_SEARCH} {...p} />;
}
function EyeIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_EYE} {...p} />;
}
function EyeOffIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_EYE_OFF} {...p} />;
}
function ZapIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_ZAP} {...p} />;
}
function CopyIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_COPY} {...p} />;
}
function CheckIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_CHECK} {...p} />;
}
function PlusIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_PLUS} {...p} />;
}
function XIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_X} {...p} />;
}
function InfoIcon(p: { className?: string; style?: React.CSSProperties }) {
  return <SvgIcon d={ICON_INFO} {...p} />;
}

/** CopyBtn copies `value` to the clipboard (HTTP-safe via copyText) and shows a
 * 1.5s green check. Renders nothing when value is empty, so the password copy
 * button is absent until the secret is revealed. */
function CopyBtn({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="icon-btn"
      title={copied ? t('oauthContribute.copied') : label}
      onClick={() => {
        copyText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--success-text)' }} /> : <CopyIcon className="w-3.5 h-3.5" />}
    </button>
  );
}
