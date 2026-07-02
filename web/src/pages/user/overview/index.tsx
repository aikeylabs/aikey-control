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
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { importApi } from '@/shared/api/user/import';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
  PieChart, Pie, Cell, Label,
} from 'recharts';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { deliveryApi, routedGroupAccount, type UserKeyDTO } from '@/shared/api/user/delivery';
import { vaultApi, type VaultListData } from '@/shared/api/user/vault';
import { usageApi, type TimelinePoint, type ProtocolTotal, type HourlyPoint, type RecentRequest } from '@/shared/api/usage';
import { runtimeConfig } from '@/app/config/runtime';
import { formatDateShort, formatRelativeTime } from '@/shared/utils/datetime-intl';
import { formatCost } from '@/shared/utils/formatCost';
import {
  OWN_MENU,
  OWN_PERSONAL_MENU,
  getOtherBaseUrl,
} from '@/shared/cross-app-menu';
import type { AccountDTO } from '@/shared/api/types/account';

// Phase 3B R23 (2026-05-11): same-side detection — A bundle's OWN_MENU
// reference-equals OWN_PERSONAL_MENU; B bundle's points at OWN_TEAM_MENU.
const IS_PERSONAL_SIDE = OWN_MENU === OWN_PERSONAL_MENU;

// Provider palette: brand yellow for Anthropic, cool/violet counterbalances
// for the others. Matches `--chart-*` tokens in user_overview_3_1.html.
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#ca8a04',
  claude: '#ca8a04',
  kimi: '#38bdf8',
  // 2026-05-08: kimi_code shares Kimi family hue (sky blue) — same brand,
  // distinct protocol code per Kimi-family decisions in
  // update/20260508-Kimi-family互斥-active-env统一KIMI写入.md.
  kimi_code: '#38bdf8',
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

/** 2026-05-28 — added '1D'. When range === '1D' the hero timeline
 * switches to hourly granularity (24 buckets in the user's local tz);
 * the by-protocol donut narrows to today and renders as usual. See
 * personalHourly for the hourly source. */
type RangeKey = '1D' | '7D' | '14D' | '30D' | '90D';
const RANGE_DAYS: Record<RangeKey, number> = { '1D': 1, '7D': 7, '14D': 14, '30D': 30, '90D': 90 };

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
  // 1D mode (days=1): the upstream queryFn already reshaped hourly data
  // into TimelinePoint with date="HH:00". Pad to 24 buckets so the
  // chart axis stays continuous; using the daily key (YYYY-MM-DD)
  // here would not match and produce a single empty bar.
  if (days === 1) {
    const map = new Map(data.map((p) => [p.date, p]));
    const out: TimelinePoint[] = [];
    for (let h = 0; h < 24; h++) {
      const k = String(h).padStart(2, '0') + ':00';
      out.push(map.get(k) ?? { date: k, total_tokens: 0, request_count: 0 });
    }
    return out;
  }
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
  // 2026-06-09 (v2 — user feedback follow-up): keep any `kind:` prefix
  // INTACT (e.g. `oauth:`, `probe:`), then take 6 chars of the body and
  // 5 chars of the tail, separated by `…`. Earlier v1 (`first6 of whole
  // id`) silently swallowed the kind marker as the "first 6" — for
  // `oauth:session_…` you'd see `oauth:…e95a5` and the user had no
  // visibility into the body. Format is now:
  //   - `oauth:session_966…` → `oauth:sessio…e95a5`
  //   - `probe:FreySilvaqzs…` → `probe:FreySi…e.com`
  //   - plain UUID (no `:`) → `5f9758…61eb6` (same as v1)
  //
  // Threshold logic: only truncate when the trunc form is SHORTER than
  // the full id. trunc form length = prefix.length + 6 + 1 + 5.
  const colonIdx = id.indexOf(':');
  if (colonIdx >= 0 && colonIdx < id.length - 1) {
    const prefix = id.slice(0, colonIdx + 1); // includes the colon
    const body = id.slice(colonIdx + 1);
    if (body.length <= 12) return id;
    return `${prefix}${body.slice(0, 6)}…${body.slice(-5)}`;
  }
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-5)}`;
}

// deriveKeyLabel moved to /user/cost (2026-05-06) along with the
// "Usage by key today" card. Overview no longer needs it.

export default function UserOverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>('14D');
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // ── R23: cross-origin data source ──────────────────────────────────
  //
  // On B side (team server's web), pull personal-flavored data from
  // A's local-server (the user's machine) via CORS-allowed endpoints.
  // On A side (or trial loopback), stay same-origin.
  //
  // Cards routing:
  //   - Identity / Hi banner / Token usage / Top providers / Accessible
  //     keys / Today usage / Recent Requests → cross-fetch from A
  //   - Recent Team Keys → B-local (team-side data), conditional on
  //     logged-in via existing /accounts/me/all-keys (NOT remapped)
  //   - Vault status / list → SKIPPED on B (vault is sensitive, no CORS;
  //     calls fall back to undefined and the metric card renders 0)
  const otherBaseUrl = useMemo(() => getOtherBaseUrl(), []);
  const useCrossOrigin = useMemo(() => {
    if (IS_PERSONAL_SIDE) return false;
    if (!otherBaseUrl) return false;
    try {
      return new URL(otherBaseUrl).origin !== window.location.origin;
    } catch {
      return false;
    }
  }, [otherBaseUrl]);
  const crossClient = useMemo(() => {
    if (!useCrossOrigin || !otherBaseUrl) return null;
    // No Authorization header — local-server's `<control-panel-url>`-
    // gated CORS allows this origin to read /accounts/me + /v1/usage/*
    // anonymously; LocalIdentityMiddleware returns the local-bypass
    // identity (local@aikey.local / personal-local) which is the
    // legitimate "this machine's data" payload.
    return axios.create({
      baseURL: otherBaseUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }, [useCrossOrigin, otherBaseUrl]);

  // queryKey suffix so React Query caches B's cross-origin data
  // separately from A's same-origin (otherwise switching sides would
  // serve the wrong cache).
  const dataScope = useCrossOrigin ? `cross:${otherBaseUrl}` : 'local';

  // Vault initialisation status — drives the "Accessible Keys" card and the
  // first-run banner. Pre-2026-04-30 this hook also auto-redirected to
  // /user/vault when initialized=false, but that punted users away from the
  // overview before they could see anything; almost everything on this page
  // (usage charts, seats, auto-claim banner) does not depend on the vault.
  // Now we render the empty state inline and surface a non-blocking banner
  // pointing at /user/vault for users who haven't set a master password yet.
  // `initialized` is undefined on legacy local-server builds; the api client
  // coerces that to true so existing users see no banner.
  // R23 (2026-05-11 revised): vault status cross-fetched from A on B
  // side via the `<control-panel-url>` sentinel-gated CORS on
  // /api/user/vault/status. Only the team URL `aikey login` wrote can
  // read; everything else is still 2026-04-24 same-origin only.
  const { data: vaultStatus } = useQuery({
    queryKey: ['vault-status', dataScope],
    queryFn: crossClient
      ? async () => (await crossClient.get('/api/user/vault/status')).data
      : importApi.vaultStatus,
  });
  const vaultUninitialized = !!vaultStatus && vaultStatus.initialized === false;

  // R23: Identity (me) + Seats — cross-fetch from A on B side.
  const { data: me } = useQuery({
    queryKey: ['me', dataScope],
    queryFn: crossClient
      ? async () => (await crossClient.get<AccountDTO>('/accounts/me')).data
      : userAccountsApi.me,
  });
  // R23 (revised 2026-05-11): Seats is a B-side concept — Personal A
  // has no team/seat domain (A's `/accounts/me/seats` is an empty stub
  // for FE-compat). On A side this query returns []; on B side it
  // returns real org_seats rows. Cross-fetch to A is pointless (always
  // empty), so we explicitly stay same-origin.
  const { data: rawSeats } = useQuery({
    queryKey: ['my-seats', 'local'],
    queryFn: userAccountsApi.mySeats,
  });
  // Recent Team Keys table — B-LOCAL same-origin, conditional on
  // logged-in (R23 2026-05-11).
  //
  // Why localStorage probe (not the `me` query): `me` is cross-fetched
  // from A on B side (R23 directionality), so its account_id is
  // always A's local-bypass stub (`local-owner` for trial,
  // `personal-local` for aikey-local-server). It tells us nothing
  // about whether the user has authenticated to B. The team session
  // JWT lives in `aikey-auth-user` localStorage — its presence is
  // the only signal we have for "logged into the team server".
  //
  // Excluded scenarios (correctly):
  //   - User never went through /master/login or `aikey web` flow →
  //     `aikey-auth-user` empty → table hidden
  //   - User on Personal A standalone → no team key data anyway,
  //     table hidden (deliveryApi.allKeys returns the empty-keys stub)
  const teamKeysLoggedIn = useMemo(() => {
    if (IS_PERSONAL_SIDE) return false; // A side: no team-keys backend
    try {
      const raw = localStorage.getItem('aikey-auth-user');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { state?: { token?: string } };
      return !!parsed?.state?.token;
    } catch {
      return false;
    }
  }, []);
  const { data: rawKeys, isLoading: keysLoading } = useQuery({
    queryKey: ['my-all-keys', 'local'],
    queryFn: deliveryApi.allKeys,
    enabled: teamKeysLoggedIn,
  });
  const { data: rawPending } = useQuery({
    queryKey: ['my-pending-keys', 'local'],
    queryFn: deliveryApi.pendingKeys,
    enabled: teamKeysLoggedIn,
  });
  // R23 (2026-05-11 revised): vault list cross-fetched from A on B
  // via `<control-panel-url>`-gated CORS. Sensitive route_token in
  // each record IS exposed cross-origin to the allowed origin (the
  // team URL `aikey login` wrote) — accepted security trade-off per
  // user decision: the sentinel restricts readers to a single
  // explicitly-trusted origin. Vault mutations (unlock, init, entry
  // add/patch/delete, use) remain same-origin only.
  //
  // Server response shape: `{records, counts, locked, ...}` (already
  // unwrapped from the `{status:"ok", data:{...}}` envelope by
  // vaultApi.list). The cross-fetch path must do the same envelope
  // unwrap.
  const { data: vaultList } = useQuery<VaultListData | null>({
    queryKey: ['user-overview-vault', dataScope],
    queryFn: crossClient
      ? async (): Promise<VaultListData | null> => {
        const r = await crossClient.get<{ status: string; data: VaultListData }>('/api/user/vault/list');
        return r.data?.data ?? null;
      }
      : vaultApi.list,
  });

  // Usage identity — local_bypass uses org_id=personal.
  //
  // R23 (2026-05-11): when cross-fetching usage from A's local-server
  // (B side viewing personal data), force `org_id=personal` regardless
  // of B's own runtimeConfig.authMode. Reason: the TARGET is A, which
  // always runs in local_bypass mode and tags its usage_event_ods rows
  // with `org_id=personal` (no account_id binding). Sending the cross-
  // fetched `me.account_id` (which is A's stub `personal-local` or
  // `local-owner`) would not match any rows in A's events table.
  const accountId = me?.account_id;
  const isLocalMode = useCrossOrigin || runtimeConfig.authMode === 'local_bypass';
  const usageIdentity = isLocalMode
    ? { org_id: 'personal' as const }
    : accountId ? { account_id: accountId } : null;
  const usageIdentityKey = isLocalMode ? 'personal' : (accountId ?? '');

  const days = RANGE_DAYS[range];
  const endDate = daysAgoStr(0);
  const startDate = daysAgoStr(days - 1);

  // R23: usage queries — cross-fetch on B, same-origin on A. The
  // identity tuple (seat_id / account_id / org_id=personal) is
  // computed from the `me` query above which itself may be cross-
  // fetched; on B side the cross-fetched local-server returns the
  // personal stub identity (`org_id=personal` semantics via local-
  // bypass), which is what we want — usage data is the user's local
  // proxy stream.
  function usageParams(): Record<string, string> {
    const p: Record<string, string> = {};
    if (usageIdentity) {
      if ('account_id' in usageIdentity && usageIdentity.account_id) p.account_id = usageIdentity.account_id;
      else if ('org_id' in usageIdentity && usageIdentity.org_id === 'personal') p.org_id = 'personal';
    }
    try {
      p.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch { p.tz = 'UTC'; }
    return p;
  }

  const usageTimeline = useQuery({
    queryKey: ['user-overview-timeline', dataScope, usageIdentityKey, range],
    queryFn: crossClient
      ? async () => {
        // 1D: hourly (?date=) instead of daily (?start_date=&end_date=)
        // — both endpoints already CORS-allowed on local-server.
        if (range === '1D') {
          const r = await crossClient.get<HourlyPoint[]>('/v1/usage/personal/hourly', {
            params: { ...usageParams(), date: endDate },
          });
          return r.data.map((h) => ({
            date: String(h.hour).padStart(2, '0') + ':00',
            total_tokens: h.total_tokens,
            request_count: h.request_count,
          }));
        }
        const r = await crossClient.get<TimelinePoint[]>('/v1/usage/personal/timeline', {
          params: { ...usageParams(), start_date: startDate, end_date: endDate },
        });
        return r.data;
      }
      : async () => {
        if (range === '1D') {
          const hourly = await usageApi.personalHourly(usageIdentity!, endDate);
          return hourly.map((h) => ({
            date: String(h.hour).padStart(2, '0') + ':00',
            total_tokens: h.total_tokens,
            request_count: h.request_count,
          }));
        }
        return usageApi.personalTimeline(usageIdentity!, startDate, endDate);
      },
    enabled: !!usageIdentity,
  });
  const usageProtocols = useQuery({
    queryKey: ['user-overview-protocols', dataScope, usageIdentityKey, range],
    queryFn: crossClient
      ? async () => {
        const r = await crossClient.get<ProtocolTotal[]>('/v1/usage/personal/by-protocol/total', {
          params: { ...usageParams(), start_date: startDate, end_date: endDate },
        });
        return r.data;
      }
      : () => usageApi.personalByProtocolTotal(usageIdentity!, startDate, endDate),
    enabled: !!usageIdentity,
  });
  const todayDate = daysAgoStr(0);
  const usageToday = useQuery({
    queryKey: ['user-overview-today-hourly', dataScope, usageIdentityKey, todayDate],
    queryFn: crossClient
      ? async () => {
        const r = await crossClient.get<HourlyPoint[]>('/v1/usage/personal/hourly', {
          params: { ...usageParams(), date: todayDate },
        });
        return r.data;
      }
      : () => usageApi.personalHourly(usageIdentity!, todayDate),
    enabled: !!usageIdentity,
  });
  // R23: Recent Requests — NEW card, always rendered, last 5 non-canary
  // proxy events from the user's local machine.
  const recentRequests = useQuery({
    queryKey: ['user-overview-recent-requests', dataScope, usageIdentityKey],
    queryFn: crossClient
      ? async () => {
        const r = await crossClient.get<{ requests: RecentRequest[] }>('/v1/usage/personal/recent', {
          params: { ...usageParams(), limit: '5' },
        });
        return r.data.requests ?? [];
      }
      : () => usageApi.personalRecent(usageIdentity!, 5),
    enabled: !!usageIdentity,
  });
  // Per-key recent breakdown ("Usage by key today") moved to /user/cost (2026-05-06).
  // Overview no longer fetches user-overview-by-key-recent.

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

  // Cost-pricing Stage 5: estimated USD spend for the selected range,
  // summed from the by-protocol totals already fetched (carry cost_usd /
  // unpriced_request_count per Stage 3; absent on pre-rc.8 servers → 0).
  const estCostTotal = useMemo(
    () => (usageProtocols.data ?? []).reduce((s, p) => s + (p.cost_usd ?? 0), 0),
    [usageProtocols.data],
  );
  const estCostUnpriced = useMemo(
    () => (usageProtocols.data ?? []).reduce((s, p) => s + (p.unpriced_request_count ?? 0), 0),
    [usageProtocols.data],
  );

  // todayKeyRows moved to /user/cost (2026-05-06).

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
        {/* First-run banner: vault not yet initialised. Replaces the earlier
            unconditional redirect to /user/vault — most of this page (usage
            charts, seats, auto-claim) doesn't depend on the vault, so push
            the user to /user/vault as a click affordance instead of forcing
            them through it. */}
        {vaultUninitialized && (
          <section
            className="flex items-center justify-between gap-3 px-4 py-3 rounded border"
            style={{
              borderColor: 'rgba(250,204,21,0.35)',
              background: 'rgba(250,204,21,0.06)',
              color: 'var(--foreground)',
            }}
          >
            <div className="text-sm">
              <span className="font-mono font-bold mr-2" style={{ color: 'var(--primary)' }}>
                {t('overview.vaultNotSetUp')}
              </span>
              <span style={{ color: 'var(--muted-foreground)' }}>
                {t('overview.vaultNotSetUpHint')}
              </span>
            </div>
            <button
              className="text-xs font-mono px-3 py-1 rounded border whitespace-nowrap"
              style={{
                borderColor: 'rgba(250,204,21,0.4)',
                color: 'var(--primary)',
                background: 'transparent',
              }}
              onClick={() => navigate('/user/vault')}
            >
              {t('overview.setUpNow')}
            </button>
          </section>
        )}
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
              <div className="text-lg font-bold font-mono tracking-wide truncate" style={{ color: 'var(--display-foreground)' }}>
                {t('overview.greeting', { email: emailDisplay })}
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                <span>{me?.role ? me.role.toUpperCase() : t('overview.roleMember')}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span className="inline-flex items-center gap-1.5" style={{ color: '#4ade80' }}>
                  <span className="status-dot" />
                  {t('overview.statusActive')}
                </span>
                {me?.created_at && (
                  <>
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>{t('overview.joinedOn', { date: new Date(me.created_at).toLocaleDateString(navigator.language) })}</span>
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
              {t('overview.docs')}
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
                  <span className="font-mono">{t('overview.bannerNewKeysGranted', { count: pendingKeys.length })}</span>{' '}
                  {t('overview.bannerGrantedToYou')}
                </>
              ) : (
                <>
                  {t('overview.bannerGrantedYou')}{' '}
                  <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                    {recentAutoClaim.alias}
                  </span>
                </>
              )}
              <span style={{ color: 'var(--muted-foreground)' }}>
                {' '}{t('overview.bannerReadyToUse')}
              </span>
            </span>
            <button
              className="ov-link text-[11px] font-mono flex items-center gap-1"
              onClick={() => navigate('/user/virtual-keys')}
            >
              {t('overview.viewKeys')}
              <ArrowUpRightIcon />
            </button>
            <button
              className="icon-btn"
              title={t('overview.dismiss')}
              aria-label={t('overview.dismissNotification')}
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
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
            aria-label={t('overview.accessibleKeysAria', { total: vaultTotalKeys, active: vaultActiveKeys })}
          >
            <span className="go"><ChevronRightIcon /></span>
            <div className="label-row">
              <span className="label">{t('overview.accessibleKeys')}</span>
              <KeyIcon className="label-icon" />
            </div>
            <div className="value-row">
              <span className="value">{vaultTotalKeys}</span>
              {vaultTotalKeys > 0 && (
                <span className="value-suffix">
                  · {vaultActiveKeys} {t('overview.activeSuffix')}{vaultIdleKeys > 0 ? ` · ${vaultIdleKeys} ${t('overview.idleSuffix')}` : ''}
                </span>
              )}
            </div>
            <span className="unit">
              {vaultProviderNamesPreview.length > 0 ? vaultProviderNamesPreview.join(' · ') : t('overview.noKeysYet')}
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
            aria-label={t('overview.mySeatsAria', { count: activeSeats.length, orgs: uniqueOrgs })}
          >
            <span className="go"><ChevronRightIcon /></span>
            <div className="label-row">
              <span className="label">{t('overview.mySeats')}</span>
              <UsersIcon className="label-icon" />
            </div>
            <div className="value-row">
              <span className="value">{activeSeats.length}</span>
              <span className="value-suffix">{t('overview.activeSuffix')}</span>
            </div>
            <span className="unit">
              <BuildingIcon className="w-3 h-3" />
              {uniqueOrgs > 0
                ? (uniqueOrgs > 1
                  ? t('overview.manyOrgs', { count: uniqueOrgs })
                  : t('overview.oneOrg', { count: uniqueOrgs }))
                : t('overview.noOrgsYet')}
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
            aria-label={t('overview.todayUsedAria', { tokens: fmtTok(todayTotalTokens) })}
          >
            <span className="go"><ChevronRightIcon /></span>
            <div className="label-row">
              <span className="label">{t('overview.todayUsed')}</span>
              <ActivityIcon className="label-icon" />
            </div>
            <div className="value-row">
              <span className="value">{fmtTok(todayTotalTokens)}</span>
              <span className="value-suffix">{t('overview.tokensSuffix')}</span>
            </div>
            <span className="unit">
              {todayTotalTokens === 0
                ? t('overview.noUsageToday')
                : t('overview.peakAt', { hour: String(todayPeakHour.hour).padStart(2, '0'), tokens: fmtTok(todayPeakHour.total_tokens) })}
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

          {/* Estimated Cost (Stage 5) — Σ cost_usd over the range's
              by-protocol totals (all keys). Links to the full ledger.
              "Estimated" + footnote there frame it as reference, not billed. */}
          <button
            type="button"
            className="metric linkable text-left"
            onClick={() => navigate('/user/usage-ledger')}
            aria-label={t('usageLedger.kpiEstimatedCost')}
          >
            <span className="go"><ChevronRightIcon /></span>
            <div className="label-row">
              <span className="label">{t('usageLedger.kpiEstimatedCost')}</span>
              <ActivityIcon className="label-icon" />
            </div>
            <div className="value-row">
              <span className="value">{formatCost(estCostTotal)}</span>
            </div>
            <span className="unit">
              {estCostUnpriced > 0 ? (
                <span title={t('usageLedger.unpricedTooltip')}>
                  ⚠ {t('usageLedger.kpiCostUnpriced', { count: estCostUnpriced })}
                </span>
              ) : (
                t('overview.estCostScope')
              )}
            </span>
            <svg className="spark" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="4" width="100" height="4" rx="2" fill="var(--border)" />
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
                  {t('overview.tokenUsage')}
                </h3>
                <p className="text-[12px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
                  {t('overview.tokenUsageSubtitle')}
                </p>
              </div>
              <div className="seg" role="tablist" aria-label={t('overview.timeRange')}>
                {(['1D', '7D', '14D', '30D', '90D'] as const).map((k) => (
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
                    formatter={(v) => [fmtTok(Number(v)), t('overview.tokensSuffix')]}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_tokens"
                    stroke="#ca8a04"
                    strokeWidth={1.8}
                    fill="url(#ov-area-grad)"
                  />
                  {/* Average reference line. Hidden when avgPerDay is 0
                      (no data) to avoid a confusing line collapsed onto
                      the x-axis baseline. Dashed + muted color so it
                      reads as metadata, not as a second data series. The
                      numeric value is already shown in the footer's
                      "Avg/day" cell — the line provides the visual
                      anchor; the label here just names the line so a
                      first-time viewer knows what the dashed line means.
                      ifOverflow="extendDomain" makes the y-axis stretch
                      so the line is always visible even on flat-data
                      days where avg > peak rounding. */}
                  {avgPerDay > 0 && (
                    <ReferenceLine
                      y={avgPerDay}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="3 3"
                      strokeOpacity={0.6}
                      ifOverflow="extendDomain"
                      label={{
                        value: t('overview.avgLabel', { value: fmtTok(avgPerDay) }),
                        position: 'insideTopRight',
                        fill: 'var(--muted-foreground)',
                        fontSize: 9,
                        fontFamily: 'monospace',
                      }}
                    />
                  )}
                </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div
              className="mt-2 pt-3 flex items-center justify-between text-[12px] font-mono flex-wrap gap-2"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
            >
              <span>
                {t('overview.total')}{' '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {t('overview.totalTokens', { value: fmtTok(totalTokens) })}
                </span>
              </span>
              <span>
                {t('overview.peak')}{' '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {peak.total_tokens > 0 ? `${fmtTok(peak.total_tokens)} · ${peak.date}` : '—'}
                </span>
              </span>
              <span>
                {t('overview.avgPerDay')}{' '}
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
                  {t('overview.topProviders')}
                </h3>
                <p className="text-[12px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
                  {t('overview.providerSplit', { range })}
                </p>
              </div>
              <button
                type="button"
                className="ov-btn ov-btn-ghost text-[11px]"
                onClick={() => navigate('/user/usage-ledger')}
              >
                {t('overview.viewAll')}
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
                {t('overview.noData')}
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
                          value={t('overview.donutTokens')}
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
                        title={idle ? t('overview.noUsageInRange') : undefined}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                            style={{ background: row.color }}
                          />
                          <span className="truncate" style={{ color: 'var(--foreground)' }}>{row.name}</span>
                          {idle && <span className="chip idle">{t('overview.idleChip')}</span>}
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
                {providerUsage.length === 1
                  ? t('overview.oneProvider', { count: providerUsage.length })
                  : t('overview.manyProviders', { count: providerUsage.length })}
                {(() => {
                  const idle = providerUsage.filter((r) => r.pct === 0).length;
                  return idle > 0 ? ` ${t('overview.idleCount', { count: idle })}` : '';
                })()}
              </span>
              <span>{t('overview.lastDays', { days })}</span>
            </div>
          </div>
        </section>

        {/* "Usage by key today" 已移出到 /user/cost 页面 (2026-05-06)。
            该页面在左侧导航 Insights 下,与 Usage 并列。 */}

        {/* ── Recent Requests (R23, 2026-05-11) ────────────────────────
            Always rendered. Cross-fetched from the user's local-server
            on B side (Personal proxy events); same-origin on A side.
            Replaces the old position of "Recent Team Keys" as the
            primary "what's flowing through my AiKey right now" view.
            Filters canary probes server-side (route_source != 'canary'). */}
        <section className="card" data-origin-name="Recent Requests">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                {t('overview.recentRequests')}
              </h3>
              <span className="chip">{t('overview.shown', { count: (recentRequests.data ?? []).length })}</span>
            </div>
            <button
              type="button"
              className="ov-btn ov-btn-outline text-[11px]"
              // 2026-06-06: Recent Requests "view all" lands on the per-
              // request drill-down (`/user/usage-detail`), not the
              // aggregated `usage-ledger` charts page. The card itself
              // shows individual request rows (event_time / model /
              // status / tokens) — the natural "see more" target is
              // the same shape at full scale, not the aggregated
              // by-key / by-protocol charts. The other two viewAll
              // buttons on this page (provider donut → usage-ledger,
              // virtual keys → virtual-keys) stay pointed at their
              // aggregated / list targets.
              onClick={() => navigate('/user/usage-detail')}
            >
              {t('overview.viewAll')}
              <ArrowRightIcon />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="vault w-full">
              <thead>
                <tr>
                  <th className="px-4 py-2.5">{t('overview.colWhen')}</th>
                  <th className="px-4 py-2.5">{t('overview.colProviderModel')}</th>
                  <th className="px-4 py-2.5">{t('overview.colKey')}</th>
                  <th className="px-4 py-2.5 text-left">{t('overview.colTokens')}</th>
                  <th className="px-4 py-2.5 text-left">{t('overview.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {recentRequests.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {t('overview.loading')}
                    </td>
                  </tr>
                ) : (recentRequests.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {t('overview.noRequestsYet')}
                    </td>
                  </tr>
                ) : (
                  (recentRequests.data ?? []).map((rr) => {
                    const status = rr.http_status_code || 0;
                    const ok = status >= 200 && status < 400;
                    return (
                      <tr key={rr.request_id || `${rr.event_time_ms}-${rr.virtual_key_id}`}>
                        <td className="px-4 py-2.5 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                          {formatRelativeTime(new Date(rr.event_time_ms)) || '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--foreground)' }}>
                            <span className="prov-dot" style={{ backgroundColor: providerColor(rr.provider_code) }} />
                            {rr.provider_code || t('overview.unknownProvider')}
                            <span style={{ color: 'var(--muted-foreground)', opacity: 0.7 }} className="font-mono text-[11px]">
                              · {rr.model || '—'}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px]" style={{ color: 'var(--muted-foreground)' }} title={rr.virtual_key_id}>
                          {shortVkId(rr.virtual_key_id) || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-left font-mono text-[12px] tabular-nums" style={{ color: 'var(--foreground)' }} title={`${rr.total_tokens.toLocaleString()} tokens`}>
                          {/* fmtTok 统一用 K/M 单位 + tabular-nums 锁定数字等宽 —
                              避免 toLocaleString 的 "12,345" / "123,456" 在右
                              对齐下因长度差异看起来跳动。原始精确值留到 title
                              tooltip,鼠标悬停可看。其他卡片(donut total / chart
                              avg)早就走 fmtTok,这里曾漏掉单位 + 列对齐。 */}
                          {fmtTok(rr.total_tokens)}
                        </td>
                        <td className="px-4 py-2.5 text-left">
                          <span
                            className="chip font-mono text-[11px]"
                            style={{
                              color: ok ? '#4ade80' : '#f87171',
                              borderColor: ok ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)',
                            }}
                          >
                            {status || (rr.request_status || '—')}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Recent Team Keys ──
            R23 (2026-05-11): conditional on logged-in. On A or
            logged-out B, the underlying allKeys query is disabled and
            we hide the section entirely so the page doesn't show an
            empty "0 accessible / No team keys assigned" placeholder
            for users without a team session. */}
        {teamKeysLoggedIn && (
        <section className="card" data-origin-name="Recent Virtual Keys">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                {t('overview.recentTeamKeys')}
              </h3>
              <span className="chip">{t('overview.accessibleChip', { count: allKeys.length })}</span>
            </div>
            <button
              type="button"
              className="ov-btn ov-btn-outline text-[11px]"
              onClick={() => navigate('/user/virtual-keys')}
            >
              {t('overview.viewAll')}
              <ArrowRightIcon />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="vault w-full">
              <thead>
                <tr>
                  <th className="px-4 py-2.5">{t('overview.colAlias')}</th>
                  <th className="px-4 py-2.5">{t('overview.colProtocols')}</th>
                  <th className="px-4 py-2.5">{t('overview.colStatus')}</th>
                  <th className="px-4 py-2.5">{t('overview.colExpires')}</th>
                  <th className="px-4 py-2.5 text-right">{t('overview.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {keysLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {t('overview.loading')}
                    </td>
                  </tr>
                ) : recentKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {t('overview.noTeamKeysAssigned')}
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
                          {/* oauth_group (Stage A): shared-group marker + the
                              master-assigned DEFAULT pool account identity. */}
                          {k.oauth_group_id && (
                            <>
                              <span className="mx-1 opacity-50">·</span>
                              <span style={{ color: 'var(--primary-dim)' }}>{t('overview.oauthGroupShared')}</span>
                              {(() => {
                                const def = routedGroupAccount(k.group_accounts);
                                return def ? (
                                  <>
                                    <span className="mx-1 opacity-50">·</span>
                                    <span title={t('overview.oauthGroupDefaultAccount')}>{def.identity}</span>
                                  </>
                                ) : null;
                              })()}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {(() => {
                          // Group VK = shared OAuth pool with no single provider_code of its
                          // own; derive the protocol from the pool's default/first account.
                          const proto =
                            (k.oauth_group_id && routedGroupAccount(k.group_accounts)?.provider_code) ||
                            k.provider_code;
                          return (
                            <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--foreground)' }}>
                              <span className="prov-dot" style={{ backgroundColor: providerColor(proto) }} />
                              {proto || t('overview.unknownProvider')}
                              {/* Group VK → TEAM-OAUTH chip beside the protocol (English, no mixed CN/EN). */}
                              {k.oauth_group_id && (
                                <span
                                  className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
                                  style={{ color: 'var(--primary-dim)', borderColor: 'rgba(250,204,21,0.3)', backgroundColor: 'rgba(250,204,21,0.06)' }}
                                >
                                  TEAM-OAUTH
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2.5">
                        <KeyStatusChip keyStatus={k.key_status} shareStatus={k.share_status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                        {k.expires_at ? relativeTime(k.expires_at) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {/* Claim only renders when the key is BOTH pending_claim
                         *  AND active. A revoked-but-still-pending_claim ghost
                         *  state would otherwise let the user POST /claim → 422
                         *  BIZ_KEY_NOT_ACTIVE. Backend RevokeVirtualKey now
                         *  flips share_status alongside key_status to prevent
                         *  new ghosts; this UI guard handles any historical
                         *  rows still in the wild. */}
                        {k.share_status === 'pending_claim' && k.key_status === 'active' ? (
                          <button
                            type="button"
                            className="ov-btn ov-btn-outline text-[11px]"
                            style={{ borderColor: 'rgba(250, 204, 21,0.5)', color: 'var(--primary)' }}
                            onClick={() => handleClaim(k.virtual_key_id)}
                          >
                            {t('overview.claim')}
                          </button>
                        ) : k.key_status !== 'active' ? (
                          // Revoked / expired keys can't be used — the REVOKED
                          // chip in the Status column already conveys the state;
                          // rendering a Use button here would be a footgun
                          // (navigates to Vault but there's nothing actionable
                          // on a dead key).
                          <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>—</span>
                        ) : (() => {
                          // Mirror the sidebar Vault menu's routing: on the
                          // Personal (A) side `/user/vault` is a local SPA
                          // route; on the Team (B) side the menu renders a
                          // cross-origin <a> to `${otherBaseUrl}/user/vault`
                          // (B has no `/user/vault` route, the Personal
                          // local-server owns it). Use button must follow
                          // the same destination to stay in lockstep with
                          // the menu — see UserShell.tsx cross-app render
                          // around line 725.
                          const otherBaseUrl = getOtherBaseUrl();
                          if (!IS_PERSONAL_SIDE && otherBaseUrl) {
                            const href = `${otherBaseUrl}/user/vault`;
                            return (
                              <a
                                href={href}
                                className="ov-btn ov-btn-outline text-[11px]"
                                title={t('overview.opensHref', { href })}
                              >
                                {t('overview.use')}
                              </a>
                            );
                          }
                          return (
                            <button
                              type="button"
                              className="ov-btn ov-btn-outline text-[11px]"
                              onClick={() => navigate('/user/vault')}
                            >
                              {t('overview.use')}
                            </button>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {/* ── Footer links ── */}
        <section
          className="flex items-center justify-between text-[12px] font-mono pt-1 pb-6"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <div className="flex items-center gap-4">
            <a className="ov-link" href="https://github.com/aikeylabs" target="_blank" rel="noreferrer">
              <BookIcon /> {t('overview.docs')}
            </a>
            <a className="ov-link" href="https://github.com/aikeylabs/aikey/issues" target="_blank" rel="noreferrer">
              <SupportIcon /> {t('overview.support')}
            </a>
          </div>
          <span>{runtimeConfig.buildVersion ? `v${runtimeConfig.buildVersion}` : ''} · {t('overview.footerVault')}</span>
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
  const { t } = useTranslation();
  // Terminal key_status (revoked / expired) wins over share_status. A
  // historical ghost state observed in prod: key_status=revoked +
  // share_status=pending_claim — the user can't claim a revoked key (server
  // returns 422 BIZ_KEY_NOT_ACTIVE), so showing "PENDING" is a lie. The
  // backend-side fix (RevokeVirtualKey flipping share_status to inactive)
  // prevents new ghosts, but this guard is the safety net for any
  // historical row still in the wild.
  if (keyStatus === 'revoked' || keyStatus === 'expired') {
    return (
      <span className="chip" style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.3)' }}>
        {keyStatus.toUpperCase()}
      </span>
    );
  }
  if (shareStatus === 'pending_claim') {
    return (
      <span className="chip" style={{ color: 'var(--primary)', background: 'rgba(250, 204, 21,0.08)', borderColor: 'rgba(250, 204, 21,0.3)' }}>
        <ClockIcon /> {t('overview.statusPending')}
      </span>
    );
  }
  if (keyStatus === 'active') {
    return (
      <span className="chip" style={{ color: '#4ade80', background: 'rgba(74,222,128,0.08)', borderColor: 'rgba(74,222,128,0.3)' }}>
        <span className="status-dot" style={{ width: 5, height: 5 }} />
        {t('overview.statusActive')}
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
  /* h2-style card titles: text-xs mono bold tracking-wider
     muted-foreground (matches the design system across the board).
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

/* "Usage by key today" CSS moved to /user/cost (2026-05-06). */
`;
