/**
 * User Usage Detail — /user/usage-detail
 *
 * Rewritten 2026-06-06 for a cleaner, self-contained design (the previous
 * .vault-page-coupled version is archived at
 * Projects/backups/usage-detail-2026-06-06/index.tsx.archive). The table chrome
 * here is hand-tuned for this dense 6-column layout rather than inherited from
 * the wider virtual-keys table, so spacing/row-rhythm stay controllable.
 *
 * Per-request detail, last 7 days. Reached ONLY via drill-down links (cost card
 * "未计价", performance by-key/model) — no sidebar entry. Filters via URL params:
 * ?filter=unpriced &model= &key= &session= &date=.
 *
 * Data: usageApi.personalDetail → /v1/usage/personal/detail. Cost/tokens/status
 * from usage_fact_dwd (the read model where billable_amount is computed); the
 * upstream error text is LEFT-JOINed from the raw ODS. Local store only (personal
 * → control.db, team → Production). billable_amount null = 未计价.
 *
 * Interaction: click any row to expand an inline panel (accordion, not a drawer)
 * showing the token breakdown + endpoint + (for failures) the error reason.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { userAccountsApi } from '@/shared/api/user/accounts';
import { usageApi, type UsageDetailRow } from '@/shared/api/usage';
import { runtimeConfig } from '@/app/config/runtime';

const PAGE_SIZE = 30;

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function fmtUSD(s: string | null): string {
  if (s == null) return '—';
  return '$' + Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** DWD carries only the HTTP code; map it to a standard reason phrase. */
const HTTP_REASON: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden',
  404: 'Not Found', 408: 'Timeout', 409: 'Conflict', 422: 'Unprocessable',
  429: 'Too Many Requests', 500: 'Server Error', 502: 'Bad Gateway',
  503: 'Unavailable', 504: 'Gateway Timeout', 529: 'Overloaded',
};

/**
 * cleanErrorReason extracts the human-readable message from the raw upstream
 * error body. The proxy stores error_message LOSSLESS (the raw provider body) on
 * purpose; cleaning is the display layer's job. Provider envelopes share
 * `error.message` (Anthropic / OpenAI / Kimi); a non-JSON / unknown body is shown
 * as-is so no detail is hidden.
 */
function cleanErrorReason(raw: string): string {
  const s = (raw || '').trim();
  if (!s || s[0] !== '{') return s;
  try {
    const o = JSON.parse(s);
    const m = o?.error?.message ?? o?.message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  } catch {
    /* not JSON — fall through to raw */
  }
  return s;
}

/**
 * normalizeErrorTerm maps a provider-specific error code (or HTTP reason phrase)
 * to a GENERIC, cross-provider LLM term so the status reads the same regardless of
 * vendor (Moonshot `exceeded_current_quota_error` / OpenAI `insufficient_quota` /
 * Anthropic `rate_limit_error` → "Quota Exceeded" / "Rate Limited"). This only
 * normalizes the short LABEL — the raw provider code is kept and shown alongside in
 * the expanded panel (so detail is never lost). Falls back to the raw code / HTTP
 * reason when nothing matches.
 */
function normalizeErrorTerm(code: string, httpStatus: number, reason: string): string {
  const c = (code || '').toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => c.includes(k));
  if (has('quota', 'insufficient', 'balance', 'billing', 'credit', 'suspend', 'payment')) return 'Quota Exceeded';
  if (has('rate', 'too_many', 'too many') || httpStatus === 429) return 'Rate Limited';
  if (has('context_length', 'context length', 'max_tokens', 'too long')) return 'Context Length';
  if (has('content_filter', 'moderation', 'safety')) return 'Content Filtered';
  if (has('invalid', 'bad_request', 'bad request') || httpStatus === 400) return 'Invalid Request';
  if (has('auth', 'unauthorized', 'api key') || httpStatus === 401) return 'Authentication';
  if (has('forbidden', 'permission') || httpStatus === 403) return 'Permission Denied';
  if (has('not_found', 'not found') || httpStatus === 404) return 'Not Found';
  if (has('overload') || httpStatus === 529 || httpStatus === 503) return 'Overloaded';
  if (has('timeout') || httpStatus === 408 || httpStatus === 504) return 'Timeout';
  if (httpStatus >= 500) return 'Server Error';
  return code || reason;
}

export default function UserUsageDetailPage() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  // Column sort (client-side, over the loaded window). Default mirrors the
  // backend order (newest first). Clicking a header switches the key; clicking
  // the active header toggles asc/desc.
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'time', dir: 'desc' });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });

  const accountId = me?.account_id;
  const isLocalMode = runtimeConfig.authMode === 'local_bypass';
  const usageIdentity = isLocalMode
    ? { org_id: 'personal' as const }
    : accountId ? { account_id: accountId } : null;
  const usageIdentityKey = isLocalMode ? 'personal' : (accountId ?? '');

  const filter = sp.get('filter') ?? '';
  const model = sp.get('model') ?? '';
  const key = sp.get('key') ?? '';
  const session = sp.get('session') ?? '';
  const app = sp.get('app') ?? '';
  const protocol = sp.get('protocol') ?? '';
  const identity = sp.get('identity') ?? '';
  const date = sp.get('date') ?? '';
  const start = date || daysAgoStr(6);
  const end = date || daysAgoStr(0);

  // Drill-down filters (model/key/session/app/protocol/identity/date) narrow
  // server-side; the scenario filter (all/success/failed/unpriced) is applied
  // client-side so the scenario chips toggle instantly without a refetch.
  const q = useQuery({
    queryKey: ['user-usage-detail', usageIdentityKey, model, key, session, app, protocol, identity, date],
    queryFn: () => usageApi.personalDetail(usageIdentity!, {
      startDate: start, endDate: end,
      model: model || undefined, key: key || undefined, sessionId: session || undefined,
      appSlug: app || undefined, protocol: protocol || undefined, identity: identity || undefined,
    }),
    enabled: !!usageIdentity,
    placeholderData: keepPreviousData,
  });
  const allRows: UsageDetailRow[] = q.data ?? [];
  const filteredRows = useMemo(() => {
    if (filter === 'unpriced') return allRows.filter((r) => r.billable_amount == null);
    if (filter === 'failed') return allRows.filter((r) => r.request_status !== 'success');
    if (filter === 'success') return allRows.filter((r) => r.request_status === 'success');
    return allRows;
  }, [allRows, filter]);

  // Client-side column sort over the filtered window. cost null sorts lowest so
  // the "未计价" rows group at the bottom on a cost-desc sort.
  const rows = useMemo(() => {
    const cost = (r: UsageDetailRow) => (r.billable_amount == null ? -1 : Number(r.billable_amount));
    const cmp = (a: UsageDetailRow, b: UsageDetailRow): number => {
      switch (sort.key) {
        case 'model': return (a.model || '').localeCompare(b.model || '');
        case 'status': return a.http_status_code - b.http_status_code;
        case 'usage': return a.total_tokens - b.total_tokens;
        case 'cost': return cost(a) - cost(b);
        case 'session': return (a.session_id || '').localeCompare(b.session_id || '');
        default: return a.event_time_ms - b.event_time_ms; // 'time'
      }
    };
    const sorted = [...filteredRows].sort((a, b) => (sort.dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
    return sorted;
  }, [filteredRows, sort]);

  // Reset to first page whenever the filter set changes.
  useEffect(() => { setPage(0); setExpanded(null); }, [filter, model, key, session, app, protocol, identity, date, usageIdentityKey]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(pageSafe * PAGE_SIZE, (pageSafe + 1) * PAGE_SIZE);

  // Header click → sort by that column; clicking the active column toggles dir.
  const toggleSort = (key: string) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
    setExpanded(null);
  };
  const sortIcon = (key: string) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  // Drill-down context chips (model/key/session/date) — the scenario filter is
  // rendered separately as toggle tabs (SCENARIOS) below.
  const chips = useMemo(() => {
    const c: { k: string; label: string }[] = [];
    if (model) c.push({ k: 'model', label: `${t('usageDetail.chipModel')}: ${model}` });
    if (key) c.push({ k: 'key', label: `${t('usageDetail.chipKey')}: ${key.length > 18 ? key.slice(0, 16) + '…' : key}` });
    if (session) c.push({ k: 'session', label: `${t('usageDetail.chipSession')}: ${session.slice(0, 8)}…` });
    if (app) c.push({ k: 'app', label: `${t('usageDetail.chipApp')}: ${app}` });
    if (protocol) c.push({ k: 'protocol', label: `${t('usageDetail.chipProtocol')}: ${protocol}` });
    if (identity) c.push({ k: 'identity', label: `${t('usageDetail.chipIdentity')}: ${identity}` });
    if (date) c.push({ k: 'date', label: `${t('usageDetail.chipDate')}: ${date}` });
    return c;
  }, [model, key, session, app, protocol, identity, date, t]);

  // Scenario quick-filters (one active at a time; '' = all). Counts are live
  // against the loaded window so the user sees how many rows each scenario has.
  const scenarios = useMemo(() => ([
    { k: '', label: t('usageDetail.scenAll'), n: allRows.length },
    { k: 'success', label: t('usageDetail.scenSuccess'), n: allRows.filter((r) => r.request_status === 'success').length },
    { k: 'failed', label: t('usageDetail.scenFailed'), n: allRows.filter((r) => r.request_status !== 'success').length },
    { k: 'unpriced', label: t('usageDetail.chipUnpriced'), n: allRows.filter((r) => r.billable_amount == null).length },
  ]), [allRows, t]);
  const setScenario = (k: string) => {
    const n = new URLSearchParams(sp);
    if (k) n.set('filter', k); else n.delete('filter');
    setSp(n, { replace: true });
  };

  const removeChip = (k: string) => { const n = new URLSearchParams(sp); n.delete(k); setSp(n, { replace: true }); };
  const reset = () => setSp(new URLSearchParams(), { replace: true });
  const subtitle = date ? date : t('usageDetail.last7Days');

  return (
    <div className="ud-page p-6">
      {/* Header: icon tile + title + meta row */}
      <header className="ud-head">
        <div className="ud-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="ud-title">{t('usageDetail.title')}</h1>
          <div className="ud-meta">
            <span>{subtitle}</span>
            <i>·</i><span>{t('usageDetail.subtitle')}</span>
            {q.data && (<><i>·</i><span>{rows.length}</span></>)}
          </div>
        </div>
      </header>

      {/* Scenario quick-filter tabs + drill-down context chips */}
      <div className="ud-filters">
        <div className="ud-tabs">
          {scenarios.map((s) => (
            <button key={s.k || 'all'} className={`ud-tab${filter === s.k ? ' on' : ''}`} onClick={() => setScenario(s.k)}>
              {s.label}<span className="ud-tab-n">{s.n}</span>
            </button>
          ))}
        </div>
        {chips.map((c) => (
          <span key={c.k} className="ud-chip" title={c.label}>
            {c.label}
            <button onClick={() => removeChip(c.k)} aria-label={t('usageDetail.removeFilter')}>×</button>
          </span>
        ))}
        {chips.length > 0 && <button className="ud-reset" onClick={reset}>{t('usageDetail.reset')}</button>}
      </div>

      {/* Table */}
      <div className="ud-card">
        <table className="ud-table">
          {/* 时间 | 模型 | 状态 | 用量 | 费用 | 会话(flex). Fixed widths for the first
              five so the model column can't hog all the slack (was a single auto
              col → ~440px gap between 模型 and 状态); the leftover goes to the last
              column as natural trailing space. Status widened to 210 so the
              normalized term ("Quota Exceeded") shows in full. */}
          {/* Ratios (scaled to fill 100%) — balanced so no column hogs the slack.
              时间 | 模型 | 状态 | 用量 | 费用 | 会话 */}
          <colgroup>
            <col style={{ width: 150 }} /><col style={{ width: 200 }} /><col style={{ width: 200 }} />
            <col style={{ width: 96 }} /><col style={{ width: 96 }} /><col style={{ width: 200 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={`ud-sortable${sort.key === 'time' ? ' on' : ''}`} onClick={() => toggleSort('time')}>{t('usageDetail.colTime')}{sortIcon('time')}</th>
              <th className={`ud-sortable${sort.key === 'model' ? ' on' : ''}`} onClick={() => toggleSort('model')}>{t('usageDetail.colModel')}{sortIcon('model')}</th>
              <th className={`ud-sortable${sort.key === 'status' ? ' on' : ''}`} onClick={() => toggleSort('status')}>{t('usageDetail.colStatus')}{sortIcon('status')}</th>
              <th className={`num ud-sortable${sort.key === 'usage' ? ' on' : ''}`} onClick={() => toggleSort('usage')}>{t('usageDetail.colUsage')}{sortIcon('usage')}</th>
              <th className={`num ud-sortable${sort.key === 'cost' ? ' on' : ''}`} onClick={() => toggleSort('cost')}>{t('usageDetail.colCost')}{sortIcon('cost')}</th>
              <th className={`ud-sortable${sort.key === 'session' ? ' on' : ''}`} onClick={() => toggleSort('session')}>{t('usageDetail.colSession')}{sortIcon('session')}</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={6} className="ud-empty">{t('usageDetail.loading')}</td></tr>}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={6} className="ud-empty">{t('usageDetail.empty')}</td></tr>}
            {pageRows.map((r, localI) => {
              const i = pageSafe * PAGE_SIZE + localI;
              const ok = r.request_status === 'success';
              const reason = HTTP_REASON[r.http_status_code] || '';
              // Generic LLM term for the short status label; the raw provider code
              // (r.error_code) is preserved and appended in the expanded panel.
              const errTerm = normalizeErrorTerm(r.error_code, r.http_status_code, reason);
              const rawErr = r.error_code && r.error_code !== reason && r.error_code !== errTerm ? r.error_code : '';
              const isOpen = expanded === i;
              const total = r.total_tokens || 1;
              const pct = (n: number) => `${Math.max((n / total) * 100, 0)}%`;
              return (
                <Fragment key={i}>
                  <tr className={`ud-row${isOpen ? ' open' : ''}`} onClick={() => setExpanded(isOpen ? null : i)}>
                    <td className="ud-dim">{fmtTime(r.event_time_ms)}</td>
                    <td className="ud-model" title={r.model}>{r.model || '—'}</td>
                    <td>
                      {ok ? (
                        <span className="ud-status ok"><i /> {t('usageDetail.success')}</span>
                      ) : (
                        <span className="ud-status err">
                          <b>{r.http_status_code || 'ERR'}</b><span>{errTerm}</span>
                        </span>
                      )}
                    </td>
                    <td className="num">{r.total_tokens > 0 ? <span>{fmtTok(r.total_tokens)}</span> : <span className="ud-zero">—</span>}</td>
                    <td className={`num ${r.billable_amount == null ? 'ud-zero' : 'ud-cost'}`}>{fmtUSD(r.billable_amount)}</td>
                    <td className="ud-session">
                      <span className="ud-caret">{isOpen ? '▾' : '▸'}</span>
                      {r.session_id ? r.session_id.slice(0, 8) + '…' : '—'}
                      {r.virtual_key_alias && <em>{r.virtual_key_alias}</em>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="ud-expand">
                      <td colSpan={6}>
                        <div className="ud-detail">
                          {/* token breakdown bar + legend */}
                          {r.total_tokens > 0 && (
                            <div className="ud-tokbar-wrap">
                              <div className="ud-tokbar">
                                <span style={{ width: pct(r.input_tokens), background: '#ca8a04' }} />
                                <span style={{ width: pct(r.cache_creation_input_tokens), background: 'rgba(202,138,4,0.65)' }} />
                                <span style={{ width: pct(r.cached_input_tokens), background: 'rgba(202,138,4,0.4)' }} />
                                <span style={{ width: pct(r.output_tokens), background: 'rgba(202,138,4,0.22)' }} />
                              </div>
                              <div className="ud-legend">
                                <span><i style={{ background: '#ca8a04' }} />{t('usageDetail.tokUncached')} {fmtTok(r.input_tokens)}</span>
                                <span><i style={{ background: 'rgba(202,138,4,0.65)' }} />{t('usageDetail.tokCreation')} {fmtTok(r.cache_creation_input_tokens)}</span>
                                <span><i style={{ background: 'rgba(202,138,4,0.4)' }} />{t('usageDetail.tokCached')} {fmtTok(r.cached_input_tokens)}</span>
                                <span><i style={{ background: 'rgba(202,138,4,0.22)' }} />{t('usageDetail.tokOutput')} {fmtTok(r.output_tokens)}</span>
                              </div>
                            </div>
                          )}
                          <dl className="ud-kv">
                            {!ok && (
                              <>
                                <dt>{t('usageDetail.exStatus')}</dt>
                                <dd><b style={{ color: 'var(--destructive)' }}>{r.http_status_code || '—'}</b> {errTerm}{rawErr ? ` · ${rawErr}` : ''}</dd>
                                <dt>{t('usageDetail.exReason')}</dt>
                                <dd>{cleanErrorReason(r.error_message) || t('usageDetail.exNoReason')}</dd>
                              </>
                            )}
                            <dt>{t('usageDetail.exEndpoint')}</dt>
                            <dd>{r.endpoint_url || '—'}</dd>
                            <dt>{t('usageDetail.exModel')}</dt>
                            <dd>{r.model || '—'}{r.provider_code ? ` · ${r.provider_code}` : ''}</dd>
                            {r.latency_ms > 0 && (<><dt>{t('usageDetail.exLatency')}</dt><dd>{r.latency_ms.toLocaleString('en-US')} ms</dd></>)}
                            {r.session_id && (<><dt>{t('usageDetail.chipSession')}</dt><dd>{r.session_id}</dd></>)}
                          </dl>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="ud-pager">
          <span>{t('usageDetail.pageRange', { from: pageSafe * PAGE_SIZE + 1, to: Math.min((pageSafe + 1) * PAGE_SIZE, rows.length), total: rows.length })}</span>
          <div className="ud-pager-ctl">
            <button disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)}>{t('usageDetail.prev')}</button>
            <span>{pageSafe + 1} / {totalPages}</span>
            <button disabled={pageSafe >= totalPages - 1} onClick={() => setPage(pageSafe + 1)}>{t('usageDetail.next')}</button>
          </div>
        </div>
      )}

      <style>{`
        .ud-page { color: var(--foreground); }
        .ud-head { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
        .ud-icon {
          width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(202,138,4,0.10); border: 1px solid rgba(202,138,4,0.28); color: var(--primary);
        }
        .ud-icon svg { width: 18px; height: 18px; }
        .ud-title { font-family: var(--font-mono); font-size: 18px; font-weight: 700; letter-spacing: 0.02em; color: var(--display-foreground); line-height: 1.25; }
        .ud-meta { display: flex; align-items: center; gap: 7px; font-family: var(--font-mono); font-size: 11.5px; color: var(--muted-foreground); margin-top: 2px; }
        .ud-meta i { opacity: 0.4; font-style: normal; }

        .ud-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 26px; margin-bottom: 14px; font-family: var(--font-mono); font-size: 11.5px; }
        .ud-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); }
        .ud-tab { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 6px; background: none; border: none; cursor: pointer; color: var(--muted-foreground); font: inherit; transition: background 110ms ease, color 110ms ease; }
        .ud-tab:hover { color: var(--foreground); }
        .ud-tab.on { background: rgba(202,138,4,0.16); color: var(--primary); }
        .ud-tab-n { font-size: 10px; opacity: 0.65; }
        .ud-tab.on .ud-tab-n { opacity: 1; }
        .ud-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px; border-radius: 999px; background: rgba(202,138,4,0.14); border: 1px solid rgba(202,138,4,0.36); color: var(--foreground); }
        .ud-chip button { background: rgba(0,0,0,0.18); border: none; color: var(--muted-foreground); cursor: pointer; width: 16px; height: 16px; border-radius: 999px; line-height: 1; font-size: 13px; }
        .ud-chip button:hover { color: #facc15; background: rgba(0,0,0,0.3); }
        .ud-reset { background: none; border: none; color: var(--muted-foreground); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; padding: 0; font: inherit; }
        .ud-reset:hover { color: #facc15; }

        .ud-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        /* table-layout: fixed (stable — the expanded panel can't resize the table on
           open) + width:100% (fills the card). The colgroup px widths act as RATIOS
           that scale to fill, so the slack spreads EVENLY instead of one auto column
           hogging it (the old ~440px gap between 模型 and 状态). 时间 a bit wider. */
        .ud-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .ud-table thead th {
          font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase;
          color: var(--muted-foreground); text-align: left; padding: 11px 16px; white-space: nowrap;
          background: rgba(0,0,0,0.22); border-bottom: 1px solid var(--border);
        }
        .ud-table th.num, .ud-table td.num { text-align: right; }
        .ud-table th.ud-sortable { cursor: pointer; user-select: none; transition: color 110ms ease; }
        .ud-table th.ud-sortable:hover { color: var(--foreground); }
        .ud-table th.ud-sortable.on { color: var(--primary); }
        .ud-table tbody td {
          font-family: var(--font-mono); font-size: 12.5px; padding: 9px 16px; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
          border-bottom: 1px solid rgba(255,255,255,0.035); color: var(--foreground);
        }
        .ud-table tbody tr.ud-row { cursor: pointer; transition: background 110ms ease, box-shadow 110ms ease; }
        .ud-table tbody tr.ud-row:hover { background: rgba(250,204,21,0.045); box-shadow: inset 2px 0 0 0 rgba(202,138,4,0.7); }
        .ud-table tbody tr.ud-row.open { background: rgba(250,204,21,0.06); box-shadow: inset 2px 0 0 0 var(--primary); }
        .ud-dim { color: var(--muted-foreground); }
        .ud-zero { color: var(--muted-foreground); opacity: 0.45; }
        .ud-cost { color: #2dd4bf; }
        .ud-model { color: var(--foreground); }

        .ud-status { display: inline-flex; align-items: center; gap: 6px; }
        .ud-status.ok { color: var(--muted-foreground); }
        .ud-status.ok i { width: 6px; height: 6px; border-radius: 999px; background: #4ade80; flex-shrink: 0; }
        .ud-status.err b { color: var(--destructive); font-weight: 600; }
        .ud-status.err span { color: var(--muted-foreground); opacity: 0.75; margin-left: 6px; }

        .ud-session { color: var(--muted-foreground); position: relative; }
        .ud-session .ud-caret { display: inline-block; width: 12px; color: var(--muted-foreground); opacity: 0.5; font-size: 9px; }
        .ud-table tbody tr.ud-row:hover .ud-caret { opacity: 1; color: var(--primary); }
        .ud-session em { display: block; font-style: normal; font-size: 10px; opacity: 0.55; padding-left: 12px; }

        /* The expanded panel must NOT inherit the dense row-cell's nowrap/clip
           (.ud-table tbody td). The selector is intentionally as specific as that
           rule + 1 (…tbody tr.ud-expand > td = 0,2,3 beats .ud-table tbody td =
           0,1,2) so white-space:normal actually wins — otherwise long error
           reasons / endpoint URLs overflow horizontally (verified via DevTools). */
        .ud-table tbody tr.ud-expand > td { padding: 0 16px 14px 16px; background: rgba(0,0,0,0.16); white-space: normal; overflow: visible; }
        .ud-detail { border: 1px solid var(--border); border-radius: 8px; padding: 13px 15px; background: var(--card); margin-top: 2px; }
        .ud-tokbar-wrap { margin-bottom: 12px; }
        .ud-tokbar { display: flex; height: 6px; border-radius: 4px; overflow: hidden; background: rgba(255,255,255,0.05); }
        .ud-tokbar > span { display: block; height: 100%; }
        .ud-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; font-family: var(--font-mono); font-size: 10.5px; color: var(--muted-foreground); }
        .ud-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .ud-legend i { width: 8px; height: 8px; border-radius: 2px; }
        .ud-kv { display: grid; grid-template-columns: max-content 1fr; gap: 5px 16px; font-family: var(--font-mono); font-size: 11.5px; align-items: baseline; margin: 0; }
        .ud-kv dt { color: var(--muted-foreground); opacity: 0.7; white-space: nowrap; }
        .ud-kv dd { color: var(--foreground); margin: 0; word-break: break-all; min-width: 0; }

        .ud-empty { text-align: center; padding: 36px; color: var(--muted-foreground); font-family: var(--font-mono); font-size: 12px; }

        .ud-pager { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; font-family: var(--font-mono); font-size: 11.5px; color: var(--muted-foreground); }
        .ud-pager-ctl { display: flex; align-items: center; gap: 14px; }
        .ud-pager-ctl button { background: var(--card); border: 1px solid var(--border); color: var(--foreground); border-radius: 6px; padding: 4px 14px; cursor: pointer; font: inherit; transition: background 110ms ease, border-color 110ms ease; }
        .ud-pager-ctl button:hover:not(:disabled) { border-color: var(--muted-foreground); background: rgba(250,204,21,0.06); }
        .ud-pager-ctl button:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
