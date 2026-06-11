/**
 * User Usage Ledger — personal usage analytics.
 *
 * v3.1 layout (2026-04-23): derived from
 * `.superdesign/design_iterations/user_usage_ledger_3_1.html`.
 *
 *  - Title + updated-at subtitle, 7D/14D/30D/90D segmented control.
 *  - 3 centred KPI cards with hint rows.
 *  - Area chart (col-span-8) + donut "By protocol" (col-span-4).
 *  - Stacked bar "Usage by protocol over time" — full width, legend chips.
 *  - "Usage by key" — custom [label | bar | pct] grid rows (no recharts).
 *  - Per-provider palette (anthropic=gold, kimi=sky, openai=violet, idle=zinc).
 *
 * Data sources:
 *   - Personal timeline:      GET /v1/usage/personal/timeline
 *   - Per-protocol timeline:  GET /v1/usage/personal/by-protocol/timeline
 *   - Protocol distribution:  GET /v1/usage/personal/by-protocol/total
 *   - Per-key totals:         GET /v1/usage/personal/by-key/total
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import { usageApi } from '@/shared/api/usage';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { runtimeConfig } from '@/app/config/runtime';
import { formatDateShort, formatRelativeTime } from '@/shared/utils/datetime-intl';
import { formatCost } from '@/shared/utils/formatCost';
import { CostCell } from '@/shared/ui/CostCell';

// Keep in sync with pages/user/overview/index.tsx's PROVIDER_COLORS.
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
const IDLE_COLOR = '#52525b';
function providerColor(name: string): string {
  return PROVIDER_COLORS[(name || '').toLowerCase()] ?? IDLE_COLOR;
}

// Fallback palette for the "by key" list — keys are identified by alias /
// OAuth identity, not provider, so we use the one-gold + zinc-gradient
// scheme when we can't map back to a provider.
const KEY_PALETTE = ['#ca8a04', '#71717a', '#52525b', '#a1a1aa', '#3f3f46', '#d4d4d8'];

// First-party app slugs hardcoded for the "INTERNAL" badge on the "Usage
// By App" chart (2026-05-25). MUST stay in sync with the Rust source of
// truth `aikey-cli/src/commands_app/mod.rs::FIRST_PARTY_SLUGS`. Frontend
// can't fetch the list dynamically because /api/user/apps/list might be
// gated by auth in some editions; hardcoding mirrors the same trade-off
// that ProviderMultiSelect makes for the protocol catalog.
const FIRST_PARTY_SLUGS = new Set(['degrade-detector']);

// Direct /v1/... traffic (app_slug == '') gets a friendly CLI tool name
// derived from the provider_code per the 2026-05-25 spec ("claude / codex
// / kimi 等作为 app 名称"). When provider doesn't map, the raw
// provider_code is used so we never silently bucket unknown values.
//
// Kimi family stays split (moonshot vs kimi_code shown separately) per
// user decision 2026-05-25 — matches the chip convention in
// `shared/ui/ProviderMultiSelect.tsx::KNOWN_PROTOCOLS`.
function providerToToolName(providerCode: string): string {
  const lc = (providerCode || '').toLowerCase();
  switch (lc) {
    case 'anthropic':       return 'claude';
    case 'openai':          return 'codex';
    case 'moonshot':        return 'kimi(moonshot)';
    case 'kimi_code':       return 'kimi(kimi-code)';
    case 'google_gemini':   return 'gemini';
    case 'deepseek':        return 'deepseek';
    case 'xai_grok':        return 'grok';
    case 'zhipu':           return 'glm';
    case 'doubao':          return 'doubao';
    default:                return providerCode || '(direct)';
  }
}

/** 2026-05-28 — added 1 (intra-day hourly). When range === 1 the
 * timeline + protocol-timeline charts swap their X axis from "day"
 * to "hour of day"; all other (whole-range aggregate) charts simply
 * narrow their window to (today, today) and continue rendering the
 * same row shapes. See `personalByProtocolHourly` for the hourly
 * stacked-bar source. */
type RangeKey = 1 | 7 | 14 | 30 | 90;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/** YYYY-MM-DD in the user's local timezone — see usage.ts `dateParam`
 * for the tz-local refactor rationale (bugfix 20260424). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normProto(s: string) {
  return s || 'unknown';
}

// Derive a human label for a usage-by-key row.
//
// Label dimension: the vk_id prefix encodes WHAT was called (app slug,
// probe alias, personal key alias, OAuth session). Identity encodes WHO
// invoked it (the user's email). For most row types the user wants WHAT;
// only OAuth direct calls want WHO (because the "what" is an opaque
// session_<hex> meaningless to a human).
//
// Priority by vk_id prefix:
//   - `app:<slug>`       → slug (the app name — what was called)
//   - `probe:<alias>`    → alias (the probe — what was called)
//   - `oauth:session_*`  → identity (email) if present, else `OAuth · <hex8>…`
//                          (identity is the only readable signal for OAuth)
//   - `personal:<alias>` → alias from `k.alias`, else stripped vk_id
//   - other (team, no prefix) → alias, else vk_id verbatim
//
// 2026-05-26 (bugfix continuation): the original "identity first" rule
// from the 2026-04-22 F2 patch caused app rows where ODS happened to
// carry oauth_identity (proxy attaches OAuthIdentity to app events when
// the underlying binding is OAuth-backed) to render with the user's
// email instead of the app name. The current per-prefix dispatch keeps
// the F2 OAuth fix without leaking identity into non-OAuth labels.
function deriveKeyLabel(
  k: { alias?: string; identity?: string; virtual_key_id: string },
  t: (key: string) => string,
): string {
  const id = (k.virtual_key_id || '').trim();
  const aliasStr = (k.alias ?? '').trim();

  if (id.startsWith('app:'))    return id.slice('app:'.length);
  if (id.startsWith('probe:'))  return id.slice('probe:'.length);

  // OAuth-session normalisation: backend may surface the raw session id
  // in `alias` OR `virtual_key_id`. Identity (email) wins when present;
  // otherwise collapse the hex to `OAuth · <hex8>…` for readability.
  const oauthRe = /^(?:oauth:)?session_([a-f0-9]+)/i;
  if (id.startsWith('oauth:')) {
    if (k.identity && k.identity.trim()) return k.identity.trim();
    const idOAuth = id.match(oauthRe);
    if (idOAuth) return `OAuth · ${idOAuth[1].slice(0, 8)}…`;
    return id.slice('oauth:'.length) || 'OAuth';
  }

  // personal / team / no-prefix: prefer the human alias, fall back to a
  // stripped vk_id. Identity is intentionally NOT consulted — those row
  // types are owner-keyed by alias, not session.
  if (aliasStr) {
    const aliasOAuth = aliasStr.match(oauthRe);
    if (aliasOAuth) return `OAuth · ${aliasOAuth[1].slice(0, 8)}…`;
    return aliasStr;
  }
  if (!id) return t('usageLedger.unlabeled');
  if (id.startsWith('personal:')) return id.slice('personal:'.length);
  return id;
}

// Map a row's (app_slug, identity) tuple to the human-readable subtitle
// shown under the primary key label in the "Usage by Key" list. Three
// cases per spec R3:
//   1. app_slug non-empty                → label per slug
//      (UA-derived on new OAuth rows, registered on app rows)
//   2. app_slug empty AND identity non-empty (legacy OAuth row that
//      predates the 2026-05-26 UA attribution fix; ODS row was projected
//      with NULL app_slug) → "Unknown App". Honest about the gap rather
//      than silently dropping the dimension.
//   3. app_slug empty AND identity empty (Personal CLI / team direct
//      call) → no subtitle. Per spec R5 these paths intentionally do
//      not carry an app dimension.
//
// Slugs themselves are coined in:
//   aikey-proxy/internal/proxy/uaattribution/fingerprint.yaml
// Display text pinned in:
//   workflow/CI/requirements/2026-05-26-usage-by-key-app-attribution.md
function deriveAppSubtitle(
  slug: string | undefined,
  identity: string | undefined,
  t: (key: string) => string,
): string {
  const s = (slug ?? '').trim();
  const id = (identity ?? '').trim();
  if (!s) {
    // Legacy OAuth row with no projected app_slug — honor spec by
    // surfacing "Unknown App". Personal/team rows fall through and
    // get no subtitle.
    return id ? t('usageLedger.unknownApp') : '';
  }
  switch (s) {
    case 'claude-code': return 'Claude Code';
    case 'unknown-app': return t('usageLedger.unknownApp');
    case 'cursor':      return 'Cursor';
    case 'cline':       return 'Cline';
    case 'continue':    return 'Continue';
    case 'codex':       return 'Codex';
  }
  // Title-case fallback for slugs we haven't curated yet.
  return s
    .split('-')
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ');
}

export default function UserUsageLedgerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeKey>(30);

  // Clickable X-axis date tick → drill to /user/usage-detail?date=. Only the
  // daily view (YYYY-MM-DD) is clickable; the 1D hourly view ("HH:00") isn't a
  // date so it stays plain. Renders the same style as the default tick config.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' custom-tick render props are not exported as a usable type
  const renderDateTick = (props: any) => {
    const { x = 0, y = 0, payload } = props;
    const v = String(payload?.value ?? '');
    const isDay = /^\d{4}-\d{2}-\d{2}$/.test(v);
    return (
      <text
        x={x} y={y + 10} textAnchor="middle" fontSize={9} fontFamily="monospace"
        fill="var(--muted-foreground)"
        style={isDay ? { cursor: 'pointer' } : undefined}
        onClick={isDay ? () => navigate(`/user/usage-detail?date=${v}`) : undefined}
      >
        {formatDateShort(v)}
      </text>
    );
  };
  // For 1D, both ends collapse to today — aggregate endpoints work
  // unchanged with the narrowed window. The hourly endpoints below
  // ignore start/end anyway and use today's date implicitly via
  // ?date=, but we keep the variable consistent so existing prop
  // wiring (chart axis label, etc.) stays straightforward.
  const isHourly = range === 1;
  const startDate = isHourly ? daysAgo(0) : daysAgo(range);
  const endDate = daysAgo(0);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });
  const seats = useQuery({
    queryKey: ['user-seats'],
    queryFn: () => userAccountsApi.mySeats(),
  });

  const accountId = me?.account_id;
  const isLocalMode = runtimeConfig.authMode === 'local_bypass';
  const identity = isLocalMode
    ? { org_id: 'personal' as const }
    : accountId ? { account_id: accountId } : null;
  const identityKey = accountId ?? '';
  const hasIdentity = !!identity;

  // 1D mode: fetch hourly and reshape to the daily TimelinePoint /
  // ProtocolTimelinePoint shapes the existing chart components expect.
  // The "date" field carries "HH:00" so sort-by-string still gives the
  // chronological 00..23 order; chart X axis labels naturally render
  // these as hour-of-day instead of dates.
  const timeline = useQuery({
    queryKey: ['user-usage-timeline', identityKey, range, isHourly],
    queryFn: async () => {
      if (isHourly) {
        const hourly = await usageApi.personalHourly(identity!, endDate);
        return hourly.map((h) => ({
          date: String(h.hour).padStart(2, '0') + ':00',
          total_tokens: h.total_tokens,
          request_count: h.request_count,
          cost_usd: h.cost_usd ?? 0,
        }));
      }
      return usageApi.personalTimeline(identity!, startDate, endDate);
    },
    enabled: hasIdentity,
  });
  const protocolTimeline = useQuery({
    queryKey: ['user-usage-protocol-timeline', identityKey, range, isHourly],
    queryFn: async () => {
      if (isHourly) {
        const hourly = await usageApi.personalByProtocolHourly(identity!, endDate);
        return hourly.map((h) => ({
          date: String(h.hour).padStart(2, '0') + ':00',
          protocol_type: h.protocol_type,
          total_tokens: h.total_tokens,
          request_count: h.request_count,
        }));
      }
      return usageApi.personalByProtocolTimeline(identity!, startDate, endDate);
    },
    enabled: hasIdentity,
  });
  const protocols = useQuery({
    queryKey: ['user-usage-protocols', identityKey, range],
    queryFn: () => usageApi.personalByProtocolTotal(identity!, startDate, endDate),
    enabled: hasIdentity,
  });
  const byKey = useQuery({
    queryKey: ['user-usage-by-key', identityKey, range],
    queryFn: () => usageApi.personalByKeyTotal(identity!, startDate, endDate),
    enabled: hasIdentity,
  });
  // 2026-05-25 "Usage By App" ranking — same identity + range as the
  // other personal queries so a single range chip change refetches
  // everything together.
  const byApp = useQuery({
    queryKey: ['user-usage-by-app', identityKey, range],
    queryFn: () => usageApi.personalByAppTotal(identity!, startDate, endDate),
    enabled: hasIdentity,
  });

  // Derive friendly key labels (F2 landed).
  //   1. `alias`                    — personal keys + named team keys
  //   2. `identity`                 — OAuth email (from ODS oauth_identity)
  //   3. `oauth:session_<hex>`      — ODS-prefixed OAuth → `OAuth · <hex8>…`
  //   4. `personal:` prefix         — strip it
  //   5. `session_<hex>`            — bare session → `OAuth · <hex8>…`
  //   6. raw id / empty             — fallback
  // 2026-06-05 — group the raw per-(app/session) rows by the underlying
  // CREDENTIAL/ACCOUNT so the by-key list reconciles to the page total. Many
  // rows are the SAME OAuth account running different apps (app:claude-mem,
  // app:chat-history-rag, oauth:session claude-code, probe:…) — all carry the
  // same `identity` email. We roll those up under the account; personal /
  // managed VK rows (no identity) group by their alias. Label = account email
  // (OAuth) or key alias — never an app/tool name (apps live in "Usage by App").
  // Without this, one account's usage was split across many rows and the list
  // summed to far less than the page total.
  const keyData = useMemo(() => {
    type Group = {
      label: string; identity: string; virtual_key_id: string; rawVkId: string; app_slug: string; appSubtitle: string;
      total_tokens: number; cost_usd: number;
      request_count: number; priced_request_count: number; unpriced_request_count: number;
    };
    const groups = new Map<string, Group>();
    for (const k of byKey.data ?? []) {
      const identity = (k.identity ?? '').trim();
      const label = identity || deriveKeyLabel(k, t);
      // rawVkId = the group's first real virtual_key_id, used for the drill-down
      // to /user/usage-detail?key=. Exact for real keys (one vk → one label);
      // for an OAuth identity (one identity spanning N vks) it's the first vk
      // (partial) — acceptable until the detail page grows an identity filter.
      const g: Group = groups.get(label) ?? {
        label, identity, virtual_key_id: label, rawVkId: k.virtual_key_id, app_slug: '', appSubtitle: identity ? 'OAuth' : '',
        total_tokens: 0, cost_usd: 0, request_count: 0, priced_request_count: 0, unpriced_request_count: 0,
      };
      g.total_tokens += k.total_tokens ?? 0;
      g.cost_usd += k.cost_usd ?? 0;
      g.request_count += k.request_count ?? 0;
      g.priced_request_count += k.priced_request_count ?? 0;
      g.unpriced_request_count += k.unpriced_request_count ?? 0;
      groups.set(label, g);
    }
    return [...groups.values()];
  }, [byKey.data, t]);

  const totalTokens = timeline.data?.reduce((s, p) => s + p.total_tokens, 0) ?? 0;
  const totalRequests = timeline.data?.reduce((s, p) => s + p.request_count, 0) ?? 0;
  const avgPerRequest = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;

  const protocolData = useMemo(
    () => (protocols.data ?? []).map((p) => ({ ...p, protocol_type: normProto(p.protocol_type) })),
    [protocols.data],
  );
  const protoTotal = protocolData.reduce((s, p) => s + p.total_tokens, 0) || 1;

  // Cost-pricing Stage 4: estimated USD totals derived from the by-protocol
  // totals (same source as the donut). cost_usd is absent on pre-rc.8
  // servers → coalesces to 0 so the card shows $0.00, never NaN. totalUnpriced
  // drives the "estimate partial" hint when some requests hit models not in
  // the price table.
  const totalCost = protocolData.reduce((s, p) => s + (p.cost_usd ?? 0), 0);
  const totalUnpriced = protocolData.reduce((s, p) => s + (p.unpriced_request_count ?? 0), 0);
  const costPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;

  const padTimelineData = useMemo(() => {
    const data = timeline.data ?? [];
    // 1D mode: data is hourly ("HH:00"), NOT calendar dates. The daily min-days
    // padding below would inject daysAgo() date rows (e.g. "2026-06-10") into the
    // hourly series whenever there were <3 active hours — making the X axis show
    // multiple days. Latent since the 1D dimension was added (2026-05-28); only
    // surfaces on sparse-hour days. Hourly data needs no calendar padding.
    if (isHourly) {
      return [...data].sort((a, b) => a.date.localeCompare(b.date));
    }
    const today = daysAgo(0);
    const existing = new Set(data.map((d) => d.date));
    const result = [...data.filter((d) => d.date <= today)];
    const minDays = 3;
    if (result.length < minDays) {
      for (let i = 0; i < minDays; i++) {
        const d = daysAgo(i);
        if (!existing.has(d)) {
          result.push({ date: d, total_tokens: 0, request_count: 0, cost_usd: 0 });
        }
      }
    }
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [timeline.data, isHourly]);

  // Stacked data by protocol, ordered so biggest stack bottom.
  const protocolNames = useMemo(
    () => Array.from(new Set(protocolTimeline.data?.map((p) => normProto(p.protocol_type)) ?? [])),
    [protocolTimeline.data],
  );
  const stackedData = useMemo(() => {
    if (!protocolTimeline.data?.length) return [];
    const byDate: Record<string, Record<string, number | string>> = {};
    for (const p of protocolTimeline.data) {
      if (!byDate[p.date]) byDate[p.date] = { date: p.date };
      byDate[p.date][normProto(p.protocol_type)] = p.total_tokens;
    }
    return Object.values(byDate).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [protocolTimeline.data]);

  // "Usage by key": drop zero-token rows (ODS sometimes surfaces probe /
  // test sentinels with 0 tokens — they're noise here), then sort desc and
  // cap at the top 10. `barPct` is relative to the top row for visual
  // comparison, `sharePct` is relative to the grand total.
  const keyRows = useMemo(() => {
    const nonZero = keyData.filter((k) => k.total_tokens > 0);
    const sorted = [...nonZero].sort((a, b) => b.total_tokens - a.total_tokens);
    const top = sorted[0]?.total_tokens ?? 1;
    const grand = sorted.reduce((s, k) => s + k.total_tokens, 0) || 1;
    return sorted.slice(0, 10).map((k, i) => ({
      ...k,
      barPct: (k.total_tokens / top) * 100,
      sharePct: (k.total_tokens / grand) * 100,
      color: KEY_PALETTE[i % KEY_PALETTE.length],
    }));
  }, [keyData]);

  // "Usage By App" rows (2026-05-25): same shape as keyRows so we can
  // reuse the .key-row / .key-bar CSS without duplicating. Two row
  // kinds — server returns (app_slug, provider_code) tuples and we
  // derive the display label here:
  //
  //   - app_slug non-empty → label = app_slug ("claude-mem"). First-
  //     party slugs (FIRST_PARTY_SLUGS) get the "INTERNAL" badge so
  //     the user can tell their own agents apart from AiKey's pipeline.
  //   - app_slug empty → label = providerToToolName(provider_code)
  //     ("claude" / "codex" / "kimi(moonshot)" …). The "(direct)"
  //     subtitle indicates these aren't a registered app, just CLI
  //     traffic.
  //
  // Sorted server-side already (ORDER BY SUM(total_tokens) DESC);
  // we just slice to top 10 + drop 0-token rows (same hygiene as
  // keyRows). barPct = relative to the top row; sharePct = absolute
  // share of the grand total — both rendered in the bar cell.
  const appRows = useMemo(() => {
    const all = (byApp.data ?? []).filter((r) => r.total_tokens > 0);
    const top = all[0]?.total_tokens ?? 1;
    const grand = all.reduce((s, r) => s + r.total_tokens, 0) || 1;
    return all.slice(0, 10).map((r) => {
      const isRegistered = r.app_slug !== '';
      const isFirstParty = isRegistered && FIRST_PARTY_SLUGS.has(r.app_slug);
      const label = isRegistered
        ? r.app_slug
        : providerToToolName(r.provider_code);
      // Color reuses providerColor() so the chip color is consistent with
      // the protocol stack chart above (anthropic = gold, kimi family =
      // sky, openai = violet). For registered apps without a clear
      // provider_code we'd fall back to IDLE, but the SQL always returns
      // provider_code for non-empty app rows.
      const color = providerColor(r.provider_code);
      return {
        key: `${r.app_slug}|${r.provider_code}`,
        label,
        app_slug: r.app_slug,
        kind: isRegistered ? (isFirstParty ? ('first-party' as const) : ('third-party' as const)) : ('direct' as const),
        provider_code: r.provider_code,
        total_tokens: r.total_tokens,
        request_count: r.request_count,
        cost_usd: r.cost_usd,
        unpriced_request_count: r.unpriced_request_count,
        barPct: (r.total_tokens / top) * 100,
        sharePct: (r.total_tokens / grand) * 100,
        color,
      };
    });
  }, [byApp.data]);

  if (!hasIdentity && !seats.isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
          {t('usageLedger.loadingAccountInfo')}
        </p>
      </div>
    );
  }

  const updatedAt = timeline.dataUpdatedAt ? relativeTime(new Date(timeline.dataUpdatedAt)) : null;

  return (
    <div className="usage-page p-6">
      <style>{USAGE_CSS}</style>

      {/* Title row — mb-6 gap mirrors the shared PageHeader component
          used across master pages. */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-lg font-bold font-mono tracking-wide" style={{ color: 'var(--display-foreground)' }}>
            {t('usageLedger.title')}
          </h1>
          <p className="text-[11.5px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
            {t('usageLedger.subtitle')}
            {updatedAt ? t('usageLedger.updatedSuffix', { updatedAt }) : ''}
          </p>
        </div>
        <div className="seg" role="tablist" aria-label={t('usageLedger.timeRangeAria')}>
          {([1, 7, 14, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={range === d}
              className={range === d ? 'active' : ''}
              onClick={() => setRange(d)}
            >
              {t('usageLedger.rangeLabel', { d })}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {/* ── KPI cards (4th = estimated cost, Stage 4) ── */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="kpi">
            <div className="kpi-label">{t('usageLedger.kpiTotalTokens')}</div>
            <div className="kpi-value">{formatTokens(totalTokens)}</div>
            <div className="kpi-hint">
              {t('usageLedger.kpiHintLast')}
              <span style={{ color: 'var(--foreground)' }}>{t('usageLedger.rangeLabel', { d: range })}</span>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{t('usageLedger.kpiTotalRequests')}</div>
            <div className="kpi-value">{totalRequests.toLocaleString()}</div>
            <div className="kpi-hint">
              {t('usageLedger.kpiHintAvg')}{' '}
              <span style={{ color: 'var(--foreground)' }}>
                {totalRequests > 0 ? formatTokens(avgPerRequest) : '—'}
              </span>{' '}
              {t('usageLedger.kpiHintTokensPerReq')}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">{t('usageLedger.kpiProtocolsUsed')}</div>
            <div className="kpi-value">{protocolData.length}</div>
            <div className="kpi-hint">
              {protocolData.length === 0
                ? t('usageLedger.noActivityYet')
                : protocolData.map((p) => p.protocol_type).slice(0, 3).join(' · ')}
            </div>
          </div>
          {/* Estimated cost (Stage 4). "Estimated" framing + footnote below
              set expectations — these are reference numbers from a published
              price table, not billed amounts. */}
          <div className="kpi">
            <div className="kpi-label">{t('usageLedger.kpiEstimatedCost')}</div>
            <div className="kpi-value">{formatCost(totalCost)}</div>
            <div className="kpi-hint">
              {totalUnpriced > 0 ? (
                <Link
                  to="/user/usage-detail?filter=unpriced"
                  title={t('usageLedger.unpricedTooltip')}
                  style={{ color: 'var(--destructive)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  ⚠ {t('usageLedger.kpiCostUnpriced', { count: totalUnpriced })}
                </Link>
              ) : (
                <>
                  {t('usageLedger.kpiHintCostPerReq')}{' '}
                  <span style={{ color: 'var(--foreground)' }}>
                    {totalRequests > 0 ? formatCost(costPerRequest) : '—'}
                  </span>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ── Area chart + By-protocol donut ── */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Area chart */}
          <div className="chart-card col-span-12 md:col-span-8">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="chart-title">{t('usageLedger.chartUsageOverTimeTitle')}</div>
                <div className="chart-sub">
                  {range === 1 ? t('usageLedger.today') : t('usageLedger.lastNDays', { range })} · {formatTokens(totalTokens)}{t('usageLedger.totalTokensSuffix')}
                </div>
              </div>
              <div className="legend">
                <span className="item">
                  <span className="dot" style={{ background: 'var(--primary)' }} />
                  {t('usageLedger.legendTokens')}
                </span>
                <span className="item">
                  <span
                    className="dot"
                    style={{
                      background: '#71717a',
                      // Dashed preview fragment to echo the stroke style below.
                      boxShadow: 'inset 0 0 0 1px #71717a',
                    }}
                  />
                  {t('usageLedger.legendRequests')}
                </span>
                <span className="item">
                  <span className="dot" style={{ background: '#2dd4bf' }} />
                  {t('usageLedger.legendCost')}
                </span>
              </div>
            </div>
            {/* Dual-axis composed chart (2026-04-23 swap): tokens as Bar on
                the left axis, requests as a dashed Line on the right axis.
                Two axes are load-bearing: tokens live in 10^3–10^6/day while
                request_count is 10^1–10^3, so forcing one axis would
                flatten requests against zero. Previous iteration had both
                as Areas; switching to Bar+Line preserves the dual-axis
                read while matching the "usage-as-bars" direction the user
                asked for. Don't drop the request series again — the
                volume-vs-frequency read is the headline value here. */}
            <div className="w-full h-[220px]">
              {timeline.isLoading ? (
                <Placeholder>{t('usageLedger.loading')}</Placeholder>
              ) : padTimelineData.length === 0 ? (
                <Placeholder>{t('usageLedger.noUsageDataYet')}</Placeholder>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={padTimelineData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={renderDateTick}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border)' }}
                      interval={Math.max(Math.floor(padTimelineData.length / 6) - 1, 0)}
                    />
                    {/* Usage is the dedicated analytics page — denser gridlines
                        (tickCount={8}) make it easier to read off exact values.
                        Overview's version uses tickCount={2} for a cleaner
                        compact look. Both axes use the same count so
                        left/right tick positions align. */}
                    <YAxis
                      yAxisId="tokens"
                      tickFormatter={formatTokens}
                      tick={{ fontSize: 9, fontFamily: 'monospace', fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickCount={8}
                    />
                    {/* Requests rides a HIDDEN axis (line still renders): the
                        visible right axis is reserved for Cost ($) per the design.
                        Request magnitude reads off the tooltip. */}
                    <YAxis yAxisId="requests" orientation="right" allowDecimals={false} hide />
                    {/* Cost ($) on the visible right axis — teal ticks tie it to
                        the cost line. $ scale differs from tokens by orders of
                        magnitude, hence its own axis. */}
                    <YAxis
                      yAxisId="cost"
                      orientation="right"
                      domain={[0, 'auto']}
                      tickFormatter={(v: number) => '$' + Math.round(Number(v)).toLocaleString('en-US')}
                      tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#2dd4bf' }}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                      tickCount={8}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(250, 204, 21,0.05)' }}
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        fontFamily: 'monospace',
                        fontSize: 11,
                        borderRadius: 4,
                      }}
                      formatter={(v, name) => {
                        if (name === 'Requests') return [Number(v).toLocaleString('en-US'), t('usageLedger.legendRequests')];
                        if (name === 'Cost') return ['$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }), t('usageLedger.legendCost')];
                        return [formatTokens(Number(v)), t('usageLedger.legendTokens')];
                      }}
                    />
                    <Bar
                      yAxisId="tokens"
                      dataKey="total_tokens"
                      name="Tokens"
                      fill="#ca8a04"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={20}
                    />
                    <Line
                      yAxisId="requests"
                      type="monotone"
                      dataKey="request_count"
                      name="Requests"
                      stroke="#71717a"
                      strokeWidth={1.4}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                    {/* Cost ($) curve — teal, solid + slightly thicker so it reads
                        as the highlight metric vs the subtle gray request line;
                        teal is a cool complement to the warm gold token bars. */}
                    <Line
                      yAxisId="cost"
                      type="monotone"
                      dataKey="cost_usd"
                      name="Cost"
                      stroke="#2dd4bf"
                      strokeWidth={1.8}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* By-protocol — list with horizontal share bars (2026-04-23 swap,
              mirrors the layout Overview used before the chart types were
              exchanged). Per-row: [provider dot] [name] [tokens] [pct] +
              a gold share bar below each non-zero row. */}
          <div className="chart-card col-span-12 md:col-span-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="chart-title">{t('usageLedger.byProtocolTitle')}</div>
                <div className="chart-sub">{t('usageLedger.byProtocolSub', { range })}</div>
              </div>
            </div>

            {protocolData.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {t('usageLedger.noData')}
              </div>
            ) : (
              <ul className="space-y-3">
                {protocolData.map((p) => {
                  const pct = Math.round((p.total_tokens / protoTotal) * 100);
                  const idle = p.total_tokens === 0;
                  const color = providerColor(p.protocol_type);
                  return (
                    <li key={p.protocol_type} title={idle ? 'No usage in the selected range' : undefined}>
                      <div
                        className="flex items-center justify-between"
                        style={{ opacity: idle ? 0.55 : 1 }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
                            style={{ background: color }}
                          />
                          {idle ? (
                            <span className="text-[12.5px] font-medium truncate" style={{ color: 'var(--foreground)' }}>
                              {p.protocol_type}
                            </span>
                          ) : (
                            <Link
                              to={`/user/usage-detail?protocol=${encodeURIComponent(p.protocol_type)}`}
                              className="text-[12.5px] font-medium truncate ledger-drill"
                              title={t('usageLedger.drillToDetail')}
                              style={{ color: 'var(--foreground)' }}
                            >
                              {p.protocol_type}
                            </Link>
                          )}
                        </div>
                        <div className="flex items-center gap-3 font-mono text-[12px]">
                          <span style={{ color: idle ? 'var(--muted-foreground)' : 'var(--foreground)' }}>
                            {idle ? '—' : formatTokens(p.total_tokens)}
                          </span>
                          <span className="w-9 text-right" style={{ color: 'var(--muted-foreground)' }}>
                            {pct}%
                          </span>
                        </div>
                      </div>
                      {!idle && (
                        <div
                          className="mt-1.5 h-2 rounded-sm"
                          style={{ background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}
                        >
                          <span
                            className="block h-full rounded-sm"
                            style={{
                              width: `${Math.max(pct, 1)}%`,
                              background: color,
                              boxShadow:
                                color === '#ca8a04' ? '0 0 8px rgba(250, 204, 21,0.35)' : undefined,
                            }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div
              className="mt-4 pt-3 flex items-center justify-between text-[12px] font-mono"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
            >
              <span>
                {protocolData.length === 1
                  ? t('usageLedger.protocolCountSingular', { count: protocolData.length })
                  : t('usageLedger.protocolCountPlural', { count: protocolData.length })}
              </span>
              <span>
                {range === 1 ? t('usageLedger.today') : t('usageLedger.kpiHintLast') + t('usageLedger.rangeLabel', { d: range })} · {formatTokens(totalTokens)}{t('usageLedger.totalSuffix')}
              </span>
            </div>
          </div>
        </section>

        {/* ── Stacked bar: Usage by protocol over time ── */}
        <section className="chart-card">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <div>
              <div className="chart-title">{t('usageLedger.byProtocolOverTimeTitle')}</div>
              <div className="chart-sub">
                {range === 1 ? t('usageLedger.hourly') : t('usageLedger.daily')}{t('usageLedger.tokensStackedByProvider')}{range === 1 ? t('usageLedger.todayLower') : t('usageLedger.lastNDaysLower', { range })}
              </div>
            </div>
            {protocolNames.length > 0 && (
              <div className="legend">
                {protocolNames.map((n) => (
                  <span key={n} className="item">
                    <span className="dot" style={{ background: providerColor(n) }} />
                    {n}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="w-full h-[220px]">
            {stackedData.length === 0 ? (
              <Placeholder>{t('usageLedger.noUsageDataYet')}</Placeholder>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stackedData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={renderDateTick}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    interval={Math.max(Math.floor(stackedData.length / 6) - 1, 0)}
                  />
                  <YAxis
                    tickFormatter={formatTokens}
                    tick={{ fontSize: 9, fontFamily: 'monospace', fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(250, 204, 21,0.04)' }}
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      borderRadius: 4,
                    }}
                    formatter={(v) => formatTokens(Number(v))}
                  />
                  {protocolNames.map((name) => (
                    <Bar
                      key={name}
                      dataKey={name}
                      stackId="a"
                      fill={providerColor(name)}
                      maxBarSize={22}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ── Usage by key (custom horizontal bars) ── */}
        <section className="chart-card">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="chart-title">{t('usageLedger.byKeyTitle')}</div>
              <div className="chart-sub">{t('usageLedger.byKeySub', { range })}</div>
            </div>
          </div>

          {byKey.isLoading ? (
            <div className="mt-6"><Placeholder>{t('usageLedger.loading')}</Placeholder></div>
          ) : keyRows.length === 0 ? (
            <div className="mt-6"><Placeholder>{t('usageLedger.noUsageDataYet')}</Placeholder></div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {keyRows.map((k) => (
                // React key is `${identity_or_vk}|${app_slug}` to mirror
                // the new SQL aggregation tuple — virtual_key_id alone is
                // no longer a stable per-row identity after OAuth
                // sessions collapse per (email, app).
                <li key={`${k.identity || k.virtual_key_id}|${k.app_slug ?? ''}`} className="key-row">
                  <div className="flex flex-col min-w-0">
                    <Link
                      to={k.identity
                        ? `/user/usage-detail?identity=${encodeURIComponent(k.identity)}`
                        : `/user/usage-detail?key=${encodeURIComponent(k.rawVkId)}`}
                      className="font-mono text-[11.5px] truncate ledger-drill"
                      title={t('usageLedger.drillToDetail')}
                      style={{ color: 'var(--foreground)' }}
                    >
                      {k.label}
                    </Link>
                    {k.appSubtitle ? (
                      <span
                        className="font-mono text-[10px] truncate"
                        title={k.appSubtitle}
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {k.appSubtitle}
                      </span>
                    ) : null}
                  </div>
                  <div className="key-bar">
                    <span
                      style={{
                        width: `${Math.max(k.barPct, 0.5)}%`,
                        background: k.color,
                        boxShadow:
                          k.color === '#ca8a04' ? '0 0 8px rgba(250, 204, 21,0.3)' : undefined,
                      }}
                    />
                  </div>
                  <div className="flex flex-col items-end whitespace-nowrap">
                    <span className="font-mono text-[11.5px]">
                      <span style={{ color: 'var(--foreground)' }}>{formatTokens(k.total_tokens)}</span>
                      <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>
                        {k.sharePct < 1 ? '<1%' : `${Math.round(k.sharePct)}%`}
                      </span>
                    </span>
                    <span className="font-mono text-[10px]">
                      <CostCell value={k.cost_usd} unpricedCount={k.unpriced_request_count} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Usage By App (2026-05-25) ──────────────────────────────
            Ranks traffic by Connected App. Registered apps (claude-mem,
            degrade-detector) show by their slug; direct /v1/... traffic
            shows by CLI tool name (claude, codex, kimi…) derived from
            the provider_code. INTERNAL badge marks first-party apps so
            the user can distinguish their own agents from AiKey's
            built-in pipeline noise. Reuses .key-row / .key-bar CSS for
            visual consistency with the "Usage by key" section above. */}
        <section className="chart-card">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="chart-title">{t('usageLedger.byAppTitle')}</div>
              <div className="chart-sub">
                {t('usageLedger.byAppSub', { range })}
              </div>
            </div>
          </div>

          {byApp.isLoading ? (
            <div className="mt-6"><Placeholder>{t('usageLedger.loading')}</Placeholder></div>
          ) : appRows.length === 0 ? (
            <div className="mt-6"><Placeholder>{t('usageLedger.noAppUsageInRange')}</Placeholder></div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {appRows.map((a) => (
                <li key={a.key} className="app-row">
                  <span
                    className="font-mono text-[11.5px] truncate flex items-center gap-1.5"
                    title={
                      a.kind === 'direct'
                        ? t('usageLedger.directBucketedByTitle', { provider: a.provider_code })
                        : `${a.label} (${a.provider_code})`
                    }
                    style={{ color: 'var(--foreground)' }}
                  >
                    {a.app_slug ? (
                      <Link to={`/user/usage-detail?app=${encodeURIComponent(a.app_slug)}`} className="truncate ledger-drill" title={t('usageLedger.drillToDetail')} style={{ color: 'var(--foreground)' }}>{a.label}</Link>
                    ) : (
                      <span className="truncate">{a.label}</span>
                    )}
                    {a.kind === 'first-party' ? (
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider px-1 py-0 rounded"
                        style={{
                          background: '#ca8a04',
                          color: 'var(--primary-foreground, #18181b)',
                          flexShrink: 0,
                        }}
                        title={t('usageLedger.badgeInternalTitle')}
                      >
                        {t('usageLedger.badgeInternal')}
                      </span>
                    ) : a.kind === 'direct' ? (
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider px-1 py-0 rounded"
                        style={{
                          background: 'transparent',
                          color: 'var(--muted-foreground)',
                          border: '1px solid var(--border)',
                          flexShrink: 0,
                        }}
                        title={t('usageLedger.badgeDirectTitle')}
                      >
                        {t('usageLedger.badgeDirect')}
                      </span>
                    ) : null}
                  </span>
                  <div className="key-bar">
                    <span
                      style={{
                        width: `${Math.max(a.barPct, 0.5)}%`,
                        background: a.color,
                        boxShadow:
                          a.color === '#ca8a04' ? '0 0 8px rgba(250, 204, 21,0.3)' : undefined,
                      }}
                    />
                  </div>
                  <div className="flex flex-col items-end whitespace-nowrap">
                    <span className="font-mono text-[11.5px]">
                      <span style={{ color: 'var(--foreground)' }}>{formatTokens(a.total_tokens)}</span>
                      <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>
                        {a.sharePct < 1 ? '<1%' : `${Math.round(a.sharePct)}%`}
                      </span>
                      <span className="ml-2" style={{ color: 'var(--muted-foreground)' }}>
                        {t('usageLedger.reqSuffix', { count: a.request_count })}
                      </span>
                    </span>
                    <span className="font-mono text-[10px]">
                      <CostCell value={a.cost_usd} unpricedCount={a.unpriced_request_count} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Estimated-cost footnote (Stage 4) — sets the "reference,
            not billed" expectation for every cost figure on the page. */}
        <p className="font-mono text-[10.5px]" style={{ color: 'var(--muted-foreground)', opacity: 0.75 }}>
          {t('usageLedger.costFootnote')}
        </p>
      </div>
    </div>
  );
}

/* ── helpers ────────────────────────────────────────────────────────── */

/** Back-compat shim for the shared locale-aware formatter.
 * Previously hardcoded English. See datetime-intl.ts. */
function relativeTime(d: Date): string {
  return formatRelativeTime(d) || d.toLocaleDateString(navigator.language);
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-full w-full flex items-center justify-center text-xs font-mono"
      style={{ color: 'var(--muted-foreground)' }}
    >
      {children}
    </div>
  );
}

/* ── Scoped CSS ─────────────────────────────────────────────────────── */

const USAGE_CSS = `
/* Drill-to-detail row labels (by-key / by-app) — underline on hover so users
   know the label links to /user/usage-detail filtered to that key / app. */
.usage-page .ledger-drill { cursor: pointer; }
.usage-page .ledger-drill:hover { text-decoration: underline; text-underline-offset: 2px; }

.usage-page .seg {
  display: inline-flex;
  padding: 2px;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.usage-page .seg button {
  font-family: monospace;
  font-size: 10.5px;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  border-radius: 4px;
  color: var(--muted-foreground);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.usage-page .seg button:hover { color: var(--foreground); }
.usage-page .seg button.active {
  background: var(--card);
  color: var(--foreground);
  box-shadow: inset 0 0 0 1px var(--border);
}

.usage-page .kpi {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.1rem 1rem;
  text-align: center;
  transition: border-color 150ms ease;
}
.usage-page .kpi:hover { border-color: var(--muted-foreground); }
.usage-page .kpi-label {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.usage-page .kpi-value {
  font-family: monospace;
  font-size: 34px;
  font-weight: 700;
  color: var(--foreground);
  line-height: 1;
  margin-top: 0.75rem;
  letter-spacing: -0.01em;
}
.usage-page .kpi-hint {
  font-family: monospace;
  font-size: 12px;
  color: var(--muted-foreground);
  margin-top: 0.5rem;
}

.usage-page .chart-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.1rem;
}
.usage-page .chart-title {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.usage-page .chart-sub {
  font-family: monospace;
  font-size: 12px;
  color: var(--muted-foreground);
  opacity: 0.55;
  margin-top: 1px;
}

.usage-page .legend {
  display: inline-flex; align-items: center; gap: 1rem;
  font-family: monospace;
  font-size: 11.5px;
  color: var(--muted-foreground);
  flex-wrap: wrap;
}
.usage-page .legend .item { display: inline-flex; align-items: center; gap: 0.4rem; }
.usage-page .legend .dot {
  width: 9px; height: 9px; border-radius: 2px; display: inline-block;
  flex-shrink: 0;
}

.usage-page .key-row {
  display: grid;
  grid-template-columns: minmax(140px, 260px) 1fr 90px;
  align-items: center;
  gap: 0.75rem;
}
/* app-row is structurally the same as key-row but the right column
 * holds THREE values (tokens · share · request count) instead of two,
 * so it needs more horizontal room. 2026-05-25: discovered the
 * default 90px right column was clipping "147 req" on the right edge
 * of the Usage By App section — widening to 160px restores the
 * intended layout. Label column is slightly narrower (240px max vs
 * 260px) to claw back the extra width without forcing the bar to
 * collapse. */
.usage-page .app-row {
  display: grid;
  grid-template-columns: minmax(140px, 240px) 1fr 160px;
  align-items: center;
  gap: 0.75rem;
}
.usage-page .key-bar {
  position: relative;
  height: 10px;
  border-radius: 3px;
  background: rgba(255,255,255,0.04);
  overflow: hidden;
}
.usage-page .key-bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  height: 100%;
  transition: width 200ms ease;
}
`;
