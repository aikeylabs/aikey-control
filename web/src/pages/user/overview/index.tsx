/**
 * User Overview page — /user/overview
 *
 * v3.1 layout (2026-04-22): derived from
 * `.superdesign/design_iterations/user_overview_3_1.html`.
 *
 *  - Identity strip (avatar + email + status) replaces the full-width
 *    welcome hero.
 *  - Auto-claim info banner (low-emphasis, dismissible) replaces the
 *    "Action Required" pending-claim hero. Claims are treated as
 *    auto-granted — the banner is passive, not a CTA.
 *  - 3-col metric row with sparklines / mini bars: Seats, Accessible
 *    Keys, Used · 30D.
 *  - Area chart (7D/14D/30D/90D, default 14D) + Top Providers donut.
 *  - Recent team keys table enlarged with provider swatch + last-used.
 *  - STATUS dot uses success green (decoupled from brand yellow).
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Label,
} from 'recharts';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { deliveryApi, type UserKeyDTO } from '@/shared/api/user/delivery';
import { vaultApi } from '@/shared/api/user/vault';
import { usageApi, type TimelinePoint, type ProtocolTotal, type HourlyPoint } from '@/shared/api/usage';
import { runtimeConfig } from '@/app/config/runtime';
import { formatDateShort, formatRelativeTime } from '@/shared/utils/datetime-intl';

// Provider palette: brand yellow for Anthropic, cool/violet counterbalances
// for the others. Matches `--chart-*` tokens in user_overview_3_1.html.
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#ca8a04',
  claude: '#ca8a04',
  kimi: '#38bdf8',
  moonshot: '#38bdf8',
  openai: '#a78bfa',
  gpt: '#a78bfa',
  codex: '#a78bfa',
  gemini: '#4ade80',
  google: '#4ade80',
};
function providerColor(name: string): string {
  const k = (name || '').toLowerCase();
  return PROVIDER_COLORS[k] ?? '#52525b';
}

type RangeKey = '7D' | '14D' | '30D' | '90D';
const RANGE_DAYS: Record<RangeKey, number> = { '7D': 7, '14D': 14, '30D': 30, '90D': 90 };

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/** YYYY-MM-DD **in the user's local timezone**. Matches the server
 * contract post bugfix 20260424: `?date=` / `?start_date=` /
 * `?end_date=` are interpreted as calendar days in the caller's
 * local tz (paired with `?tz=<IANA>`).
 *
 * Using `toISOString().slice(0,10)` (UTC date) here would desync:
 * a +08:00 user checking at local 00:15 would send UTC yesterday's
 * date, and the server would query the wrong 24-hour window —
 * missing up to 8 hours of "today". See frontend `dateParam()` and
 * `daysAgo()` in usage-ledger/index.tsx for the matching convention
 * on sibling pages. */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function padTimeline(data: TimelinePoint[], days: number): TimelinePoint[] {
  const map = new Map(data.map((p) => [p.date, p]));
  const out: TimelinePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgoStr(i);
    out.push(map.get(d) ?? { date: d, total_tokens: 0, request_count: 0 });
  }
  return out;
}

/** Back-compat shim — old in-page `relativeTime()` is now the shared
 * `formatRelativeTime` (locale-aware). Keep the name so call sites
 * don't need to change. Em-dash for empty/invalid input matches the
 * prior behaviour callers expect for "nothing to show". */
function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const s = formatRelativeTime(iso);
  return s || '—';
}

function shortVkId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-3)}`;
}

// Derive a human label for a usage-by-key row. Mirrors the rule used on
// /user/usage-ledger so the same key surfaces with the same label across
// pages: identity (email) wins over alias; raw `(oauth:)?session_<hex>`
// collapses to `OAuth · <hex8>…` so unreadable hex never reaches the UI.
function deriveKeyLabel(k: { alias?: string; identity?: string; virtual_key_id: string }): string {
  if (k.identity && k.identity.trim()) return k.identity;
  const oauthRe = /^(?:oauth:)?session_([a-f0-9]+)/i;
  const aliasStr = (k.alias ?? '').trim();
  const aliasOAuth = aliasStr.match(oauthRe);
  if (aliasOAuth) return `OAuth · ${aliasOAuth[1].slice(0, 8)}…`;
  if (aliasStr) return aliasStr;
  const id = (k.virtual_key_id || '').trim();
  if (!id) return 'unlabeled';
  const idOAuth = id.match(oauthRe);
  if (idOAuth) return `OAuth · ${idOAuth[1].slice(0, 8)}…`;
  if (id.startsWith('personal:')) return id.slice('personal:'.length);
  return id;
}

export default function UserOverviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>('14D');
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });
  const { data: rawSeats } = useQuery({ queryKey: ['my-seats'], queryFn: userAccountsApi.mySeats });
  const { data: rawKeys, isLoading: keysLoading } = useQuery({
    queryKey: ['my-all-keys'],
    queryFn: deliveryApi.allKeys,
  });
  const { data: rawPending } = useQuery({
    queryKey: ['my-pending-keys'],
    queryFn: deliveryApi.pendingKeys,
  });
  // Vault list drives the "Accessible Keys" metric (count, active/idle
  // split, provider preview, spark). Locked vault still returns
  // metadata-only records with counts populated, so the card stays
  // useful before unlock. 2026-04-24: repointed from deliveryApi (team
  // keys only) to vault so the number reflects what the user actually
  // holds locally — Personal + OAuth + Team.
  const { data: vaultList } = useQuery({
    queryKey: ['user-overview-vault'],
    queryFn: vaultApi.list,
  });

  // Usage identity — same rule as before (local_bypass uses org_id=personal).
  const accountId = me?.account_id;
  const isLocalMode = runtimeConfig.authMode === 'local_bypass';
  const usageIdentity = isLocalMode
    ? { org_id: 'personal' as const }
    : accountId ? { account_id: accountId } : null;
  const usageIdentityKey = isLocalMode ? 'personal' : (accountId ?? '');

  const days = RANGE_DAYS[range];
  const endDate = daysAgoStr(0);
  const startDate = daysAgoStr(days - 1);

  const usageTimeline = useQuery({
    queryKey: ['user-overview-timeline', usageIdentityKey, range],
    queryFn: () => usageApi.personalTimeline(usageIdentity!, startDate, endDate),
    enabled: !!usageIdentity,
  });
  const usageProtocols = useQuery({
    queryKey: ['user-overview-protocols', usageIdentityKey, range],
    queryFn: () => usageApi.personalByProtocolTotal(usageIdentity!, startDate, endDate),
    enabled: !!usageIdentity,
  });
  // Intra-day hourly buckets for today (UTC). Drives the "Today used"
  // metric card — main value is the day's total, mini chart shows the
  // 24-hour distribution. 2026-04-24: new endpoint /v1/usage/personal/
  // hourly was added to query-service specifically for this card; the
  // daily TimelinePoint API couldn't express sub-day resolution.
  const todayDate = daysAgoStr(0);
  const usageToday = useQuery({
    queryKey: ['user-overview-today-hourly', usageIdentityKey, todayDate],
    queryFn: () => usageApi.personalHourly(usageIdentity!, todayDate),
    enabled: !!usageIdentity,
  });
  // Per-key recent breakdown drives "Recent usage by key" below the main
  // chart. Auto-falls-through to the most recent active day when today
  // has no usage yet (e.g., early morning, fresh install) instead of
  // showing an empty card. Derived from usageTimeline so we don't need
  // a second per-day query — when today is empty we walk the timeline
  // backwards to find the latest day with non-zero usage. Independent
  // query key + 60s refetch keeps the card live.
  const activeDate = useMemo(() => {
    const tl = usageTimeline.data ?? [];
    for (let i = tl.length - 1; i >= 0; i--) {
      if (tl[i].total_tokens > 0) return tl[i].date;
    }
    return todayDate;
  }, [usageTimeline.data, todayDate]);
  const isShowingToday = activeDate === todayDate;
  const byKeyRecent = useQuery({
    queryKey: ['user-overview-by-key-recent', usageIdentityKey, activeDate],
    queryFn: () => usageApi.personalByKeyTotal(usageIdentity!, activeDate, activeDate),
    enabled: !!usageIdentity,
    refetchInterval: 60_000,
  });

  const seats = rawSeats ?? [];
  const allKeys = rawKeys ?? [];
  const pendingKeys = rawPending ?? [];
  const activeSeats = seats.filter((s) => s.seat_status === 'active');

  // Vault-backed stats for the "Accessible Keys" metric card. Personal
  // records carry status='active' unconditionally; OAuth records can be
  // active/revoked/expired/error — anything non-'active' counts as idle.
  // `counts.total` already equals personal + oauth + team, but we also
  // recompute here so the fallback path (vault unreachable, empty list)
  // stays 0 instead of NaN.
  const vaultRecords = vaultList?.records ?? [];
  const vaultTotalKeys = vaultList?.counts.total ?? vaultRecords.length;
  const vaultActiveKeys = vaultRecords.filter((r) => r.status === 'active').length;
  const vaultIdleKeys = Math.max(0, vaultTotalKeys - vaultActiveKeys);
  const vaultProviderNamesPreview = useMemo(() => {
    const names = new Set<string>();
    for (const r of vaultRecords) {
      const p = r.target === 'personal' ? r.provider_code : r.provider;
      if (p) names.add(p);
    }
    return Array.from(names).slice(0, 3);
  }, [vaultRecords]);
  const timelinePoints = useMemo(
    () => padTimeline(usageTimeline.data ?? [], days),
    [usageTimeline.data, days],
  );
  const totalTokens = timelinePoints.reduce((s, p) => s + p.total_tokens, 0);
  const avgPerDay = days > 0 ? Math.floor(totalTokens / days) : 0;
  const peak = timelinePoints.reduce(
    (acc, p) => (p.total_tokens > acc.total_tokens ? p : acc),
    { date: '', total_tokens: 0, request_count: 0 } as TimelinePoint,
  );

  // Today's 24-hour distribution — padded so every hour 0..23 is
  // present even when the backend returns only hours with activity.
  // Hours are UTC (same basis as TimelinePoint.date). The peakHour
  // value is used for the "peak at Nh" sub-line.
  const todayHourly = useMemo<HourlyPoint[]>(() => {
    const raw = usageToday.data ?? [];
    const byHour = new Map<number, HourlyPoint>();
    for (const h of raw) byHour.set(h.hour, h);
    const padded: HourlyPoint[] = [];
    for (let h = 0; h < 24; h++) {
      padded.push(byHour.get(h) ?? { hour: h, total_tokens: 0, request_count: 0 });
    }
    return padded;
  }, [usageToday.data]);
  const todayTotalTokens = todayHourly.reduce((s, p) => s + p.total_tokens, 0);
  const todayPeakHour = todayHourly.reduce(
    (acc, p) => (p.total_tokens > acc.total_tokens ? p : acc),
    { hour: 0, total_tokens: 0, request_count: 0 } as HourlyPoint,
  );

  // Recently auto-claimed = share_status "pending_claim" still flagged by
  // the backend but semantically "granted". Showing the newest one in the
  // passive banner keeps the old data model working with the new UX.
  const recentAutoClaim = pendingKeys[0];

  // Providers ranked by tokens; include 0% entries from accessible keys so
  // "idle" providers show up even without usage.
  const providerUsage = useMemo(() => buildProviderRows(usageProtocols.data ?? [], allKeys, totalTokens),
    [usageProtocols.data, allKeys, totalTokens]);

  // "Usage by key today" — 4-segment bar per account aligned to
  // Anthropic's prompt-caching tuple. Math: proxy's input_tokens already
  // includes both cache buckets (anthropic.go totalInput()), so:
  //   uncached = input - cached - creation
  //   total    = uncached + creation + cached + output  (= input + output)
  const todayKeyRows = useMemo(() => {
    const data = (byKeyRecent.data ?? []).map((k) => ({ ...k, label: deriveKeyLabel(k) }));
    const nonZero = data.filter((k) => k.total_tokens > 0);
    const sorted = [...nonZero].sort((a, b) => b.total_tokens - a.total_tokens);
    const top = sorted[0]?.total_tokens ?? 1;
    const grand = sorted.reduce((s, k) => s + k.total_tokens, 0) || 1;
    const grandReqs = sorted.reduce((s, k) => s + k.request_count, 0);
    const grandCached = sorted.reduce((s, k) => s + (k.cached_input_tokens ?? 0), 0);
    const grandCreation = sorted.reduce((s, k) => s + (k.cache_creation_input_tokens ?? 0), 0);
    return {
      rows: sorted.map((k) => {
        const inputAll = k.input_tokens ?? 0;
        const cached = k.cached_input_tokens ?? 0;
        const creation = k.cache_creation_input_tokens ?? 0;
        const cappedCached = Math.min(cached, inputAll);
        const cappedCreation = Math.min(creation, Math.max(inputAll - cappedCached, 0));
        const uncached = Math.max(inputAll - cappedCached - cappedCreation, 0);
        const output = k.output_tokens ?? 0;
        const denom = uncached + cappedCreation + cappedCached + output > 0
          ? uncached + cappedCreation + cappedCached + output
          : 1;
        return {
          ...k,
          uncached,
          creation: cappedCreation,
          cached: cappedCached,
          output,
          uncachedPctOfRow: (uncached / denom) * 100,
          creationPctOfRow: (cappedCreation / denom) * 100,
          cachedPctOfRow:   (cappedCached / denom) * 100,
          outputPctOfRow:   (output / denom) * 100,
          barPct: (k.total_tokens / top) * 100,
          sharePct: (k.total_tokens / grand) * 100,
        };
      }),
      grandTotal: sorted.reduce((s, k) => s + k.total_tokens, 0),
      grandCached,
      grandCreation,
      grandReqs,
      keyCount: sorted.length,
    };
  }, [byKeyRecent.data]);

  const uniqueOrgs = useMemo(() => {
    const s = new Set(activeSeats.map((x) => x.org_id));
    return s.size;
  }, [activeSeats]);

  const handleClaim = async (vkId: string) => {
    try {
      await deliveryApi.claimKey(vkId);
      queryClient.invalidateQueries({ queryKey: ['my-pending-keys'] });
      queryClient.invalidateQueries({ queryKey: ['my-all-keys'] });
    } catch {
      // Handled by global http-client interceptor
    }
  };

  const recentKeys = allKeys.slice(0, 5);
  const emailDisplay = me?.email ?? '—';
  const initial = emailDisplay.slice(0, 1).toUpperCase();

  return (
    <div className="overview-page p-6">
      <style>{OVERVIEW_CSS}</style>

      {/* Full-width layout matches usage-ledger / my-keys / pending-keys.
          Only reading-focused pages (account, referrals) cap width. */}
      <div className="space-y-5">
        {/* ── Identity strip ── */}
        <section className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded border flex items-center justify-center text-[13px] font-mono font-bold"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              {initial}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold font-mono tracking-wide truncate" style={{ color: 'var(--foreground)' }}>
                Hi, {emailDisplay}
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                <span>{(me?.role ?? 'MEMBER').toUpperCase()}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span className="inline-flex items-center gap-1.5" style={{ color: '#4ade80' }}>
                  <span className="status-dot" />
                  ACTIVE
                </span>
                {me?.created_at && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>Joined {new Date(me.created_at).toLocaleDateString(navigator.language)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="ov-btn ov-btn-ghost text-xs"
              onClick={() => window.open('https://github.com/aikeylabs/aikey', '_blank')}
            >
              <BookIcon />
              Docs
            </button>
          </div>
        </section>

        {/* ── Auto-claim info banner ── */}
        {!bannerDismissed && recentAutoClaim && (
          <div className="info-banner" role="status">
            <span className="dot" aria-hidden="true" />
            <SparklesIcon />
            <span className="flex-1 min-w-0 truncate text-[12.5px]" style={{ color: 'var(--foreground)' }}>
              {pendingKeys.length > 1 ? (
                <>
                  <span className="font-mono">{pendingKeys.length} new keys</span>{' '}
                  granted to you
                </>
              ) : (
                <>
                  Granted you{' '}
                  <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                    {recentAutoClaim.alias}
                  </span>
                </>
              )}
              <span style={{ color: 'var(--muted-foreground)' }}>
                {' '}· ready to use
              </span>
            </span>
            <button
              className="ov-link text-[11px] font-mono flex items-center gap-1"
              onClick={() => navigate('/user/virtual-keys')}
            >
              View keys
              <ArrowUpRightIcon />
            </button>
            <button
              className="icon-btn"
              title="Dismiss"
              aria-label="Dismiss notification"
              onClick={() => setBannerDismissed(true)}
            >
              <XIcon />
            </button>
          </div>
        )}

        {/* ── Metric row (3-col hero) ──
            Slot order (final 2026-04-24): Accessible Keys · My Seats ·
            Today Used. Inventory (keys, seats) comes first because that
            is what the user typically needs to confirm on landing;
            usage trends sit last and also anchor the reader's eye right
            above the larger Token usage time-series chart below. */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Accessible Keys — 2026-04-24: repointed to Vault.
              Counts Personal + OAuth + Team records in the local vault
              (vaultList.counts.total). The +N auto badge that used to
              surface pendingKeys (team-keys auto-claim signal) was
              dropped because it's a team-keys concept and mixing it
              into a vault-total metric makes the number misleading. */}
          <button
            type="button"
            className="metric linkable text-left"
            onClick={() => navigate('/user/vault')}
            aria-label={`Accessible keys: ${vaultTotalKeys}, ${vaultActiveKeys} active`}
          >
            <span className="go"><ChevronRightIcon /></span>
            <div className="label-row">
              <span className="label">Accessible Keys</span>
              <KeyIcon className="label-icon" />
            </div>
            <div className="value-row">
              <span className="value">{vaultTotalKeys}</span>
              {vaultTotalKeys > 0 && (
                <span className="value-suffix">
                  · {vaultActiveKeys} active{vaultIdleKeys > 0 ? ` · ${vaultIdleKeys} idle` : ''}
                </span>
              )}
            </div>
            <span className="unit">
              {vaultProviderNamesPreview.length > 0 ? vaultProviderNamesPreview.join(' · ') : 'No keys yet'}
            </span>
            {/* Active / idle split. Renders a flat muted baseline when there
                are no keys at all — an "up and flat" step chart would falsely
                imply activity in the empty state. */}
            <svg className="spark" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
              {vaultTotalKeys === 0 ? (
                <rect x="0" y="4" width="100" height="4" rx="2" fill="var(--border)" />
              ) : (
                (() => {
                  const ratio = vaultActiveKeys / vaultTotalKeys;
                  const activeW = Math.max(Math.round(ratio * 100), ratio > 0 ? 4 : 0);
                  return (
                    <>
                      <rect x="0" y="4" width="100" height="4" rx="2" fill="var(--border)" />
                      {activeW > 0 && (
                        <rect x="0" y="4" width={activeW} height="4" rx="2" fill="#ca8a04" opacity="0.85" />
                      )}
                    </>
                  );
                })()
              )}
            </svg>
          </button>

          {/* My Seats */}
          <button
            type="button"
            className="metric linkable text-left"
            onClick={() => navigate('/user/account')}
            aria-label={`My seats: ${activeSeats.length} active across ${uniqueOrgs} organisations`}
          >
            <span className="go"><ChevronRightIcon /></span>
            <div className="label-row">
              <span className="label">My Seats</span>
              <UsersIcon className="label-icon" />
            </div>
            <div className="value-row">
              <span className="value">{activeSeats.length}</span>
              <span className="value-suffix">active</span>
            </div>
            <span className="unit">
              <BuildingIcon className="w-3 h-3" />
              {uniqueOrgs > 0 ? `${uniqueOrgs} org${uniqueOrgs > 1 ? 's' : ''}` : 'No organisations yet'}
            </span>
            {/* slots bar */}
            <svg className="spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
              {activeSeats.length === 0 ? (
                <rect x="0" y="6" width="100" height="8" rx="2" fill="var(--border)" />
              ) : (
                Array.from({ length: Math.min(activeSeats.length, 6) }).map((_, i, arr) => {
                  const n = arr.length;
                  const gap = 4;
                  const w = (100 - gap * (n - 1)) / n;
                  const x = i * (w + gap);
                  return <rect key={i} x={x} y={6} width={w} height={8} rx={2} fill="#ca8a04" opacity={0.85} />;
                })
              )}
            </svg>
          </button>

          {/* Today used — intra-day hourly distribution (UTC).
              Slot #3 (final 2026-04-24): placed adjacent to the Token
              usage area chart below so the intra-day spark + the
              7D/14D/30D/90D time-series read as one continuous usage
              story. */}
          <button
            type="button"
            className="metric linkable text-left"
            onClick={() => navigate('/user/usage-ledger')}
            aria-label={`Today used: ${fmtTok(todayTotalTokens)} tokens`}
          >
            <span className="go"><ChevronRightIcon /></span>
            <div className="label-row">
              <span className="label">Today Used</span>
              <ActivityIcon className="label-icon" />
            </div>
            <div className="value-row">
              <span className="value">{fmtTok(todayTotalTokens)}</span>
              <span className="value-suffix">tokens</span>
            </div>
            <span className="unit">
              {todayTotalTokens === 0
                ? 'No usage yet today'
                : <>peak at {String(todayPeakHour.hour).padStart(2, '0')}:00 · {fmtTok(todayPeakHour.total_tokens)}</>}
            </span>
            {/* 24-bar intra-day distribution. Hours with activity are
                primary-coloured; the peak hour is rendered at full
                opacity so it stands out. An all-zero day collapses to
                a flat muted baseline (consistent with the Accessible
                Keys empty state). */}
            <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
              {todayTotalTokens === 0 ? (
                <rect x="0" y="14" width="100" height="4" rx="2" fill="var(--border)" />
              ) : (
                (() => {
                  const maxV = Math.max(...todayHourly.map((p) => p.total_tokens), 1);
                  const barW = 100 / 24;
                  return todayHourly.map((p) => {
                    const h = (p.total_tokens / maxV) * 28;
                    const y = 32 - h;
                    const isPeak = p.total_tokens === todayPeakHour.total_tokens && todayPeakHour.total_tokens > 0;
                    const hasValue = p.total_tokens > 0;
                    return (
                      <rect
                        key={p.hour}
                        x={p.hour * barW + 0.5}
                        y={hasValue ? y : 31}
                        width={Math.max(barW - 1, 1)}
                        height={hasValue ? Math.max(h, 0.5) : 1}
                        fill={isPeak ? '#ca8a04' : (hasValue ? 'var(--muted-foreground)' : 'var(--border)')}
                        opacity={isPeak ? 1 : (hasValue ? 0.55 : 0.5)}
                      />
                    );
                  });
                })()
              )}
            </svg>
          </button>
        </section>

        {/* ── Usage + Top Providers ── */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Bar chart — flex column so the chart body expands to fill any
              extra height granted by the right-column donut card (taller
              when its provider list grows), and stays vertically centered
              within whatever real estate it ends up with. Without
              flex-col + flex-1 the chart sat at a fixed 180px regardless,
              creating an empty stripe at the bottom on tall donut runs. */}
          <div className="card col-span-12 md:col-span-8 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Token usage
                </h3>
                <p className="text-[12px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
                  Your consumption across all accessible keys
                </p>
              </div>
              <div className="seg" role="tablist" aria-label="Time range">
                {(['7D', '14D', '30D', '90D'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={range === k}
                    className={range === k ? 'active' : ''}
                    onClick={() => setRange(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* Area chart — tokens only (requests intentionally omitted per
                2026-04-23 UX ask: Overview's hero chart stays focused on
                volume; the dual-axis breakdown lives on the Usage page).
                Outer flex-1 wrapper grows to fill any extra height the
                grid grants the card; inner box has a *definite pixel*
                height so Recharts' ResponsiveContainer can measure on
                first render (percentage heights against a flex-1 parent
                whose own height isn't yet resolved by grid auto-rows
                emit a "width(-1) and height(-1)" warning). 200px ≈ 80%
                of typical card heights, with the flex centering giving
                ~10% breathing room top/bottom on stretched cards. */}
            <div className="w-full flex-1 flex items-center justify-center min-h-[220px]">
              <div className="w-full h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelinePoints} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="ov-area-grad" x1="0" y1="0" x2="0" y2="1">
                      {/* Chart tone aligned with /master dashboard + usage-
                          ledger — yellow-600 (#ca8a04) instead of the bright
                          yellow-400 brand color, so both consoles render
                          usage in the same chart palette. */}
                      <stop offset="0%" stopColor="#ca8a04" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#ca8a04" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Compact hero card — tickCount={2} keeps a single top
                      gridline + the x-axis baseline. */}
                  <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fontFamily: 'monospace', fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickFormatter={(d: string) => formatDateShort(d)}
                    interval={Math.max(Math.floor(timelinePoints.length / 6) - 1, 0)}
                  />
                  <YAxis
                    tickFormatter={fmtTok}
                    tick={{ fontSize: 9, fontFamily: 'monospace', fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tickCount={2}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      borderRadius: 4,
                    }}
                    formatter={(v) => [fmtTok(Number(v)), 'tokens']}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_tokens"
                    stroke="#ca8a04"
                    strokeWidth={1.8}
                    fill="url(#ov-area-grad)"
                  />
                </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div
              className="mt-2 pt-3 flex items-center justify-between text-[12px] font-mono flex-wrap gap-2"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
            >
              <span>
                Total{' '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {fmtTok(totalTokens)} tokens
                </span>
              </span>
              <span>
                Peak{' '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {peak.total_tokens > 0 ? `${fmtTok(peak.total_tokens)} · ${peak.date}` : '—'}
                </span>
              </span>
              <span>
                Avg/day{' '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {fmtTok(avgPerDay)}
                </span>
              </span>
            </div>
          </div>

          {/* Top Providers list */}
          <div className="card col-span-12 md:col-span-4 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Top providers
                </h3>
                <p className="text-[12px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
                  Your {range} split
                </p>
              </div>
              <button
                type="button"
                className="ov-btn ov-btn-ghost text-[11px]"
                onClick={() => navigate('/user/usage-ledger')}
              >
                View all
                <ChevronRightIcon />
              </button>
            </div>

            {/* Donut — swap from list-with-bars (2026-04-23). Slices use
                providerColor so the hue mapping stays consistent with
                the usage-ledger by-protocol legend. Idle providers
                (0% / 0 tokens) don't produce a slice but still appear
                in the legend below so the user can see them. */}
            {providerUsage.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                No data
              </div>
            ) : (
              <>
                <div className="w-full h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={providerUsage.filter((r) => r.tokens > 0)}
                        dataKey="tokens"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius="90%"
                        innerRadius="72%"
                        paddingAngle={1}
                        stroke="none"
                      >
                        {providerUsage
                          .filter((r) => r.tokens > 0)
                          .map((r) => <Cell key={r.name} fill={r.color} />)}
                        <Label
                          value={fmtTok(totalTokens)}
                          position="center"
                          dy={-8}
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '1rem',
                            fontWeight: 700,
                            fill: 'var(--foreground)',
                          }}
                        />
                        <Label
                          value="TOKENS"
                          position="center"
                          dy={8}
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.625rem',
                            letterSpacing: '0.08em',
                            fill: 'var(--muted-foreground)',
                          }}
                        />
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          fontFamily: 'monospace',
                          fontSize: 11,
                          borderRadius: 4,
                        }}
                        formatter={(v) => fmtTok(Number(v))}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Mini legend under the donut — tiny dot + name + pct. Keeps
                    idle providers visible (donut omits them because 0 slice). */}
                <ul className="space-y-1 mt-2">
                  {providerUsage.map((row) => {
                    const idle = row.pct === 0;
                    return (
                      <li
                        key={row.name}
                        className="flex items-center justify-between text-[11.5px]"
                        style={{ opacity: idle ? 0.55 : 1 }}
                        title={idle ? 'No usage in the selected range' : undefined}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                            style={{ background: row.color }}
                          />
                          <span className="truncate" style={{ color: 'var(--foreground)' }}>{row.name}</span>
                          {idle && <span className="chip idle">idle</span>}
                        </span>
                        <span className="font-mono text-[12px]">
                          <span style={{ color: idle ? 'var(--muted-foreground)' : 'var(--foreground)' }}>
                            {idle ? '—' : fmtTok(row.tokens)}
                          </span>
                          <span className="ml-2" style={{ color: 'var(--muted-foreground)' }}>{row.pct}%</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <div
              className="mt-4 pt-3 flex items-center justify-between text-[12px] font-mono"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
            >
              <span>
                {providerUsage.length} provider{providerUsage.length === 1 ? '' : 's'}
                {(() => {
                  const idle = providerUsage.filter((r) => r.pct === 0).length;
                  return idle > 0 ? ` · ${idle} idle` : '';
                })()}
              </span>
              <span>Last {days}D</span>
            </div>
          </div>
        </section>

        {/* ── Usage by key today (live, per-account input/cache/output split) ──
            Layout aligned to Token usage / Top providers pattern:
              header (title + minimal subtitle, mb-3) → body → footer
              divider (mt-4 pt-3 border-top) carrying the aggregate
              metrics. Avoids the cramped header that was packing date +
              4 aggregate numbers on one line. */}
        <section className="card p-4" data-origin-name="Usage by key today">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="min-w-0">
              <h3 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                {/* Live dot only when actually showing today — when we
                    fell through to an earlier day, the data is no
                    longer "live", so the pulsing indicator is dropped. */}
                {isShowingToday && <span className="ov-live-dot" aria-hidden />}
                {isShowingToday ? ' Usage by key today' : ' Recent usage by key'}
              </h3>
              <p className="text-[12px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
                {activeDate}{isShowingToday ? '' : ' · no usage today yet'}
              </p>
            </div>
            {todayKeyRows.keyCount > 0 && (
              <div className="ov-legend">
                <span className="ov-legend-item">
                  <span className="ov-legend-dot" style={{ background: '#ca8a04' }} />
                  uncached
                </span>
                <span className="ov-legend-item">
                  <span className="ov-legend-dot" style={{ background: 'rgba(202,138,4,0.7)' }} />
                  creation
                </span>
                <span className="ov-legend-item">
                  <span className="ov-legend-dot" style={{ background: 'rgba(202,138,4,0.45)' }} />
                  cached
                </span>
                <span className="ov-legend-item">
                  <span className="ov-legend-dot" style={{ background: 'rgba(202,138,4,0.2)' }} />
                  output
                </span>
              </div>
            )}
          </div>

          {byKeyRecent.isLoading ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              Loading...
            </div>
          ) : todayKeyRows.rows.length === 0 ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              No usage recorded yet
            </div>
          ) : (
            <ul className="space-y-3">
              {todayKeyRows.rows.map((k) => (
                <li key={k.virtual_key_id} className="ov-key-row">
                  <span
                    className="font-mono text-[11.5px] truncate"
                    title={k.label}
                    style={{ color: 'var(--foreground)' }}
                  >
                    {k.label}
                  </span>
                  <div
                    className="ov-key-bar"
                    title={`uncached ${fmtTok(k.uncached)} · creation ${fmtTok(k.creation)} · cached ${fmtTok(k.cached)} · output ${fmtTok(k.output)} · ${k.request_count.toLocaleString()} req`}
                  >
                    <div
                      className="ov-key-bar-fill"
                      style={{ width: `${Math.max(k.barPct, 0.5)}%` }}
                    >
                      <span className="seg-uncached" style={{ width: `${k.uncachedPctOfRow}%` }} />
                      <span className="seg-creation" style={{ width: `${k.creationPctOfRow}%` }} />
                      <span className="seg-cached"   style={{ width: `${k.cachedPctOfRow}%`   }} />
                      <span className="seg-output"   style={{ width: `${k.outputPctOfRow}%`   }} />
                    </div>
                  </div>
                  {/* Per-row breakdown — small colored marker before each value
                      mirroring the bar segments. 0-valued buckets are hidden
                      to avoid `0` noise on non-Anthropic rows (no cache buckets)
                      or first-turn rows (no cached_read yet). Total + share%
                      stay rightmost as the primary at-a-glance metric. */}
                  <div className="ov-key-stats font-mono text-[11.5px] whitespace-nowrap">
                    {k.uncached > 0 && (
                      <span className="ov-stat" title="uncached">
                        <span className="ov-stat-dot ov-stat-uncached" />{fmtTok(k.uncached)}
                      </span>
                    )}
                    {k.creation > 0 && (
                      <span className="ov-stat" title="cache_creation">
                        <span className="ov-stat-dot ov-stat-creation" />{fmtTok(k.creation)}
                      </span>
                    )}
                    {k.cached > 0 && (
                      <span className="ov-stat" title="cache_read">
                        <span className="ov-stat-dot ov-stat-cached" />{fmtTok(k.cached)}
                      </span>
                    )}
                    {k.output > 0 && (
                      <span className="ov-stat" title="output">
                        <span className="ov-stat-dot ov-stat-output" />{fmtTok(k.output)}
                      </span>
                    )}
                    <span className="ov-stat-total">
                      <span style={{ color: 'var(--foreground)' }}>{fmtTok(k.total_tokens)}</span>
                      <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>
                        {k.sharePct < 1 ? '<1%' : `${Math.round(k.sharePct)}%`}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {todayKeyRows.keyCount > 0 && (
            <div
              className="mt-4 pt-3 flex items-center justify-between text-[12px] font-mono flex-wrap gap-2"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
            >
              <span>
                {todayKeyRows.keyCount} key{todayKeyRows.keyCount === 1 ? '' : 's'}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayKeyRows.grandTotal)}</span>
                {' total'}
                {todayKeyRows.grandCreation > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayKeyRows.grandCreation)}</span>
                    {' creation'}
                  </>
                )}
                {todayKeyRows.grandCached > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayKeyRows.grandCached)}</span>
                    {' cached'}
                  </>
                )}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{todayKeyRows.grandReqs.toLocaleString()}</span>
                {' req'}
              </span>
            </div>
          )}
        </section>

        {/* ── Recent Team Keys ── */}
        <section className="card" data-origin-name="Recent Virtual Keys">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                Recent team keys
              </h3>
              <span className="chip">{allKeys.length} accessible</span>
            </div>
            <button
              type="button"
              className="ov-btn ov-btn-outline text-[11px]"
              onClick={() => navigate('/user/virtual-keys')}
            >
              View all
              <ArrowRightIcon />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="vault w-full">
              <thead>
                <tr>
                  <th className="px-4 py-2.5">Alias</th>
                  <th className="px-4 py-2.5">Protocols</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Expires</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keysLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      Loading...
                    </td>
                  </tr>
                ) : recentKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      No team keys assigned yet
                    </td>
                  </tr>
                ) : (
                  recentKeys.map((k: UserKeyDTO) => (
                    <tr key={k.virtual_key_id}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium" style={{ color: 'var(--foreground)' }}>{k.alias}</div>
                        <div
                          className="text-[11px] font-mono mt-0.5"
                          style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                        >
                          {shortVkId(k.virtual_key_id)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--foreground)' }}>
                          <span className="prov-dot" style={{ backgroundColor: providerColor(k.provider_code) }} />
                          {k.provider_code || 'unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <KeyStatusChip keyStatus={k.key_status} shareStatus={k.share_status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                        {k.expires_at ? relativeTime(k.expires_at) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {k.share_status === 'pending_claim' ? (
                          <button
                            type="button"
                            className="ov-btn ov-btn-outline text-[11px]"
                            style={{ borderColor: 'rgba(250, 204, 21,0.5)', color: 'var(--primary)' }}
                            onClick={() => handleClaim(k.virtual_key_id)}
                          >
                            Claim
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ov-btn ov-btn-outline text-[11px]"
                            onClick={() => navigate('/user/virtual-keys')}
                          >
                            Use
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Footer links ── */}
        <section
          className="flex items-center justify-between text-[12px] font-mono pt-1 pb-6"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <div className="flex items-center gap-4">
            <a className="ov-link" href="https://github.com/aikeylabs" target="_blank" rel="noreferrer">
              <BookIcon /> Docs
            </a>
            <a className="ov-link" href="https://github.com/aikeylabs/aikey/issues" target="_blank" rel="noreferrer">
              <SupportIcon /> Support
            </a>
          </div>
          <span>{runtimeConfig.buildVersion ? `v${runtimeConfig.buildVersion}` : ''} · aikey vault</span>
        </section>
      </div>
    </div>
  );
}

/* ── Provider row builder ──────────────────────────────────────────── */

interface ProviderRow {
  name: string;
  tokens: number;
  pct: number;
  color: string;
}

function buildProviderRows(
  totals: ProtocolTotal[],
  keys: UserKeyDTO[],
  totalTokens: number,
): ProviderRow[] {
  const accum = new Map<string, number>();
  for (const t of totals) {
    const k = (t.protocol_type || 'unknown').toLowerCase();
    accum.set(k, (accum.get(k) ?? 0) + t.total_tokens);
  }
  // Ensure providers from accessible keys are represented even with 0 usage.
  for (const k of keys) {
    const p = (k.provider_code || '').toLowerCase();
    if (!p) continue;
    if (!accum.has(p)) accum.set(p, 0);
  }
  const rows: ProviderRow[] = Array.from(accum.entries()).map(([name, tokens]) => ({
    name,
    tokens,
    pct: totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0,
    color: providerColor(name),
  }));
  rows.sort((a, b) => b.tokens - a.tokens);
  return rows.slice(0, 5);
}

/* ── Key status chip ───────────────────────────────────────────────── */

function KeyStatusChip({ keyStatus, shareStatus }: { keyStatus: string; shareStatus: string }) {
  if (shareStatus === 'pending_claim') {
    return (
      <span className="chip" style={{ color: 'var(--primary)', background: 'rgba(250, 204, 21,0.08)', borderColor: 'rgba(250, 204, 21,0.3)' }}>
        <ClockIcon /> PENDING
      </span>
    );
  }
  if (keyStatus === 'active') {
    return (
      <span className="chip" style={{ color: '#4ade80', background: 'rgba(74,222,128,0.08)', borderColor: 'rgba(74,222,128,0.3)' }}>
        <span className="status-dot" style={{ width: 5, height: 5 }} />
        ACTIVE
      </span>
    );
  }
  if (keyStatus === 'revoked' || keyStatus === 'expired') {
    return (
      <span className="chip" style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.3)' }}>
        {keyStatus.toUpperCase()}
      </span>
    );
  }
  return <span className="chip">{keyStatus.toUpperCase()}</span>;
}

/* ── Inline SVG icons ──────────────────────────────────────────────── */

function ChevronRightIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}
function ArrowRightIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
    </svg>
  );
}
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}
function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
    </svg>
  );
}
/** Heroicons v2 "key" — same silhouette as virtual-keys' `KeyIconSmall`
 *  so the two pages read as a consistent icon system. The metric-card
 *  Accessible Keys label used to have no glyph at all; added 2026-04-24
 *  to restore the template slot (user_overview_3_1.html §metric row) and
 *  match the Seats / Activity cards' icon treatment. */
function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}
function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12h2.25l3-6 3 12 3-9 3 6h5.25" />
    </svg>
  );
}
function SparklesIcon({ size }: { size?: number }) {
  const s = size ?? 14;
  return (
    <svg width={s} height={s} className="flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: '#4ade80' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.562L16.5 21.75l-.398-1.188a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.188-.398a2.25 2.25 0 001.423-1.423L16.5 15.75l.398 1.188a2.25 2.25 0 001.423 1.423L19.5 18.75l-1.188.398a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}
function SupportIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.712 4.33a9 9 0 011.79 1.79l-3.536 3.536a4.5 4.5 0 00-1.79-1.79l3.536-3.536zm1.79 13.98a9 9 0 01-1.79 1.79l-3.536-3.536a4.5 4.5 0 001.79-1.79l3.536 3.536zM5.69 17.72a9 9 0 01-1.79-1.79l3.536-3.536a4.5 4.5 0 001.79 1.79L5.69 17.72zM3.9 5.69a9 9 0 011.79-1.79l3.536 3.536a4.5 4.5 0 00-1.79 1.79L3.9 5.69zM16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

/* ── Inline CSS — scoped to .overview-page ─────────────────────────── */

const OVERVIEW_CSS = `
.overview-page .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
  display: inline-block;
  flex-shrink: 0;
}

.overview-page .info-banner {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.55rem 0.9rem;
  border-radius: 6px;
  background: rgba(74, 222, 128, 0.05);
  border: 1px solid rgba(74, 222, 128, 0.25);
}
.overview-page .info-banner .dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
  flex-shrink: 0;
}

.overview-page .metric {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.1rem;
  display: flex; flex-direction: column; gap: 4px;
  position: relative;
  transition: border-color 150ms ease;
  width: 100%;
  cursor: pointer;
}
.overview-page .metric:hover { border-color: var(--muted-foreground); }
.overview-page .metric .label-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem;
}
.overview-page .metric .label {
  /* Master h2-style card titles: text-xs mono bold tracking-wider
     muted-foreground (matches pages/master/* across the board).
     2026-04-25 alignment — earlier we made these look like h3s but
     the h3s themselves are now also on this master pattern, so
     everything rejoins the same muted-gray title rhythm. */
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--muted-foreground);
}
.overview-page .metric .label-icon {
  width: 14px; height: 14px;
  color: var(--muted-foreground);
}
.overview-page .metric .value-row {
  display: flex; align-items: baseline; gap: 0.5rem;
  margin-top: 2px;
}
.overview-page .metric .value {
  font-family: monospace;
  font-size: 30px;
  font-weight: 700;
  color: var(--foreground);
  line-height: 1;
  letter-spacing: -0.01em;
}
.overview-page .metric .value-suffix {
  font-family: monospace;
  font-size: 12px;
  color: var(--muted-foreground);
}
.overview-page .metric .unit {
  font-family: monospace;
  font-size: 12px;
  color: var(--muted-foreground);
  display: inline-flex; align-items: center; gap: 0.35rem;
}
.overview-page .metric .spark {
  margin-top: 0.5rem;
  display: block;
  width: 100%; height: 32px;
}
.overview-page .metric .mini-badge {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-family: monospace;
  font-size: 9px;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(74, 222, 128, 0.08);
  color: #4ade80;
  border: 1px solid rgba(74, 222, 128, 0.25);
}
/* Hover-arrow moved 2026-04-25 from top-right to vertical-center
   right side — top-right collided with the per-card title icon (key /
   user / clock SVGs sit at top: 10px; right: 10px). Centering it
   vertically keeps it visible on hover without overlap. */
.overview-page .metric .go {
  position: absolute; top: 50%; right: 12px;
  transform: translate(-2px, -50%);
  opacity: 0;
  transition: opacity 150ms ease, transform 150ms ease;
  color: var(--muted-foreground);
}
.overview-page .metric:hover .go { opacity: 1; transform: translate(0, -50%); }

.overview-page .seg {
  display: inline-flex;
  padding: 2px;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.overview-page .seg button {
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.05em;
  padding: 3px 9px;
  border-radius: 4px;
  color: var(--muted-foreground);
  transition: background 120ms ease, color 120ms ease;
  background: transparent;
  border: none;
  cursor: pointer;
}
.overview-page .seg button:hover { color: var(--foreground); }
.overview-page .seg button.active {
  background: var(--card);
  color: var(--foreground);
  box-shadow: inset 0 0 0 1px var(--border);
}

.overview-page .card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.overview-page .chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 3px 8px;
  font-size: 11px;
  font-family: monospace;
  border-radius: 4px;
  background: rgba(0,0,0,0.2);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.overview-page .chip.idle {
  padding: 1px 5px;
  font-size: 9px;
}

.overview-page .prov-dot {
  width: 8px; height: 8px; border-radius: 2px;
  display: inline-block;
  flex-shrink: 0;
}
.overview-page .prov-bar {
  position: relative;
  height: 8px;
  background: rgba(255,255,255,0.04);
  border-radius: 2px;
  overflow: hidden;
}
.overview-page .prov-bar > span {
  position: absolute; inset: 0 auto 0 0;
  border-radius: 2px;
  height: 100%;
}

.overview-page table.vault th {
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  font-weight: 600;
  text-align: left;
  background: rgba(0,0,0,0.2);
  border-bottom: 1px solid var(--border);
}
.overview-page table.vault td { border-bottom: 1px solid var(--border); font-size: 13px; }
/* Keep the last row's bottom border — stacks with the card's outer
   bottom border to produce the master-style "double line" at the end
   of the table. */
.overview-page table.vault tbody tr { transition: background 120ms ease; }
.overview-page table.vault tbody tr:hover { background: rgba(250, 204, 21, 0.035); }

.overview-page .ov-btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-weight: 600;
  border-radius: 6px;
  transition: background 150ms ease, border-color 150ms ease, color 120ms ease;
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;
  padding: 4px 10px;
  background: transparent;
}
.overview-page .ov-btn-outline {
  background: rgba(0,0,0,0.25);
  color: var(--foreground);
  border-color: var(--border);
}
.overview-page .ov-btn-outline:hover {
  border-color: var(--muted-foreground);
  background: rgba(255,255,255,0.03);
}
.overview-page .ov-btn-ghost {
  color: var(--muted-foreground);
}
.overview-page .ov-btn-ghost:hover {
  color: var(--foreground);
  background: rgba(255,255,255,0.03);
}

.overview-page .icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--muted-foreground);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.overview-page .icon-btn:hover {
  color: var(--foreground);
  background: rgba(0,0,0,0.25);
  border-color: var(--border);
}

.overview-page .ov-link {
  display: inline-flex; align-items: center; gap: 0.35rem;
  color: var(--muted-foreground);
  transition: color 120ms ease;
  background: transparent;
  border: none;
  cursor: pointer;
}
.overview-page .ov-link:hover {
  color: var(--foreground);
}

/* ── "Usage by key today" card — share-of-day bar with 4 gold-shade
 *    segments (uncached / cache_creation / cache_read / output). ── */
.overview-page .ov-live-dot {
  display: inline-block;
  width: 7px; height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: #ca8a04;
  box-shadow: 0 0 6px rgba(250, 204, 21, 0.6);
  animation: ov-live-pulse 1.6s ease-in-out infinite;
  vertical-align: middle;
}
@keyframes ov-live-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}
.overview-page .ov-legend {
  display: inline-flex; align-items: center; gap: 1rem;
  font-family: monospace;
  font-size: 11.5px;
  color: var(--muted-foreground);
  flex-wrap: wrap;
}
.overview-page .ov-legend-item {
  display: inline-flex; align-items: center; gap: 0.4rem;
}
.overview-page .ov-legend-dot {
  width: 9px; height: 9px;
  border-radius: 2px;
  display: inline-block;
  flex-shrink: 0;
}
.overview-page .ov-key-row {
  display: grid;
  grid-template-columns: minmax(140px, 260px) 1fr auto;
  align-items: center;
  gap: 0.75rem;
}
.overview-page .ov-key-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  color: var(--muted-foreground);
  text-align: right;
}
.overview-page .ov-stat {
  display: inline-flex;
  align-items: center;
}
.overview-page .ov-stat-dot {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 2px;
  margin-right: 5px;
  flex-shrink: 0;
}
.overview-page .ov-stat-dot.ov-stat-uncached { background: #ca8a04; }
.overview-page .ov-stat-dot.ov-stat-creation { background: rgba(202, 138, 4, 0.7); }
.overview-page .ov-stat-dot.ov-stat-cached   { background: rgba(202, 138, 4, 0.45); }
.overview-page .ov-stat-dot.ov-stat-output   { background: rgba(202, 138, 4, 0.2); }
.overview-page .ov-stat-total {
  margin-left: 0.35rem;
  padding-left: 0.85rem;
  border-left: 1px solid var(--border);
}
.overview-page .ov-key-bar {
  position: relative;
  height: 10px;
  border-radius: 3px;
  background: rgba(255,255,255,0.04);
  overflow: hidden;
}
.overview-page .ov-key-bar > .ov-key-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  display: flex;
  border-radius: 3px;
  overflow: hidden;
  transition: width 200ms ease;
}
.overview-page .ov-key-bar-fill > span {
  display: block;
  height: 100%;
  transition: width 200ms ease;
}
.overview-page .ov-key-bar-fill > .seg-uncached {
  background: #ca8a04;
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.3);
}
.overview-page .ov-key-bar-fill > .seg-creation {
  background: rgba(202, 138, 4, 0.7);
}
.overview-page .ov-key-bar-fill > .seg-cached {
  background: rgba(202, 138, 4, 0.45);
}
.overview-page .ov-key-bar-fill > .seg-output {
  background: rgba(202, 138, 4, 0.2);
}
`;
