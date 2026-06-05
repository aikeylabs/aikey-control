/**
 * User Performance page — /user/performance
 *
 * Originally extracted as "Cost" on 2026-05-06; renamed to "Performance"
 * on 2026-05-21 (sidebar label) and the route + internal identifiers
 * (directory, function, CSS class) followed later the same day. Cross-app
 * menu trailer ID stays `personal-cost` and icon name stays `cost` —
 * those are stable cross-version match keys consumed by peer apps still
 * on the old binary; renaming them would break A↔B menu reconciliation.
 *
 * Data hooks (usageApi.personalByKeyTotal) and card style aligned with
 * /user/usage-ledger's `.chart-card` idiom (chart-title + chart-sub +
 * legend) so the two Insights pages read as a coherent set.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { usageApi, type TimelinePoint, type SessionTotal } from '@/shared/api/usage';
import { runtimeConfig } from '@/app/config/runtime';

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/** Format a cache hit ratio (0..1) as the percentage shown in the
 *  by-key / by-model row tail. Rules pinned by reviewer feedback:
 *   - exactly 0  → "0%"      (explicit "no cache used at all")
 *   - 0..1%      → "<1%"     (avoid the rounded-down "0%" lie for tiny hits)
 *   - else       → rounded integer percent (e.g. "85%")
 *  Single decimal point would look noisy at this font size and the user
 *  reads this number for a quick at-a-glance signal, not auditing. */
function formatHitRate(ratio: number): string {
  if (!isFinite(ratio) || ratio <= 0) return '0%';
  const pct = ratio * 100;
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

/** YYYY-MM-DD in user's local timezone — see overview/index.tsx for the
 *  rationale (UTC slice would desync near midnight in non-UTC tz). */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mirror of overview's deriveKeyLabel — keep call sites in sync if you edit. */
function deriveKeyLabel(
  k: { alias?: string; identity?: string; virtual_key_id: string },
  unlabeled: string,
): string {
  if (k.identity && k.identity.trim()) return k.identity;
  const oauthRe = /^(?:oauth:)?session_([a-f0-9]+)/i;
  const aliasStr = (k.alias ?? '').trim();
  const aliasOAuth = aliasStr.match(oauthRe);
  if (aliasOAuth) return `OAuth · ${aliasOAuth[1].slice(0, 8)}…`;
  if (aliasStr) return aliasStr;
  const id = (k.virtual_key_id || '').trim();
  if (!id) return unlabeled;
  const idOAuth = id.match(oauthRe);
  if (idOAuth) return `OAuth · ${idOAuth[1].slice(0, 8)}…`;
  if (id.startsWith('personal:')) return id.slice('personal:'.length);
  return id;
}

export default function UserPerformancePage() {
  const { t } = useTranslation();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });

  // Same usage-identity logic as Overview (see overview/index.tsx for rationale).
  const accountId = me?.account_id;
  const isLocalMode = runtimeConfig.authMode === 'local_bypass';
  const usageIdentity = isLocalMode
    ? { org_id: 'personal' as const }
    : accountId ? { account_id: accountId } : null;
  const usageIdentityKey = isLocalMode ? 'personal' : (accountId ?? '');

  const todayDate = daysAgoStr(0);

  // 7-day timeline only as fallback driver for activeDate (today / latest active day);
  // not displayed as a chart on this page.
  const usageTimeline = useQuery({
    queryKey: ['user-performance-timeline', usageIdentityKey],
    queryFn: () => usageApi.personalTimeline(usageIdentity!, daysAgoStr(6), todayDate),
    enabled: !!usageIdentity,
    refetchInterval: 60_000,
  });

  // pinnedDate / pinnedSession (2026-05-26): user-controlled drill-down
  // state. null = "use defaults" (latest-active-day for date, all-sessions
  // for session). When the user clicks a 7-day chart bar or a session row,
  // we pin that value here; the chip + Reset UI lets them clear it.
  //
  // We pin instead of just calling setActiveDate directly because:
  //   - default for date is derived from data (latest active day), not
  //     fixed — keeping pin separate lets "default" follow new data
  //   - chip needs to know "pinned vs derived" to decide whether to
  //     render at all (no chip when nothing's been clicked)
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [pinnedSession, setPinnedSession] = useState<string | null>(null);

  // derivedDate: latest day with non-zero usage in the 7D window. If today
  // already has usage we show "today"; if not (early morning / fresh
  // install) fall back to the most recent active day so the card has
  // something to display by default.
  const derivedDate = useMemo(() => {
    const tl: TimelinePoint[] = usageTimeline.data ?? [];
    for (let i = tl.length - 1; i >= 0; i--) {
      if (tl[i].total_tokens > 0) return tl[i].date;
    }
    return todayDate;
  }, [usageTimeline.data, todayDate]);
  const activeDate = pinnedDate ?? derivedDate;
  const isShowingToday = activeDate === todayDate && !pinnedDate;

  const byKeyRecent = useQuery({
    queryKey: ['user-performance-by-key', usageIdentityKey, activeDate, pinnedSession],
    queryFn: () => usageApi.personalByKeyTotal(usageIdentity!, activeDate, activeDate, pinnedSession ?? undefined),
    enabled: !!usageIdentity,
    refetchInterval: 60_000,
  });

  const byModelRecent = useQuery({
    queryKey: ['user-performance-by-model', usageIdentityKey, activeDate, pinnedSession],
    queryFn: () => usageApi.personalByModelTotal(usageIdentity!, activeDate, activeDate, undefined, pinnedSession ?? undefined),
    enabled: !!usageIdentity,
    refetchInterval: 60_000,
  });

  // Top N sessions for the active day. Deliberately NOT filtered by
  // pinnedSession (see design doc §5.3): clicking a session shouldn't
  // shrink the ranking to one row — user needs to see siblings to
  // switch between sessions without going through Reset.
  const bySessionRecent = useQuery({
    queryKey: ['user-performance-by-session', usageIdentityKey, activeDate],
    queryFn: () => usageApi.personalBySessionTotal(usageIdentity!, activeDate, activeDate, 10),
    enabled: !!usageIdentity,
    refetchInterval: 60_000,
  });

  // 4-segment bar (uncached / creation / cached / output) per account, share-of-day.
  // Math mirrors the proxy's anthropic.go totalInput() so segments sum to total_tokens.
  //
  // hitRate (2026-05-26): cached / input_tokens. The denominator is the full
  // INPUT side (uncached + creation + cached) — output is excluded because
  // it's a generation cost, not a cache-eligible read. Range 0..1 per row;
  // grandHitRate uses the sum-of-numerators / sum-of-denominators form
  // (NOT the arithmetic mean of per-row rates) so large-traffic rows weigh
  // proportionally — small "100% hit" probe rows don't drag the average up.
  const todayKeyRows = useMemo(() => {
    const data = (byKeyRecent.data ?? []).map((k) => ({ ...k, label: deriveKeyLabel(k, t('performance.unlabeled')) }));
    const nonZero = data.filter((k) => k.total_tokens > 0);
    const sorted = [...nonZero].sort((a, b) => b.total_tokens - a.total_tokens);
    const top = sorted[0]?.total_tokens ?? 1;
    const grand = sorted.reduce((s, k) => s + k.total_tokens, 0) || 1;
    const grandReqs = sorted.reduce((s, k) => s + k.request_count, 0);
    const grandCached = sorted.reduce((s, k) => s + (k.cached_input_tokens ?? 0), 0);
    const grandCreation = sorted.reduce((s, k) => s + (k.cache_creation_input_tokens ?? 0), 0);
    const grandInput = sorted.reduce((s, k) => s + (k.input_tokens ?? 0), 0);
    return {
      rows: sorted.map((k) => {
        // 方案 A: input_tokens is the PURE (uncached) input; cache lives in its own
        // fields (not a subset of input). Total input context = uncached + cached +
        // creation. No capping/subtraction needed anymore.
        const uncached = k.input_tokens ?? 0;
        const cached = k.cached_input_tokens ?? 0;
        const creation = k.cache_creation_input_tokens ?? 0;
        const totalInput = uncached + cached + creation;
        const output = k.output_tokens ?? 0;
        const denom = uncached + creation + cached + output > 0
          ? uncached + creation + cached + output
          : 1;
        return {
          ...k,
          uncached,
          creation,
          cached,
          output,
          uncachedPctOfRow: (uncached / denom) * 100,
          creationPctOfRow: (creation / denom) * 100,
          cachedPctOfRow: (cached / denom) * 100,
          outputPctOfRow: (output / denom) * 100,
          barPct: (k.total_tokens / top) * 100,
          sharePct: (k.total_tokens / grand) * 100,
          hitRate: totalInput > 0 ? cached / totalInput : 0,
        };
      }),
      grandTotal: sorted.reduce((s, k) => s + k.total_tokens, 0),
      grandCached,
      grandCreation,
      grandInput,
      grandReqs,
      // 方案 A: grandInput is now pure; total input context = pure + cache + creation.
      grandHitRate: (grandInput + grandCached + grandCreation) > 0
        ? grandCached / (grandInput + grandCached + grandCreation) : 0,
      keyCount: sorted.length,
    };
  }, [byKeyRecent.data, t]);

  // Same 4-segment math as todayKeyRows but keyed by `model`. Kept
  // inline (not extracted to a helper) because this is the second
  // occurrence — extract on the third per the project's "third-time"
  // abstraction rule.
  const todayModelRows = useMemo(() => {
    const data = byModelRecent.data ?? [];
    const nonZero = data.filter((m) => m.total_tokens > 0);
    const sorted = [...nonZero].sort((a, b) => b.total_tokens - a.total_tokens);
    const top = sorted[0]?.total_tokens ?? 1;
    const grand = sorted.reduce((s, m) => s + m.total_tokens, 0) || 1;
    const grandReqs = sorted.reduce((s, m) => s + m.request_count, 0);
    const grandCached = sorted.reduce((s, m) => s + (m.cached_input_tokens ?? 0), 0);
    const grandCreation = sorted.reduce((s, m) => s + (m.cache_creation_input_tokens ?? 0), 0);
    const grandInput = sorted.reduce((s, m) => s + (m.input_tokens ?? 0), 0);
    return {
      rows: sorted.map((m) => {
        // 方案 A: input_tokens is the PURE (uncached) input; cache is separate.
        // Total input context = uncached + cached + creation.
        const uncached = m.input_tokens ?? 0;
        const cached = m.cached_input_tokens ?? 0;
        const creation = m.cache_creation_input_tokens ?? 0;
        const totalInput = uncached + cached + creation;
        const output = m.output_tokens ?? 0;
        const denom = uncached + creation + cached + output > 0
          ? uncached + creation + cached + output
          : 1;
        return {
          ...m,
          uncached,
          creation,
          cached,
          output,
          uncachedPctOfRow: (uncached / denom) * 100,
          creationPctOfRow: (creation / denom) * 100,
          cachedPctOfRow: (cached / denom) * 100,
          outputPctOfRow: (output / denom) * 100,
          barPct: (m.total_tokens / top) * 100,
          sharePct: (m.total_tokens / grand) * 100,
          hitRate: totalInput > 0 ? cached / totalInput : 0,
        };
      }),
      grandTotal: sorted.reduce((s, m) => s + m.total_tokens, 0),
      grandCached,
      grandCreation,
      grandInput,
      grandReqs,
      // 方案 A: grandInput is now pure; total input context = pure + cache + creation.
      grandHitRate: (grandInput + grandCached + grandCreation) > 0
        ? grandCached / (grandInput + grandCached + grandCreation) : 0,
      modelCount: sorted.length,
    };
  }, [byModelRecent.data]);

  const updatedAt = byKeyRecent.dataUpdatedAt
    ? new Date(byKeyRecent.dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  // 7-day trend rows — read from the existing usageTimeline query (no new
  // fetch). One bar per day in the 7D window; height proportional to that
  // day's total_tokens vs the window max. Click → pin date.
  //
  // Padding (2026-05-26): the timeline API returns rows only for days
  // with at least one event, but the chart promises 7 columns the user
  // can click — including empty days, so drill-down to those is still
  // possible (Top N + by-key + by-model all switch to the empty state,
  // which is informative). We pad the missing dates with zero rows; the
  // rendered bar height is capped to a 1% minimum so clickable tappable
  // area exists even at zero tokens.
  const trend7d = useMemo(() => {
    const byDate = new Map<string, TimelinePoint>();
    for (const p of usageTimeline.data ?? []) {
      byDate.set(p.date, p);
    }
    // Build the canonical 7-day window from today back, oldest first.
    const allSeven: TimelinePoint[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = daysAgoStr(i);
      const found = byDate.get(d);
      allSeven.push(found ?? { date: d, total_tokens: 0, request_count: 0 });
    }
    const max = allSeven.reduce((m, p) => Math.max(m, p.total_tokens), 0) || 1;
    return allSeven.map((p) => ({
      date: p.date,
      total_tokens: p.total_tokens,
      request_count: p.request_count,
      heightPct: (p.total_tokens / max) * 100,
      isActive: p.date === activeDate,
      isToday: p.date === todayDate,
    }));
  }, [usageTimeline.data, activeDate, todayDate]);

  // Top N session rows — compute label + bar percentages. Mirror of
  // todayKeyRows minus the cache segmentation (sessions don't need the
  // 4-segment split; one bar per session is enough).
  const sessionRows = useMemo(() => {
    const data: SessionTotal[] = bySessionRecent.data ?? [];
    const nonZero = data.filter((s) => s.total_tokens > 0);
    const sorted = [...nonZero].sort((a, b) => b.total_tokens - a.total_tokens);
    const top = sorted[0]?.total_tokens ?? 1;
    const grand = sorted.reduce((s, r) => s + r.total_tokens, 0) || 1;
    return {
      rows: sorted.map((r) => ({
        ...r,
        label: r.session_id || t('performance.noSession'),
        // For OAuth sessions show the email next to the session id.
        sublabel: [r.sample_identity, r.sample_app_slug && r.sample_app_slug !== '' ? r.sample_app_slug : '']
          .filter(Boolean)
          .join(' · '),
        barPct: (r.total_tokens / top) * 100,
        sharePct: (r.total_tokens / grand) * 100,
        isPinned: r.session_id === pinnedSession,
      })),
      grandTotal: sorted.reduce((s, r) => s + r.total_tokens, 0),
      grandReqs: sorted.reduce((s, r) => s + r.request_count, 0),
      sessionCount: sorted.length,
    };
  }, [bySessionRecent.data, pinnedSession, t]);

  // Pinned session sample identity for the chip label (so users see
  // "FreySilvaqzs@... · Claude Code" rather than a raw session id).
  const pinnedSessionLabel = useMemo(() => {
    if (!pinnedSession) return '';
    const row = sessionRows.rows.find((r) => r.session_id === pinnedSession);
    if (!row) return pinnedSession;
    if (row.sublabel) return `${pinnedSession.slice(0, 12)}… · ${row.sublabel}`;
    return pinnedSession;
  }, [pinnedSession, sessionRows.rows]);

  const hasFilters = pinnedDate !== null || pinnedSession !== null;
  const resetFilters = () => {
    setPinnedDate(null);
    setPinnedSession(null);
  };

  return (
    <div className="performance-page p-6">
      <style>{COST_CSS}</style>

      {/* Title row — mirrors usage-ledger's PageHeader idiom: lg bold mono
          title + 11.5px muted subtitle. No range selector here; the page is
          single-day-scoped (today, or latest active day fallback). */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-lg font-bold font-mono tracking-wide" style={{ color: 'var(--display-foreground)' }}>
            {t('performance.title')}
          </h1>
          <p className="text-[11.5px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
            {t('performance.subtitle')}
            {updatedAt ? t('performance.updatedSuffix', { time: updatedAt }) : ''}
          </p>
        </div>
      </div>

      {/* Filter chips + Reset (2026-05-26): ALWAYS rendered so the row
          doesn't appear / disappear as the user toggles filters —
          avoids layout jumps that shift the charts down on first click.
          When nothing's pinned the row shows the implicit defaults as
          plain text (no chip × since defaults have nothing to clear).
          Reset link only appears when at least one filter is pinned. */}
      <div className="flex items-center gap-2 flex-wrap mb-4 text-[11.5px] font-mono" style={{ minHeight: '24px' }}>
        <span style={{ color: 'var(--muted-foreground)' }}>{t('performance.filteredBy')}</span>
        {pinnedDate ? (
          <span className="filter-chip" title={`${t('performance.dateLabelPrefix')}${pinnedDate}`}>
            {t('performance.dateLabelPrefix')}{pinnedDate}
            <button className="chip-x" onClick={() => setPinnedDate(null)} aria-label={t('performance.clearDateFilter')}>×</button>
          </span>
        ) : (
          <span style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
            {t('performance.dateLabelPrefix')}{isShowingToday ? t('performance.today') : derivedDate} <span style={{ opacity: 0.55 }}>{t('performance.defaultSuffix')}</span>
          </span>
        )}
        <span style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}>·</span>
        {pinnedSession ? (
          <span className="filter-chip" title={`${t('performance.sessionLabelPrefix')}${pinnedSession}`}>
            {t('performance.sessionLabelPrefix')}{pinnedSessionLabel}
            <button className="chip-x" onClick={() => setPinnedSession(null)} aria-label={t('performance.clearSessionFilter')}>×</button>
          </span>
        ) : (
          <span style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
            {t('performance.sessionLabelPrefix')}{t('performance.sessionAll')} <span style={{ opacity: 0.55 }}>{t('performance.defaultSuffix')}</span>
          </span>
        )}
        {hasFilters && (
          <button className="reset-link" onClick={resetFilters}>{t('performance.resetAll')}</button>
        )}
      </div>

      <div className="space-y-5">
        {/* 7-day trend (2026-05-26): one clickable bar per day. Source
            data is the existing usageTimeline query — no new fetch. The
            current activeDate (pinned or derived) is visually highlighted.
            Click a bar → setPinnedDate. */}
        <section className="chart-card" data-origin-name="7-day token trend">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="min-w-0">
              <div className="chart-title">{t('performance.trendTitle')}</div>
              <div className="chart-sub">{t('performance.trendSub')}</div>
            </div>
          </div>
          {usageTimeline.isLoading ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.loading')}
            </div>
          ) : trend7d.length === 0 ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.noUsage7d')}
            </div>
          ) : (
            <div className="trend7d">
              {trend7d.map((d) => (
                <button
                  key={d.date}
                  className={`trend7d-bar ${d.isActive ? 'is-active' : ''} ${d.isToday ? 'is-today' : ''}`}
                  onClick={() => {
                    // Switching day implicitly clears any session pin —
                    // a session that existed on day A almost certainly
                    // doesn't exist on day B, so leaving the session
                    // filter active would render an empty by-key /
                    // by-model card and confuse the user. Date click
                    // resets the session dimension to "All".
                    setPinnedDate(d.date);
                    setPinnedSession(null);
                  }}
                  title={t('performance.trendBarTitle', { date: d.date, tokens: fmtTok(d.total_tokens), reqs: d.request_count })}
                >
                  {/* Bar height with two tiers so a small-traffic day doesn't
                      disappear under one huge-traffic day:
                       - zero tokens     → render the 2px CSS min-height
                                           ONLY (clickable empty cell hint)
                       - non-zero tokens → at least 12% of chart height so
                                           a 1:100 ratio (e.g. 12K vs 1.3M)
                                           is still visibly a real bar, not
                                           a sub-pixel line. Larger days
                                           still scale linearly up to 100%. */}
                  {/* Per-day token total above the bar. Shown only when
                      non-zero — empty days stay visually quiet so the eye
                      can scan only the days with real traffic. Formatted
                      via fmtTok ("12.8K", "1.3M") to keep the number
                      tight under the narrow column width. */}
                  {d.total_tokens > 0 && (
                    <span className="trend7d-value">{fmtTok(d.total_tokens)}</span>
                  )}
                  <span
                    className="trend7d-fill"
                    style={{ height: `${d.total_tokens > 0 ? Math.max(d.heightPct, 12) : 0}%` }}
                  />
                  <span className="trend7d-label">{d.date.slice(5)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Top N sessions (2026-05-26): clickable rows feed pinnedSession.
            Empty session_id rendered as "(no session)" so users see the
            traffic that lacks session attribution (curl / generic SDKs). */}
        <section className="chart-card" data-origin-name="Top N sessions">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="min-w-0">
              <div className="chart-title">{t('performance.topSessionsTitle')}</div>
              <div className="chart-sub">
                {t('performance.topSessionsSub', { date: activeDate })}
              </div>
            </div>
          </div>
          {bySessionRecent.isLoading ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.loading')}
            </div>
          ) : sessionRows.rows.length === 0 ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.noSessions')}
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {sessionRows.rows.map((s) => (
                <li key={s.session_id || '__none__'} className="key-row session-row">
                  <button
                    className={`session-label ${s.isPinned ? 'is-pinned' : ''}`}
                    onClick={() => setPinnedSession(s.isPinned ? null : (s.session_id || null))}
                    title={s.label}
                  >
                    <div className="flex flex-col items-start min-w-0">
                      <span className="font-mono text-[11.5px] truncate" style={{ color: 'var(--foreground)' }}>
                        {s.label.length > 32 ? `${s.label.slice(0, 30)}…` : s.label}
                      </span>
                      {s.sublabel && (
                        <span className="font-mono text-[10px] truncate" style={{ color: 'var(--muted-foreground)' }}>
                          {s.sublabel}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="key-bar">
                    <span className="key-bar-fill" style={{ width: `${Math.max(s.barPct, 0.5)}%`, background: '#facc15' }} />
                  </div>
                  <span className="font-mono text-[11.5px] text-right whitespace-nowrap">
                    <span style={{ color: 'var(--foreground)' }}>{fmtTok(s.total_tokens)}</span>
                    <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>
                      {s.sharePct < 1 ? '<1%' : `${Math.round(s.sharePct)}%`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="chart-card" data-origin-name="Usage by key today">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="min-w-0">
              <div className="chart-title">
                {isShowingToday && <span className="live-dot" aria-hidden />}
                {isShowingToday ? t('performance.cacheUtilByKey') : t('performance.cacheUtilByKeyRecent')}
              </div>
              <div className="chart-sub">
                {activeDate}{isShowingToday ? '' : t('performance.noUsageTodayYet')}
              </div>
            </div>
            {todayKeyRows.keyCount > 0 && (
              <div className="legend">
                <span className="item">
                  <span className="dot" style={{ background: '#ca8a04' }} />
                  {t('performance.legendUncached')}
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.7)' }} />
                  {t('performance.legendCreation')}
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.45)' }} />
                  {t('performance.legendCached')}
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.2)' }} />
                  {t('performance.legendOutput')}
                </span>
              </div>
            )}
          </div>

          {byKeyRecent.isLoading ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.loading')}
            </div>
          ) : todayKeyRows.rows.length === 0 ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.noUsageRecorded')}
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {todayKeyRows.rows.map((k) => (
                <li key={k.virtual_key_id} className="key-row">
                  <span
                    className="font-mono text-[11.5px] truncate"
                    title={k.label}
                    style={{ color: 'var(--foreground)' }}
                  >
                    {k.label}
                  </span>
                  <div
                    className="key-bar"
                    title={t('performance.barTooltip', { uncached: fmtTok(k.uncached), creation: fmtTok(k.creation), cached: fmtTok(k.cached), output: fmtTok(k.output), reqs: k.request_count.toLocaleString() })}
                  >
                    <div
                      className="key-bar-fill"
                      style={{ width: `${Math.max(k.barPct, 0.5)}%` }}
                    >
                      <span className="seg-uncached" style={{ width: `${k.uncachedPctOfRow}%` }} />
                      <span className="seg-creation" style={{ width: `${k.creationPctOfRow}%` }} />
                      <span className="seg-cached" style={{ width: `${k.cachedPctOfRow}%` }} />
                      <span className="seg-output" style={{ width: `${k.outputPctOfRow}%` }} />
                    </div>
                  </div>
                  <div className="key-stats font-mono text-[11.5px] whitespace-nowrap">
                    {k.uncached > 0 && (
                      <span className="stat" title={t('performance.statTitleUncached')}>
                        <span className="stat-dot stat-uncached" />{fmtTok(k.uncached)}
                      </span>
                    )}
                    {k.creation > 0 && (
                      <span className="stat" title={t('performance.statTitleCacheCreation')}>
                        <span className="stat-dot stat-creation" />{fmtTok(k.creation)}
                      </span>
                    )}
                    {k.cached > 0 && (
                      <span className="stat" title={t('performance.statTitleCacheRead')}>
                        <span className="stat-dot stat-cached" />{fmtTok(k.cached)}
                      </span>
                    )}
                    {k.output > 0 && (
                      <span className="stat" title={t('performance.statTitleOutput')}>
                        <span className="stat-dot stat-output" />{fmtTok(k.output)}
                      </span>
                    )}
                    {/* Cache hit rate — the headline number for this chart.
                        Rendered in accent gold + bold + larger font so it
                        pops vs the muted segment stats. Tooltip shows the
                        raw numerator / denominator for forensic clarity. */}
                    <span
                      className="hit-rate"
                      title={t('performance.hitRateTooltip', { cached: k.cached.toLocaleString(), input: (k.input_tokens ?? 0).toLocaleString() })}
                    >
                      {formatHitRate(k.hitRate)}
                    </span>
                    <span className="stat-total">
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
                {todayKeyRows.keyCount === 1
                  ? t('performance.footerKeyCount', { count: todayKeyRows.keyCount })
                  : t('performance.footerKeyCountPlural', { count: todayKeyRows.keyCount })}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayKeyRows.grandTotal)}</span>
                {t('performance.footerTotal')}
                {todayKeyRows.grandCreation > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayKeyRows.grandCreation)}</span>
                    {t('performance.footerCreation')}
                  </>
                )}
                {todayKeyRows.grandCached > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayKeyRows.grandCached)}</span>
                    {t('performance.footerCached')}
                  </>
                )}
                {/* Weighted aggregate cache hit rate. Same accent treatment
                    as per-row hit-rate so the eye can scan vertically and
                    land on the total without a context switch. */}
                {todayKeyRows.grandInput > 0 && (
                  <>
                    {' · '}
                    <span
                      className="hit-rate"
                      title={t('performance.weightedHitRateTooltip', { cached: todayKeyRows.grandCached.toLocaleString(), input: todayKeyRows.grandInput.toLocaleString() })}
                    >
                      {formatHitRate(todayKeyRows.grandHitRate)}
                    </span>
                    {t('performance.footerHitRate')}
                  </>
                )}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{todayKeyRows.grandReqs.toLocaleString()}</span>
                {t('performance.footerReq')}
              </span>
            </div>
          )}
        </section>

        {/* 2026-05-12: "Usage by model" — same 4-segment shape as the
            by-key chart above, grouped by the provider-reported `model`
            string. Sort: total_tokens DESC; server caps at 20 rows. */}
        <section className="chart-card" data-origin-name="Usage by model today">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="min-w-0">
              <div className="chart-title">
                {isShowingToday && <span className="live-dot" aria-hidden />}
                {isShowingToday ? t('performance.usageByModel') : t('performance.usageByModelRecent')}
              </div>
              <div className="chart-sub">
                {activeDate}{isShowingToday ? '' : t('performance.noUsageTodayYet')}
              </div>
            </div>
            {todayModelRows.modelCount > 0 && (
              <div className="legend">
                <span className="item">
                  <span className="dot" style={{ background: '#ca8a04' }} />
                  {t('performance.legendUncached')}
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.7)' }} />
                  {t('performance.legendCreation')}
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.45)' }} />
                  {t('performance.legendCached')}
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.2)' }} />
                  {t('performance.legendOutput')}
                </span>
              </div>
            )}
          </div>

          {byModelRecent.isLoading ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.loading')}
            </div>
          ) : todayModelRows.rows.length === 0 ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('performance.noUsageRecorded')}
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {todayModelRows.rows.map((m) => (
                <li key={m.model} className="key-row">
                  <span
                    className="font-mono text-[11.5px] truncate"
                    title={m.model}
                    style={{ color: 'var(--foreground)' }}
                  >
                    {m.model}
                  </span>
                  <div
                    className="key-bar"
                    title={t('performance.barTooltip', { uncached: fmtTok(m.uncached), creation: fmtTok(m.creation), cached: fmtTok(m.cached), output: fmtTok(m.output), reqs: m.request_count.toLocaleString() })}
                  >
                    <div
                      className="key-bar-fill"
                      style={{ width: `${Math.max(m.barPct, 0.5)}%` }}
                    >
                      <span className="seg-uncached" style={{ width: `${m.uncachedPctOfRow}%` }} />
                      <span className="seg-creation" style={{ width: `${m.creationPctOfRow}%` }} />
                      <span className="seg-cached" style={{ width: `${m.cachedPctOfRow}%` }} />
                      <span className="seg-output" style={{ width: `${m.outputPctOfRow}%` }} />
                    </div>
                  </div>
                  <div className="key-stats font-mono text-[11.5px] whitespace-nowrap">
                    {m.uncached > 0 && (
                      <span className="stat" title={t('performance.statTitleUncached')}>
                        <span className="stat-dot stat-uncached" />{fmtTok(m.uncached)}
                      </span>
                    )}
                    {m.creation > 0 && (
                      <span className="stat" title={t('performance.statTitleCacheCreation')}>
                        <span className="stat-dot stat-creation" />{fmtTok(m.creation)}
                      </span>
                    )}
                    {m.cached > 0 && (
                      <span className="stat" title={t('performance.statTitleCacheRead')}>
                        <span className="stat-dot stat-cached" />{fmtTok(m.cached)}
                      </span>
                    )}
                    {m.output > 0 && (
                      <span className="stat" title={t('performance.statTitleOutput')}>
                        <span className="stat-dot stat-output" />{fmtTok(m.output)}
                      </span>
                    )}
                    {/* Cache hit rate — same prominent treatment as by-key.
                        See the by-key block above for rationale. */}
                    <span
                      className="hit-rate"
                      title={t('performance.hitRateTooltip', { cached: m.cached.toLocaleString(), input: (m.input_tokens ?? 0).toLocaleString() })}
                    >
                      {formatHitRate(m.hitRate)}
                    </span>
                    <span className="stat-total">
                      <span style={{ color: 'var(--foreground)' }}>{fmtTok(m.total_tokens)}</span>
                      <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>
                        {m.sharePct < 1 ? '<1%' : `${Math.round(m.sharePct)}%`}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {todayModelRows.modelCount > 0 && (
            <div
              className="mt-4 pt-3 flex items-center justify-between text-[12px] font-mono flex-wrap gap-2"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
            >
              <span>
                {todayModelRows.modelCount === 1
                  ? t('performance.footerModelCount', { count: todayModelRows.modelCount })
                  : t('performance.footerModelCountPlural', { count: todayModelRows.modelCount })}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayModelRows.grandTotal)}</span>
                {t('performance.footerTotal')}
                {todayModelRows.grandCreation > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayModelRows.grandCreation)}</span>
                    {t('performance.footerCreation')}
                  </>
                )}
                {todayModelRows.grandCached > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayModelRows.grandCached)}</span>
                    {t('performance.footerCached')}
                  </>
                )}
                {todayModelRows.grandInput > 0 && (
                  <>
                    {' · '}
                    <span
                      className="hit-rate"
                      title={t('performance.weightedHitRateTooltip', { cached: todayModelRows.grandCached.toLocaleString(), input: todayModelRows.grandInput.toLocaleString() })}
                    >
                      {formatHitRate(todayModelRows.grandHitRate)}
                    </span>
                    {t('performance.footerHitRate')}
                  </>
                )}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{todayModelRows.grandReqs.toLocaleString()}</span>
                {t('performance.footerReq')}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Card / title / legend / row idiom mirrors `.usage-page` selectors in
// /user/usage-ledger so the two Insights pages share a visual language.
// If you tweak chart-card spacing here, also tweak it in usage-ledger
// (or extract both into a shared CSS module — only worth it once a third
// page joins).
const COST_CSS = `
.performance-page .chart-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.1rem;
}
.performance-page .chart-title {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.performance-page .chart-sub {
  font-family: monospace;
  font-size: 12px;
  color: var(--muted-foreground);
  opacity: 0.55;
  margin-top: 1px;
}

.performance-page .legend {
  display: inline-flex; align-items: center; gap: 1rem;
  font-family: monospace;
  font-size: 11.5px;
  color: var(--muted-foreground);
  flex-wrap: wrap;
}
.performance-page .legend .item { display: inline-flex; align-items: center; gap: 0.4rem; }
.performance-page .legend .dot {
  width: 9px; height: 9px; border-radius: 2px; display: inline-block;
  flex-shrink: 0;
}

.performance-page .live-dot {
  display: inline-block;
  width: 7px; height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: #ca8a04;
  box-shadow: 0 0 6px rgba(250, 204, 21, 0.6);
  animation: performance-live-pulse 1.6s ease-in-out infinite;
  vertical-align: middle;
}
@keyframes performance-live-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

.performance-page .key-row {
  display: grid;
  grid-template-columns: minmax(140px, 260px) 1fr auto;
  align-items: center;
  gap: 0.75rem;
}
.performance-page .key-bar {
  position: relative;
  height: 10px;
  border-radius: 3px;
  background: rgba(255,255,255,0.04);
  overflow: hidden;
}
.performance-page .key-bar > .key-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  display: flex;
  border-radius: 3px;
  overflow: hidden;
  transition: width 200ms ease;
}
.performance-page .key-bar-fill > span {
  display: block;
  height: 100%;
  transition: width 200ms ease;
}
.performance-page .key-bar-fill > .seg-uncached {
  background: #ca8a04;
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.3);
}
.performance-page .key-bar-fill > .seg-creation { background: rgba(202, 138, 4, 0.7); }
.performance-page .key-bar-fill > .seg-cached   { background: rgba(202, 138, 4, 0.45); }
.performance-page .key-bar-fill > .seg-output   { background: rgba(202, 138, 4, 0.2); }

.performance-page .key-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  color: var(--muted-foreground);
  text-align: right;
}
.performance-page .stat { display: inline-flex; align-items: center; }
.performance-page .stat-dot {
  display: inline-block;
  width: 7px; height: 7px;
  border-radius: 2px;
  margin-right: 5px;
  flex-shrink: 0;
}
.performance-page .stat-dot.stat-uncached { background: #ca8a04; }
.performance-page .stat-dot.stat-creation { background: rgba(202, 138, 4, 0.7); }
.performance-page .stat-dot.stat-cached   { background: rgba(202, 138, 4, 0.45); }
.performance-page .stat-dot.stat-output   { background: rgba(202, 138, 4, 0.2); }
.performance-page .stat-total {
  margin-left: 0.35rem;
  padding-left: 0.85rem;
  border-left: 1px solid var(--border);
}
/* Cache hit rate — the headline number per row + per chart-total.
 * Visual treatment chosen to "pop" without breaking the muted-stats grid:
 *   - bold + +1px font size vs the muted .stat siblings
 *   - accent gold (#facc15) matching the chart's primary segment color
 *   - subtle glow + left divider keeps it tied to the row, not floating
 *   - cursor:help signals the title-tooltip with raw num/den breakdown
 * Why no background pill: we tried it in design review; the pill made
 * every row look "noisy". Plain colored bold is enough at 12px mono. */
.performance-page .hit-rate {
  margin-left: 0.35rem;
  padding-left: 0.85rem;
  border-left: 1px solid var(--border);
  font-weight: 700;
  font-size: 12.5px;
  color: #facc15;
  text-shadow: 0 0 6px rgba(250, 204, 21, 0.35);
  cursor: help;
}

/* 7-day trend chart (2026-05-26). Flex of equal-width clickable bars.
 * Active bar (current activeDate, pinned or derived) gets a brighter
 * fill + outline; today's bar gets the live-pulse dot color. Hover
 * lifts slightly so the affordance is obvious. */
.performance-page .trend7d {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;          /* stretch children to full container height */
  height: 110px;
  padding: 0.5rem 0;
}
.performance-page .trend7d-bar {
  flex: 1;
  height: 100%;                  /* anchor for the fill's percentage height */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-end;     /* fill grows from the bottom up */
  background: transparent;
  border: none;
  cursor: pointer;
  /* Tiny inner padding + rounding so the column-wide hover highlight
   * (added below) doesn't visually touch its neighbours. Without this
   * adjacent bars look "glued" when both hover overlap on quick
   * mouseovers. */
  padding: 2px;
  border-radius: 4px;
  position: relative;
  min-width: 0;
  transition: background 120ms ease;
}
/* Whole-column hover affordance (option A, 2026-05-26): on hover the
 * entire button column gets a subtle background tint so users see
 * "this is a clickable cell" — even on zero-token days where the bar
 * itself is just a 2px line. Far more discoverable than relying on
 * cursor: pointer alone. */
.performance-page .trend7d-bar:hover {
  background: rgba(255, 255, 255, 0.04);
}
.performance-page .trend7d-fill {
  display: block;
  /* Default state: muted dark yellow (~25% opacity of the chart base
   * color). Quiet enough that the eye doesn't read every day as
   * "active" but still visible against the card background. */
  background: rgba(202, 138, 4, 0.25);
  border-radius: 3px 3px 0 0;
  transition: background 120ms ease, transform 120ms ease;
  min-height: 2px;
}
.performance-page .trend7d-bar:hover .trend7d-fill {
  /* Hover lift sits between default and active so users get a clear
   * "I'm about to select this" affordance. */
  background: rgba(202, 138, 4, 0.55);
  transform: scaleY(1.03);
  transform-origin: bottom;
}
.performance-page .trend7d-bar.is-active .trend7d-fill {
  /* Selected state: full-saturation project base yellow (same hue
   * as the cache-utilization "uncached" segment below — visual
   * consistency). 4x more saturated than the 25%-opacity default
   * is plenty of contrast without the harshness of pure #facc15. */
  background: #ca8a04;
  box-shadow: 0 0 6px rgba(202, 138, 4, 0.45);
}
.performance-page .trend7d-bar.is-today .trend7d-fill {
  outline: 1px dashed rgba(74, 222, 128, 0.7);
  outline-offset: 1px;
}
.performance-page .trend7d-label {
  display: block;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: var(--muted-foreground);
  text-align: center;
  margin-top: 4px;
}
/* Per-day token total — small mono label above the bar. Matches the
 * trend7d-label visual weight so the column reads as one tight unit:
 * value · bar · date. Slightly less muted than the date label since
 * the number is the data and the date is the index. */
.performance-page .trend7d-value {
  display: block;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: var(--foreground);
  text-align: center;
  margin-bottom: 3px;
  opacity: 0.75;
  white-space: nowrap;
}

/* Session label button — reset default button chrome so it sits cleanly
 * inside the .key-row grid. Pinned session glows the same accent gold
 * as the trend7d active bar for visual consistency. */
.performance-page .session-label {
  background: transparent;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.performance-page .session-label.is-pinned {
  outline: 1px solid #ca8a04;
  outline-offset: 2px;
  border-radius: 3px;
}
/* Top-session row hover highlight (matches the 7-day trend bar
 * affordance): the whole row gets a subtle background tint on hover
 * so users see "this entire line is clickable", not just the small
 * label button. Padding negative-margin trick keeps the highlight
 * flush with the row grid without shifting layout. */
.performance-page .session-row {
  cursor: pointer;
  margin: 0 -6px;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 120ms ease;
}
.performance-page .session-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

/* Filter chip — small inline tag with × close button. Pinned date /
 * session each get one. Reset clears all. Designed to look like
 * existing badge components in the project (e.g. usage-ledger app
 * row INTERNAL badge) to avoid visual noise. */
.performance-page .filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 2px 8px;
  border-radius: 12px;
  background: rgba(202, 138, 4, 0.15);
  border: 1px solid rgba(202, 138, 4, 0.4);
  color: var(--foreground);
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.performance-page .filter-chip .chip-x {
  background: none;
  border: none;
  color: var(--muted-foreground);
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
}
.performance-page .filter-chip .chip-x:hover {
  color: #facc15;
}
.performance-page .reset-link {
  background: none;
  border: none;
  color: var(--muted-foreground);
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  padding: 0;
  margin-left: 0.25rem;
}
.performance-page .reset-link:hover {
  color: #facc15;
}
`;
