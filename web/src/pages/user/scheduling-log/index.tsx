/**
 * Member Scheduling Log — /user/team-oauth/scheduling-log (update/20260817 P8).
 *
 * The member's OWN slice of the pool scheduling timeline (用户拍板 2026-08-18
 * "Personal 也显示调度日志，只显示自己的"): scheduling EVENTS come from
 * GET /accounts/me/scheduling-logs (seat-scoped SERVER-SIDE), engine DECISIONS
 * from the existing switch-log read (affected-seats visibility, single-sourced)
 * — merged client-side into one newest-first timeline. The admin page
 * (master console) remains the pool-wide superset.
 *
 * Third-level page like switch-log: entered from the team-oauth page's toolbar
 * button, not a menu item. Personal (:8090) reaches the data over the same
 * team-fetch two-hop as every other team-scoped read; a not-logged-in /
 * unreachable team renders the existing precise error states.
 */
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  fetchMySchedulingLogs,
  type MySchedulingLogRow,
} from '@/shared/api/team/scheduling-logs';
import type { SwitchLogScope } from '@/shared/api/team/account-decisions';
import { isTeamFetchError } from '@/shared/api/team/team-fetch';
import { Badge, type BadgeVariant } from '@/shared/ui/Badge';
import { Pagination, useStoredPageSize } from '@/shared/ui/Pagination';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';
import { PageTitleRow } from '@/shared/ui/PageHeader';

// decision_type → badge variant. Carried over from the switch-log page this one
// absorbed (2026-08-18): same palette, same mapping — the merge must not silently
// restyle rows the member already recognises.
const DECISION_VARIANT: Record<string, BadgeVariant> = {
  reassign: 'yellow',
  promote_standby: 'green',
  drain: 'gray',
  retire: 'red',
  quarantine: 'red',
  util_cap_adjust: 'gray',
  suggest_add: 'yellow',
  group_exhausted: 'red',
  pool_braked: 'red',
};

const DECISION_TYPES = Object.keys(DECISION_VARIANT);

function decisionVariant(type: string): BadgeVariant {
  return DECISION_VARIANT[type] ?? 'neutral';
}

// Static t() call sites: the i18n fence budgets template-literal translation
// keys, so the decision-type labels resolve through this switch instead.
// (Keep the budgeted pattern out of comments too — the fence greps source text
// and cannot tell a comment from a call.)
function decisionLabel(t: (k: string) => string, type: string): string {
  switch (type) {
    case 'reassign': return t('switchLog.dt_reassign');
    case 'promote_standby': return t('switchLog.dt_promote_standby');
    case 'drain': return t('switchLog.dt_drain');
    case 'retire': return t('switchLog.dt_retire');
    case 'quarantine': return t('switchLog.dt_quarantine');
    case 'util_cap_adjust': return t('switchLog.dt_util_cap_adjust');
    case 'suggest_add': return t('switchLog.dt_suggest_add');
    case 'group_exhausted': return t('switchLog.dt_group_exhausted');
    case 'pool_braked': return t('switchLog.dt_pool_braked');
    default: return type;
  }
}

// One merged timeline entry (events + decisions normalized).
interface TimelineRow {
  id: string;
  tsMs: number;
  kind: 'event' | 'decision';
  name: string;
  origin: 'provider' | 'aikey' | '';
  severityVariant: BadgeVariant;
  accountLabel: string;
  detail: string;
}

function shortName(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1) : name;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

// Locked en-US style timestamp (code-and-ui-language convention), same as
// the switch-log page.
function fmtTime(tsMs: number): string {
  const d = new Date(tsMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function eventVariant(r: MySchedulingLogRow): BadgeVariant {
  if (r.severity === 'error') return 'red';
  if (r.severity === 'warn') return 'yellow';
  return 'gray';
}

function fetchErrKey(kind: string): string {
  switch (kind) {
    case 'not-logged-in': return 'mySchedLog.errNotLoggedIn';
    case 'unauth': return 'mySchedLog.errUnauth';
    case 'parse-error': return 'mySchedLog.errParse';
    default: return 'mySchedLog.errUnreachable';
  }
}

// Range presets reuse the switch-log's existing labels verbatim (no new i18n
// keys, no invented wording): the merged page must read the same as the page it
// absorbed. Labels resolve through a static switch — the i18n fence budgets
// template-literal call sites, and a variable key would spend one for nothing.
const RANGE_OPTIONS = ['1', '7', '30'] as const;

function scopeLabel(t: (k: string) => string, scope: string): string {
  switch (scope) {
    case 'personal': return t('switchLog.scopePersonal');
    case 'pools': return t('switchLog.scopePools');
    default: return t('switchLog.scopeAll');
  }
}

function rangeLabel(t: (k: string) => string, days: string): string {
  switch (days) {
    case '1': return t('switchLog.range24h');
    case '30': return t('switchLog.range30d');
    default: return t('switchLog.range7d');
  }
}

export default function UserSchedulingLogPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kindFilter, setKindFilter] = useState<'' | 'event' | 'decision'>('');
  const [scope, setScope] = useState<SwitchLogScope>('');
  const [decisionFilter, setDecisionFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [rangeDays, setRangeDays] = useState('7');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useStoredPageSize(20);
  const [page, setPage] = useState(1);

  // Changing any filter invalidates the current page number: page 3 of the old
  // result set is meaningless in the new one (and would render empty).
  const resetPaging = () => setPage(1);

  const sinceMs = useMemo(
    () => Date.now() - Number(rangeDays) * 24 * 3600 * 1000,
    [rangeDays],
  );

  // ONE server-side query. The merge, the filters and the page cut all happen on
  // the server: a client-side merge cannot paginate correctly, because asking
  // each source for its own offset returns "each source's Nth slice" instead of
  // "the Nth slice of the merge" (skips and repeats rows at every boundary).
  const logQuery = useQuery({
    queryKey: ['my-sched-log', kindFilter, scope, decisionFilter, groupFilter, rangeDays, page, pageSize],
    queryFn: () => fetchMySchedulingLogs({
      kind: kindFilter,
      scope,
      decision: decisionFilter,
      group: groupFilter,
      since_ms: sinceMs,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    placeholderData: (prev) => prev, // keep the table steady while a page loads
  });

  const fetchError = useMemo(
    () => (logQuery.data && isTeamFetchError(logQuery.data) ? logQuery.data : null),
    [logQuery.data],
  );

  const pageData = logQuery.data && !isTeamFetchError(logQuery.data) ? logQuery.data : null;

  const rows: TimelineRow[] = useMemo(() => {
    if (!pageData) return [];
    return pageData.rows.map((r) => ({
      id: r.id,
      tsMs: r.ts_ms,
      kind: r.kind === 'decision' ? 'decision' : 'event',
      name: r.kind === 'decision' ? r.name : shortName(r.name),
      origin: (r.origin ?? '') as TimelineRow['origin'],
      severityVariant: r.kind === 'decision' ? decisionVariant(r.name) : eventVariant(r),
      accountLabel: r.account_id ? shortId(r.account_id) : '—',
      detail: r.detail ? JSON.stringify(r.detail) : '',
    }));
  }, [pageData]);

  // Group options come from the page in view (the member has no separate pool
  // list endpoint); "" always stays available so a filter can be cleared.
  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of pageData?.rows ?? []) {
      if (r.oauth_group_id) seen.set(r.oauth_group_id, shortId(r.oauth_group_id));
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [pageData]);

  const loading = logQuery.isLoading;
  // Two distinct failure shapes must BOTH reach the user: a typed team-fetch
  // problem (not logged in / unreachable team server) and a plain query failure
  // (network drop, 5xx). Rendering only the first leaves the second as an empty
  // table that looks like "no activity" — the exact silent-failure this page's
  // fence forbids.
  const isError = logQuery.isError;
  const total = pageData?.total ?? 0;
  const paged = rows;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <PageTitleRow>
          <h1 className="text-lg font-mono font-bold" style={{ color: 'var(--foreground)' }}>
            {t('mySchedLog.pageTitle')}
          </h1>
          <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
            {t('mySchedLog.pageDescription', { days: rangeDays })}
          </p>
        </PageTitleRow>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {([['', 'mySchedLog.kindAll'], ['event', 'mySchedLog.kindEvent'], ['decision', 'mySchedLog.kindDecision']] as const).map(([v, key]) => (
              <button
                key={v || 'all'}
                onClick={() => { setKindFilter(v); resetPaging(); }}
                className="text-xs font-mono px-3 py-2"
                style={{
                  color: kindFilter === v ? 'var(--foreground)' : 'var(--muted-foreground)',
                  backgroundColor: kindFilter === v ? 'rgba(var(--lift-rgb), 0.08)' : 'transparent',
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="row-use-btn flex-shrink-0"
            style={{ height: 34 }}
            onClick={() => navigate('/user/team-oauth')}
          >
            {t('mySchedLog.backButton')}
          </button>
        </div>
      </div>

      {/* Filters absorbed from the switch-log page (2026-08-18 merge). The
          scope / decision-type / pool selectors only constrain the DECISION half
          — events carry none of those fields — so they are disabled while the
          view is pinned to events, instead of silently returning nothing. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2" role="radiogroup" aria-label={t('switchLog.scopeAria')}>
          {(['', 'personal', 'pools'] as const).map((v) => {
            const active = scope === v;
            const disabled = kindFilter === 'event';
            return (
              <button
                key={v || 'all'}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                className="text-xs font-mono px-3 py-1.5 rounded border"
                style={{
                  borderColor: active ? 'var(--primary)' : 'var(--border)',
                  color: disabled ? 'var(--muted-foreground)' : (active ? 'var(--foreground)' : 'var(--muted-foreground)'),
                  backgroundColor: active ? 'rgba(var(--lift-rgb), 0.08)' : 'transparent',
                  opacity: disabled ? 0.5 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
                onClick={() => { setScope(v); resetPaging(); }}
              >
                {scopeLabel(t, v)}
              </button>
            );
          })}
        </div>
        <div className="w-52">
          <SearchableSelect
            value={decisionFilter}
            onChange={(v) => { setDecisionFilter(v); resetPaging(); }}
            disabled={kindFilter === 'event'}
            options={[{ value: '', label: t('switchLog.filterDecisionAll') },
              ...DECISION_TYPES.map((dt) => ({ value: dt, label: decisionLabel(t, dt) }))]}
          />
        </div>
        <div className="w-52">
          <SearchableSelect
            value={groupFilter}
            onChange={(v) => { setGroupFilter(v); resetPaging(); }}
            disabled={kindFilter === 'event'}
            options={[{ value: '', label: t('switchLog.filterGroupAll') }, ...groupOptions]}
          />
        </div>
        <div className="flex items-center rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {RANGE_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className="text-xs font-mono px-3 py-2"
              style={{
                color: rangeDays === days ? 'var(--foreground)' : 'var(--muted-foreground)',
                backgroundColor: rangeDays === days ? 'rgba(var(--lift-rgb), 0.08)' : 'transparent',
              }}
              onClick={() => { setRangeDays(days); resetPaging(); }}
            >
              {rangeLabel(t, days)}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr>
                {/* Static keys: a template-literal key is invisible to the
                    i18n coverage fence, which then reports these columns as
                    orphaned catalog entries (and would not catch a real typo). */}
                {[t('mySchedLog.columnTime'), t('mySchedLog.columnKind'), t('mySchedLog.columnName'),
                  t('mySchedLog.columnAccount'), t('mySchedLog.columnDetail')].map((label) => (
                  <th key={label} className="px-5 py-3 text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--table-header)' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('mySchedLog.loading')}</td></tr>
              ) : fetchError ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--destructive-text)' }}>{t(fetchErrKey(fetchError.kind))}</td></tr>
              ) : isError ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--destructive-text)' }}>{t('mySchedLog.errUnreachable')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('mySchedLog.empty')}</td></tr>
              ) : (
                paged.map((row) => {
                  const expanded = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className="cursor-pointer hover:bg-white/5"
                        style={{ borderBottom: expanded ? 'none' : '1px solid var(--border)' }}
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{fmtTime(row.tsMs)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={row.kind === 'decision' ? 'protocol' : 'neutral'}>
                              {t(row.kind === 'decision' ? 'mySchedLog.kindDecision' : 'mySchedLog.kindEvent')}
                            </Badge>
                            {row.origin && (
                              <Badge variant={row.origin === 'provider' ? 'yellow' : 'dim'}>
                                {t(row.origin === 'provider' ? 'mySchedLog.originProvider' : 'mySchedLog.originAikey')}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant={row.severityVariant}>
                            {row.kind === 'decision' ? decisionLabel(t, row.name) : row.name}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--foreground)' }}>{row.accountLabel}</td>
                        <td className="px-5 py-3 text-xs font-mono max-w-xs truncate" style={{ color: 'var(--muted-foreground)' }}>{row.detail || '—'}</td>
                      </tr>
                      {expanded && (
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td colSpan={5} className="px-5 pb-4">
                            <pre className="text-[11px] font-mono rounded border p-3 overflow-x-auto"
                              style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)', backgroundColor: 'rgba(var(--sink-rgb), 0.25)' }}>
                              {row.detail || '—'}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Pagination page={page} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); resetPaging(); }} total={total} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}
