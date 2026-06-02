/**
 * Compliance Audit (self view) — /user/compliance
 *
 * Phase 3 (2026-06-02). The LOCAL counterpart to the master/team audit page:
 * shows the compliance events detected on THIS machine for the local user.
 * No tenant (single-user) — loads immediately. Filters: severity / category /
 * action. Row click → detail drawer with per-finding metadata + already-
 * redacted snippet (never the raw prompt — DC5). Offset pagination.
 *
 * Structure mirrors aikey-control-master/web .../master/compliance/audit so the
 * two views stay visually consistent; the only differences are: no tenant
 * prompt/column, and the FilterBar search box is repurposed for the category
 * filter (there's no tenant to search).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complianceApi, type ComplianceEventDTO } from '@/shared/api/user/compliance';
import { Badge } from '@/shared/ui/Badge';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DetailDrawer, DrawerField } from '@/shared/ui/DetailDrawer';
import { FilterBar } from '@/shared/ui/FilterBar';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';

const PAGE_SIZE = 50;

function severityVariant(s: string): 'red' | 'yellow' | 'green' | 'gray' {
  switch (s) {
    case 'critical': return 'red';
    case 'high': return 'yellow';
    case 'medium': return 'gray';
    default: return 'gray';
  }
}

function actionVariant(a: string): 'red' | 'yellow' | 'green' | 'gray' {
  switch (a) {
    case 'block': return 'red';
    case 'mask': return 'yellow';
    case 'warn': return 'gray';
    default: return 'green'; // allow
  }
}

const SEV_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
function topSeverity(e: ComplianceEventDTO): string {
  let top = '';
  for (const f of e.findings) {
    if (top === '' || (SEV_RANK[f.severity] ?? -1) > (SEV_RANK[top] ?? -1)) top = f.severity;
  }
  return top;
}

export default function ComplianceSelfViewPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<ComplianceEventDTO | null>(null);
  const [offset, setOffset] = useState(0);

  const severity = searchParams.get('severity') ?? '';
  const category = searchParams.get('category') ?? '';
  const action = searchParams.get('action') ?? '';

  function updateFilter(key: string, value: string) {
    setOffset(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['compliance-self', { severity, category, action, offset }],
    queryFn: () => complianceApi.listEvents({
      severity: severity || undefined,
      category: category || undefined,
      action: action || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  const severityOptions = [
    { value: 'critical', label: t('compliancePage.sevCritical') },
    { value: 'high', label: t('compliancePage.sevHigh') },
    { value: 'medium', label: t('compliancePage.sevMedium') },
    { value: 'low', label: t('compliancePage.sevLow') },
  ];
  const actionOptions = [
    { value: '', label: t('compliancePage.allActions') },
    { value: 'block', label: t('compliancePage.actionBlock') },
    { value: 'mask', label: t('compliancePage.actionMask') },
    { value: 'warn', label: t('compliancePage.actionWarn') },
    { value: 'allow', label: t('compliancePage.actionAllow') },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title={t('compliancePage.pageTitle')}
        description={t('compliancePage.pageDescription')}
      />

      <FilterBar
        searchValue={category}
        onSearchChange={(v) => updateFilter('category', v)}
        searchPlaceholder={t('compliancePage.categoryPlaceholder')}
        statusOptions={severityOptions}
        statusValue={severity}
        onStatusChange={(v) => updateFilter('severity', v)}
        statusPlaceholder={t('compliancePage.allSeverities')}
        actions={
          <SearchableSelect
            options={actionOptions}
            value={action}
            onChange={(v) => updateFilter('action', v)}
            placeholder={t('compliancePage.allActions')}
            style={{ minWidth: 140 }}
          />
        }
      />

      <div className="rounded border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
          <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.sectionTitle')}</h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border" style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}>
            {t('compliancePage.recordCount', { count: total })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr>
                {[
                  'compliancePage.columnTime',
                  'compliancePage.columnAction',
                  'compliancePage.columnFindings',
                  'compliancePage.columnModel',
                ].map((k) => (
                  <th key={k} className="px-5 py-3 text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.loading')}</td></tr>
              ) : isError ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-xs font-mono" style={{ color: '#f87171' }}>{t('compliancePage.loadFailed')}</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.noEvents')}</td></tr>
              ) : (
                events.map((e) => (
                  <tr key={e.event_id} className="cursor-pointer hover:bg-white/5" style={{ borderBottom: '1px solid var(--border)' }} onClick={() => setSelected(e)}>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{new Date(e.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3"><Badge variant={actionVariant(e.action_taken)}>{e.action_taken.toUpperCase()}</Badge></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {topSeverity(e) && <Badge variant={severityVariant(topSeverity(e))}>{topSeverity(e).toUpperCase()}</Badge>}
                        <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                          {e.findings.length} · {[...new Set(e.findings.map((f) => f.category))].join(', ') || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{e.target_model || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
            {t('compliancePage.pageRange', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}
          </span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 rounded border text-xs font-mono disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >{t('compliancePage.prev')}</button>
            <button
              className="px-3 py-1 rounded border text-xs font-mono disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >{t('compliancePage.next')}</button>
          </div>
        </div>
      </div>

      <DetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={t('compliancePage.drawerTitle')}
        subtitle={selected?.event_id?.slice(0, 12)}
      >
        {selected && (
          <div>
            <DrawerField label={t('compliancePage.fieldEventId')} value={<span className="break-all text-[11px]">{selected.event_id}</span>} />
            <DrawerField label={t('compliancePage.columnTime')} value={new Date(selected.created_at).toLocaleString()} />
            <DrawerField label={t('compliancePage.columnAction')} value={<Badge variant={actionVariant(selected.action_taken)}>{selected.action_taken.toUpperCase()}</Badge>} />
            <DrawerField label={t('compliancePage.columnModel')} value={selected.target_model || '—'} />
            <DrawerField label={t('compliancePage.fieldPromptLength')} value={selected.prompt_length} />
            <DrawerField label={t('compliancePage.columnFindings')} value={
              <div className="space-y-2">
                {selected.findings.map((f) => (
                  <div key={f.finding_id} className="rounded border p-2" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={severityVariant(f.severity)}>{f.severity.toUpperCase()}</Badge>
                      <span className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>{f.entity_type}</span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>{f.category} · {f.confidence}</span>
                    </div>
                    {f.detector && <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.fieldDetector')}: {f.detector}</p>}
                    {/* Local self-view shows the un-redacted matched text + context
                        (context_snippet); falls back to the redacted placeholder if
                        the detector didn't supply it. Local-only — never原文 on the
                        team view. */}
                    {(f.context_snippet || f.redacted_snippet) && (
                      <p className="text-[11px] font-mono mt-1 break-all whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>
                        {f.context_snippet || f.redacted_snippet}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            } />
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
