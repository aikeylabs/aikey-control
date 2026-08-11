/**
 * Access Token — /user/access-tokens  (alpha.5 online-agent, member self-service)
 *
 * The agents this member owns (parent = my seat). A member creates an agent,
 * points a third-party agent product at its base_url + team OAuth VK, and the
 * agent borrows the member's own OAuth token. Two-pool model: an agent draws
 * from the member's OWN agent pool by default (company pools are an advanced
 * path); see the Create Agent flow.
 *
 * This is the list + create + disable surface. The full "fuel the agent"
 * wizard (add accounts / log in / connectivity self-check) enriches the create
 * modal in a follow-up; this MVP creates against the member's own pool.
 */
import { useState } from 'react';
import { PageTitleRow } from '@/shared/ui/PageHeader';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userAccountsApi, type AgentRoutingSummaryDTO, type MyAgentDTO } from '@/shared/api/user/accounts';
import { ToolGlyph, toolGlyphLabel } from '@/shared/ui/ToolGlyph';
import { DetailDrawer } from '@/shared/ui/DetailDrawer';
import { ModalPortal } from '@/shared/ui/ModalShell';
import { copyText } from '@/shared/utils/clipboard';
import { formatDate, formatDateTime, formatRelativeTime } from '@/shared/utils/datetime-intl';
// Shared keys-family table skin (same one virtual-keys / team-oauth / vault
// inject): mono uppercase thead, row rhythm, borders. Scoped under
// `.vault-page` + `table.vault`, so injecting it is inert until both classes
// are applied. Reusing it (2026-07-18 user request: align this table header
// with /user/virtual-keys) instead of hand-copying the values keeps a single
// source of truth for the keys-page table look.
import { KEYS_PAGE_CSS } from '../_shared/keys-page-css';
import { KindGlyph } from '../_shared/tool-glyph';
import { PoolAccountList } from '../_shared/PoolAccountList';

// statusLabel maps a seat status to the SAME words the card-header chips use
// (启用中 / 停用 / 已吊销). Before 2026-07-31 the cell printed the raw backend
// string, which was tolerable only because `suspended` was unreachable for
// agents — the "停用" button revoked instead of suspending. Now that pausing is
// real, an untranslated "suspended" would sit in a Chinese UI right next to a
// chip already calling that state 停用 (统一名词字典).
function statusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case 'active': return t('accessTokens.status.active');
    case 'suspended': return t('accessTokens.status.suspended');
    case 'revoked': return t('accessTokens.status.revoked');
    default: return status; // unknown future status: show it rather than hide it
  }
}

function routingStateLabel(summary: AgentRoutingSummaryDTO | undefined, t: (key: string) => string): string {
  switch (summary?.state) {
    case 'bound': return t('accessTokens.routing.bound');
    case 'binding_pending': return t('accessTokens.routing.bindingPending');
    case 'unbound': return t('accessTokens.routing.unbound');
    case 'binding_stale': return t('accessTokens.routing.bindingStale');
    case 'source_unavailable': return t('accessTokens.routing.sourceUnavailable');
    default: return t('accessTokens.routing.unavailable');
  }
}

function RoutingCell({ agent, onOpen }: { agent: MyAgentDTO; onOpen: () => void }) {
  const { t } = useTranslation();
  const summary = agent.routing_summary;
  const label = summary?.state === 'bound'
    ? (summary.identity || summary.account_id || routingStateLabel(summary, t))
    : routingStateLabel(summary, t);
  return (
    <button
      type="button"
      className="row-use-btn max-w-[220px] truncate"
      onClick={onOpen}
      title={t('accessTokens.routing.openTitle', { account: label })}
    >
      {label}
    </button>
  );
}

function AgentRoutingDrawer({ agent, onClose }: { agent: MyAgentDTO | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeErr, setRevokeErr] = useState('');
  const poolQuery = useQuery({
    queryKey: ['my-agent-pool-status', agent?.seat_id],
    queryFn: () => userAccountsApi.agentPoolStatus(agent!.seat_id),
    enabled: Boolean(agent?.seat_id),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: agent?.seat_id ? 5_000 : false,
  });
  const latestQuery = useQuery({
    queryKey: ['my-agent-last-route', agent?.seat_id],
    queryFn: () => userAccountsApi.agentLastRoute(agent!.seat_id),
    enabled: Boolean(agent?.seat_id),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const lastRoute = latestQuery.data?.last_served;
  const runtime = poolQuery.data?.runtime;
  const binding = poolQuery.data?.binding ?? agent?.routing_summary;
  const bindingLabel = binding?.state === 'bound'
    ? (binding.identity || binding.account_id || t('accessTokens.routing.bound'))
    : routingStateLabel(binding, t);
  const lastLabel = lastRoute?.identity || lastRoute?.account_id;
  const diverged = Boolean(
    binding?.state === 'bound'
      && binding.account_id
      && lastRoute?.account_id
      && binding.account_id !== lastRoute.account_id,
  );

  // Do not leave off-screen drawer controls in the tab order when closed.
  if (!agent) return null;

  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={t('accessTokens.routing.drawerTitle', { name: agent?.alias ?? '' })}
      subtitle={t('accessTokens.routing.drawerSubtitle')}
    >
      {/* DetailDrawer portals to document.body, outside the page-level
          .vault-page scope. Re-establish that shared skin scope here so the
          canonical PoolAccountList, cards, chips, and actions render exactly
          as they do on Team Keys without duplicating any CSS. */}
      <div className="vault-page space-y-5 font-mono">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.routing.ingressBinding')}</p>
            <p className="mt-2 text-sm break-all" style={{ color: 'var(--foreground)' }}>{bindingLabel}</p>
            {binding?.binding_updated_at ? (
              <p className="mt-1 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                {t('accessTokens.routing.bindingUpdated', { time: formatDateTime(binding.binding_updated_at * 1000) })}
              </p>
            ) : null}
          </div>
          <div className="card p-4">
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.routing.lastServed')}</p>
            <p className="mt-2 text-sm break-all" style={{ color: 'var(--foreground)' }}>
              {latestQuery.isLoading
                ? t('accessTokens.routing.loading')
                : latestQuery.isError || latestQuery.data?.state === 'unavailable'
                  ? t('accessTokens.routing.lastUnavailable')
                  : lastLabel || t('accessTokens.routing.noRequests')}
            </p>
            {lastRoute?.request_at_ms ? (
              <p className="mt-1 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                {t('accessTokens.routing.lastRequestAt', { time: formatDateTime(lastRoute.request_at_ms) })}
              </p>
            ) : null}
          </div>
        </section>

        <section className="card p-4" aria-label={t('accessTokens.routing.runtimeScheduling')}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.routing.runtimeScheduling')}</p>
              <p className="mt-2 text-sm" style={{ color: runtime?.state === 'available' && runtime.schedulable_accounts === 0 ? '#fbbf24' : 'var(--foreground)' }}>
                {poolQuery.isLoading
                  ? t('accessTokens.routing.loading')
                  : runtime?.state === 'available'
                    ? t('accessTokens.routing.runtimeCount', { ready: runtime.schedulable_accounts, total: runtime.total_accounts })
                    : runtime?.state === 'not_reported'
                      ? t('accessTokens.routing.runtimeNotReported')
                      : t('accessTokens.routing.runtimeUnavailable')}
              </p>
              {runtime?.state === 'available' && runtime.earliest_retry_at ? (
                <p className="mt-1 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                  {t('accessTokens.routing.runtimeEarliestRetry', {
                    time: formatRelativeTime(runtime.earliest_retry_at * 1000) || formatDateTime(runtime.earliest_retry_at * 1000),
                  })}
                </p>
              ) : null}
            </div>
            {runtime?.node_id ? <span className="chip">{runtime.node_id}</span> : null}
          </div>
          {runtime?.updated_at ? (
            <p className="mt-2 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
              {t('accessTokens.routing.runtimeUpdated', { time: formatRelativeTime(runtime.updated_at * 1000) || formatDateTime(runtime.updated_at * 1000) })}
            </p>
          ) : null}
        </section>

        {diverged && (
          <div role="status" className="rounded px-3 py-2 text-xs" style={{ color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.07)' }}>
            {t('accessTokens.routing.failoverNotice')}
          </div>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>{t('accessTokens.routing.poolAccounts')}</h3>
              <p className="mt-1 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.routing.poolAccountsHint')}</p>
            </div>
            <Link
              to={agent?.source.oauth_group_id ? `/user/team-oauth?group=${encodeURIComponent(agent.source.oauth_group_id)}` : '/user/team-oauth'}
              className="row-use-btn whitespace-nowrap"
              onClick={onClose}
            >
              {t('accessTokens.routing.manageAccounts')}
            </Link>
          </div>

          {poolQuery.isLoading && <div className="card p-4 text-xs" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.routing.loading')}</div>}
          {poolQuery.isError && (
            <div role="alert" className="card p-4 text-xs" style={{ color: '#fca5a5' }}>
              <p>{t('accessTokens.routing.poolLoadError')}</p>
              <button type="button" className="row-use-btn mt-3" onClick={() => void poolQuery.refetch()}>{t('accessTokens.retry')}</button>
            </div>
          )}
          {poolQuery.data?.accounts_state === 'unavailable' && (
            <div role="alert" className="card p-4 text-xs" style={{ color: '#fca5a5' }}>
              <p>{t('accessTokens.routing.poolLoadError')}</p>
              <button type="button" className="row-use-btn mt-3" onClick={() => void poolQuery.refetch()}>{t('accessTokens.retry')}</button>
            </div>
          )}
          {poolQuery.data?.accounts_state !== 'unavailable' && poolQuery.data && poolQuery.data.accounts.length === 0 && (
            <div className="card p-4 text-xs" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.routing.emptyPool')}</div>
          )}
          {poolQuery.data?.accounts_state !== 'unavailable' && poolQuery.data && poolQuery.data.accounts.length > 0 && (
            <PoolAccountList
              accounts={poolQuery.data.accounts}
              selection={{
                primaryAccountId: binding?.state === 'bound' ? binding.account_id : undefined,
                primaryLabel: t('accessTokens.routing.ingressBindingBadge'),
                secondaryAccountId: lastRoute?.account_id,
                secondaryLabel: t('accessTokens.routing.lastServedBadge'),
                showDefaultBadge: false,
              }}
              showRemaining
            />
          )}
        </section>

        {/* Revoke — the ONLY member-side way to free a slot against
            agent_limit_per_member. 停用 deliberately keeps consuming the quota
            (OA5b: if it freed the slot, a member could suspend five, create five,
            and then be unable to resume any of the old ones). Before 2026-08-10
            the member console had no revoke entry at all, so a member at the cap
            was stuck: the only button available was 停用, which changes nothing
            about the count, while the error told them to "remove an agent".

            🔴 In the DRAWER, not the row (user decision 2026-08-10): this is
            terminal and unsafe — a row button sits one mis-click from 停用. */}
        {agent.status !== 'revoked' && (
          <section className="card p-4" style={{ borderColor: 'rgba(239,68,68,0.35)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: '#f87171' }}>
              {t('accessTokens.revoke.sectionTitle')}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
              {t('accessTokens.revoke.explain')}
            </p>
            {revokeErr && (
              <div role="alert" className="mt-2 text-[10px] rounded px-2 py-1" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }}>
                {revokeErr}
              </div>
            )}
            <button
              type="button"
              onClick={() => setConfirmRevoke(true)}
              disabled={revoking}
              className="mt-3 text-[10px] font-mono px-2.5 py-1 rounded border disabled:opacity-40"
              style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.06)' }}
            >
              {revoking ? t('accessTokens.revoke.busy') : t('accessTokens.revoke.button')}
            </button>
          </section>
        )}
      </div>

      {confirmRevoke && agent && (
        <RevokeConfirmModal
          agent={agent}
          busy={revoking}
          onClose={() => setConfirmRevoke(false)}
          onConfirm={async () => {
            setRevoking(true);
            try {
              await userAccountsApi.deleteAgent(agent.seat_id);
              qc.invalidateQueries({ queryKey: ['my-agents'] });
              setConfirmRevoke(false);
              onClose();
            } catch (e) {
              setRevokeErr(e instanceof Error ? e.message : t('accessTokens.actionFailed'));
              setConfirmRevoke(false);
            } finally {
              setRevoking(false);
            }
          }}
        />
      )}
    </DetailDrawer>
  );
}

function sourceBadge(src: MyAgentDTO['source'], t: (k: string) => string) {
  const isApiKey = src.type === 'api_key';
  return (
    <span className="inline-flex items-center gap-1.5">
      {/* Kind glyph instead of the OAUTH/API-KEY text badge (2026-08-01 user
          request): key = API key material, fingerprint = OAuth — the same
          colorless icon language as the vault/virtual-keys kind tiles. The
          wording moves to the tooltip. */}
      <span className="kind-tile" title={isApiKey ? 'API-KEY' : 'OAUTH'}>
        <KindGlyph kind={isApiKey ? 'key' : 'oauth'} />
      </span>
      <span style={{ color: 'var(--muted-foreground)' }}>{src.name || (src.owner_pool ? t('accessTokens.myPool') : '—')}</span>
    </span>
  );
}

function readinessStatus(agent: MyAgentDTO): 'ready' | 'no_login' | 'degraded' {
  // Compatibility with a pre-readiness master: preserve the old pool_empty
  // warning and otherwise avoid claiming ready without server evidence.
  return agent.pool_readiness || (agent.pool_empty ? 'no_login' : 'degraded');
}

function readinessMessageKey(agent: MyAgentDTO): string {
  if (agent.pool_readiness_reason === 'read_failed' || agent.pool_readiness_reason === 'source_unavailable') {
    return 'accessTokens.readiness.readFailedDetail';
  }
  if (agent.pool_readiness_reason === 'pool_disabled') return 'accessTokens.readiness.disabledDetail';
  if ((agent.pool_accounts_total ?? 0) === 0) return 'accessTokens.readiness.emptyDetail';
  if (readinessStatus(agent) === 'no_login') return 'accessTokens.readiness.noLoginDetail';
  if (readinessStatus(agent) === 'degraded') return 'accessTokens.readiness.degradedDetail';
  return 'accessTokens.readiness.readyDetail';
}

function readinessLabel(status: 'ready' | 'no_login' | 'degraded', t: (key: string) => string): string {
  if (status === 'ready') return t('accessTokens.readiness.ready');
  if (status === 'no_login') return t('accessTokens.readiness.no_login');
  return t('accessTokens.readiness.degraded');
}

function PoolReadinessBadge({ agent, linkToOauth }: { agent: MyAgentDTO; linkToOauth?: boolean }) {
  const { t } = useTranslation();
  const status = readinessStatus(agent);
  const color = status === 'ready' ? '#4ade80' : status === 'no_login' ? '#f59e0b' : '#fb923c';
  const bg = status === 'ready' ? 'rgba(74,222,128,0.07)' : status === 'no_login' ? 'rgba(245,158,11,0.08)' : 'rgba(251,146,60,0.08)';
  const symbol = status === 'ready' ? '✓' : status === 'no_login' ? '!' : '△';
  const chip = (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold"
      style={{ color, background: bg, border: `1px solid ${color}55` }}
    >
      <span aria-hidden="true">{symbol}</span>
      {readinessLabel(status, t)}
    </span>
  );
  return (
    <div className="space-y-1" title={t(readinessMessageKey(agent), { ready: agent.pool_accounts_ready ?? 0, total: agent.pool_accounts_total ?? 0 })}>
      {/* 2026-07-22 (user): the "待登录" (no_login) chip is a shortcut to Team OAuth
          login. Only linkified in the list (linkToOauth); the create-modal reuse
          stays a plain badge. */}
      {linkToOauth && status === 'no_login' ? (
        // Deep-link with the agent's pool id so Team OAuth lands filtered to
        // THIS agent-pool's accounts (removable chip there). Falls back to the
        // plain page when the source carries no group id. (2026-07-22)
        <Link
          to={agent.source?.oauth_group_id
            ? `/user/team-oauth?group=${encodeURIComponent(agent.source.oauth_group_id)}`
            : '/user/team-oauth'}
          className="inline-block"
          style={{ textDecoration: 'none' }}
        >{chip}</Link>
      ) : (
        chip
      )}
      <div className="text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
        {t('accessTokens.readiness.count', { ready: agent.pool_accounts_ready ?? 0, total: agent.pool_accounts_total ?? 0 })}
      </div>
    </div>
  );
}

function PoolReadinessAlert({ agent }: { agent: MyAgentDTO }) {
  const { t } = useTranslation();
  const status = readinessStatus(agent);
  if (status === 'ready') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-[10px] font-mono px-3 py-2 rounded space-y-1"
      style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b' }}
    >
      <p>
        <strong>{readinessLabel(status, t)}：</strong>{' '}
        {t(readinessMessageKey(agent), { ready: agent.pool_accounts_ready ?? 0, total: agent.pool_accounts_total ?? 0 })}
      </p>
      <Link to="/user/team-oauth" className="inline-block font-bold" style={{ color: '#f59e0b', textDecoration: 'underline' }}>
        {t('accessTokens.create.vkPendingCta')}
      </Link>
    </div>
  );
}

function SelfCheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 text-[10px] font-mono">
      <span aria-hidden="true" style={{ color: ok ? '#4ade80' : '#f59e0b' }}>{ok ? '✓' : '!'}</span>
      <div>
        <div className="font-bold" style={{ color: ok ? '#4ade80' : '#f59e0b' }}>{label}</div>
        <div style={{ color: 'var(--muted-foreground)' }}>{detail}</div>
      </div>
    </div>
  );
}

function ConnectionSelfCheck({ agent }: { agent: MyAgentDTO }) {
  const { t } = useTranslation();
  const baseReady = !agent.base_url_blocked && !!agent.base_url;
  const vkReady = !agent.vk_pending && !!(agent.vk || agent.vk_hint);
  const poolReady = readinessStatus(agent) === 'ready';
  return (
    <div className="rounded px-3 py-3 space-y-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
        {t('accessTokens.create.selfCheckTitle')}
      </div>
      <SelfCheckRow ok={baseReady} label={t('accessTokens.create.selfCheckBase')} detail={baseReady ? t('accessTokens.create.selfCheckPassed') : t('accessTokens.create.baseUrlBlocked')} />
      <SelfCheckRow ok={vkReady} label={t('accessTokens.create.selfCheckVK')} detail={vkReady ? t('accessTokens.create.selfCheckPassed') : t('accessTokens.create.selfCheckVKPending')} />
      <SelfCheckRow
        ok={poolReady}
        label={t('accessTokens.create.selfCheckPool')}
        detail={t(readinessMessageKey(agent), { ready: agent.pool_accounts_ready ?? 0, total: agent.pool_accounts_total ?? 0 })}
      />
    </div>
  );
}

// ── Copyable connection field (base_url / VK) with reveal-once eye ─────────────

// Reveal toggle — lucide "eye" / "eye-off" inlined, matching this app's icon
// convention (no icon-library dependency; see UserShell's nav glyphs). Replaces
// the 👁/🙈 emoji, which rendered as a monkey face and matched no other control
// (user feedback 2026-07-28). Kept byte-identical to the master console's twin
// in aikey-control-master/web/src/pages/master/orgs/agents/index.tsx so the two
// consoles cannot drift.
function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.06 12.35a1 1 0 010-.7 10.75 10.75 0 0119.88 0 1 1 0 010 .7 10.75 10.75 0 01-19.88 0z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.73 5.08a10.74 10.74 0 0111.21 6.57 1 1 0 010 .7 10.75 10.75 0 01-1.45 2.49" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.08 14.16a3 3 0 01-4.24-4.24" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.48 17.5a10.75 10.75 0 01-15.42-5.15 1 1 0 010-.7 10.75 10.75 0 014.45-5.14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 2l20 20" />
    </svg>
  );
}

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const shown = revealed ? value : value.replace(/./g, '•').slice(0, 40);
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-2 text-xs rounded truncate" style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>{shown}</code>
        {secret && (
          <button
            onClick={() => setRevealed(r => !r)}
            title={revealed ? t('accessTokens.hide') : t('accessTokens.reveal')}
            aria-label={revealed ? t('accessTokens.hide') : t('accessTokens.reveal')}
            className="inline-flex items-center justify-center p-2 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
        <button
          onClick={() => { copyText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          className="text-[10px] font-mono px-2.5 py-2 rounded border whitespace-nowrap"
          style={{ borderColor: copied ? 'rgba(74,222,128,0.4)' : 'var(--border)', color: copied ? '#4ade80' : 'var(--muted-foreground)' }}
        >
          {copied ? t('accessTokens.copied') : t('accessTokens.copy')}
        </button>
      </div>
    </div>
  );
}

// ── Connection reveal (base_url + VK) — reused by create step-2 AND the list
//    "Get VK" rotate modal, so the reveal-once surface is defined once. onGetVK
//    (when set) renders a "get my VK now" button on the vk_pending state — the
//    member clicks it after adding + logging in a pool account to mint/rotate a
//    fresh VK without re-creating the agent. ──
function ConnectionReveal({ agent, onGetVK, gettingVK, onNavigate }: {
  agent: MyAgentDTO; onGetVK?: () => void; gettingVK?: boolean; onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {agent.base_url_blocked ? (
        <div className="text-[10px] font-mono px-3 py-2 rounded" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
          {t('accessTokens.create.baseUrlBlocked')}
        </div>
      ) : (
        <CopyField label={t('accessTokens.create.baseUrlLabel')} value={agent.base_url ?? ''} />
      )}
      {agent.vk_pending ? (
        <div className="text-[10px] font-mono px-3 py-2 rounded space-y-2" style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', color: '#60a5fa' }}>
          <p>{t('accessTokens.create.vkPending')}</p>
          {/* Reuse the canonical add-account + login surface (Team OAuth pool-login)
              instead of duplicating it here. After adding an account, click "Get my
              VK" (below, or on the agent row in the list) to mint + reveal it. */}
          <Link to="/user/team-oauth" onClick={onNavigate} className="inline-block font-bold" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
            {t('accessTokens.create.vkPendingCta')}
          </Link>
          {onGetVK && (
            <div>
              <button onClick={onGetVK} disabled={gettingVK} className="mt-1 text-[10px] font-mono px-2.5 py-1 rounded border disabled:opacity-40" style={{ color: '#60a5fa', borderColor: 'rgba(96,165,250,0.4)' }}>
                {gettingVK ? t('accessTokens.vk.getting') : t('accessTokens.vk.getNow')}
              </button>
            </div>
          )}
        </div>
      ) : agent.vk ? (
        <>
          <CopyField label={t('accessTokens.create.vkLabel')} value={agent.vk} secret />
          {/* 2026-08-10: this used to warn "shown only once — it cannot be
              retrieved later". That became FALSE when the member gained the
              reveal path: agent VKs are minted with encrypted retention, so this
              value is re-readable via 获取 VK. Telling a user to panic-copy a key
              they can re-open is the kind of copy that trains them to distrust
              the UI, so it says what is actually true. */}
          <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.vk.revealedNote')}</p>
        </>
      ) : (
        /* Nothing revealable: an active VK exists but predates encrypted
           retention, so its plaintext genuinely does not exist anywhere. Show the
           mask for identification; Rotate is the only path to a value that can be
           displayed from then on. The old key keeps working until they rotate. */
        <div className="space-y-2">
          {agent.vk_hint ? (
            <div className="space-y-1">
              <label className="block text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.vk.hintLabel')}</label>
              <code className="block px-3 py-2 text-xs rounded truncate" style={{ background: 'var(--muted)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>{agent.vk_hint}</code>
            </div>
          ) : (
            /* Pre-alpha.5 VK: issued before token_hint was populated, so there is
               not even a mask. Without this branch the modal is a dead end —
               2026-07-28 real-machine finding on staging (1 of 3 agent VKs had an
               empty hint); the master console already carries the same branch. */
            <div className="text-[10px] font-mono px-3 py-2 rounded leading-relaxed" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
              {t('accessTokens.vk.noHint')}
            </div>
          )}
          <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.vk.existingHint')}</p>
        </div>
      )}
      {/* A minted VK does not imply the source pool can serve. Keep the
          availability warning beside the connection material; login remains
          non-blocking and is repaired on the canonical Team OAuth page. */}
      {!agent.vk_pending && <PoolReadinessAlert agent={agent} />}
    </div>
  );
}

// ── Get / rotate VK modal (list row) — the recovery for a VK whose plaintext was
//    never captured (empty-pool create) or is lost. Rotating re-mints the token,
//    so this always yields a fresh usable VK (reveal-once). ──
function VKRevealModal({ agent, onClose }: { agent: MyAgentDTO; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>{t('accessTokens.vk.title', { name: agent.alias })}</h3>
          <button onClick={onClose} style={{ color: 'var(--muted-foreground)' }}>✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.vk.hint')}</p>
          <ConnectionReveal agent={agent} onNavigate={onClose} />
        </div>
        <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="btn btn-primary text-xs px-6 py-2">{t('accessTokens.create.done')}</button>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── Create Agent (two-step: name → connection reveal) ─────────────────────────

function CreateAgentModal({ open, onClose, agents }: { open: boolean; onClose: () => void; agents: MyAgentDTO[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [alias, setAlias] = useState('');
  // Provider choice (2026-07-18, user requirement "新建 Agent 支持选协议"): drives
  // WHICH per-provider agent pool the server auto-provisions/attaches (R34 one
  // provider per pool — a claude and a codex agent live in separate pools).
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<MyAgentDTO | null>(null);
  const [gettingVK, setGettingVK] = useState(false);
  const existingProviderPool = agents.find((agent) =>
    agent.source.owner_pool && (agent.source.provider_code || 'anthropic') === provider,
  );

  function reset() {
    setAlias(''); setErr(null); setCreated(null); setSubmitting(false); setGettingVK(false);
  }

  async function getVK() {
    if (!created) return;
    setGettingVK(true);
    try {
      // ensure (non-destructive): first-issues if the pool now has an account,
      // else stays pending — never rotates an already-issued VK.
      const r = await userAccountsApi.getAgentVK(created.seat_id);
      setErr(null);
      setCreated(r); // reveals the VK inline (or stays pending if the pool is still empty)
      qc.invalidateQueries({ queryKey: ['my-agents'] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('accessTokens.create.getVKFailed'));
    } finally {
      setGettingVK(false);
    }
  }
  function close() { reset(); onClose(); }

  async function submit() {
    const name = alias.trim();
    if (!name) return;
    setSubmitting(true);
    setErr(null);
    try {
      // Omit oauth_group_id → the server attaches the agent to the member's own
      // per-provider agent pool (auto-provisioned on first agent of this provider).
      const agent = await userAccountsApi.createAgent({ alias: name, provider_code: provider });
      qc.invalidateQueries({ queryKey: ['my-agents'] });
      setCreated(agent); // → step 2: reveal base_url + VK
    } catch (e) {
      const anyE = e as { response?: { data?: { message?: string; error?: string } } };
      setErr(anyE.response?.data?.message || anyE.response?.data?.error || (e instanceof Error ? e.message : t('accessTokens.create.failed')));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={!submitting ? close : undefined} />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
            {created ? t('accessTokens.create.titleCreated') : t('accessTokens.create.titleNew')}
          </h3>
          <button onClick={close} disabled={submitting} style={{ color: 'var(--muted-foreground)' }}>✕</button>
        </div>

        {!created ? (
          <>
            <div className="px-6 py-5 space-y-3">
              <label className="block text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.create.providerLabel')}</label>
              <div className="flex gap-2">
                {([['anthropic', 'Claude'], ['openai', 'Codex']] as const).map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setProvider(code)}
                    disabled={submitting}
                    className="px-3 py-1.5 text-xs font-mono font-bold rounded border"
                    style={provider === code
                      ? { borderColor: '#60a5fa', color: '#60a5fa', background: 'rgba(96,165,250,0.08)' }
                      : { borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                role="status"
                className="rounded px-3 py-2 space-y-1"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}
              >
                <div className="text-[10px] font-mono font-bold" style={{ color: 'var(--foreground)' }}>
                  {t('accessTokens.create.preflightTitle')}
                </div>
                {existingProviderPool ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {t(readinessMessageKey(existingProviderPool), {
                        ready: existingProviderPool.pool_accounts_ready ?? 0,
                        total: existingProviderPool.pool_accounts_total ?? 0,
                      })}
                    </p>
                    <PoolReadinessBadge agent={existingProviderPool} />
                  </div>
                ) : (
                  <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                    {t('accessTokens.create.preflightNewPool')}
                  </p>
                )}
                <p className="text-[9px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                  {t('accessTokens.create.preflightNonBlocking')}
                </p>
              </div>
              <label className="block text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.create.nameLabel')}</label>
              <input className="w-full px-3 py-2 text-sm" placeholder="my-research-agent" value={alias} onChange={e => setAlias(e.target.value)} disabled={submitting} />
              <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                {t('accessTokens.create.hint')}
              </p>
              {err && (
                <div role="alert" aria-live="assertive" className="text-[10px] font-mono px-3 py-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>{err}</div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={close} className="px-4 py-2 text-xs font-mono font-bold rounded border" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>{t('accessTokens.create.cancel')}</button>
              <button onClick={submit} disabled={!alias.trim() || submitting} className="btn btn-primary text-xs px-4 py-2 disabled:opacity-40">
                {submitting ? t('accessTokens.create.submitting') : t('accessTokens.create.submit')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                {t('accessTokens.create.connHint')}
              </p>
              <ConnectionReveal agent={created} onNavigate={close} onGetVK={getVK} gettingVK={gettingVK} />
              <ConnectionSelfCheck agent={created} />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={close} className="btn btn-primary text-xs px-6 py-2">{t('accessTokens.create.done')}</button>
            </div>
          </>
        )}
      </div>
    </ModalPortal>
  );
}

// ── Rotate confirm (destructive) ──────────────────────────────────────────────
// Rotation is the ONE destructive VK action: it re-mints the token and instantly
// invalidates the current one. Gated behind an explicit confirm so a member can
// never lose a working VK by reflex — the reuse-first "Get VK" is non-destructive.
// Revoke is TERMINAL: seat_status goes to `revoked`, which nothing in the
// product can move back (it is also what the orphan reconcile writes, so a
// member-side "un-revoke" would let a member undo a governance action — OA5b).
// The confirmation therefore has to state all three consequences, not just ask
// "are you sure": the token stops routing immediately, the VK cannot be
// recovered (hash-only storage), and the third-party agent must be re-pointed
// at a NEW token.
function RevokeConfirmModal({ agent, busy, onConfirm, onClose }: {
  agent: MyAgentDTO; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={!busy ? onClose : undefined} />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'rgba(239,68,68,0.4)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-mono font-bold tracking-wider" style={{ color: '#f87171' }}>
            {t('accessTokens.revoke.confirmTitle', { name: agent.alias })}
          </h3>
          <button onClick={onClose} disabled={busy} style={{ color: 'var(--muted-foreground)' }}>✕</button>
        </div>
        <div className="px-6 py-5">
          <p className="text-[11px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
            {t('accessTokens.revoke.confirmBody')}
          </p>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-xs font-mono font-bold rounded border disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
            {t('accessTokens.vk.rotateConfirm.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-xs font-mono font-bold rounded border disabled:opacity-40"
            style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.1)' }}
          >
            {busy ? t('accessTokens.revoke.busy') : t('accessTokens.revoke.confirmAction')}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

function RotateConfirmModal({ agent, busy, onConfirm, onClose }: {
  agent: MyAgentDTO; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={!busy ? onClose : undefined} />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>{t('accessTokens.vk.rotateConfirm.title')}</h3>
          <button onClick={onClose} disabled={busy} style={{ color: 'var(--muted-foreground)' }}>✕</button>
        </div>
        <div className="px-6 py-5">
          <div className="text-[11px] font-mono leading-relaxed px-3 py-2 rounded" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
            {t('accessTokens.vk.rotateConfirm.body', { name: agent.alias })}
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-xs font-mono font-bold rounded border disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
            {t('accessTokens.vk.rotateConfirm.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="text-xs font-mono font-bold px-4 py-2 rounded border disabled:opacity-40"
            style={{ color: '#f59e0b', borderColor: 'rgba(245,158,11,0.5)', backgroundColor: 'rgba(245,158,11,0.1)' }}
          >
            {busy ? t('accessTokens.vk.rotating') : t('accessTokens.vk.rotateConfirm.confirm')}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── Row actions ───────────────────────────────────────────────────────────────

function AgentRowActions({ agent }: { agent: MyAgentDTO }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [getting, setGetting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [revealed, setRevealed] = useState<MyAgentDTO | null>(null);
  const [actionErr, setActionErr] = useState('');
  // Disable / Enable — the REVERSIBLE pair (2026-07-31 fix). The button used to
  // call deleteAgent, which revokes terminally: a member who clicked "停用"
  // expecting a pause silently lost the agent for good, because nothing in the
  // product could move a seat out of `revoked`. Now "停用" parks the agent
  // (suspended) and "启用" brings it back with its ORIGINAL VK still valid, so
  // the third-party agent product needs no re-keying.
  //
  // `revoked` stays terminal on purpose and has no button: it is also what the
  // orphan reconcile writes when a parent seat is removed (OA5/INV-B), so a
  // member-plane "un-revoke" would let a member undo a governance action.
  async function setStatus(action: 'suspend' | 'resume') {
    setLoading(true);
    try {
      await userAccountsApi.setAgentStatus(agent.seat_id, action);
      setActionErr('');
      qc.invalidateQueries({ queryKey: ['my-agents'] });
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : t('accessTokens.actionFailed'));
    } finally {
      setLoading(false);
    }
  }
  // Get VK — NON-destructive in every branch. Safe to click repeatedly; it can
  // never invalidate a VK already pasted into a third-party agent.
  //
  // 2026-08-10: reveal FIRST. Agent VKs are minted with encrypted retention on,
  // so the live plaintext is recoverable — before this the member's own console
  // could only show them a mask while the master console could show the value
  // (permission inversion, bugfix 2026-08-10-member-cannot-reveal-own-agent-vk).
  //
  // Fall back to ensure ONLY when there is genuinely nothing to reveal yet:
  // `vk_pending && !pool_empty` means "the pool can mint but no VK exists", i.e.
  // first issue. Reveal deliberately never mints (that invariant is fenced in
  // onlineagent/reveal_mine_test.go), so the first-issue affordance has to live
  // here rather than being folded into the server's reveal path.
  async function getVK() {
    setGetting(true);
    try {
      let r = await userAccountsApi.revealAgentVK(agent.seat_id);
      if (r.vk_pending && !r.pool_empty) {
        r = await userAccountsApi.getAgentVK(agent.seat_id);
        qc.invalidateQueries({ queryKey: ['my-agents'] }); // a first issue changes the row's hint
      }
      setRevealed(r);
      setActionErr('');
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : t('accessTokens.actionFailed'));
    } finally {
      setGetting(false);
    }
  }
  // Rotate — DESTRUCTIVE re-mint, only after explicit confirm. Reveals the new
  // plaintext once and invalidates the old key.
  async function rotate() {
    setRotating(true);
    try {
      const r = await userAccountsApi.rotateAgentVK(agent.seat_id);
      setActionErr('');
      setConfirmRotate(false);
      setRevealed(r);
      qc.invalidateQueries({ queryKey: ['my-agents'] }); // refresh the list hint
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : t('accessTokens.actionFailed'));
    } finally {
      setRotating(false);
    }
  }
  return (
    <div className="space-y-1">
      {actionErr && (
        <div role="alert" aria-live="assertive" className="max-w-[300px] whitespace-normal text-[9px] font-mono text-left rounded px-2 py-1" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }}>
          {actionErr}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
      {agent.status === 'active' && (
        <>
          <button
            onClick={getVK}
            disabled={getting}
            className="text-[10px] font-mono px-2.5 py-1 rounded border whitespace-nowrap disabled:opacity-40"
            style={{ color: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)', backgroundColor: 'rgba(96,165,250,0.06)' }}
          >
            {getting ? '...' : t('accessTokens.vk.button')}
          </button>
          <button
            onClick={() => setConfirmRotate(true)}
            disabled={rotating}
            className="text-[10px] font-mono px-2.5 py-1 rounded border whitespace-nowrap disabled:opacity-40"
            style={{ color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.06)' }}
          >
            {t('accessTokens.vk.rotate')}
          </button>
        </>
      )}
      {agent.status === 'active' && (
        <button
          onClick={() => setStatus('suspend')}
          disabled={loading}
          className="text-[10px] font-mono px-2.5 py-1 rounded border whitespace-nowrap disabled:opacity-40"
          style={{ color: '#f97316', borderColor: 'rgba(249,115,22,0.3)', backgroundColor: 'rgba(249,115,22,0.06)' }}
        >
          {loading ? '...' : t('accessTokens.disable')}
        </button>
      )}
      {agent.status === 'suspended' && (
        <button
          onClick={() => setStatus('resume')}
          disabled={loading}
          title={t('accessTokens.enableTitle')}
          className="text-[10px] font-mono px-2.5 py-1 rounded border whitespace-nowrap disabled:opacity-40"
          style={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)', backgroundColor: 'rgba(74,222,128,0.06)' }}
        >
          {loading ? '...' : t('accessTokens.enable')}
        </button>
      )}
      {/* Revoked is terminal — say so instead of showing a button that would
          fail, so the member's next step ("create a new one") is explicit
          rather than something they discover by clicking. */}
      {agent.status === 'revoked' && (
        <span className="text-[10px] font-mono whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>
          {t('accessTokens.revokedTerminal')}
        </span>
      )}
      {confirmRotate && (
        <RotateConfirmModal agent={agent} busy={rotating} onConfirm={rotate} onClose={() => setConfirmRotate(false)} />
      )}
      {revealed && <VKRevealModal agent={revealed} onClose={() => setRevealed(null)} />}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyAgentsPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [routingAgent, setRoutingAgent] = useState<MyAgentDTO | null>(null);
  const { data: agents, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-agents'],
    queryFn: userAccountsApi.myAgents,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Card-header chip counts — same strip the Team Keys card renders above its
  // thead (2026-07-18 user request: align with /user/virtual-keys). Chip
  // classes (.chip/.status-dot) come from the shared KEYS_PAGE_CSS skin.
  const counts = {
    total: agents?.length ?? 0,
    active: agents?.filter(a => a.status === 'active').length ?? 0,
    suspended: agents?.filter(a => a.status === 'suspended').length ?? 0,
    revoked: agents?.filter(a => a.status === 'revoked').length ?? 0,
  };

  return (
    <>
      {/* OUTSIDE the space-y-6 container on purpose: Tailwind's space-y-* adds
          margin-top to every child except the first, and a <style> element —
          invisible but still an element — occupied that first slot, silently
          pushing the real first row (the page title) down by an extra 24px.
          User report 2026-07-29: "Agents 页面顶部间距太大" — measured exactly
          +24px vs every PageHeader page. Keep style tags out of spacing scopes. */}
      <style>{KEYS_PAGE_CSS}</style>
      <div className="vault-page p-6 space-y-6">
      <div className="flex items-center justify-between">
        <PageTitleRow>
          <h1 className="text-lg font-mono font-bold tracking-widest" style={{ color: 'var(--foreground)' }}>{t('accessTokens.title')}</h1>
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.subtitle')}</p>
        </PageTitleRow>
        <button onClick={() => setCreateOpen(true)} className="btn btn-primary btn-primary-dim text-xs px-4 py-2">{t('accessTokens.newAgent')}</button>
      </div>

      <section className="card overflow-hidden">
        {/* Summary strip above the thead — mirrors virtual-keys' CardHeader
            (label + count chips), so the two tables read as one family. */}
        <div className="card-header flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
            <span>{t('accessTokens.cardAll')}</span>
            <span className="chip">
              <span className="status-dot idle" style={{ width: 5, height: 5 }} />
              {t('accessTokens.cardTotal', { count: counts.total })}
            </span>
            {counts.active > 0 && (
              <span className="chip success">
                <span className="status-dot" style={{ width: 5, height: 5 }} />
                {t('accessTokens.cardActive', { count: counts.active })}
              </span>
            )}
            {counts.suspended > 0 && (
              <span className="chip warning">
                <span className="status-dot stale" style={{ width: 5, height: 5 }} />
                {t('accessTokens.cardSuspended', { count: counts.suspended })}
              </span>
            )}
            {counts.revoked > 0 && (
              <span className="chip danger">
                <span className="status-dot error" style={{ width: 5, height: 5 }} />
                {t('accessTokens.cardRevoked', { count: counts.revoked })}
              </span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="vault w-full whitespace-nowrap">
            <thead>
              <tr>
                {/* Padding/align/typography come from KEYS_PAGE_CSS's
                    `.vault-page table.vault th` (12px 20px, left, mono
                    uppercase). Actions header stays right-aligned inline —
                    the shared rule's text-align:left outranks a utility
                    class, so inline style is the reliable override. */}
                <th>{t('accessTokens.col.agent')}</th>
                <th>{t('accessTokens.col.source')}</th>
                <th>{t('accessTokens.col.status')}</th>
                <th>{t('accessTokens.col.availability')}</th>
                <th>{t('accessTokens.col.routing')}</th>
                <th>{t('accessTokens.col.created')}</th>
                <th style={{ textAlign: 'right' }}>{t('accessTokens.col.actions')}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {isLoading && (
                <tr><td colSpan={7} className="px-5 py-8 text-center" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.loading')}</td></tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center">
                    <div role="alert" aria-live="assertive" className="inline-flex items-center gap-3 rounded px-3 py-2" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.38)' }}>
                      <span>{t('accessTokens.loadError')}</span>
                      <button type="button" className="row-use-btn" onClick={() => void refetch()}>{t('accessTokens.retry')}</button>
                    </div>
                  </td>
                </tr>
              )}
              {agents && agents.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center" style={{ color: 'var(--muted-foreground)' }}>{t('accessTokens.empty')}</td></tr>
              )}
              {agents?.map(agent => (
                <tr key={agent.seat_id}>
                  <td className="px-5 py-4" style={{ color: 'var(--soft-foreground)' }}>
                    {/* Tool glyph LEFT of the name — same spec/placement as the
                        admin OAuth pools and Agents lists (shared/ui/ToolGlyph).
                        Outside the button so it is decoration, not a click
                        target: the name alone opens the routing drawer. */}
                    <div className="flex items-center gap-2">
                      <ToolGlyph label={toolGlyphLabel(agent.source?.protocol_type, agent.source?.provider_code)} />
                      <button
                        type="button"
                        className="alias-main mono cursor-pointer text-left hover:underline focus-visible:underline"
                        onClick={() => setRoutingAgent(agent)}
                        title={t('accessTokens.routing.openTitle', { account: agent.alias })}
                        aria-label={t('accessTokens.routing.openTitle', { account: agent.alias })}
                      >
                        {agent.alias}
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-4">{sourceBadge(agent.source, t)}</td>
                  <td className="px-5 py-4">
                    <span className={`badge ${agent.status === 'active' ? 'badge-active' : 'badge-neutral'}`}>{statusLabel(agent.status, t)}</span>
                  </td>
                  <td className="px-5 py-4"><PoolReadinessBadge agent={agent} linkToOauth /></td>
                  <td className="px-5 py-4"><RoutingCell agent={agent} onOpen={() => setRoutingAgent(agent)} /></td>
                  {/* VK value column removed 2026-07-22 (user): the masked VK hint
                      no longer shows inline; members still mint/rotate/reveal via the
                      row's "获取 VK" / "轮换" actions (AgentRowActions). */}
                  <td className="px-5 py-4" style={{ color: 'var(--muted-foreground)' }}>
                    {agent.created_at ? formatDate(agent.created_at) : '—'}
                  </td>
                  <td className="px-5 py-4 text-right"><AgentRowActions agent={agent} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} agents={agents ?? []} />
      <AgentRoutingDrawer agent={routingAgent} onClose={() => setRoutingAgent(null)} />
    </div>
    </>
  );
}
