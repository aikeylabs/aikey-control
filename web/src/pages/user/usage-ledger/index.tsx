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
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import { usageApi } from '@/shared/api/usage';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { runtimeConfig } from '@/app/config/runtime';
import { formatDateShort, formatRelativeTime } from '@/shared/utils/datetime-intl';

// Keep in sync with pages/user/overview/index.tsx's PROVIDER_COLORS.
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
const IDLE_COLOR = '#52525b';
function providerColor(name: string): string {
  return PROVIDER_COLORS[(name || '').toLowerCase()] ?? IDLE_COLOR;
}

// Fallback palette for the "by key" list — keys are identified by alias /
// OAuth identity, not provider, so we use the one-gold + zinc-gradient
// scheme when we can't map back to a provider.
const KEY_PALETTE = ['#ca8a04', '#71717a', '#52525b', '#a1a1aa', '#3f3f46', '#d4d4d8'];

type RangeKey = 7 | 14 | 30 | 90;

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
// Why the OAuth-session normalisation runs *before* the alias check: for
// OAuth sessions the backend populates `alias` with the raw session id
// (e.g. `oauth:session_<long-hex>`), which is unreadable in a list. If we
// trust the alias blindly we render the raw hex; if we trust the identity
// first (email), we get a clean label only for rows where ODS still has
// the identity row joined in. Collapsing any `(oauth:)?session_<hex>` form
// — in alias OR virtual_key_id — to `OAuth · <hex8>…` gives a consistent
// readable label across all variants, and `identity` still wins when
// present so the email ("user@example.com") takes precedence.
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

export default function UserUsageLedgerPage() {
  const [range, setRange] = useState<RangeKey>(30);
  const startDate = daysAgo(range);
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

  const timeline = useQuery({
    queryKey: ['user-usage-timeline', identityKey, range],
    queryFn: () => usageApi.personalTimeline(identity!, startDate, endDate),
    enabled: hasIdentity,
  });
  const protocolTimeline = useQuery({
    queryKey: ['user-usage-protocol-timeline', identityKey, range],
    queryFn: () => usageApi.personalByProtocolTimeline(identity!, startDate, endDate),
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

  // Derive friendly key labels (F2 landed).
  //   1. `alias`                    — personal keys + named team keys
  //   2. `identity`                 — OAuth email (from ODS oauth_identity)
  //   3. `oauth:session_<hex>`      — ODS-prefixed OAuth → `OAuth · <hex8>…`
  //   4. `personal:` prefix         — strip it
  //   5. `session_<hex>`            — bare session → `OAuth · <hex8>…`
  //   6. raw id / empty             — fallback
  const keyData = (byKey.data ?? []).map((k) => ({ ...k, label: deriveKeyLabel(k) }));

  const totalTokens = timeline.data?.reduce((s, p) => s + p.total_tokens, 0) ?? 0;
  const totalRequests = timeline.data?.reduce((s, p) => s + p.request_count, 0) ?? 0;
  const avgPerRequest = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;

  const protocolData = useMemo(
    () => (protocols.data ?? []).map((p) => ({ ...p, protocol_type: normProto(p.protocol_type) })),
    [protocols.data],
  );
  const protoTotal = protocolData.reduce((s, p) => s + p.total_tokens, 0) || 1;

  const padTimelineData = useMemo(() => {
    const data = timeline.data ?? [];
    const today = daysAgo(0);
    const existing = new Set(data.map((d) => d.date));
    const result = [...data.filter((d) => d.date <= today)];
    const minDays = 3;
    if (result.length < minDays) {
      for (let i = 0; i < minDays; i++) {
        const d = daysAgo(i);
        if (!existing.has(d)) {
          result.push({ date: d, total_tokens: 0, request_count: 0 });
        }
      }
    }
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }, [timeline.data]);

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

  if (!hasIdentity && !seats.isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
          Loading account info...
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
          <h1 className="text-lg font-bold font-mono tracking-wide" style={{ color: 'var(--foreground)' }}>
            My Usage
          </h1>
          <p className="text-[11.5px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
            Personal consumption across all accessible keys
            {updatedAt ? ` · updated ${updatedAt}` : ''}
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="Time range">
          {([7, 14, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={range === d}
              className={range === d ? 'active' : ''}
              onClick={() => setRange(d)}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {/* ── 3 KPI cards ── */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="kpi">
            <div className="kpi-label">Total Tokens</div>
            <div className="kpi-value">{formatTokens(totalTokens)}</div>
            <div className="kpi-hint">
              Last <span style={{ color: 'var(--foreground)' }}>{range}D</span>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Total Requests</div>
            <div className="kpi-value">{totalRequests.toLocaleString()}</div>
            <div className="kpi-hint">
              avg{' '}
              <span style={{ color: 'var(--foreground)' }}>
                {totalRequests > 0 ? formatTokens(avgPerRequest) : '—'}
              </span>{' '}
              tokens/req
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Protocols Used</div>
            <div className="kpi-value">{protocolData.length}</div>
            <div className="kpi-hint">
              {protocolData.length === 0
                ? 'No activity yet'
                : protocolData.map((p) => p.protocol_type).slice(0, 3).join(' · ')}
            </div>
          </div>
        </section>

        {/* ── Area chart + By-protocol donut ── */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Area chart */}
          <div className="chart-card col-span-12 md:col-span-8">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="chart-title">My token usage over time</div>
                <div className="chart-sub">
                  Last {range} days · {formatTokens(totalTokens)} total tokens
                </div>
              </div>
              <div className="legend">
                <span className="item">
                  <span className="dot" style={{ background: 'var(--primary)' }} />
                  tokens
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
                  requests
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
                <Placeholder>Loading...</Placeholder>
              ) : padTimelineData.length === 0 ? (
                <Placeholder>No usage data yet</Placeholder>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={padTimelineData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fontFamily: 'monospace', fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border)' }}
                      tickFormatter={(d: string) => formatDateShort(d)}
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
                    <YAxis
                      yAxisId="requests"
                      orientation="right"
                      allowDecimals={false}
                      tick={{ fontSize: 9, fontFamily: 'monospace', fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
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
                      formatter={(v, name) =>
                        name === 'Requests'
                          ? [Number(v).toLocaleString(), 'requests']
                          : [formatTokens(Number(v)), 'tokens']
                      }
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
                <div className="chart-title">By protocol</div>
                <div className="chart-sub">{range}D token share</div>
              </div>
            </div>

            {protocolData.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                No data
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
                          <span className="text-[12.5px] font-medium truncate" style={{ color: 'var(--foreground)' }}>
                            {p.protocol_type}
                          </span>
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
                {protocolData.length} protocol{protocolData.length === 1 ? '' : 's'}
              </span>
              <span>Last {range}D · {formatTokens(totalTokens)} total</span>
            </div>
          </div>
        </section>

        {/* ── Stacked bar: Usage by protocol over time ── */}
        <section className="chart-card">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <div>
              <div className="chart-title">Usage by protocol over time</div>
              <div className="chart-sub">
                Daily tokens stacked by provider · last {range} days
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
              <Placeholder>No usage data yet</Placeholder>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stackedData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fontFamily: 'monospace', fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickFormatter={(d: string) => formatDateShort(d)}
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
              <div className="chart-title">Usage by key</div>
              <div className="chart-sub">Top virtual keys · {range}D token consumption</div>
            </div>
          </div>

          {byKey.isLoading ? (
            <div className="mt-6"><Placeholder>Loading...</Placeholder></div>
          ) : keyRows.length === 0 ? (
            <div className="mt-6"><Placeholder>No usage data yet</Placeholder></div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {keyRows.map((k) => (
                <li key={k.virtual_key_id} className="key-row">
                  <span
                    className="font-mono text-[11.5px] truncate"
                    title={k.label}
                    style={{ color: 'var(--foreground)' }}
                  >
                    {k.label}
                  </span>
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
                  <span className="font-mono text-[11.5px] text-right whitespace-nowrap">
                    <span style={{ color: 'var(--foreground)' }}>{formatTokens(k.total_tokens)}</span>
                    <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>
                      {k.sharePct < 1 ? '<1%' : `${Math.round(k.sharePct)}%`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
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
