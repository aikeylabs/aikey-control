/**
 * Account Switch Log — /user/team-oauth/switch-log
 *
 * Third-level drill-down from Team OAuth (header button entry, NO sidebar menu
 * item — same pattern as usage-detail). Shows the allocation engine's decision
 * trail (account_decision_log via GET /accounts/me/account-decisions):
 * automatic pool switches (reassign / promote / drain / quarantine / …), NOT
 * the user's own `aikey use` actions.
 *
 * Visibility is SERVER-enforced (需求规格 2026-07-31-account-switch-log-
 * visibility.md): Personal = rows whose decision-time affected_seats snapshot
 * hits my seat; Agent pools = every row of a pool I own. The scope pills here
 * only partition the already-visible set. Structure mirrors /user/compliance
 * (the personal-console event-trail anchor page).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  fetchAccountDecisions,
  type AccountDecisionEvent,
  type SwitchLogScope,
} from '@/shared/api/team/account-decisions';
import { isTeamFetchError } from '@/shared/api/team/team-fetch';
import { Badge, type BadgeVariant } from '@/shared/ui/Badge';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Pagination, useStoredPageSize } from '@/shared/ui/Pagination';
import { DetailDrawer, DrawerField } from '@/shared/ui/DetailDrawer';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';

// decision_type → badge variant, anchored on the existing badge palette
// (green=active / orange=suspended / red=revoked / gray=neutral — no new colors,
// same mapping logic as compliance severityVariant).
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

// Static t() call sites (the i18n fence budgets dynamic t(`...`) keys, so the
// decision-type labels resolve through this switch, not template keys).
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
    default: return type.toUpperCase();
  }
}

// Locked YYYY-MM-DD HH:mm:ss like the compliance page (en-US independent of
// browser locale, per the code-and-ui-language convention).
function fmtTime(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

// Best-effort {from,to} extraction for the CHANGE column; raw detail stays
// available in the drawer.
function parseChange(detail: string): { from?: string; to?: string } {
  try {
    const m = JSON.parse(detail) as { from?: string; to?: string };
    return { from: m.from, to: m.to };
  } catch {
    return {};
  }
}

function fetchErrMessage(t: (k: string) => string, kind: string): string {
  switch (kind) {
    case 'not-logged-in': return t('switchLog.errNotLoggedIn');
    case 'unauth': return t('switchLog.errUnauth');
    case 'parse-error': return t('switchLog.errParse');
    default: return t('switchLog.errUnreachable');
  }
}

export default function UserSwitchLogPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [scope, setScope] = useState<SwitchLogScope>('');
  const [decisionFilter, setDecisionFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [rangeDays, setRangeDays] = useState('7');
  const [pageSize, setPageSize] = useStoredPageSize(20);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AccountDecisionEvent | null>(null);

  const query = useQuery({
    queryKey: ['account-decisions', scope, decisionFilter, groupFilter, rangeDays, offset, pageSize],
    queryFn: async () => {
      const res = await fetchAccountDecisions({
        scope,
        decision: decisionFilter,
        group: groupFilter,
        from: Math.floor(Date.now() / 1000) - Number(rangeDays) * 24 * 3600,
        limit: pageSize,
        offset,
      });
      // Surface the team-fetch union as a real query error so the table's
      // isError row (and react-query retries) engage — never a silent empty.
      if (isTeamFetchError(res)) throw new Error(fetchErrMessage(t, res.kind));
      return res;
    },
  });
  const { data, isLoading, isError, error } = query;
  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  // Group filter options derived from the loaded window (the visible universe);
  // a dedicated groups query would only ever list a subset (my pools) and miss
  // the company pools my personal rows live in.
  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.oauth_group_id && !seen.has(e.oauth_group_id)) {
        seen.set(e.oauth_group_id, e.group_alias || shortId(e.oauth_group_id));
      }
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [events]);

  const resetPaging = () => setOffset(0);

  const scopePills: Array<{ value: SwitchLogScope; label: string }> = [
    { value: '', label: t('switchLog.scopeAll') },
    { value: 'personal', label: t('switchLog.scopePersonal') },
    { value: 'pools', label: t('switchLog.scopePools') },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title={t('switchLog.pageTitle')}
        description={t('switchLog.pageDescription')}
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs font-mono transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
            onClick={() => navigate('/user/team-oauth')}
          >
            ← {t('switchLog.backButton')}
          </button>
        }
      />

      {/* Scope pills + the visibility-rule caption (需求规格 rule 1/2 shown
          verbatim so members know exactly what each partition contains). */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2" role="radiogroup" aria-label={t('switchLog.scopeAria')}>
          {scopePills.map((p) => {
            const active = scope === p.value;
            return (
              <button
                key={p.value || 'all'}
                type="button"
                role="radio"
                aria-checked={active}
                className="px-3 py-1.5 rounded-full border text-[11px] font-mono transition-colors"
                style={{
                  borderColor: active ? 'rgba(250,204,21,0.45)' : 'var(--border)',
                  color: active ? 'var(--primary)' : 'var(--muted-foreground)',
                  backgroundColor: active ? 'rgba(250,204,21,0.08)' : 'transparent',
                }}
                onClick={() => { setScope(p.value); resetPaging(); }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
          {t('switchLog.scopeCaption')}
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchableSelect
          options={[
            { value: '', label: t('switchLog.filterDecisionAll') },
            ...DECISION_TYPES.map((d) => ({ value: d, label: decisionLabel(t, d) })),
          ]}
          value={decisionFilter}
          onChange={(v) => { setDecisionFilter(v); resetPaging(); }}
          placeholder={t('switchLog.filterDecisionAll')}
          style={{ minWidth: 180 }}
        />
        <SearchableSelect
          options={[
            { value: '', label: t('switchLog.filterGroupAll') },
            ...groupOptions,
          ]}
          value={groupFilter}
          onChange={(v) => { setGroupFilter(v); resetPaging(); }}
          placeholder={t('switchLog.filterGroupAll')}
          style={{ minWidth: 160 }}
        />
        <SearchableSelect
          options={[
            { value: '1', label: t('switchLog.range24h') },
            { value: '7', label: t('switchLog.range7d') },
            { value: '30', label: t('switchLog.range30d') },
          ]}
          value={rangeDays}
          onChange={(v) => { setRangeDays(v); resetPaging(); }}
          placeholder={t('switchLog.range7d')}
          style={{ minWidth: 140 }}
        />
      </div>

      {/* Events table */}
      <div className="rounded-md border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'inset 0 -1px 0 0 var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
            {t('switchLog.sectionTitle')}
          </h2>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full border" style={{ color: 'var(--primary)', borderColor: 'rgba(250,204,21,0.35)', backgroundColor: 'rgba(250,204,21,0.06)' }}>
            {t('switchLog.recordCount', { count: total })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr>
                {[
                  t('switchLog.columnTime'),
                  t('switchLog.columnScope'),
                  t('switchLog.columnDecision'),
                  t('switchLog.columnGroup'),
                  t('switchLog.columnAccount'),
                  t('switchLog.columnChange'),
                  t('switchLog.columnMode'),
                ].map((label) => (
                  <th key={label} className="px-4 py-3 text-[10px] font-mono font-semibold tracking-wider uppercase" style={{ color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.35)' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('switchLog.loading')}</td></tr>
              ) : isError ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-xs font-mono" style={{ color: '#f87171' }}>
                  {error instanceof Error ? error.message : t('switchLog.errUnreachable')}
                </td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('switchLog.noEvents')}</td></tr>
              ) : (
                events.map((e) => {
                  const change = parseChange(e.detail);
                  return (
                    <tr
                      key={e.decision_id}
                      className="cursor-pointer transition-colors hover:bg-[rgba(250,204,21,0.045)]"
                      style={{ borderBottom: '1px solid var(--border)' }}
                      onClick={() => setSelected(e)}
                    >
                      <td className="px-4 py-3.5 text-xs font-mono" style={{ color: 'var(--foreground)' }}>{fmtTime(e.created_at)}</td>
                      <td className="px-4 py-3.5">
                        {e.affects_you ? (
                          <Badge variant="gray">{t('switchLog.scopePersonalBadge')}</Badge>
                        ) : (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--primary-dim)', backgroundColor: 'rgba(202,138,4,0.08)' }}>
                            {t('switchLog.scopePoolBadge')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={DECISION_VARIANT[e.decision_type] ?? 'neutral'}>
                          {decisionLabel(t, e.decision_type)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-xs font-mono" style={{ color: 'var(--soft-foreground)' }}>
                        {e.group_alias || (e.oauth_group_id ? shortId(e.oauth_group_id) : '—')}
                      </td>
                      <td className="px-4 py-3.5 text-xs font-mono" style={{ color: 'var(--soft-foreground)' }}>
                        {e.account_email || (e.account_id ? shortId(e.account_id) : '—')}
                      </td>
                      <td className="px-4 py-3.5">
                        {change.from && change.to ? (
                          <div className="text-[11px] font-mono" style={{ color: 'var(--soft-foreground)' }}>
                            {shortId(change.from)} <span style={{ color: 'var(--muted-foreground)' }}>→</span> {shortId(change.to)}
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}>—</span>
                        )}
                        <div className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                          {e.affected_seats == null
                            ? (e.account_id ? '—' : t('switchLog.allSeats'))
                            : t('switchLog.affectsSeats', { count: e.affected_seats.length })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={e.auto_executed ? 'gray' : 'yellow'}>
                          {e.auto_executed ? t('switchLog.modeAuto') : t('switchLog.modeAdvisory')}
                        </Badge>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Pagination
            page={Math.floor(offset / pageSize) + 1}
            pageSize={pageSize}
            onPageSize={(n) => { setPageSize(n); setOffset(0); }}
            total={total}
            onPage={(p) => setOffset((p - 1) * pageSize)}
          />
        </div>
      </div>

      <DetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={t('switchLog.drawerTitle')}
        subtitle={selected ? shortId(selected.decision_id) : undefined}
      >
        {selected && (
          <div>
            <DrawerField label={t('switchLog.fieldDecisionId')} value={<span className="break-all text-[11px]">{selected.decision_id}</span>} />
            <DrawerField label={t('switchLog.columnTime')} value={fmtTime(selected.created_at)} />
            <DrawerField label={t('switchLog.columnScope')} value={selected.affects_you ? t('switchLog.scopePersonalBadge') : t('switchLog.scopePoolBadge')} />
            <DrawerField label={t('switchLog.columnDecision')} value={
              <Badge variant={DECISION_VARIANT[selected.decision_type] ?? 'neutral'}>
                {decisionLabel(t, selected.decision_type)}
              </Badge>
            } />
            <DrawerField label={t('switchLog.columnGroup')} value={selected.group_alias || selected.oauth_group_id || '—'} />
            <DrawerField label={t('switchLog.columnAccount')} value={selected.account_email || selected.account_id || '—'} />
            <DrawerField label={t('switchLog.fieldTrigger')} value={selected.trigger || '—'} />
            <DrawerField label={t('switchLog.columnMode')} value={selected.auto_executed ? t('switchLog.modeAuto') : t('switchLog.modeAdvisory')} />

            {/* Decision-time seat snapshot; absent on pre-feature rows (— per
                需求规格: never back-fill attribution from current bindings). */}
            <div className="mt-4">
              <div className="text-[10px] font-mono font-semibold tracking-wider uppercase mb-2" style={{ color: 'var(--muted-foreground)' }}>
                {t('switchLog.affectedSeatsTitle')}
              </div>
              {selected.affected_seats == null ? (
                <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}>
                  {t('switchLog.snapshotUnavailable')}
                </div>
              ) : selected.affected_seats.length === 0 ? (
                <div className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                  {t('switchLog.noAffectedSeats')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selected.affected_seats.map((s) => (
                    <div key={s.seat_id} className="flex items-center gap-2 text-[11px] font-mono rounded border px-2.5 py-1.5" style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(255,255,255,0.02)', color: 'var(--soft-foreground)' }}>
                      <span className="break-all">{s.email || s.seat_id}</span>
                      {s.you && <Badge variant="yellow">{t('switchLog.youChip')}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Raw decision basis — the engine's audit snapshot, verbatim. */}
            <div className="mt-4">
              <div className="text-[10px] font-mono font-semibold tracking-wider uppercase mb-2" style={{ color: 'var(--muted-foreground)' }}>
                {t('switchLog.rawDetailTitle')}
              </div>
              <pre className="text-[11px] font-mono rounded border px-3 py-2.5 overflow-x-auto" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--soft-foreground)' }}>
                {(() => {
                  try { return JSON.stringify(JSON.parse(selected.detail), null, 2); } catch { return selected.detail || '—'; }
                })()}
              </pre>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
