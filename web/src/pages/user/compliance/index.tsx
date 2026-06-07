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
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { complianceApi, type ComplianceEventDTO } from '@/shared/api/user/compliance';
import { appsApi } from '@/shared/api/user/apps';
import { Badge } from '@/shared/ui/Badge';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DetailDrawer, DrawerField } from '@/shared/ui/DetailDrawer';
import { FilterBar } from '@/shared/ui/FilterBar';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';

const PAGE_SIZE = 15;

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

// Highlight planner mask tokens in the audit snippet so the redacted spans
// (***PHONE*** / ***18*** / [password-redacted] / [违规话术] / [prompt-injection] …)
// stand out from the surrounding context. Uses --primary (distinct from the
// orange MASK/severity badges); no new colors.
const MASK_SPLIT = /(\*\*\*[^*\s]{1,20}\*\*\*|\[[^\]\n]{1,24}\])/g;
const MASK_TEST = /^(\*\*\*[^*\s]{1,20}\*\*\*|\[[^\]\n]{1,24}\])$/;
function renderMaskedSnippet(text: string) {
  return text.split(MASK_SPLIT).filter((p) => p !== '').map((part, i) =>
    MASK_TEST.test(part) ? (
      // 2026-06-06: dimmed from var(--primary) #facc15 → var(--primary-dim)
      // #ca8a04 (yellow-600) and bg 0.12 → 0.08. The audit table renders
      // ~15 rows × 2 mask markers each = 30+ amber patches on screen
      // simultaneously; at the previous yellow-400 + 12% alpha those
      // tiny tokens summed to a "刺眼" amber speckle that overwhelmed
      // the row text. yellow-600 stays warm and still reads as a
      // masked-token highlight, but no longer competes with the page's
      // real CTAs (生效合规包 button, 4893 条记录 chip) which still use
      // the bright --primary and visually outrank the noisy in-cell
      // highlights now.
      <span key={i} className="font-bold" style={{ color: 'var(--primary-dim)', backgroundColor: 'rgba(202,138,4,0.08)', borderRadius: 2, padding: '0 2px' }}>{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// Locked timestamp (YYYY-MM-DD HH:mm:ss) so the audit time reads the same
// regardless of browser locale — cleaner than locale toLocaleString().
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function ComplianceSelfViewPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<ComplianceEventDTO | null>(null);
  const [offset, setOffset] = useState(0);
  const [packsOpen, setPacksOpen] = useState(false);

  // ── Compliance master switch (feature on/off) ────────────────────────────
  // Reuses the app filter enable/disable: filter_stages NULL = off, set = on;
  // the CLI bumps vault change_seq → the local proxy reloads within ~5s and
  // spawns / kills the detector child. Mirrors the toggle in /user/settings
  // (2nd usage — replicate the pattern, don't abstract prematurely). G3 adds
  // the master-policy `locked` state (org-mandated on → can't disable here).
  const COMPLIANCE_SLUG = 'ai-compliance-detector';
  const [filterState, setFilterState] = useState<
    { kind: 'loading' } | { kind: 'not-installed' } | { kind: 'ready'; enabled: boolean } | { kind: 'error' }
  >({ kind: 'loading' });
  const [filterSaving, setFilterSaving] = useState(false);
  const [filterMsg, setFilterMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await appsApi.list();
        if (!list.apps.some((a) => a.slug === COMPLIANCE_SLUG)) {
          if (!cancelled) setFilterState({ kind: 'not-installed' });
          return;
        }
        const status = await appsApi.filterStatus(COMPLIANCE_SLUG);
        if (!cancelled) setFilterState({ kind: 'ready', enabled: status.enabled });
      } catch {
        if (!cancelled) setFilterState({ kind: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function onToggleFilter(next: boolean) {
    if (filterState.kind !== 'ready' || filterSaving) return;
    setFilterSaving(true);
    setFilterMsg('');
    try {
      const res = await appsApi.filterSet(COMPLIANCE_SLUG, next);
      setFilterState({ kind: 'ready', enabled: res.enabled });
    } catch (err) {
      const e = err as Error & { code?: string };
      setFilterMsg(
        e.code === 'I_VAULT_LOCKED' || e.code === 'I_VAULT_NO_SESSION'
          ? t('compliancePage.toggleLocked')
          : (e.message ?? t('compliancePage.toggleFailed')),
      );
    } finally {
      setFilterSaving(false);
    }
  }

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

  // Effective packs (built-in + server-distributed) — lazily fetched when the
  // drawer opens. Relayed local-server → proxy → live detector IPC.
  const packsQuery = useQuery({
    queryKey: ['compliance-packs'],
    queryFn: () => complianceApi.getEffectivePacks(),
    enabled: packsOpen,
  });
  const packsReport = packsQuery.data?.available ? packsQuery.data.report : undefined;

  // Collapsible summary cards. Counts reuse the existing list endpoint with an
  // `action` override (limit:1, read total) — accurate across ALL matching rows
  // (not just the current page), no new backend. Fetched only when expanded.
  const [cardsOpen, setCardsOpen] = useState(false);
  const countQ = (act: string | undefined, key: string) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['compliance-count', key, { severity, category }],
      queryFn: () => complianceApi.listEvents({
        severity: severity || undefined,
        category: category || undefined,
        action: act,
        limit: 1,
        offset: 0,
      }),
      // Always fetched (cheap limit:1 count) so the collapsed summary bar can
      // show the action breakdown inline without the user expanding the card.
      enabled: true,
    });
  const sumAll = countQ(undefined, 'all');
  const sumMask = countQ('mask', 'mask');
  const sumAllow = countQ('allow', 'allow');
  const sumBlock = countQ('block', 'block');
  const summaryCards = [
    { label: t('compliancePage.summaryTotal'), q: sumAll, color: 'var(--foreground)' },
    { label: t('compliancePage.summaryMasked'), q: sumMask, color: '#fb923c' },
    { label: t('compliancePage.summaryAllowed'), q: sumAllow, color: '#4ade80' },
    { label: t('compliancePage.summaryBlocked'), q: sumBlock, color: '#f87171' },
  ];

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
        actions={
          <div className="flex items-center gap-3">
            {/* Feature master switch — distinct from the pack-level info (layered:
                whole-detection on/off here, which packs are effective in the drawer). */}
            {filterState.kind === 'ready' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                  {t('compliancePage.toggleLabel')}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={filterState.enabled}
                  aria-label={t('compliancePage.toggleLabel')}
                  disabled={filterSaving}
                  onClick={() => onToggleFilter(!filterState.enabled)}
                  style={{
                    position: 'relative', width: 44, height: 24, borderRadius: 12, border: 'none',
                    background: filterState.enabled ? '#4ade80' : 'var(--border)',
                    cursor: filterSaving ? 'wait' : 'pointer', flexShrink: 0, opacity: filterSaving ? 0.7 : 1,
                    transition: 'background 0.15s ease',
                  }}
                >
                  <span style={{ position: 'absolute', top: 2, left: filterState.enabled ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.15s ease' }} />
                </button>
              </div>
            )}
            <button
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs font-mono transition-colors"
              style={{ borderColor: 'rgba(250,204,21,0.35)', color: 'var(--primary)', backgroundColor: 'rgba(250,204,21,0.06)' }}
              onClick={() => setPacksOpen(true)}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              {t('effectivePacks.viewButton')}
            </button>
          </div>
        }
      />

      {/* Toggle status line: surface a save error / vault-lock / not-installed
          hint. Quiet when the switch is ready + idle. */}
      {(filterMsg || filterState.kind === 'not-installed') && (
        <div className="text-xs font-mono" style={{ color: filterState.kind === 'not-installed' ? 'var(--muted-foreground)' : '#f87171' }}>
          {filterState.kind === 'not-installed' ? t('compliancePage.toggleNotInstalled') : filterMsg}
        </div>
      )}

      {/* Collapsible summary — at-a-glance action breakdown (default collapsed). */}
      <div className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)', boxShadow: 'inset 0 -1px 0 0 var(--border)' }}>
        <button
          className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-mono"
          style={{ color: 'var(--muted-foreground)' }}
          onClick={() => setCardsOpen((o) => !o)}
        >
          <span className="flex items-center gap-3 tracking-wider min-w-0">
            <span className="shrink-0">
              {t('compliancePage.summaryTitle')} · {t('compliancePage.recordCount', { count: total })}
            </span>
            {/* collapsed: inline text breakdown of the stat cards (遮蔽 / 放行 / 拦截) */}
            {!cardsOpen && (
              <span className="flex items-center gap-2.5 truncate">
                <span style={{ color: 'var(--border)' }}>|</span>
                {summaryCards.slice(1).map((c) => (
                  <span key={c.label} className="shrink-0">
                    {c.label} <b style={{ color: c.color }}>{c.q.isLoading ? '…' : (c.q.data?.total ?? 0)}</b>
                  </span>
                ))}
              </span>
            )}
          </span>
          <span aria-hidden style={{ color: 'var(--muted-foreground)' }}>{cardsOpen ? '▾' : '▸'}</span>
        </button>
        {cardsOpen && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4">
            {summaryCards.map((c) => (
              <div key={c.label} className="rounded-md border px-3 py-2.5" style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(255,255,255,0.025)', borderLeft: `2px solid ${c.color}` }}>
                <div className="text-[10px] font-mono tracking-wider uppercase" style={{ color: 'var(--muted-foreground)' }}>{c.label}</div>
                <div className="text-xl font-mono font-bold mt-1" style={{ color: c.color }}>
                  {c.q.isLoading ? '…' : (c.q.data?.total ?? 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <FilterBar
        searchValue={category}
        onSearchChange={(v) => updateFilter('category', v)}
        searchPlaceholder={t('compliancePage.categoryPlaceholder')}
        statusOptions={severityOptions}
        statusValue={severity}
        onStatusChange={(v) => updateFilter('severity', v)}
        statusPlaceholder={t('compliancePage.allSeverities')}
        actions={
          <>
            <span aria-hidden style={{ width: 1, height: 22, background: 'var(--border)' }} />
            <SearchableSelect
              options={actionOptions}
              value={action}
              onChange={(v) => updateFilter('action', v)}
              placeholder={t('compliancePage.allActions')}
              style={{ minWidth: 140 }}
            />
          </>
        }
      />

      <div className="rounded-md border overflow-hidden" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'inset 0 -1px 0 0 var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.sectionTitle')}</h2>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full border" style={{ color: 'var(--primary)', borderColor: 'rgba(250,204,21,0.35)', backgroundColor: 'rgba(250,204,21,0.06)' }}>
            {t('compliancePage.recordCount', { count: total })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse table-fixed">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '41%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                {[
                  'compliancePage.columnTime',
                  'compliancePage.columnAction',
                  'compliancePage.columnFindings',
                  'compliancePage.columnPreview',
                  'compliancePage.columnModel',
                ].map((k) => (
                  <th key={k} className="px-4 py-3 text-[10px] font-mono font-semibold tracking-wider uppercase" style={{ color: 'var(--muted-foreground)', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.35)', position: 'sticky', top: 0, zIndex: 1 }}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.loading')}</td></tr>
              ) : isError ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: '#f87171' }}>{t('compliancePage.loadFailed')}</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.noEvents')}</td></tr>
              ) : (
                events.map((e) => (
                  <tr key={e.event_id} className="cursor-pointer transition-colors hover:bg-[rgba(250,204,21,0.045)]" style={{ borderBottom: '1px solid var(--border)' }} onClick={() => setSelected(e)}>
                    <td className="px-4 py-3.5 text-xs font-mono" style={{ color: 'var(--foreground)' }}>{fmtTime(e.created_at)}</td>
                    <td className="px-4 py-3.5"><Badge variant={actionVariant(e.action_taken)}>{e.action_taken.toUpperCase()}</Badge></td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {topSeverity(e) && <Badge variant={severityVariant(topSeverity(e))}>{topSeverity(e).toUpperCase()}</Badge>}
                        {[...new Set(e.findings.map((f) => f.category))].map((c) => (
                          <span key={c} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--muted-foreground)' }}>{c}</span>
                        ))}
                        <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--muted-foreground)', opacity: 0.75 }}>×{e.findings.length}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {(() => {
                        const f0 = e.findings[0];
                        const snip = (f0?.context_snippet || f0?.redacted_snippet || '').replace(/\s+/g, ' ').trim();
                        return snip ? (
                          <div className="text-[11px] font-mono truncate" style={{ color: 'var(--muted-foreground)' }}>
                            {renderMaskedSnippet(snip)}
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}>—</span>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>{e.target_model || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
            {t('compliancePage.pageRange', {
              from: total === 0 ? 0 : offset + 1,
              to: Math.min(offset + PAGE_SIZE, total),
              total,
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border text-xs font-mono disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >{t('compliancePage.prev')}</button>
            <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('compliancePage.pageOf', { page: Math.floor(offset / PAGE_SIZE) + 1, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) })}
            </span>
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
            {selected.detect_latency_ms != null && (
              <DrawerField label={t('compliancePage.fieldDetectLatency')} value={`${selected.detect_latency_ms} ms`} />
            )}
            <DrawerField label={t('compliancePage.columnFindings')} value={
              <div className="space-y-3 pt-1.5 pl-1.5">
                {selected.findings.map((f, idx) => (
                  <div key={f.finding_id} className="rounded-md border p-2.5" style={{ position: 'relative', borderColor: 'var(--border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    {/* sequence badge — overhangs the card's top-left corner (出框) */}
                    <span
                      className="inline-flex items-center justify-center text-[10px] font-mono font-bold rounded-full shrink-0"
                      style={{ position: 'absolute', top: -9, left: -9, width: 20, height: 20, color: 'var(--primary-dim)', border: '1px solid rgba(202,138,4,0.5)', backgroundColor: 'var(--card)', zIndex: 1 }}
                    >{idx + 1}</span>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant={severityVariant(f.severity)}>{f.severity.toUpperCase()}</Badge>
                      <span className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>{f.entity_type}</span>
                      <span className="text-[10px] font-mono ml-auto whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>{f.category} · {f.confidence}</span>
                    </div>
                    {f.detector && <p className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.fieldDetector')}: {f.detector}</p>}
                    {/* Local self-view shows the un-redacted matched text + context
                        (context_snippet); falls back to the redacted placeholder if
                        the detector didn't supply it. Local-only — never原文 on the
                        team view. */}
                    {(f.context_snippet || f.redacted_snippet) && (
                      <div className="text-[11px] font-mono mt-2 break-all whitespace-pre-wrap rounded px-2 py-1.5 leading-relaxed" style={{ color: 'var(--foreground)', backgroundColor: 'rgba(0,0,0,0.28)', border: '1px solid var(--border)' }}>
                        {renderMaskedSnippet(f.context_snippet || f.redacted_snippet || '')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            } />
          </div>
        )}
      </DetailDrawer>

      {/* Effective compliance packs (built-in + server-distributed) */}
      <DetailDrawer
        open={packsOpen}
        onClose={() => setPacksOpen(false)}
        title={t('effectivePacks.drawerTitle')}
      >
        {packsQuery.isLoading ? (
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('compliancePage.loading')}</p>
        ) : !packsReport ? (
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.unavailable')}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-[10px] font-mono tracking-wider mb-2" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.builtInSection')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {packsReport.built_in.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 rounded border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                    <Badge variant="gray" className="shrink-0">{t('effectivePacks.builtInBadge')}</Badge>
                    <span className="text-xs font-mono truncate" style={{ color: 'var(--foreground)' }}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
            {(packsReport.engines ?? []).length > 0 && (
              <div>
                <h3 className="text-[10px] font-mono tracking-wider mb-2" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.enginesSection')}</h3>
                <div className="space-y-1.5">
                  {(packsReport.engines ?? []).map((e) => (
                    <div key={e.name} className="flex items-start gap-2 rounded border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                      <Badge variant={e.loaded ? 'green' : 'gray'} className="shrink-0">{e.loaded ? t('effectivePacks.engineOn') : t('effectivePacks.engineOff')}</Badge>
                      <div className="min-w-0">
                        <div className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>{e.name}</div>
                        <div className="text-[10px] font-mono mt-0.5 break-words" style={{ color: 'var(--muted-foreground)' }}>
                          {e.entities.join(', ')}{e.note ? ` · ${e.note}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-[10px] font-mono tracking-wider mb-2" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.distributedSection')}</h3>
              {packsReport.pulled.length === 0 ? (
                <p className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>{t('effectivePacks.noDistributed')}</p>
              ) : (
                <div className="space-y-1">
                  {packsReport.pulled.map((p) => (
                    <div key={p.pack_id} className="rounded border px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-2">
                        <Badge variant={p.status === 'active' ? 'green' : 'gray'} className="shrink-0">{p.status.toUpperCase()}</Badge>
                        <span className="text-xs font-mono font-bold" style={{ color: 'var(--foreground)' }}>{p.name}</span>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>v{p.version}</span>
                      </div>
                      <p className="text-[10px] font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
                        {p.rule_count} {t('effectivePacks.rules')} · {p.phrase_count} {t('effectivePacks.phrases')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
