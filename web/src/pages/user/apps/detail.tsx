/**
 * Phase 4 阶段 3 — Connected App detail page (/user/apps/:slug).
 *
 * Layout sourced from the 2026-05-23 design iteration at
 *   aikeylabs/.superdesign/design_iterations/connected_app_detail_1.html
 * (handed off by an external design agent). Styles live in
 * `apps-detail-css.ts` and are scoped to the `.connected-app-page`
 * wrapper so they don't bleed into other pages.
 *
 * Sections:
 *
 *   Hero      — app identity (icon + slug + chips) + actions row
 *                (Unlock vault, Pause/Resume, Rotate, Revoke)
 *   §A Key Bindings — per-upstream binding rows. follow-user-active
 *                apps show a yellow callout + read-only rows (no
 *                Switch button, per the 2026-05-19 follow-active spec)
 *   §B Usage   — 4 metric cards + recharts ComposedChart
 *                (tokens bar + requests line) + top-5 models meter list
 *   §C Issued Bearer — active key_id list + Rotate
 *   §D Audit Log — placeholder (audit endpoint not wired yet)
 *
 * Per-app usage scoping uses `app_slug` filter on the usage query
 * endpoint (Phase 4 Stage B, v1.0.0-rc.5).
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Radar,
  Pause,
  Play,
  RotateCw,
  Ban,
  Info,
  Repeat2,
  Asterisk,
  Trash2,
} from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

import { runtimeConfig } from '@/app/config/runtime';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { usageApi, type TimelinePoint, type ModelTotal } from '@/shared/api/usage';
import { appsApi, bindingTypeLabel } from '@/shared/api/user/apps';
import { importApi } from '@/shared/api/user/import';
import { SwitchKeyModal } from './SwitchKeyModal';
import { VaultStatusPill } from '../_shared/VaultStatusPill';
import { APPS_DETAIL_CSS } from './apps-detail-css';

// --- Per-app usage helpers --------------------------------------------

/** 2026-05-28 — added 1 (intra-day hourly). For 1D the timeline
 * switches to personalHourly(app_slug=slug) and densifies to 24 hour
 * buckets; by-model just narrows window to today. */
type RangeKey = 1 | 7 | 14 | 30;

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function relativeTime(unixSeconds: number | null): string {
  if (unixSeconds == null) return 'never';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fmtCompactInt(n: number): string {
  // 12345 → "12,345"; 1240000 → "1.24M"; 2400 → "2,400"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return new Intl.NumberFormat('en-US').format(n);
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

/**
 * Fill missing days in the timeline series with zero entries.
 *
 * Why: the backend omits days that had zero events (saves rows). The
 * chart needs to show empty days as zero-height bars (not gaps), so
 * the user can see the activity rhythm — "two quiet days then a spike"
 * is a different signal from "no data".
 */
function densifyTimeline(points: TimelinePoint[], range: RangeKey): TimelinePoint[] {
  const map = new Map<string, TimelinePoint>();
  for (const p of points) map.set(p.date, p);
  const out: TimelinePoint[] = [];
  // 1D — pad to 24 hour-of-day buckets (the upstream queryFn already
  // mapped HourlyPoint to TimelinePoint with date="HH:00"). Same
  // "no gaps in the axis" guarantee as the daily path.
  if (range === 1) {
    for (let h = 0; h < 24; h++) {
      const k = String(h).padStart(2, '0') + ':00';
      out.push(map.get(k) ?? { date: k, total_tokens: 0, request_count: 0 });
    }
    return out;
  }
  for (let i = range - 1; i >= 0; i--) {
    const d = daysAgoISO(i);
    out.push(map.get(d) ?? { date: d, total_tokens: 0, request_count: 0 });
  }
  return out;
}

export default function UserAppDetailPage() {
  const { t } = useTranslation();
  const { slug = '' } = useParams<{ slug: string }>();
  const qc = useQueryClient();

  const [switchTarget, setSwitchTarget] = useState<{
    upstream: string;
    currentRef?: string;
  } | null>(null);

  const detailQuery = useQuery({
    queryKey: ['user-apps-detail', slug],
    queryFn: () => appsApi.get(slug),
    enabled: !!slug,
    refetchInterval: 30_000,
  });

  const vaultQuery = useQuery({
    queryKey: ['vault-status'],
    queryFn: importApi.vaultStatus,
    refetchInterval: 10_000,
    staleTime: 0,
  });
  const vaultLocked = !vaultQuery.data?.unlocked;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['user-apps-detail', slug] });
    qc.invalidateQueries({ queryKey: ['user-apps-list'] });
  };
  const pauseM = useMutation({
    mutationFn: () => appsApi.pause(slug),
    onSuccess: invalidate,
  });
  const resumeM = useMutation({
    mutationFn: () => appsApi.resume(slug),
    onSuccess: invalidate,
  });
  const revokeM = useMutation({
    mutationFn: () => appsApi.revoke(slug),
    onSuccess: invalidate,
  });
  const rotateM = useMutation({
    mutationFn: () => appsApi.rotate(slug),
    onSuccess: invalidate,
  });

  // 2026-05-25 reveal-token: stored ONLY in component state so it
  // disappears on unmount / navigation away — explicitly NOT in React
  // Query cache (which would persist the plaintext across page nav
  // until a manual invalidate). Show/Hide toggles visibility of the
  // stored value; clicking Show again after Hide re-fetches so we
  // never keep stale plaintext in JS heap longer than needed.
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const revealM = useMutation({
    mutationFn: () => appsApi.revealToken(slug),
    onSuccess: (res) => setRevealedToken(res.route_token),
  });
  // Track which key_id row is "active" in the user's perception so the
  // reveal UI only renders Show/Copy controls on the matched row.
  // active_keys is ORDER BY created_at DESC server-side; index 0 is the
  // freshly issued one (which is what reveal-token returns).
  const activeKeyIdForReveal: string | null =
    detailQuery.data?.active_keys?.[0]?.key_id ?? null;

  // base_url is deterministic from the slug + the proxy's fixed port.
  // Two SDK families read different env names AND want different URL
  // shapes (Anthropic SDK appends /v1/messages on its own — its
  // base_url must NOT end in /v1 or the proxy 400's with
  // BASE_URL_MISCONFIGURED). Compute both so the user can copy either.
  const baseUrlOpenAI = `http://127.0.0.1:27200/apps/${slug}/v1`;
  const baseUrlAnthropic = `http://127.0.0.1:27200/apps/${slug}`;
  const [copiedBaseUrl, setCopiedBaseUrl] = useState<'openai' | 'anthropic' | null>(null);
  // Copy-feedback state for the bearer token. Mirrors copiedBaseUrl —
  // flashes "Copied" on the button for 2s after a successful clipboard
  // write, so the user gets the same visual confirmation they get
  // everywhere else (the TokenRevealModal post-register uses an
  // identical pattern).
  const [copiedToken, setCopiedToken] = useState(false);
  // 2026-05-23 uninstall — paired with default-install flip. Bypasses
  // the mutationLockedSlugs revoke/rotate guard because uninstall is
  // whole-system (service stops BEFORE bearer is wiped). On success the
  // detail query returns 404, so we navigate back to the list rather
  // than re-rendering this page with stale data.
  const uninstallM = useMutation({
    mutationFn: () => appsApi.uninstall(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-apps-list'] });
      qc.removeQueries({ queryKey: ['user-apps-detail', slug] });
      // Send user back to apps list so they don't get a "this app no
      // longer exists" 404 immediately after their own uninstall.
      window.location.assign('/user/apps');
    },
  });

  // --- Per-app usage (Stage C) -----------------------------------------
  const [usageRange, setUsageRange] = useState<RangeKey>(30);
  const usageStart = daysAgoISO(usageRange);
  const usageEnd = daysAgoISO(0);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });
  const accountId = meQuery.data?.account_id;
  const isLocalMode = runtimeConfig.authMode === 'local_bypass';
  const identity = isLocalMode
    ? { org_id: 'personal' as const }
    : accountId
    ? { account_id: accountId }
    : null;
  const identityKey = isLocalMode ? 'personal' : accountId ?? '';
  const hasIdentity = !!identity;

  const usageTimeline = useQuery({
    queryKey: ['user-apps-detail-timeline', slug, identityKey, usageRange],
    queryFn: async () => {
      // 1D: hourly per-app traffic (24 hour buckets), reshaped to the
      // TimelinePoint shape so densifyTimeline + chart consumers don't
      // branch. date="HH:00" sorts chronologically as a string.
      if (usageRange === 1) {
        const hourly = await usageApi.personalHourly(identity!, usageEnd, slug);
        return hourly.map((h) => ({
          date: String(h.hour).padStart(2, '0') + ':00',
          total_tokens: h.total_tokens,
          request_count: h.request_count,
        }));
      }
      return usageApi.personalTimeline(identity!, usageStart, usageEnd, slug);
    },
    enabled: hasIdentity && !!slug,
  });
  const usageByModel = useQuery({
    queryKey: ['user-apps-detail-by-model', slug, identityKey, usageRange],
    queryFn: () => usageApi.personalByModelTotal(identity!, usageStart, usageEnd, slug),
    enabled: hasIdentity && !!slug,
  });

  const usageMetrics = useMemo(() => {
    const points = usageTimeline.data ?? [];
    let tokens = 0;
    let requests = 0;
    let activeDays = 0;
    for (const p of points) {
      tokens += p.total_tokens;
      requests += p.request_count;
      if (p.total_tokens > 0 || p.request_count > 0) activeDays++;
    }
    const modelCount = (usageByModel.data ?? []).length;
    return { tokens, requests, activeDays, modelCount };
  }, [usageTimeline.data, usageByModel.data]);

  const densified = useMemo(
    () => densifyTimeline(usageTimeline.data ?? [], usageRange),
    [usageTimeline.data, usageRange],
  );

  const topModels: ModelTotal[] = useMemo(() => {
    const all = usageByModel.data ?? [];
    return all.slice(0, 5);
  }, [usageByModel.data]);

  const topModelMax = topModels.length > 0 ? topModels[0].total_tokens : 0;

  // ── Early-return states ──────────────────────────────────────────────

  if (detailQuery.isLoading) {
    return (
      <section className="connected-app-page p-6">
        <style>{APPS_DETAIL_CSS}</style>
        <div className="cap-surface p-8 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {t('apps.loadingApp')}
        </div>
      </section>
    );
  }

  if (detailQuery.isError) {
    const err = detailQuery.error as Error & { code?: string };
    return (
      <section className="connected-app-page p-6">
        <style>{APPS_DETAIL_CSS}</style>
        <div
          className="cap-surface p-6 text-sm"
          style={{ borderColor: 'var(--destructive, #ef4444)', color: 'var(--destructive, #ef4444)' }}
        >
          <strong>
            {err.code === 'I_APP_NOT_FOUND'
              ? t('apps.appNotFound', { slug })
              : t('apps.failedToLoadApp')}
          </strong>
          <div className="mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {err.message || t('apps.unknownError')}
          </div>
          <div className="mt-3">
            <Link
              to="/user/apps"
              className="text-[12px] underline"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {t('apps.backToConnectedApps')}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const data = detailQuery.data!;
  const isMutating =
    pauseM.isPending || resumeM.isPending || revokeM.isPending || rotateM.isPending ||
    uninstallM.isPending;
  const hasActiveKey = data.active_keys.length > 0;

  // 2026-05-23 policy: degrade-detector is wired into trust-local +
  // the proxy's rhythm observer; revoke / rotate would tear down the
  // first-party bearer that those components depend on. Back-end
  // mirrors this guard in pkg/userapi/app/handlers.go::mutationLockedSlugs
  // (returns 403 I_APP_MUTATION_DENIED). UI disables the buttons up-
  // front so users don't hit the API just to see an error. Pause /
  // resume stay enabled because they're recoverable.
  const mutationLocked = data.app.slug === 'degrade-detector';
  const mutationLockedReason = t('apps.mutationLockedReason');
  const bindingByUpstream = new Map<string, (typeof data.bindings)[number]>();
  data.bindings.forEach((b) => bindingByUpstream.set(b.upstream, b));
  const declaredUpstreamCount = data.app.upstreams.length;

  return (
    <>
      <style>{APPS_DETAIL_CSS}</style>
      <section className="connected-app-page p-6" aria-labelledby="app-detail-title">
          {/* Breadcrumb — kept above the hero so the shell's User → Apps trail is preserved */}
          <nav
            aria-label={t('apps.breadcrumbAria')}
            className="text-[12px] mb-4"
            style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}
          >
            <Link to="/user/apps" style={{ color: 'inherit' }} className="hover:underline">
              {t('apps.title')}
            </Link>
            <span className="mx-2" style={{ opacity: 0.45 }}>/</span>
            <strong style={{ color: 'var(--foreground)' }}>{data.app.name}</strong>
          </nav>

          {/* ─── Hero ─────────────────────────────────────────────────────── */}
          <section className="cap-section cap-surface cap-hero mb-5">
            <div className="cap-hero-grid">
              <div>
                <div className="flex items-center gap-4">
                  <div className="cap-app-icon">
                    {data.app.app_kind === 'first-party' ? (
                      <Radar size={25} />
                    ) : (
                      <Asterisk size={25} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="cap-mono-label mb-1">{t('apps.connectedAppDetail')}</div>
                    <h1
                      id="app-detail-title"
                      className="m-0 text-[28px] leading-tight font-extrabold tracking-tight"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {data.app.name}
                    </h1>
                    <p
                      className="mt-1 text-sm"
                      style={{
                        color: 'var(--muted-foreground)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      /user/apps/{data.app.slug}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-2 flex-wrap">
                  <span className="cap-chip px-3 py-1 text-[11px]">
                    {data.app.app_kind}
                  </span>
                  {data.app.follow_user_active ? (
                    <span className="cap-chip cap-chip-active px-3 py-1 text-[11px]">
                      follow-user-active
                    </span>
                  ) : null}
                  {data.app.vendor ? (
                    <span className="cap-chip px-3 py-1 text-[11px]">
                      {t('apps.vendorChip', { vendor: data.app.vendor })}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="cap-action-row flex items-center gap-2 flex-wrap justify-end">
                <VaultStatusPill
                  invalidateOnUnlock={[['user-apps-detail', slug], ['user-apps-list']]}
                />
                {hasActiveKey ? (
                  <button
                    type="button"
                    className="cap-btn cap-btn-secondary"
                    disabled={isMutating || vaultLocked}
                    title={vaultLocked ? t('apps.unlockVaultFirst') : undefined}
                    onClick={() => pauseM.mutate()}
                  >
                    <Pause size={14} /> {t('apps.actionPause')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cap-btn cap-btn-secondary"
                    disabled={isMutating || vaultLocked}
                    title={vaultLocked ? t('apps.unlockVaultFirst') : undefined}
                    onClick={() => resumeM.mutate()}
                  >
                    <Play size={14} /> {t('apps.actionResume')}
                  </button>
                )}
                <button
                  type="button"
                  className="cap-btn cap-btn-secondary"
                  disabled={isMutating || vaultLocked || mutationLocked}
                  title={
                    mutationLocked
                      ? mutationLockedReason
                      : vaultLocked
                        ? t('apps.unlockVaultFirst')
                        : undefined
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        t('apps.rotateConfirmFull', { name: data.app.name }),
                      )
                    ) {
                      rotateM.mutate();
                    }
                  }}
                >
                  <RotateCw size={14} /> {t('apps.rotateBearer')}
                </button>
                <button
                  type="button"
                  className="cap-btn cap-btn-danger"
                  disabled={isMutating || vaultLocked || mutationLocked}
                  title={
                    mutationLocked
                      ? mutationLockedReason
                      : vaultLocked
                        ? t('apps.unlockVaultFirst')
                        : undefined
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        t('apps.revokeConfirmDetail', { name: data.app.name }),
                      )
                    ) {
                      revokeM.mutate();
                    }
                  }}
                >
                  <Ban size={14} /> {t('apps.actionRevoke')}
                </button>
                {data.app.app_kind === 'third-party' && (
                  // Uninstall is third-party ONLY. First-party apps (e.g.
                  // Trust Check / degrade-detector) intentionally have no
                  // Web-UI uninstall path:
                  //
                  //   - Their bearer + app_record row are re-asserted by
                  //     ensure_first_party_app_keys self-heal on the next
                  //     CLI startup (see aikey-cli migrations.rs §self-heal),
                  //     so a UI uninstall would 401 the running plugin for
                  //     a few seconds and then auto-recreate — disruptive
                  //     AND ineffective.
                  //
                  //   - The intended way to fully remove a first-party app
                  //     is to uninstall the plugin itself from the CLI
                  //     (`aikey app uninstall <slug>`), which stops the
                  //     service before wiping vault rows. That path is not
                  //     reachable from this page on purpose — exposing it
                  //     here was a rc.5 "default-install flip" carve-out
                  //     (mutationLocked branch) that we removed 2026-05-26
                  //     per user direction "内置 APP 不支持 uninstall，需要屏蔽".
                  //
                  // Backend dispatches between first-party / third-party
                  // uninstall paths by slug membership in TRUSTED_APPS —
                  // see commands_app::install::handle_uninstall. The
                  // third-party path deletes app_records + bindings and
                  // flips app_keys.status to 'revoked' (history retained).
                  <button
                    type="button"
                    className="cap-btn cap-btn-danger"
                    disabled={isMutating || vaultLocked}
                    title={
                      vaultLocked
                        ? t('apps.unlockVaultFirst')
                        : t('apps.uninstallTooltip', { name: data.app.name })
                    }
                    onClick={() => {
                      if (
                        window.confirm(
                          t('apps.uninstallConfirm', { name: data.app.name }),
                        )
                      ) {
                        uninstallM.mutate();
                      }
                    }}
                  >
                    <Trash2 size={14} /> {t('apps.uninstall')}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Rotate result surface — bearer shown once on rotate success.
              Two env blocks side-by-side because OpenAI-style SDKs and
              the Anthropic SDK read different env names AND want different
              base_url shapes (the Anthropic SDK appends /v1/messages on
              its own — if its base_url also ends in /v1 the proxy trips
              BASE_URL_MISCONFIGURED). Pasting from the wrong block is the
              biggest support footgun, so we show both. */}
          {rotateM.data ? (
            <div
              className="cap-surface mb-5 p-4"
              style={{ borderColor: 'rgba(202, 138, 4, 0.5)' }}
            >
              <strong style={{ color: '#ca8a04' }}>{t('apps.newBearerIssued')}</strong>
              <p className="text-[12px] mt-1" style={{ color: 'var(--muted-foreground)' }}>
                {t('apps.copyBlockRestart')}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div
                    className="text-[11px] uppercase tracking-wider mb-1"
                    style={{
                      color: 'var(--muted-foreground)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    OpenAI SDK
                  </div>
                  <div
                    className="rounded p-2 break-all"
                    style={{
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      border: '1px solid var(--border)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    OPENAI_API_KEY={rotateM.data.api_key}
                    <br />
                    OPENAI_BASE_URL={rotateM.data.base_url}
                  </div>
                </div>
                <div>
                  <div
                    className="text-[11px] uppercase tracking-wider mb-1"
                    style={{
                      color: 'var(--muted-foreground)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    Anthropic SDK · Claude Code
                  </div>
                  <div
                    className="rounded p-2 break-all"
                    style={{
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      border: '1px solid var(--border)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    ANTHROPIC_API_KEY={rotateM.data.api_key}
                    <br />
                    ANTHROPIC_BASE_URL={rotateM.data.base_url.replace(/\/v1$/, '')}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* ─── §A Key Bindings ──────────────────────────────────────────── */}
          <section className="cap-section cap-surface mb-5" aria-labelledby="bindings-title">
            <div className="cap-section-header">
              <div>
                <div id="bindings-title" className="cap-mono-label">{t('apps.keyBindings')}</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {t('apps.keyBindingsDesc')}
                </p>
              </div>
              <span className="cap-chip px-3 py-1 text-[11px]">
                {declaredUpstreamCount} {declaredUpstreamCount === 1 ? t('apps.upstreamSingular') : t('apps.upstreamPlural')}
              </span>
            </div>

            <div className="cap-section-body">
              {data.app.follow_user_active ? (
                <div className="cap-callout px-4 py-3 mb-3 flex items-start gap-3">
                  <Info
                    size={17}
                    style={{ color: '#ca8a04', marginTop: 2, flexShrink: 0 }}
                  />
                  <p className="m-0 text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                    <strong style={{ color: '#ca8a04' }}>
                      {t('apps.followsDefaultKey')}
                    </strong>{' '}
                    {t('apps.followsDefaultKeyPre')}{' '}
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--foreground)',
                      }}
                    >
                      aikey use
                    </code>{' '}
                    {t('apps.followsDefaultKeyMid')}{' '}
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--foreground)',
                      }}
                    >
                      aikey use &lt;alias&gt;
                    </code>{' '}
                    {t('apps.followsDefaultKeyOpen')}{' '}
                    <Link
                      to="/user/vault"
                      className="underline"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {t('apps.vaultPage')}
                    </Link>
                    .
                  </p>
                </div>
              ) : null}

              {declaredUpstreamCount === 0 ? (
                <div className="text-[13px] py-3" style={{ color: 'var(--muted-foreground)' }}>
                  {t('apps.noUpstreamsDeclared')}
                </div>
              ) : (
                <div className="grid gap-2.5">
                  {data.app.upstreams.map((upstream) => {
                    const binding = bindingByUpstream.get(upstream);
                    return (
                      <div key={upstream} className="cap-row cap-row-binding">
                        <div>
                          <div
                            className="font-bold"
                            style={{
                              color: '#ca8a04',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {upstream}
                          </div>
                          <div
                            className="mt-1 text-[11px]"
                            style={{
                              color: 'var(--muted-foreground)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {t('apps.declaredUpstream')}
                          </div>
                        </div>

                        <div className="min-w-0">
                          {binding ? (
                            <>
                              <div
                                className="font-semibold truncate"
                                style={{ color: 'var(--foreground)' }}
                              >
                                {binding.key_source_label ?? binding.key_source_ref}
                              </div>
                              <div
                                className="mt-1 text-xs truncate"
                                style={{
                                  color: 'var(--muted-foreground)',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {t('apps.keySource', { type: bindingTypeLabel(binding.key_source_type) })}
                              </div>
                            </>
                          ) : data.app.follow_user_active ? (
                            <div className="text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                              {t('apps.dynamicallyResolved')}
                            </div>
                          ) : (
                            <div
                              className="text-[13px]"
                              style={{ color: 'var(--destructive, #ef4444)' }}
                            >
                              {t('apps.noBindingWillFail')}
                            </div>
                          )}
                        </div>

                        {data.app.follow_user_active ? (
                          <span className="cap-chip px-3 py-1 text-[11px]">{t('apps.readOnly')}</span>
                        ) : data.app.app_kind === 'first-party' ? (
                          // Mode B (credential-mode-architecture spec, 2026-05-23):
                          // first-party + !follow_user_active means the binding was
                          // SNAPSHOT-FROZEN at registration (init_from_user_active).
                          // Switching it post-init would break the probe baseline
                          // these apps rely on, so the action is disabled rather
                          // than hidden — keeps the layout consistent with regular
                          // third-party rows while signalling the constraint.
                          <button
                            type="button"
                            className="cap-btn cap-btn-primary"
                            disabled
                            title={t('apps.switchFrozenTooltip')}
                          >
                            <Repeat2 size={14} /> {t('apps.switch')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="cap-btn cap-btn-primary"
                            onClick={() =>
                              setSwitchTarget({
                                upstream,
                                currentRef: binding?.key_source_ref,
                              })
                            }
                          >
                            <Repeat2 size={14} /> {binding ? t('apps.switch') : t('apps.bind')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ─── §B Usage ────────────────────────────────────────────────── */}
          <section className="cap-section cap-surface mb-5" aria-labelledby="usage-title">
            <div className="cap-section-header">
              <div>
                <div id="usage-title" className="cap-mono-label">{t('apps.usage')}</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {t('apps.usageDesc')}
                </p>
              </div>
              <div className="flex items-center gap-1.5" aria-label={t('apps.rangeSelectorAria')}>
                {([1, 7, 14, 30] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setUsageRange(r)}
                    className={`cap-chip px-3 py-1.5 text-[11px] ${r === usageRange ? 'cap-chip-active' : ''}`}
                  >
                    {r}D
                  </button>
                ))}
              </div>
            </div>

            <div className="cap-section-body">
              {!hasIdentity ? (
                <div className="text-[13px] py-4 text-center" style={{ color: 'var(--muted-foreground)' }}>
                  {t('apps.loadingIdentity')}
                </div>
              ) : usageTimeline.isError || usageByModel.isError ? (
                <div className="text-[13px] py-4" style={{ color: 'var(--destructive, #ef4444)' }}>
                  {t('apps.failedToLoadUsage')}{' '}
                  {((usageTimeline.error ?? usageByModel.error) as Error)?.message ?? t('apps.unknownError2')}
                </div>
              ) : (
                <>
                  <div className="cap-metric-grid">
                    <div className="cap-metric-card">
                      <div className="cap-mono-label">{t('apps.totalTokens')}</div>
                      <div
                        className="mt-3 text-[28px] font-extrabold tracking-tight"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {fmtCompactInt(usageMetrics.tokens)}
                      </div>
                      <div
                        className="mt-2 text-xs"
                        style={{
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {usageRange === 1 ? t('apps.today') : t('apps.lastNDays', { count: usageRange })}
                      </div>
                    </div>

                    <div className="cap-metric-card">
                      <div className="cap-mono-label">{t('apps.requests')}</div>
                      <div
                        className="mt-3 text-[28px] font-extrabold tracking-tight"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {fmtInt(usageMetrics.requests)}
                      </div>
                      <div
                        className="mt-2 text-xs"
                        style={{
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('apps.proxiedCalls')}
                      </div>
                    </div>

                    <div className="cap-metric-card">
                      {/* 1D label flip: usageMetrics.activeDays counts
                          non-zero buckets in the timeline. For ranges
                          7/14/30 the buckets are days; for 1D they're
                          hours. Show "Active hours" / 24 then so the
                          label matches what the number actually counts. */}
                      <div className="cap-mono-label">
                        {usageRange === 1 ? t('apps.activeHours') : t('apps.activeDays')}
                      </div>
                      <div
                        className="mt-3 text-[28px] font-extrabold tracking-tight"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {usageMetrics.activeDays} / {usageRange === 1 ? 24 : usageRange}
                      </div>
                      <div
                        className="mt-2 text-xs"
                        style={{
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {usageRange === 1 ? t('apps.zeroHoursHonestly') : t('apps.zeroDaysHonestly')}
                      </div>
                    </div>

                    <div className="cap-metric-card">
                      <div className="cap-mono-label">{t('apps.modelsUsed')}</div>
                      <div
                        className="mt-3 text-[28px] font-extrabold tracking-tight"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {usageMetrics.modelCount}
                      </div>
                      <div
                        className="mt-2 text-xs"
                        style={{
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('apps.topNShown', { count: Math.min(5, usageMetrics.modelCount) })}
                      </div>
                    </div>
                  </div>

                  <div className="cap-usage-grid">
                    {/* Chart card */}
                    <div className="cap-chart-card cap-surface-subtle">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="cap-mono-label">{t('apps.consumptionTrend')}</div>
                        </div>
                        <div
                          className="flex gap-4 text-[11px]"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--muted-foreground)',
                          }}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block w-3 h-3 rounded-sm"
                              style={{ background: 'var(--cap-token-bar)' }}
                            />
                            {t('apps.tokens')}
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block w-3"
                              style={{ background: 'var(--cap-request-line)', height: 2 }}
                            />
                            {t('apps.requestsLegend')}
                          </span>
                        </div>
                      </div>

                      <div className="cap-chart-wrap">
                        {usageTimeline.isLoading ? (
                          <div
                            className="h-full grid place-items-center text-[13px]"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {t('apps.loadingEllipsis')}
                          </div>
                        ) : usageMetrics.tokens === 0 && usageMetrics.requests === 0 ? (
                          <div
                            className="h-full grid place-items-center text-center text-[13px] px-4"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {t('apps.noUsageInWindow')}
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                              data={densified}
                              margin={{ top: 16, right: 16, bottom: 16, left: 12 }}
                            >
                              <CartesianGrid
                                strokeDasharray="2 3"
                                stroke="var(--border)"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="date"
                                stroke="#a1a1aa"
                                tick={{
                                  fill: '#a1a1aa',
                                  fontFamily: 'JetBrains Mono, monospace',
                                  fontSize: 10,
                                }}
                                tickFormatter={(d: string) => d.slice(5)}
                                interval="preserveStartEnd"
                                minTickGap={28}
                              />
                              <YAxis
                                yAxisId="tokens"
                                orientation="left"
                                stroke="#a1a1aa"
                                tick={{
                                  fill: '#a1a1aa',
                                  fontFamily: 'JetBrains Mono, monospace',
                                  fontSize: 10,
                                }}
                                tickFormatter={(v: number) => fmtCompactInt(v)}
                                width={48}
                              />
                              <YAxis
                                yAxisId="requests"
                                orientation="right"
                                stroke="#a1a1aa"
                                tick={{
                                  fill: '#a1a1aa',
                                  fontFamily: 'JetBrains Mono, monospace',
                                  fontSize: 10,
                                }}
                                tickFormatter={(v: number) => fmtInt(v)}
                                width={36}
                              />
                              <Tooltip
                                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                                contentStyle={{
                                  background: 'var(--card)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 6,
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 11,
                                  color: 'var(--foreground)',
                                }}
                                formatter={(value, name) => [
                                  fmtCompactInt(Number(value)),
                                  name === 'total_tokens' ? 'tokens' : 'requests',
                                ]}
                              />
                              <Bar
                                yAxisId="tokens"
                                dataKey="total_tokens"
                                fill="var(--cap-token-bar)"
                                radius={[5, 5, 0, 0]}
                                maxBarSize={20}
                              />
                              <Line
                                yAxisId="requests"
                                dataKey="request_count"
                                stroke="var(--cap-request-line)"
                                strokeWidth={2.5}
                                dot={false}
                                activeDot={{
                                  r: 5,
                                  fill: 'var(--cap-request-line)',
                                  stroke: 'var(--background)',
                                  strokeWidth: 3,
                                }}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </div>

                      <p
                        className="text-[11px] mt-3"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {t('apps.scopedToEvents')}{' '}
                        <code
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--foreground)',
                          }}
                        >
                          app_slug={slug}
                        </code>
                        {t('apps.forGlobalViewSee')}{' '}
                        <Link
                          to="/user/usage-ledger"
                          className="underline"
                          style={{ color: 'var(--foreground)' }}
                        >
                          {t('apps.costUsage')}
                        </Link>
                        .
                      </p>
                    </div>

                    {/* Top models meter list */}
                    <div className="cap-models-card cap-surface-subtle">
                      <div className="cap-mono-label">{t('apps.topModels')}</div>
                      <div className="mt-2 mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                        {t('apps.rankedByTokens')}
                      </div>
                      {topModels.length === 0 ? (
                        <div className="text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                          {t('apps.noModelBreakdown')}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {topModels.map((m) => {
                            const pct =
                              topModelMax > 0 ? Math.round((m.total_tokens / topModelMax) * 100) : 0;
                            return (
                              <div key={m.model} className="cap-row cap-row-model">
                                <div className="min-w-0">
                                  <div
                                    className="truncate font-medium"
                                    style={{ color: 'var(--foreground)' }}
                                  >
                                    {m.model}
                                  </div>
                                  <div className="cap-model-meter">
                                    <span style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                                <div
                                  className="text-right"
                                  style={{ fontFamily: 'var(--font-mono)' }}
                                >
                                  <div className="font-bold" style={{ color: 'var(--foreground)' }}>
                                    {fmtCompactInt(m.total_tokens)}
                                  </div>
                                  <div className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                                    {t('apps.reqSuffix', { value: fmtInt(m.request_count) })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ─── §C Issued Bearer ───────────────────────────────────────── */}
          <section className="cap-section cap-surface mb-5" aria-labelledby="bearer-title">
            <div className="cap-section-header">
              <div>
                <div id="bearer-title" className="cap-mono-label">{t('apps.issuedBearer')}</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {t('apps.issuedBearerDesc')}
                </p>
              </div>
              <button
                type="button"
                className="cap-btn cap-btn-secondary"
                disabled={isMutating || vaultLocked || mutationLocked}
                title={
                  mutationLocked
                    ? mutationLockedReason
                    : vaultLocked
                      ? t('apps.unlockVaultFirst')
                      : undefined
                }
                onClick={() => {
                  if (
                    window.confirm(
                      t('apps.rotateConfirmShort', { name: data.app.name }),
                    )
                  ) {
                    rotateM.mutate();
                  }
                }}
              >
                <RotateCw size={14} /> {t('apps.rotateBearer')}
              </button>
            </div>
            <div className="cap-section-body">
              {/* Base URL — always visible, not behind unlock (it's public by
                  design; the token is the secret half of the env block).
                  Two rows because OpenAI-style SDKs and the Anthropic SDK
                  need different env var names AND different URL shapes —
                  Anthropic SDK appends /v1/messages on its own, so its
                  base_url must NOT end in /v1 (else the proxy 400's with
                  BASE_URL_MISCONFIGURED). */}
              {([
                { sdk: 'openai' as const, envName: 'OPENAI_BASE_URL', url: baseUrlOpenAI, label: 'OpenAI SDK' },
                { sdk: 'anthropic' as const, envName: 'ANTHROPIC_BASE_URL', url: baseUrlAnthropic, label: 'Anthropic SDK · Claude Code' },
              ]).map((row) => (
                <div key={row.sdk} className="cap-row cap-row-bearer mb-2.5">
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-[11px] uppercase tracking-wider flex items-center gap-2 flex-wrap"
                      style={{
                        color: 'var(--muted-foreground)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span>{row.envName}</span>
                      <span style={{ opacity: 0.6 }}>· {row.label}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <code
                        className="px-2 py-1 rounded text-[12px]"
                        style={{
                          background: 'var(--secondary, #3f3f46)',
                          color: 'var(--foreground)',
                          fontFamily: 'var(--font-mono)',
                          wordBreak: 'break-all',
                        }}
                      >
                        {row.url}
                      </code>
                      <button
                        type="button"
                        title={t('apps.copyEnvTooltip', { envName: row.envName })}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(row.url);
                            setCopiedBaseUrl(row.sdk);
                            window.setTimeout(() => setCopiedBaseUrl(null), 2000);
                          } catch {
                            // Clipboard API may be blocked in non-secure
                            // contexts. The text is selectable in the code
                            // block, so users can copy by hand. Silent.
                          }
                        }}
                        className="rounded px-2 py-1 text-[11px] font-mono uppercase tracking-wider"
                        style={{
                          background:
                            copiedBaseUrl === row.sdk
                              ? 'var(--success, #16a34a)'
                              : '#ca8a04',
                          color: 'var(--primary-foreground, #18181b)',
                        }}
                      >
                        {copiedBaseUrl === row.sdk ? t('apps.copied') : t('apps.copy')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {data.active_keys.length === 0 ? (
                <div className="text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                  {t('apps.noActiveBearer')}{' '}
                  <span
                    style={{
                      background: 'var(--secondary, #3f3f46)',
                      color: 'var(--foreground)',
                      padding: '2px 8px',
                      borderRadius: 6,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    aikey app register --slug {data.app.slug} --upstreams{' '}
                    {data.app.upstreams.join(',')}
                  </span>
                </div>
              ) : (
                <div className="grid gap-2.5">
                  {data.active_keys.map((k) => {
                    // Show the reveal controls only on the row whose
                    // key_id matches what the backend's reveal-token
                    // endpoint will actually return (most-recently
                    // created active row). For multi-active rotation
                    // windows the older row stays read-only — its
                    // plaintext is no longer accessible by design.
                    const isRevealTarget = k.key_id === activeKeyIdForReveal;
                    const tokenIsShown = isRevealTarget && revealedToken !== null;
                    return (
                      <div key={k.key_id} className="cap-row cap-row-bearer">
                        <div className="min-w-0">
                          <div
                            className="font-semibold truncate"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--foreground)',
                            }}
                          >
                            {k.key_id}
                          </div>
                          {isRevealTarget ? (
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              <code
                                className="px-2 py-1 rounded text-[12px]"
                                style={{
                                  background: 'var(--secondary, #3f3f46)',
                                  color: 'var(--foreground)',
                                  fontFamily: 'var(--font-mono)',
                                  wordBreak: 'break-all',
                                }}
                                aria-label={tokenIsShown ? t('apps.bearerTokenRevealedAria') : t('apps.bearerTokenMaskedAria')}
                              >
                                {tokenIsShown
                                  ? revealedToken
                                  : 'aikey_app_••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                              </code>
                              {/* Show / Hide toggle. Hides without a
                                  fresh fetch — the stored value is
                                  dropped, next Show re-fetches. */}
                              <button
                                type="button"
                                disabled={vaultLocked || revealM.isPending}
                                title={vaultLocked ? t('apps.unlockVaultFirst') : undefined}
                                onClick={() => {
                                  if (tokenIsShown) {
                                    setRevealedToken(null);
                                  } else {
                                    revealM.mutate();
                                  }
                                }}
                                className="rounded border px-2 py-1 text-[11px] font-mono uppercase tracking-wider disabled:opacity-50"
                                style={{
                                  background: 'transparent',
                                  color: 'var(--foreground)',
                                  borderColor: 'var(--border)',
                                }}
                              >
                                {revealM.isPending && !tokenIsShown
                                  ? t('apps.loadingEllipsis')
                                  : tokenIsShown
                                  ? t('apps.hide')
                                  : t('apps.show')}
                              </button>
                              {/* Copy: fetch (if not already fetched)
                                  and write to clipboard. Doesn't
                                  toggle visibility — user may want to
                                  copy without exposing on screen. The
                                  button label flips to "Copied" for 2s
                                  on success so the user gets the same
                                  visual confirmation as the base_url
                                  Copy and the TokenRevealModal. */}
                              <button
                                type="button"
                                disabled={vaultLocked || revealM.isPending}
                                title={vaultLocked ? t('apps.unlockVaultFirst') : t('apps.copyTokenTooltip')}
                                onClick={async () => {
                                  let value = revealedToken;
                                  if (value === null) {
                                    const res = await revealM.mutateAsync();
                                    value = res.route_token;
                                  }
                                  try {
                                    await navigator.clipboard.writeText(value);
                                    setCopiedToken(true);
                                    window.setTimeout(() => setCopiedToken(false), 2000);
                                  } catch {
                                    // Clipboard write can fail in non-
                                    // secure contexts; the token is
                                    // already visible (via revealedToken
                                    // state) so the user can copy by
                                    // hand. Silent — no toast lib yet.
                                  }
                                }}
                                className="rounded px-2 py-1 text-[11px] font-mono uppercase tracking-wider disabled:opacity-50"
                                style={{
                                  background: copiedToken ? 'var(--success, #16a34a)' : '#ca8a04',
                                  color: 'var(--primary-foreground, #18181b)',
                                }}
                              >
                                {copiedToken ? t('apps.copied') : t('apps.copy')}
                              </button>
                            </div>
                          ) : (
                            <div
                              className="mt-1 text-xs"
                              style={{ color: 'var(--muted-foreground)' }}
                            >
                              {t('apps.olderActiveRow')}
                            </div>
                          )}
                          {isRevealTarget && revealM.error ? (
                            <div
                              className="mt-1 text-[11px] font-mono"
                              style={{ color: 'var(--destructive, #ef4444)' }}
                              role="alert"
                            >
                              {t('apps.revealFailed')} {(revealM.error as Error).message}
                            </div>
                          ) : null}
                        </div>
                        <div
                          className="text-right text-xs"
                          style={{
                            color: 'var(--muted-foreground)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t('apps.issuedLastUsed', {
                            issued: relativeTime(k.created_at),
                            lastUsed: relativeTime(k.last_used_at),
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ─── §D Audit Log placeholder ────────────────────────────── */}
          <section className="cap-section cap-audit-placeholder mb-5">
            <div className="cap-mono-label">{t('apps.auditLog')}</div>
            <p className="mt-3 mb-0 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
              {t('apps.auditLogPlaceholder')}
            </p>
          </section>

          {/* Mutation error surfacing */}
          {(pauseM.error || resumeM.error || revokeM.error || rotateM.error) ? (
            <div
              className="cap-surface mt-4 p-3 text-[12px]"
              style={{
                borderColor: 'var(--destructive, #ef4444)',
                color: 'var(--destructive, #ef4444)',
                fontFamily: 'var(--font-mono)',
              }}
              role="alert"
            >
              {t('apps.lastActionFailed')}{' '}
              {(pauseM.error || resumeM.error || revokeM.error || rotateM.error)?.message ?? t('apps.unknown')}
            </div>
          ) : null}
      </section>

      {/* Switch Key modal — opened from §A Key Bindings rows. */}
      {switchTarget ? (
        <SwitchKeyModal
          slug={slug}
          upstream={switchTarget.upstream}
          currentKeyRef={switchTarget.currentRef}
          onClose={() => setSwitchTarget(null)}
        />
      ) : null}
    </>
  );
}
