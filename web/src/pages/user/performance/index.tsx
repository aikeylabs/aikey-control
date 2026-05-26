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
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { usageApi, type TimelinePoint } from '@/shared/api/usage';
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

export default function UserPerformancePage() {
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

  // activeDate: latest day with non-zero usage in the 7D window. If today already
  // has usage we show "today"; if not (early morning / fresh install) fall back to
  // the most recent active day so the card has something to display.
  const activeDate = useMemo(() => {
    const tl: TimelinePoint[] = usageTimeline.data ?? [];
    for (let i = tl.length - 1; i >= 0; i--) {
      if (tl[i].total_tokens > 0) return tl[i].date;
    }
    return todayDate;
  }, [usageTimeline.data, todayDate]);
  const isShowingToday = activeDate === todayDate;

  const byKeyRecent = useQuery({
    queryKey: ['user-performance-by-key', usageIdentityKey, activeDate],
    queryFn: () => usageApi.personalByKeyTotal(usageIdentity!, activeDate, activeDate),
    enabled: !!usageIdentity,
    refetchInterval: 60_000,
  });

  const byModelRecent = useQuery({
    queryKey: ['user-performance-by-model', usageIdentityKey, activeDate],
    queryFn: () => usageApi.personalByModelTotal(usageIdentity!, activeDate, activeDate),
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
    const data = (byKeyRecent.data ?? []).map((k) => ({ ...k, label: deriveKeyLabel(k) }));
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
          cachedPctOfRow: (cappedCached / denom) * 100,
          outputPctOfRow: (output / denom) * 100,
          barPct: (k.total_tokens / top) * 100,
          sharePct: (k.total_tokens / grand) * 100,
          hitRate: inputAll > 0 ? cappedCached / inputAll : 0,
        };
      }),
      grandTotal: sorted.reduce((s, k) => s + k.total_tokens, 0),
      grandCached,
      grandCreation,
      grandInput,
      grandReqs,
      grandHitRate: grandInput > 0 ? grandCached / grandInput : 0,
      keyCount: sorted.length,
    };
  }, [byKeyRecent.data]);

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
        const inputAll = m.input_tokens ?? 0;
        const cached = m.cached_input_tokens ?? 0;
        const creation = m.cache_creation_input_tokens ?? 0;
        const cappedCached = Math.min(cached, inputAll);
        const cappedCreation = Math.min(creation, Math.max(inputAll - cappedCached, 0));
        const uncached = Math.max(inputAll - cappedCached - cappedCreation, 0);
        const output = m.output_tokens ?? 0;
        const denom = uncached + cappedCreation + cappedCached + output > 0
          ? uncached + cappedCreation + cappedCached + output
          : 1;
        return {
          ...m,
          uncached,
          creation: cappedCreation,
          cached: cappedCached,
          output,
          uncachedPctOfRow: (uncached / denom) * 100,
          creationPctOfRow: (cappedCreation / denom) * 100,
          cachedPctOfRow: (cappedCached / denom) * 100,
          outputPctOfRow: (output / denom) * 100,
          barPct: (m.total_tokens / top) * 100,
          sharePct: (m.total_tokens / grand) * 100,
          hitRate: inputAll > 0 ? cappedCached / inputAll : 0,
        };
      }),
      grandTotal: sorted.reduce((s, m) => s + m.total_tokens, 0),
      grandCached,
      grandCreation,
      grandInput,
      grandReqs,
      grandHitRate: grandInput > 0 ? grandCached / grandInput : 0,
      modelCount: sorted.length,
    };
  }, [byModelRecent.data]);

  const updatedAt = byKeyRecent.dataUpdatedAt
    ? new Date(byKeyRecent.dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="performance-page p-6">
      <style>{COST_CSS}</style>

      {/* Title row — mirrors usage-ledger's PageHeader idiom: lg bold mono
          title + 11.5px muted subtitle. No range selector here; the page is
          single-day-scoped (today, or latest active day fallback). */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-lg font-bold font-mono tracking-wide" style={{ color: 'var(--display-foreground)' }}>
            Performance
          </h1>
          <p className="text-[11.5px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
            Per-key token usage breakdown for the active day
            {updatedAt ? ` · updated ${updatedAt}` : ''}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <section className="chart-card" data-origin-name="Usage by key today">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="min-w-0">
              <div className="chart-title">
                {isShowingToday && <span className="live-dot" aria-hidden />}
                {isShowingToday ? 'Cache utilization by key' : 'Cache utilization by key (recent)'}
              </div>
              <div className="chart-sub">
                {activeDate}{isShowingToday ? '' : ' · no usage today yet'}
              </div>
            </div>
            {todayKeyRows.keyCount > 0 && (
              <div className="legend">
                <span className="item">
                  <span className="dot" style={{ background: '#ca8a04' }} />
                  uncached
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.7)' }} />
                  creation
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.45)' }} />
                  cached
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.2)' }} />
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
                    title={`uncached ${fmtTok(k.uncached)} · creation ${fmtTok(k.creation)} · cached ${fmtTok(k.cached)} · output ${fmtTok(k.output)} · ${k.request_count.toLocaleString()} req`}
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
                      <span className="stat" title="uncached">
                        <span className="stat-dot stat-uncached" />{fmtTok(k.uncached)}
                      </span>
                    )}
                    {k.creation > 0 && (
                      <span className="stat" title="cache_creation">
                        <span className="stat-dot stat-creation" />{fmtTok(k.creation)}
                      </span>
                    )}
                    {k.cached > 0 && (
                      <span className="stat" title="cache_read">
                        <span className="stat-dot stat-cached" />{fmtTok(k.cached)}
                      </span>
                    )}
                    {k.output > 0 && (
                      <span className="stat" title="output">
                        <span className="stat-dot stat-output" />{fmtTok(k.output)}
                      </span>
                    )}
                    {/* Cache hit rate — the headline number for this chart.
                        Rendered in accent gold + bold + larger font so it
                        pops vs the muted segment stats. Tooltip shows the
                        raw numerator / denominator for forensic clarity. */}
                    <span
                      className="hit-rate"
                      title={`cache hit rate = cached / input · ${k.cached.toLocaleString()} / ${(k.input_tokens ?? 0).toLocaleString()}`}
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
                {/* Weighted aggregate cache hit rate. Same accent treatment
                    as per-row hit-rate so the eye can scan vertically and
                    land on the total without a context switch. */}
                {todayKeyRows.grandInput > 0 && (
                  <>
                    {' · '}
                    <span
                      className="hit-rate"
                      title={`weighted cache hit rate = ${todayKeyRows.grandCached.toLocaleString()} / ${todayKeyRows.grandInput.toLocaleString()}`}
                    >
                      {formatHitRate(todayKeyRows.grandHitRate)}
                    </span>
                    {' hit rate'}
                  </>
                )}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{todayKeyRows.grandReqs.toLocaleString()}</span>
                {' req'}
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
                {isShowingToday ? 'Usage by model' : 'Usage by model (recent)'}
              </div>
              <div className="chart-sub">
                {activeDate}{isShowingToday ? '' : ' · no usage today yet'}
              </div>
            </div>
            {todayModelRows.modelCount > 0 && (
              <div className="legend">
                <span className="item">
                  <span className="dot" style={{ background: '#ca8a04' }} />
                  uncached
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.7)' }} />
                  creation
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.45)' }} />
                  cached
                </span>
                <span className="item">
                  <span className="dot" style={{ background: 'rgba(202,138,4,0.2)' }} />
                  output
                </span>
              </div>
            )}
          </div>

          {byModelRecent.isLoading ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              Loading...
            </div>
          ) : todayModelRows.rows.length === 0 ? (
            <div className="py-6 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              No usage recorded yet
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
                    title={`uncached ${fmtTok(m.uncached)} · creation ${fmtTok(m.creation)} · cached ${fmtTok(m.cached)} · output ${fmtTok(m.output)} · ${m.request_count.toLocaleString()} req`}
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
                      <span className="stat" title="uncached">
                        <span className="stat-dot stat-uncached" />{fmtTok(m.uncached)}
                      </span>
                    )}
                    {m.creation > 0 && (
                      <span className="stat" title="cache_creation">
                        <span className="stat-dot stat-creation" />{fmtTok(m.creation)}
                      </span>
                    )}
                    {m.cached > 0 && (
                      <span className="stat" title="cache_read">
                        <span className="stat-dot stat-cached" />{fmtTok(m.cached)}
                      </span>
                    )}
                    {m.output > 0 && (
                      <span className="stat" title="output">
                        <span className="stat-dot stat-output" />{fmtTok(m.output)}
                      </span>
                    )}
                    {/* Cache hit rate — same prominent treatment as by-key.
                        See the by-key block above for rationale. */}
                    <span
                      className="hit-rate"
                      title={`cache hit rate = cached / input · ${m.cached.toLocaleString()} / ${(m.input_tokens ?? 0).toLocaleString()}`}
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
                {todayModelRows.modelCount} model{todayModelRows.modelCount === 1 ? '' : 's'}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayModelRows.grandTotal)}</span>
                {' total'}
                {todayModelRows.grandCreation > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayModelRows.grandCreation)}</span>
                    {' creation'}
                  </>
                )}
                {todayModelRows.grandCached > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{fmtTok(todayModelRows.grandCached)}</span>
                    {' cached'}
                  </>
                )}
                {todayModelRows.grandInput > 0 && (
                  <>
                    {' · '}
                    <span
                      className="hit-rate"
                      title={`weighted cache hit rate = ${todayModelRows.grandCached.toLocaleString()} / ${todayModelRows.grandInput.toLocaleString()}`}
                    >
                      {formatHitRate(todayModelRows.grandHitRate)}
                    </span>
                    {' hit rate'}
                  </>
                )}
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{todayModelRows.grandReqs.toLocaleString()}</span>
                {' req'}
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
`;
