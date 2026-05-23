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

type RangeKey = 7 | 14 | 30;

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
  for (let i = range - 1; i >= 0; i--) {
    const d = daysAgoISO(i);
    out.push(map.get(d) ?? { date: d, total_tokens: 0, request_count: 0 });
  }
  return out;
}

export default function UserAppDetailPage() {
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
    queryFn: () => usageApi.personalTimeline(identity!, usageStart, usageEnd, slug),
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
          Loading app…
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
              ? `App "${slug}" not found.`
              : 'Failed to load app.'}
          </strong>
          <div className="mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {err.message || 'Unknown error.'}
          </div>
          <div className="mt-3">
            <Link
              to="/user/apps"
              className="text-[12px] underline"
              style={{ color: 'var(--muted-foreground)' }}
            >
              ← Back to Connected Apps
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const data = detailQuery.data!;
  const isMutating =
    pauseM.isPending || resumeM.isPending || revokeM.isPending || rotateM.isPending;
  const hasActiveKey = data.active_keys.length > 0;

  // 2026-05-23 policy: degrade-detector is wired into trust-local +
  // the proxy's rhythm observer; revoke / rotate would tear down the
  // first-party bearer that those components depend on. Back-end
  // mirrors this guard in pkg/userapi/app/handlers.go::mutationLockedSlugs
  // (returns 403 I_APP_MUTATION_DENIED). UI disables the buttons up-
  // front so users don't hit the API just to see an error. Pause /
  // resume stay enabled because they're recoverable.
  const mutationLocked = data.app.slug === 'degrade-detector';
  const mutationLockedReason =
    'This app is wired into the AiKey internal pipeline. Revoke / rotate ' +
    'would break trust-local and the proxy rhythm observer. Use Pause / ' +
    'Resume to stop it temporarily.';
  const bindingByUpstream = new Map<string, (typeof data.bindings)[number]>();
  data.bindings.forEach((b) => bindingByUpstream.set(b.upstream, b));
  const declaredUpstreamCount = data.app.upstreams.length;

  return (
    <>
      <style>{APPS_DETAIL_CSS}</style>
      <section className="connected-app-page p-6" aria-labelledby="app-detail-title">
          {/* Breadcrumb — kept above the hero so the shell's User → Apps trail is preserved */}
          <nav
            aria-label="Breadcrumb"
            className="text-[12px] mb-4"
            style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}
          >
            <Link to="/user/apps" style={{ color: 'inherit' }} className="hover:underline">
              Connected Apps
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
                    <div className="cap-mono-label mb-1">Connected app detail</div>
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
                      vendor: {data.app.vendor}
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
                    title={vaultLocked ? 'Unlock vault first' : undefined}
                    onClick={() => pauseM.mutate()}
                  >
                    <Pause size={14} /> Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cap-btn cap-btn-secondary"
                    disabled={isMutating || vaultLocked}
                    title={vaultLocked ? 'Unlock vault first' : undefined}
                    onClick={() => resumeM.mutate()}
                  >
                    <Play size={14} /> Resume
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
                        ? 'Unlock vault first'
                        : undefined
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        `Rotate bearer for "${data.app.name}"?\n\nThe agent's existing OPENAI_API_KEY will immediately become invalid. You must copy the new bearer (shown after this completes) into the agent's env, then restart the agent.`,
                      )
                    ) {
                      rotateM.mutate();
                    }
                  }}
                >
                  <RotateCw size={14} /> Rotate bearer
                </button>
                <button
                  type="button"
                  className="cap-btn cap-btn-danger"
                  disabled={isMutating || vaultLocked || mutationLocked}
                  title={
                    mutationLocked
                      ? mutationLockedReason
                      : vaultLocked
                        ? 'Unlock vault first'
                        : undefined
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        `Revoke "${data.app.name}"?\n\nAll active keys are immediately invalidated. The agent will return 401 on its next request. This cannot be undone — re-register via CLI to issue a new bearer.`,
                      )
                    ) {
                      revokeM.mutate();
                    }
                  }}
                >
                  <Ban size={14} /> Revoke
                </button>
              </div>
            </div>
          </section>

          {/* Rotate result surface — bearer shown once on rotate success. */}
          {rotateM.data ? (
            <div
              className="cap-surface mb-5 p-4"
              style={{ borderColor: 'rgba(202, 138, 4, 0.5)' }}
            >
              <strong style={{ color: '#ca8a04' }}>New bearer issued.</strong>
              <p className="text-[12px] mt-1" style={{ color: 'var(--muted-foreground)' }}>
                Update the agent's env with these two values and restart it. This is shown once.
              </p>
              <div
                className="mt-3 rounded p-2 break-all"
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
          ) : null}

          {/* ─── §A Key Bindings ──────────────────────────────────────────── */}
          <section className="cap-section cap-surface mb-5" aria-labelledby="bindings-title">
            <div className="cap-section-header">
              <div>
                <div id="bindings-title" className="cap-mono-label">Key bindings</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Which provider key the agent uses for each declared upstream.
                </p>
              </div>
              <span className="cap-chip px-3 py-1 text-[11px]">
                {declaredUpstreamCount} {declaredUpstreamCount === 1 ? 'upstream' : 'upstreams'}
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
                      This app follows your default key.
                    </strong>{' '}
                    It resolves via your active{' '}
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--foreground)',
                      }}
                    >
                      aikey use
                    </code>{' '}
                    selection at request time. To change which key it uses, run{' '}
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--foreground)',
                      }}
                    >
                      aikey use &lt;alias&gt;
                    </code>{' '}
                    or open the{' '}
                    <Link
                      to="/user/vault"
                      className="underline"
                      style={{ color: 'var(--foreground)' }}
                    >
                      Vault page
                    </Link>
                    .
                  </p>
                </div>
              ) : null}

              {declaredUpstreamCount === 0 ? (
                <div className="text-[13px] py-3" style={{ color: 'var(--muted-foreground)' }}>
                  No upstreams declared at register time.
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
                            declared upstream
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
                                key source: {bindingTypeLabel(binding.key_source_type)}
                              </div>
                            </>
                          ) : data.app.follow_user_active ? (
                            <div className="text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                              Dynamically resolved from your default key.
                            </div>
                          ) : (
                            <div
                              className="text-[13px]"
                              style={{ color: 'var(--destructive, #ef4444)' }}
                            >
                              No binding — runtime requests will fail with BINDING_NOT_FOUND. Bind a key to fix.
                            </div>
                          )}
                        </div>

                        {data.app.follow_user_active ? (
                          <span className="cap-chip px-3 py-1 text-[11px]">read only</span>
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
                            title="Binding is frozen at registration (Mode B). Switching is not supported for first-party apps."
                          >
                            <Repeat2 size={14} /> Switch
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
                            <Repeat2 size={14} /> {binding ? 'Switch' : 'Bind'}
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
                <div id="usage-title" className="cap-mono-label">Usage</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Daily tokens and requests expose cost drift and runaway request loops.
                </p>
              </div>
              <div className="flex items-center gap-1.5" aria-label="Range selector">
                {([7, 14, 30] as const).map((r) => (
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
                  Loading identity…
                </div>
              ) : usageTimeline.isError || usageByModel.isError ? (
                <div className="text-[13px] py-4" style={{ color: 'var(--destructive, #ef4444)' }}>
                  Failed to load usage:{' '}
                  {((usageTimeline.error ?? usageByModel.error) as Error)?.message ?? 'unknown error'}
                </div>
              ) : (
                <>
                  <div className="cap-metric-grid">
                    <div className="cap-metric-card">
                      <div className="cap-mono-label">Total tokens</div>
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
                        last {usageRange} days
                      </div>
                    </div>

                    <div className="cap-metric-card">
                      <div className="cap-mono-label">Requests</div>
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
                        proxied calls
                      </div>
                    </div>

                    <div className="cap-metric-card">
                      <div className="cap-mono-label">Active days</div>
                      <div
                        className="mt-3 text-[28px] font-extrabold tracking-tight"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {usageMetrics.activeDays} / {usageRange}
                      </div>
                      <div
                        className="mt-2 text-xs"
                        style={{
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        zero days rendered honestly
                      </div>
                    </div>

                    <div className="cap-metric-card">
                      <div className="cap-mono-label">Models used</div>
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
                        top {Math.min(5, usageMetrics.modelCount)} shown
                      </div>
                    </div>
                  </div>

                  <div className="cap-usage-grid">
                    {/* Chart card */}
                    <div className="cap-chart-card cap-surface-subtle">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="cap-mono-label">Consumption trend</div>
                          <h3
                            className="mt-2 mb-0 text-lg font-medium tracking-tight"
                            style={{ color: 'var(--foreground)' }}
                          >
                            Daily tokens with request count overlay
                          </h3>
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
                            tokens
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block w-3"
                              style={{ background: 'var(--cap-request-line)', height: 2 }}
                            />
                            requests
                          </span>
                        </div>
                      </div>

                      <div className="cap-chart-wrap">
                        {usageTimeline.isLoading ? (
                          <div
                            className="h-full grid place-items-center text-[13px]"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            Loading…
                          </div>
                        ) : usageMetrics.tokens === 0 && usageMetrics.requests === 0 ? (
                          <div
                            className="h-full grid place-items-center text-center text-[13px] px-4"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            No usage in this window. Zero-baseline rendered honestly
                            — the bound proxy will populate this once the agent
                            issues a request.
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
                        Scoped to events tagged with{' '}
                        <code
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--foreground)',
                          }}
                        >
                          app_slug={slug}
                        </code>
                        . For a global view, see{' '}
                        <Link
                          to="/user/usage-ledger"
                          className="underline"
                          style={{ color: 'var(--foreground)' }}
                        >
                          Cost · Usage
                        </Link>
                        .
                      </p>
                    </div>

                    {/* Top models meter list */}
                    <div className="cap-models-card cap-surface-subtle">
                      <div className="cap-mono-label">Top models</div>
                      <div className="mt-2 mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                        Ranked by total tokens in this range.
                      </div>
                      {topModels.length === 0 ? (
                        <div className="text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                          No model breakdown yet — empty range.
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
                                    {fmtInt(m.request_count)} req
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
                <div id="bearer-title" className="cap-mono-label">Issued bearer</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Active bearer tokens issued for this connected app.
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
                      ? 'Unlock vault first'
                      : undefined
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `Rotate bearer for "${data.app.name}"?\n\nThe agent's existing OPENAI_API_KEY will immediately become invalid.`,
                    )
                  ) {
                    rotateM.mutate();
                  }
                }}
              >
                <RotateCw size={14} /> Rotate bearer
              </button>
            </div>
            <div className="cap-section-body">
              {data.active_keys.length === 0 ? (
                <div className="text-[13px]" style={{ color: 'var(--muted-foreground)' }}>
                  No active bearer. Re-register via CLI:{' '}
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
                  {data.active_keys.map((k) => (
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
                        <div
                          className="mt-1 text-xs"
                          style={{ color: 'var(--muted-foreground)' }}
                        >
                          Plaintext is only shown at register or rotate time and is not re-readable here.
                        </div>
                      </div>
                      <div
                        className="text-right text-xs"
                        style={{
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        issued {relativeTime(k.created_at)} · last used {relativeTime(k.last_used_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ─── §D Audit Log placeholder ────────────────────────────── */}
          <section className="cap-section cap-audit-placeholder mb-5">
            <div className="cap-mono-label">Audit log</div>
            <p className="mt-3 mb-0 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
              App-scoped audit timeline will appear here once the audit endpoint is wired. The
              bound proxy already emits these events to the local WAL — recoverable but not
              surfaced here yet.
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
              Last action failed:{' '}
              {(pauseM.error || resumeM.error || revokeM.error || rotateM.error)?.message ?? 'unknown'}
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
