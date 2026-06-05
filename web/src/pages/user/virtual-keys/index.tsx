/**
 * Team Keys page — /user/virtual-keys
 *
 * URL path stays `virtual-keys` (matches the internal concept — sentinel
 * tokens that route through the proxy). The user-facing label was
 * renamed "Virtual Keys" → "Team Keys" 2026-04-22 because end users see
 * only keys their team/org assigned them, so "Team Keys" better matches
 * intent. Master console retains "Virtual Keys" (operator technical view).
 *
 * Phase 3B vault-style alignment (2026-05-11): page restructured to use
 * the same visual vocabulary as the User Vault page (`.vault-page` outer
 * class, shared KEYS_PAGE_CSS, IdentityStrip + Card + FilterStrip +
 * GroupHeaderRow + Row + DetailDrawer + ToastStack patterns). Spec:
 * requirements/2026-05-11-aikey-web-local-first-team-merge.md R10.
 *
 * IMPORTANT: this file is consumed by BOTH editions:
 *   - A side: not routed (Phase 3B R7 removed the route); the file
 *     stays here for B's npm-link import.
 *   - B side: master/web imports as
 *     `import UserVirtualKeysPage from 'aikey-control-web/pages/virtual-keys'`.
 *     This is the canonical Team Keys page on the team server.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';

import { deliveryApi, type UserKeyDTO, type KeySummaryDTO } from '@/shared/api/user/delivery';
import { vaultApi, pickHookReadiness } from '@/shared/api/user/vault';
import { useHookReadinessStore } from '@/store';
import { HookReadinessBanner } from '@/shared/components/HookReadinessBanner';
import {
  HookWireRcModal,
  useHookWireRcModal,
} from '@/shared/components/HookWireRcModal';
import { copyText } from '@/shared/utils/clipboard';
import { mapUseError } from '@/shared/utils/mapUseError';
import { formatDate } from '@/shared/utils/datetime-intl';
import { KEYS_PAGE_CSS } from '../_shared/keys-page-css';
import { OWN_MENU, OWN_PERSONAL_MENU, getOtherBaseUrl } from '@/shared/cross-app-menu';

// Phase 3B R23 revised (2026-05-11): on B (team server) the Team Keys
// drawer cross-fetches Personal A's vault.list to surface the
// CLI-local route_url + route_token rows for each team key. On A
// (Personal local-server) — the route never registers (R7) and this
// detection just stays false.
const IS_PERSONAL_SIDE = OWN_MENU === OWN_PERSONAL_MENU;

// ── Derived types ────────────────────────────────────────────────────────

type TypeFilter = 'all' | 'issued' | 'pending' | 'revoked';
type SortKey = 'alias' | 'expires' | 'status';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Lower-case provider family for grouping. Strips _api / _oauth tails. */
function providerFamily(code: string | null | undefined): string {
  return (code ?? 'unknown').toLowerCase().replace(/_oauth$|_api$/, '');
}

function providerBrandColor(provider: string | null | undefined): string {
  const p = (provider ?? '').toLowerCase();
  if (p.includes('anthropic') || p.includes('claude')) return 'var(--chart-anthropic)';
  if (p.includes('openai')) return 'var(--chart-openai)';
  if (p.includes('codex')) return 'var(--chart-codex)';
  if (p.includes('kimi') || p.includes('moonshot')) return 'var(--chart-kimi)';
  if (p.includes('gemini') || p.includes('google')) return 'var(--chart-gemini)';
  return 'var(--chart-neutral)';
}

/** key_status (CLI side) → vault page chip semantics. Pure helper —
 *  the i18n translator is threaded in by callers (this isn't a React
 *  component so it can't call useTranslation itself). */
function statusMeta(keyStatus: string, t: TFunction): {
  chipClass: 'success' | 'warning' | 'danger';
  label: string;
} {
  if (keyStatus === 'active')        return { chipClass: 'success', label: t('teamKeys.statusIssued') };
  if (keyStatus === 'pending_claim') return { chipClass: 'warning', label: t('teamKeys.statusPending') };
  if (keyStatus === 'revoked')       return { chipClass: 'danger',  label: t('teamKeys.statusRevoked') };
  if (keyStatus === 'expired')       return { chipClass: 'danger',  label: t('teamKeys.statusExpired') };
  return { chipClass: 'danger', label: keyStatus ? keyStatus.toUpperCase() : t('teamKeys.statusUnknown') };
}

function shareLabel(s: string | undefined, t: TFunction): string {
  const k = (s ?? '').toLowerCase();
  if (k === 'pending_claim') return t('teamKeys.shareValuePending');
  if (k === 'claimed')       return t('teamKeys.shareValueClaimed');
  if (k === 'revoked')       return t('teamKeys.shareValueRevoked');
  if (k === 'shared' || k === 'team') return t('teamKeys.shareValueShared');
  if (k === 'private' || k === 'owner_only') return t('teamKeys.shareValuePrivate');
  return s || t('teamKeys.shareValueUnknown');
}

/** Format a quota amount: usd as "$0.77" / "$100", tokens as "1.2k" / "340". The
 *  "$" vs plain-number already conveys the metric, so no extra label is needed.
 *  Kept short so the cell stays narrow and never squeezes the actions column. */
function fmtQuota(metric: string, n: number): string {
  if (metric === 'usd') {
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (n >= 1000) {
    return (n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k';
  }
  return n.toLocaleString('en-US');
}

/** Next quota-period reset (when `used` rolls back to 0): the start of the next
 *  calendar month (monthly) or next day (daily), in UTC — matching the server's
 *  period-key boundary. Localised date string, in lock-step with the page's
 *  other dates. */
function nextResetLabel(period: string): string {
  const now = new Date();
  const d = period === 'daily'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "expires Mar 5, 2026" / "expired" / null when no expiry. Date is
 *  formatted via datetime-intl (locale-aware, in lock-step with the
 *  active i18n language); the surrounding phrase comes from the
 *  message catalogue. */
function formatExpiresAt(iso: string | undefined, t: TFunction): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  if (parsed < Date.now()) return t('teamKeys.expired');
  return t('teamKeys.expiresOn', { date: formatDate(new Date(parsed)) });
}

function shortVk(vk: string): string {
  if (vk.length <= 14) return vk;
  return `${vk.slice(0, 8)}…${vk.slice(-4)}`;
}

// ── Main component ──────────────────────────────────────────────────────

export default function UserVirtualKeysPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  const { data: rawAll, isLoading, isError, error } = useQuery({
    queryKey: ['my-keys'],
    queryFn: deliveryApi.allKeys,
  });
  const allKeys: UserKeyDTO[] = useMemo(() => rawAll ?? [], [rawAll]);

  // ── R23 revised (2026-05-11): cross-fetch A's vault.list ──────────
  //
  // CLI vault is where `route_url` + `route_token` live for each team
  // key (CLI populates them on claim, see `_internal query
  // list_personal_with_masked` → emits team records). The team server
  // (this page's same-origin backend) has no knowledge of the user's
  // local aikey-proxy URL or the route_token mint, so we must reach
  // back to A.
  //
  // CORS gate: `<control-panel-url>` sentinel on A's
  // /api/user/vault/list — already wired in R23. Only runs on B side
  // (IS_PERSONAL_SIDE=false) and only when otherBaseUrl resolves to a
  // different origin than the current page (no point cross-fetching
  // ourselves; the trial single-binary case is hypothetical here
  // because this Team Keys page is master/web-only). Anonymous fetch
  // (no JWT) — A's LocalIdentityMiddleware returns the local-owner
  // identity which owns the vault records.
  const otherBaseUrl = useMemo(() => getOtherBaseUrl(), []);
  const vaultCrossClient = useMemo(() => {
    if (IS_PERSONAL_SIDE || !otherBaseUrl) return null;
    try {
      if (new URL(otherBaseUrl).origin === window.location.origin) return null;
    } catch {
      return null;
    }
    return axios.create({
      baseURL: otherBaseUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }, [otherBaseUrl]);

  // Team record lookup: { virtual_key_id → { route_url, route_token } }.
  // Empty map when cross-fetch is unavailable or returns no records;
  // drawer falls back to "—" hints for those fields.
  const teamVaultQuery = useQuery({
    queryKey: ['team-vault-records-cross', otherBaseUrl ?? ''],
    queryFn: async () => {
      if (!vaultCrossClient) return {} as Record<string, { route_url?: string; route_token?: string | null }>;
      try {
        const r = await vaultCrossClient.get<{ status: string; data?: { records?: Array<{
          target?: string; virtual_key_id?: string; route_url?: string; route_token?: string | null;
        }> } }>('/api/user/vault/list');
        const records = r.data?.data?.records ?? [];
        const map: Record<string, { route_url?: string; route_token?: string | null }> = {};
        for (const rec of records) {
          if (rec.target === 'team' && rec.virtual_key_id) {
            // rc.3 fix (2026-05-12): team route_token = `aikey_team_<vk_id>`
            // is purely derived from the public vk_id — CLI's
            // commands_internal/query.rs::team_records_for_emit builds it the
            // same way. So when the cross-fetch returns it null (because A's
            // vault is locked OR the request goes without credentials per
            // 2026-04-24 vault-leak rule), we can safely reconstruct it
            // client-side. This avoids needing `withCredentials: true` which
            // would expose A's unlock-session cookie to the B origin — a
            // 2026-04-24 vault-leak rule violation. route_url stays as-fetched
            // (it depends on A's local proxy port + provider_routes table,
            // which B doesn't know).
            map[rec.virtual_key_id] = {
              route_url: rec.route_url,
              route_token: rec.route_token ?? `aikey_team_${rec.virtual_key_id}`,
            };
          }
        }
        return map;
      } catch {
        return {} as Record<string, { route_url?: string; route_token?: string | null }>;
      }
    },
    enabled: !!vaultCrossClient,
    staleTime: 30_000,
  });
  const teamVaultByVk = teamVaultQuery.data ?? {};

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('alias');

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allKeys
      .filter((k) => {
        if (typeFilter === 'issued' && k.key_status !== 'active') return false;
        if (typeFilter === 'pending' && k.key_status !== 'pending_claim') return false;
        if (typeFilter === 'revoked' && !(k.key_status === 'revoked' || k.key_status === 'expired')) return false;
        if (q) {
          const a = k.alias.toLowerCase();
          const id = k.virtual_key_id.toLowerCase();
          const p = (k.provider_code ?? '').toLowerCase();
          if (!a.includes(q) && !id.includes(q) && !p.includes(q)) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => {
        switch (sortKey) {
          case 'alias':
            return a.alias.localeCompare(b.alias);
          case 'expires': {
            const ta = a.expires_at ? Date.parse(a.expires_at) : Number.POSITIVE_INFINITY;
            const tb = b.expires_at ? Date.parse(b.expires_at) : Number.POSITIVE_INFINITY;
            return ta - tb;
          }
          case 'status':
            return a.key_status.localeCompare(b.key_status);
          default:
            return 0;
        }
      });
  }, [allKeys, search, typeFilter, sortKey]);

  // Counts for IdentityStrip + filter pills
  const counts = useMemo(() => {
    const total = allKeys.length;
    const issued = allKeys.filter((k) => k.key_status === 'active').length;
    const pending = allKeys.filter((k) => k.key_status === 'pending_claim').length;
    const revoked = allKeys.filter((k) => k.key_status === 'revoked' || k.key_status === 'expired').length;
    return { total, issued, pending, revoked };
  }, [allKeys]);

  // Group by provider family (preserves filter order)
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, UserKeyDTO[]>();
    for (const k of filtered) {
      const fam = providerFamily(k.provider_code);
      if (!map.has(fam)) {
        map.set(fam, []);
        order.push(fam);
      }
      map.get(fam)!.push(k);
    }
    return order.map((provider) => ({
      provider,
      color: providerBrandColor(provider),
      records: map.get(provider)!,
    }));
  }, [filtered]);

  // Drawer + selected row
  const [drawerKey, setDrawerKey] = useState<UserKeyDTO | null>(null);
  const [summary, setSummary] = useState<KeySummaryDTO | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const viewMut = useMutation({
    mutationFn: (id: string) => deliveryApi.getSummary(id),
    onSuccess: (result) => { setSummary(result); setDrawerError(null); },
    onError: (err: unknown) => {
      setSummary(null);
      const status = (err as { response?: { status?: number } })?.response?.status;
      setDrawerError(status === 403
        ? t('teamKeys.detailErrorRevoked')
        : t('teamKeys.detailErrorLoadFailed'));
    },
  });

  // Toast stack — vault-style transient feedback (5s auto-dismiss)
  type ToastKind = 'success' | 'error';
  interface ToastEntry { id: number; kind: ToastKind; title: string; sub?: string }
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdRef = useRef(0);
  const pushToast = useCallback((t: Omit<ToastEntry, 'id'>): number => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5000);
    return id;
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Use action — same-origin only.
  //
  // History:
  //   - rc.3 first attempt (2026-05-12 morning): cross-origin POST via
  //     vaultCrossClient. Cleared 405 (server's POST /vault/use lacked
  //     OPTIONS preflight) but surfaced a deeper 401: A's session cookie
  //     deliberately doesn't cross origins per the 2026-04-24 vault-leak
  //     rule, so the cross-origin POST fails I_VAULT_NO_SESSION.
  //   - rc.3 final design (2026-05-12 afternoon): on B side render an
  //     external link to A's local Vault page instead (see Row.useHref
  //     prop below). Phase 3B decision 8 promised B-side Use clicks; the
  //     architectural reality is they must be confirmed in A's local
  //     session. The link UX is the design realization. Updated 20260511
  //     vault-page doc decision 8 accordingly.
  // This mutation only fires on A side now (where the page is same-
  // origin to /api/user/vault/use). On B side the link short-circuits
  // before this mutation is invoked.
  const setHookReadiness = useHookReadinessStore((s) => s.setReadiness);
  const wireRcModal = useHookWireRcModal();
  const useMutTeam = useMutation({
    mutationFn: (id: string) => vaultApi.use({ target: 'team', id }),
    onSuccess: (res, vkId) => {
      const r = pickHookReadiness(res);
      setHookReadiness(r);
      wireRcModal.openIfNeeded(r, true);
      qc.invalidateQueries({ queryKey: ['my-keys'] });
      const k = allKeys.find((x) => x.virtual_key_id === vkId);
      pushToast({
        kind: 'success',
        title: t('teamKeys.toastNowRouting', { alias: k?.alias ?? t('teamKeys.unnamed') }),
        sub: t('teamKeys.toastNowRoutingSub'),
      });
    },
    onError: (err: unknown) => {
      pushToast({ kind: 'error', title: t('teamKeys.toastSetRoutingFailed'), sub: mapUseError(err) });
    },
  });

  // Claim mutation
  const claimMut = useMutation({
    mutationFn: (id: string) => deliveryApi.claimKey(id),
    onSuccess: (_res, vkId) => {
      qc.invalidateQueries({ queryKey: ['my-keys'] });
      const k = allKeys.find((x) => x.virtual_key_id === vkId);
      pushToast({ kind: 'success', title: t('teamKeys.toastClaimed', { alias: k?.alias ?? t('teamKeys.unnamed') }) });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast({ kind: 'error', title: t('teamKeys.toastClaimFailed'), sub: msg });
    },
  });

  function openDrawer(k: UserKeyDTO) {
    setDrawerKey(k);
    setDrawerError(null);
    setSummary(null);
    if (k.key_status === 'active') {
      viewMut.mutate(k.virtual_key_id);
    }
  }

  function closeDrawer() {
    setDrawerKey(null);
    setSummary(null);
    setDrawerError(null);
  }

  return (
    <div className="vault-page h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      <style>{KEYS_PAGE_CSS}</style>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 space-y-5">
          <HookReadinessBanner onEnableClick={wireRcModal.openManually} />
          <HookWireRcModal open={wireRcModal.open} onClose={wireRcModal.close} />

          <IdentityStrip counts={counts} />

          <FilterStrip
            search={search}
            onSearchChange={setSearch}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            counts={counts}
          />

          <section className="card overflow-hidden">
            <CardHeader counts={counts} />

            <div className="overflow-x-auto">
              {isLoading && <EmptyState message={t('teamKeys.emptyLoading')} />}
              {isError && <EmptyState message={t('teamKeys.emptyLoadFailed', { message: (error as Error)?.message ?? t('teamKeys.unknownError') })} />}
              {!isLoading && !isError && allKeys.length === 0 && <TeamKeysEmptyPanel />}
              {!isLoading && !isError && allKeys.length > 0 && filtered.length === 0 && (
                <EmptyState message={t('teamKeys.emptyNoMatch')} />
              )}
              {filtered.length > 0 && (
                <table className="vault">
                  <thead>
                    <tr>
                      <th
                        style={{ width: '34%' }}
                        className={`th-sortable ${sortKey === 'alias' ? 'active' : ''}`}
                        onClick={() => setSortKey('alias')}
                        aria-sort={sortKey === 'alias' ? 'ascending' : 'none'}
                      >
                        {t('teamKeys.colAlias')} <span className="th-hint">{t('teamKeys.colAliasHint')}</span>
                        {sortKey === 'alias' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th style={{ width: '20%' }}>{t('teamKeys.colProtocol')}</th>
                      <th
                        style={{ width: '14%' }}
                        className={`th-sortable ${sortKey === 'status' ? 'active' : ''}`}
                        onClick={() => setSortKey('status')}
                      >
                        {t('teamKeys.colStatus')}
                        {sortKey === 'status' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th style={{ width: '13%' }}>{t('teamKeys.colUsage')}</th>
                      <th
                        style={{ width: '12%' }}
                        className={`th-sortable ${sortKey === 'expires' ? 'active' : ''}`}
                        onClick={() => setSortKey('expires')}
                      >
                        {t('teamKeys.colExpires')}
                        {sortKey === 'expires' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th style={{ width: 130, textAlign: 'right' }}>{t('teamKeys.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((g) => (
                      <React.Fragment key={g.provider}>
                        <GroupHeaderRow
                          provider={g.provider}
                          color={g.color}
                          totalCount={g.records.length}
                        />
                        {g.records.map((k, idx) => (
                          <Row
                            key={k.virtual_key_id}
                            record={k}
                            isLastInGroup={idx === g.records.length - 1}
                            onOpenDrawer={() => openDrawer(k)}
                            onClaim={() => claimMut.mutate(k.virtual_key_id)}
                            onUse={() => useMutTeam.mutate(k.virtual_key_id)}
                            claimPending={claimMut.isPending && claimMut.variables === k.virtual_key_id}
                            usePending={useMutTeam.isPending && useMutTeam.variables === k.virtual_key_id}
                            // On B side, Use must be confirmed against A's
                            // local-session-bearing vault page; same-origin
                            // POST stays for A side (useHref=undefined).
                            useHref={
                              !IS_PERSONAL_SIDE && otherBaseUrl
                                ? `${otherBaseUrl}/user/vault?focus=${encodeURIComponent(k.virtual_key_id)}`
                                : undefined
                            }
                          />
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <PageFooter />
        </div>
      </div>

      {drawerKey && (
        <DetailDrawer
          record={drawerKey}
          summary={summary}
          summaryPending={viewMut.isPending}
          summaryError={drawerError}
          onClose={closeDrawer}
          localRoute={teamVaultByVk[drawerKey.virtual_key_id]}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ── Identity strip (team-keys flavor) ────────────────────────────────────
function IdentityStrip({ counts }: { counts: { total: number; issued: number; pending: number; revoked: number } }) {
  const { t } = useTranslation();
  return (
    <section className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <KeyRoundIcon className="w-4 h-4" style={{ color: 'var(--primary)' }} />
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold font-mono tracking-wide truncate" style={{ color: 'var(--display-foreground)' }}>{t('teamKeys.title')}</div>
          <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
            <span>{counts.total} {t('teamKeys.countTotal')}</span>
            {counts.issued > 0 && (<><span className="opacity-40">·</span><span>{counts.issued} {t('teamKeys.countIssued')}</span></>)}
            {counts.pending > 0 && (<><span className="opacity-40">·</span><span>{counts.pending} {t('teamKeys.countPending')}</span></>)}
            {counts.revoked > 0 && (<><span className="opacity-40">·</span><span>{counts.revoked} {t('teamKeys.countRevoked')}</span></>)}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Card header ──────────────────────────────────────────────────────────
function CardHeader({ counts }: { counts: { total: number; issued: number; pending: number; revoked: number } }) {
  const { t } = useTranslation();
  return (
    <div className="card-header flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
        <span>{t('teamKeys.cardAllKeys')}</span>
        <span className="chip">
          <span className="status-dot idle" style={{ width: 5, height: 5 }} />
          {t('teamKeys.cardStored', { count: counts.total })}
        </span>
        {counts.issued > 0 && (
          <span className="chip success">
            <span className="status-dot" style={{ width: 5, height: 5 }} />
            {t('teamKeys.cardIssued', { count: counts.issued })}
          </span>
        )}
        {counts.pending > 0 && (
          <span className="chip warning">
            <span className="status-dot stale" style={{ width: 5, height: 5 }} />
            {t('teamKeys.cardPending', { count: counts.pending })}
          </span>
        )}
        {counts.revoked > 0 && (
          <span className="chip danger">
            <span className="status-dot error" style={{ width: 5, height: 5 }} />
            {t('teamKeys.cardRevoked', { count: counts.revoked })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Filter strip ─────────────────────────────────────────────────────────
function FilterStrip(props: {
  search: string;
  onSearchChange: (s: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (v: TypeFilter) => void;
  counts: { total: number; issued: number; pending: number; revoked: number };
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap min-w-0">
        <div className="relative">
          <SearchIcon
            className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--muted-foreground)' }}
          />
          <input
            type="text"
            className="pl-10 pr-3 py-2 text-sm w-96"
            placeholder={t('teamKeys.searchPlaceholder')}
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            aria-label={t('teamKeys.searchAriaLabel')}
          />
        </div>
        <div className="filter-group" role="radiogroup" aria-label={t('teamKeys.filterAriaLabel')}>
          <FilterPill active={props.typeFilter === 'all'} onClick={() => props.onTypeFilterChange('all')} label={t('teamKeys.filterAll')} count={props.counts.total} />
          <FilterPill active={props.typeFilter === 'issued'} onClick={() => props.onTypeFilterChange('issued')} label={t('teamKeys.filterIssued')} count={props.counts.issued} />
          <FilterPill active={props.typeFilter === 'pending'} onClick={() => props.onTypeFilterChange('pending')} label={t('teamKeys.filterPending')} count={props.counts.pending} />
          <FilterPill active={props.typeFilter === 'revoked'} onClick={() => props.onTypeFilterChange('revoked')} label={t('teamKeys.filterRevoked')} count={props.counts.revoked} />
        </div>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count?: number;
}) {
  return (
    <button className={`filter-pill${active ? ' active' : ''}`} onClick={onClick}>
      {label}
      {typeof count === 'number' && <span className="count">{count}</span>}
    </button>
  );
}

// ── Group header row ─────────────────────────────────────────────────────
function GroupHeaderRow({ provider, color, totalCount }: {
  provider: string; color: string; totalCount: number;
}) {
  const { t } = useTranslation();
  const entryWord = totalCount === 1 ? t('teamKeys.entryOne') : t('teamKeys.entryOther');
  return (
    <tr className="group-row" data-group-provider={provider}>
      <td colSpan={6}>
        <div className="gr-inner">
          <span
            className="gr-chip"
            style={{ background: color }}
            aria-hidden="false"
          >
            {provider}
          </span>
          <span className="gr-meta">
            · {totalCount} {entryWord}
          </span>
        </div>
      </td>
    </tr>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────
const Row = React.memo(function Row(props: {
  record: UserKeyDTO;
  isLastInGroup?: boolean;
  onOpenDrawer: () => void;
  onClaim: () => void;
  onUse: () => void;
  claimPending: boolean;
  usePending: boolean;
  /** rc.3 fix (2026-05-12): when set, render the Use action as an
   *  external link to A side's vault page instead of a same-origin
   *  POST button. Used on B side (team server origin) where direct
   *  cross-origin POST to /api/user/vault/use returns 401
   *  (I_VAULT_NO_SESSION — A's unlock session cookie deliberately
   *  doesn't cross origins per 2026-04-24 vault-leak rule). The link
   *  navigates the current window to A's local Vault page (mirroring
   *  /user/overview's Use button — same-window keeps the user in a
   *  single tab so back-button returns them to the team listing).
   *  Undefined on A side. */
  useHref?: string;
}) {
  const { t } = useTranslation();
  const r = props.record;
  const status = statusMeta(r.key_status, t);
  const fam = providerFamily(r.provider_code);
  const expiresStr = formatExpiresAt(r.expires_at, t);
  const trClasses = [
    'group-child',
    'row-clickable',
    props.isLastInGroup ? 'last-in-group' : '',
  ].filter(Boolean).join(' ');

  const onRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, a, [role="button"]')) return;
    props.onOpenDrawer();
  };

  return (
    <tr className={trClasses} onClick={onRowClick}>
      <td>
        <div className="alias-main">{r.alias || t('teamKeys.unnamed')}</div>
        <div className="alias-sub">
          <span className="font-mono" title={r.virtual_key_id}>{shortVk(r.virtual_key_id)}</span>
        </div>
      </td>

      <td>
        <span className="provider-cell">
          <span className="prov-dot" style={{ background: providerBrandColor(fam) }} aria-hidden="true" />
          <span className="name">{fam}</span>
          <span className="kind-pill team">{t('teamKeys.kindTeam')}</span>
        </span>
      </td>

      <td>
        <span className={`chip ${status.chipClass}`}>
          {status.chipClass === 'success' && <span className="status-dot" style={{ width: 5, height: 5 }} />}
          {status.chipClass === 'warning' && <span className="status-dot stale" style={{ width: 5, height: 5 }} />}
          {status.chipClass === 'danger'  && <span className="status-dot error" style={{ width: 5, height: 5 }} />}
          {status.label}
        </span>
        {/* claim/share status relocated here — the former 共享 column is now the
            usage/limit bar; this preserves the claim dimension. */}
        <div className="alias-sub" style={{ marginTop: 3 }}>{shareLabel(r.share_status, t)}</div>
      </td>

      {/* usage / limit — one progress bar per seat quota rule (used vs limit). */}
      <td>
        {!r.seat_quota || r.seat_quota.length === 0 ? (
          <span className="text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {r.seat_quota.map((q, i) => {
              const pct = q.limit > 0 ? (q.used / q.limit) * 100 : 0;
              const shown = Math.min(100, Math.max(0, Math.round(pct)));
              const over = q.limit > 0 && q.used >= q.limit;
              return (
                <div key={i} title={`${fmtQuota(q.metric, q.used)} / ${fmtQuota(q.metric, q.limit)}`}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 6,
                      fontSize: 10.5,
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                      color: 'var(--muted-foreground)',
                    }}
                  >
                    <span className="font-mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {fmtQuota(q.metric, q.used)}
                      <span style={{ opacity: 0.55 }}> / {fmtQuota(q.metric, q.limit)}</span>
                    </span>
                    <span style={{ fontWeight: 600, color: over ? 'var(--destructive)' : 'var(--muted-foreground)' }}>
                      {shown}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 5,
                      borderRadius: 3,
                      background: 'var(--muted)',
                      overflow: 'hidden',
                      marginTop: 3,
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        width: `${Math.max(shown, 1.5)}%`,
                        background: over ? 'var(--destructive)' : 'var(--primary)',
                        borderRadius: 3,
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </td>

      <td className="font-mono text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
        {expiresStr ?? '—'}
      </td>

      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div className="row-actions" style={{ whiteSpace: 'nowrap' }}>
          {r.share_status === 'pending_claim' ? (
            <button
              type="button"
              className="row-use-btn"
              onClick={props.onClaim}
              disabled={props.claimPending}
              title={props.claimPending ? t('teamKeys.claiming') : t('teamKeys.claimTitle')}
            >
              {props.claimPending ? '…' : t('teamKeys.claim')}
            </button>
          ) : r.key_status === 'active' ? (
            props.useHref ? (
              // B side: vault.use is same-origin only (2026-04-24 vault-leak
              // rule keeps A's session cookie from crossing origins). Render
              // an in-window link to A's local Vault page so the user can
              // confirm Use there with a valid local session. Same-window
              // navigation matches /user/overview's Use button (2026-05-12
              // user feedback: a new tab broke the back-button flow).
              <a
                href={props.useHref}
                className="row-use-btn"
                title={t('teamKeys.useHrefTitle', { url: props.useHref })}
                aria-label={t('teamKeys.useHrefAriaLabel')}
              >
                <ZapIcon className="w-3 h-3" />
                {t('teamKeys.use')}
              </a>
            ) : (
              <button
                type="button"
                className="row-use-btn"
                onClick={props.onUse}
                disabled={props.usePending}
                title={props.usePending ? t('teamKeys.switching') : t('teamKeys.useTitle')}
                aria-label={t('teamKeys.useAriaLabel')}
              >
                <ZapIcon className="w-3 h-3" />
                {t('teamKeys.use')}
              </button>
            )
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>—</span>
          )}
          <button className="icon-btn" title={t('teamKeys.viewDetails')} onClick={(e) => { e.stopPropagation(); props.onOpenDrawer(); }}>
            <EyeIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
});

// ── Detail drawer ────────────────────────────────────────────────────────
function DetailDrawer(props: {
  record: UserKeyDTO;
  summary: KeySummaryDTO | null;
  summaryPending: boolean;
  summaryError: string | null;
  onClose: () => void;
  /** Phase 3B R23 revised (2026-05-11): local-side proxy routing
   *  for this team key, cross-fetched from Personal A's vault.list.
   *  Both fields optional — undefined when this Team Keys page is
   *  rendered without a reachable Personal local-server (cross-app
   *  base URL absent / unreachable / CORS denied / locked vault).
   *  Drawer renders graceful empty hints in those cases. */
  localRoute?: { route_url?: string; route_token?: string | null };
  /** Phase 3B R12 (2026-05-11): drawer no longer hosts a direct
   *  vaultApi.use button — primary CTA is now copy-CLI
   *  ("Activate in terminal"), matching vault page's drawer pattern.
   *  The inline row Use button (handled at the table-row level)
   *  preserves one-click activation for users who want it. */
}) {
  const { t } = useTranslation();
  const r = props.record;
  const status = statusMeta(r.key_status, t);
  const fam = providerFamily(r.provider_code);
  const expiresStr = formatExpiresAt(r.expires_at, t);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  const [copied, setCopied] = useState<string | null>(null);
  function copy(field: string, text: string) {
    copyText(text);
    setCopied(field);
    window.setTimeout(() => setCopied((k) => (k === field ? null : k)), 1200);
  }

  return (
    <>
      <div className="drawer-overlay" data-open="true" onClick={props.onClose} />
      <aside className="drawer" data-open="true" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="content">
            <div className="alias-title">{r.alias || t('teamKeys.unnamed')}</div>
            <div className="meta-row">
              <span className="provider-cell">
                <span className="prov-dot" style={{ background: providerBrandColor(fam) }} />
                <span className="name font-mono" style={{ color: 'var(--muted-foreground)' }}>{fam}</span>
                <span className="kind-pill team">{t('teamKeys.kindTeam')}</span>
              </span>
              <span className={`chip ${status.chipClass}`}>
                {status.chipClass === 'success' && <span className="status-dot" style={{ width: 5, height: 5 }} />}
                {status.chipClass === 'warning' && <span className="status-dot stale" style={{ width: 5, height: 5 }} />}
                {status.chipClass === 'danger'  && <span className="status-dot error" style={{ width: 5, height: 5 }} />}
                {status.label}
              </span>
            </div>
          </div>
          <button className="drawer-close" onClick={props.onClose} title={t('teamKeys.drawerCloseTitle')} aria-label={t('teamKeys.drawerCloseAriaLabel')}>
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="drawer-body">
          {/* Virtual Key section — analog of vault page's Credential block */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <KeyRoundIcon className="w-3 h-3" />
              {t('teamKeys.sectionVirtualKey')}
            </div>
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldAlias')}</span>
              <span className="v">{r.alias || t('teamKeys.unnamed')}</span>
            </div>
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldVirtualKeyId')}</span>
              <span className="v mono">
                <span title={r.virtual_key_id}>{shortVk(r.virtual_key_id)}</span>
                <button type="button" className="copy-btn" onClick={() => copy('vk_id', r.virtual_key_id)} title={t('teamKeys.copyField', { value: r.virtual_key_id })}>
                  {copied === 'vk_id' ? <CheckIcon className="w-3 h-3" /> : <ClipboardIcon className="w-3 h-3" />}
                </button>
              </span>
            </div>
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldShare')}</span>
              <span className="v">
                <span className={`chip ${r.share_status === 'claimed' ? 'success' : r.share_status === 'revoked' ? 'danger' : 'warning'}`}>
                  {shareLabel(r.share_status, t).toUpperCase()}
                </span>
              </span>
            </div>
          </div>

          {/* Usage / Limit section — the seat's quota (used vs limit per rule),
              the same data as the team-keys list column, shown larger here. */}
          {r.seat_quota && r.seat_quota.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-title">
                <ZapIcon className="w-3 h-3" />
                {t('teamKeys.sectionUsage')}
              </div>
              {r.seat_quota.map((q, i) => {
                const pct = q.limit > 0 ? (q.used / q.limit) * 100 : 0;
                const shown = Math.min(100, Math.max(0, Math.round(pct)));
                const over = q.limit > 0 && q.used >= q.limit;
                return (
                  <div key={i} className="drawer-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span className="v mono">
                        {fmtQuota(q.metric, q.used)} / {fmtQuota(q.metric, q.limit)}
                      </span>
                      <span className="v" style={{ fontWeight: 600, color: over ? 'var(--destructive)' : undefined }}>
                        {shown}%
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--muted)', overflow: 'hidden' }}>
                      <span
                        style={{
                          display: 'block',
                          height: '100%',
                          width: `${Math.max(shown, 1.5)}%`,
                          background: over ? 'var(--destructive)' : 'var(--primary)',
                          borderRadius: 3,
                          transition: 'width 200ms ease',
                        }}
                      />
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--muted-foreground)', opacity: 0.7, marginTop: 1 }}>
                      {t('teamKeys.quotaResetAt', { date: nextResetLabel(q.period) })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Routing section — protocol slots from KeySummaryDTO */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <NetworkIcon className="w-3 h-3" />
              {t('teamKeys.sectionRouting')}
            </div>
            {props.summaryPending && (
              <div className="drawer-field">
                <span className="v" style={{ color: 'var(--muted-foreground)' }}>{t('teamKeys.routingLoading')}</span>
              </div>
            )}
            {props.summaryError && (
              <div className="drawer-field">
                <span className="v" style={{ color: '#fca5a5' }}>{props.summaryError}</span>
              </div>
            )}
            {props.summary && props.summary.slots.length === 0 && (
              <div className="drawer-field">
                <span className="v" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>{t('teamKeys.routingNoSlots')}</span>
              </div>
            )}
            {props.summary && props.summary.slots.map((slot) => (
              <div key={slot.protocol_type} className="drawer-field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span className="k">{slot.protocol_type.toUpperCase()}</span>
                <span className="v" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, width: '100%' }}>
                  {slot.targets.map((t) => (
                    <div key={t.binding_id} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--muted-foreground)' }}>{t.base_url}</span>
                      <span className={`kind-pill${t.fallback_role === 'primary' ? '' : ' oauth'}`}>{t.fallback_role}</span>
                    </div>
                  ))}
                </span>
              </div>
            ))}

            {/* Phase 3B R23 revised (2026-05-11): local proxy mapping
                rows. Mirrors Personal Vault drawer's `route_url` +
                `Route token` pair (see vault/index.tsx). Data is the
                user's machine view (cross-fetched A's vault.list); when
                A is unreachable / vault locked / not configured the
                row renders a single "—" hint instead of disappearing,
                so the user can tell the slot exists. */}
            {props.localRoute?.route_url && (
              <div className="drawer-field">
                <span className="k">route_url</span>
                <span className="v stack">
                  <span className="mono font-mono text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                    {props.localRoute.route_url}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className="text-[10px]" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
                      {t('teamKeys.routeUrlHint')}
                    </span>
                    <button
                      type="button"
                      className="copy-btn"
                      title={t('teamKeys.copyRouteUrlTitle')}
                      aria-label={t('teamKeys.copyRouteUrlAriaLabel')}
                      onClick={() => copy('route_url', props.localRoute!.route_url!)}
                    >
                      {copied === 'route_url' ? <CheckIcon className="w-3 h-3" /> : <ClipboardIcon className="w-3 h-3" />}
                    </button>
                  </span>
                </span>
              </div>
            )}
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldRouteToken')}</span>
              <span className="v stack">
                {props.localRoute?.route_token ? (
                  <div className="drawer-tokenbox" tabIndex={0} aria-label={t('teamKeys.routeTokenAriaLabel')}>
                    {props.localRoute.route_token}
                    <button
                      type="button"
                      className="copy-btn"
                      title={t('teamKeys.copyRouteTokenTitle')}
                      aria-label={t('teamKeys.copyRouteTokenAriaLabel')}
                      onClick={() => copy('route_token', props.localRoute!.route_token!)}
                    >
                      {copied === 'route_token' ? <CheckIcon className="w-3 h-3" /> : <ClipboardIcon className="w-3 h-3" />}
                    </button>
                  </div>
                ) : (
                  <div
                    className="drawer-tokenbox drawer-tokenbox-locked"
                    aria-label={t('teamKeys.routeTokenUnavailableAriaLabel')}
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    <span style={{ letterSpacing: '0.15em' }}>{'•'.repeat(40)}</span>
                    <span className="drawer-tokenbox-hint text-[10px]" style={{ opacity: 0.55 }}>
                      {t('teamKeys.routeTokenUnlockHint')}
                    </span>
                  </div>
                )}
              </span>
            </div>
          </div>

          {/* Actions section — Phase 3B R12 (2026-05-11): unified
              "Activate in terminal" copy-CLI primary CTA, matching
              vault page's drawer pattern across all credential
              targets (Personal / OAuth / Team). The inline row Use
              button still calls vaultApi.use directly for one-click;
              the drawer button gives the user a copy-paste
              alternative for muscle memory + scriptability. */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <WrenchIcon className="w-3 h-3" />
              {t('teamKeys.sectionActions')}
            </div>
            <div className="drawer-actions">
              {r.key_status === 'active' && r.alias ? (
                <>
                  <button
                    type="button"
                    className="action-btn primary-route"
                    onClick={() => copy('route_cmd', `aikey activate ${r.alias}`)}
                    title={t('teamKeys.activateCopyTitle', { alias: r.alias })}
                  >
                    {copied === 'route_cmd' ? (
                      <>
                        <CheckIcon className="w-3.5 h-3.5" />
                        {t('teamKeys.commandCopied')}
                      </>
                    ) : (
                      <>
                        <ZapIcon className="w-3.5 h-3.5" />
                        {t('teamKeys.activateInTerminal')}
                      </>
                    )}
                  </button>
                  <div className="drawer-actions-hint" role="note">
                    {copied === 'route_cmd' ? (
                      <>
                        <CheckIcon className="w-3 h-3" />
                        <span>{t('teamKeys.copiedPasteInTerminal')}</span>
                      </>
                    ) : (
                      <>
                        <ZapIcon className="w-3 h-3" />
                        <span>
                          {t('teamKeys.activateHintCopyPrefix')}<code className="font-mono">aikey activate {r.alias}</code>{t('teamKeys.activateHintRunSuffix')}
                        </span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="drawer-actions-hint" role="note">
                  <InfoIcon className="w-3 h-3" />
                  <span>{t('teamKeys.cannotActivate', { status: status.label.toLowerCase() })}</span>
                </div>
              )}
            </div>
          </div>

          {/* Meta section */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <InfoIcon className="w-3 h-3" />
              {t('teamKeys.sectionMeta')}
            </div>
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldProtocol')}</span>
              <span className="v">{fam}<span className="ro-pill">RO</span></span>
            </div>
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldType')}</span>
              <span className="v">{t('teamKeys.typeTeamKey')}<span className="ro-pill">RO</span></span>
            </div>
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldStatus')}</span>
              <span className="v">
                {status.chipClass === 'success'
                  ? <><span className="status-dot" style={{ width: 5, height: 5 }} /><span style={{ color: 'var(--success)' }}>{status.label}</span></>
                  : <><span className="status-dot error" style={{ width: 5, height: 5 }} /><span style={{ color: '#fca5a5' }}>{status.label}</span></>}
              </span>
            </div>
            {expiresStr && (
              <div className="drawer-field">
                <span className="k">{t('teamKeys.fieldExpires')}</span>
                <span className="v">{expiresStr}</span>
              </div>
            )}
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldOrg')}</span>
              <span className="v mono dim">{r.org_id || '—'}</span>
            </div>
            <div className="drawer-field">
              <span className="k">{t('teamKeys.fieldSeat')}</span>
              <span className="v mono dim">{r.seat_id || '—'}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Toast stack ──────────────────────────────────────────────────────────
function ToastStack({ toasts, onDismiss }: {
  toasts: Array<{ id: number; kind: 'success' | 'error'; title: string; sub?: string }>;
  onDismiss: (id: number) => void;
}) {
  // Named `tr` (not `t`) to avoid shadowing the per-toast `t` loop variable below.
  const { t: tr } = useTranslation();
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' error' : ''}`} data-open="true">
          <span className="toast-icon">
            {t.kind === 'success' ? <ZapIcon className="w-3 h-3" /> : <InfoIcon className="w-3 h-3" />}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.sub && <div className="toast-sub">{t.sub}</div>}
          </div>
          <div className="toast-actions">
            <button type="button" className="toast-dismiss" onClick={() => onDismiss(t.id)} aria-label={tr('teamKeys.toastDismiss')}>
              <XIcon className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16" style={{ color: 'var(--muted-foreground)' }}>
      <div className="text-[12px] font-mono">{message}</div>
    </div>
  );
}

function TeamKeysEmptyPanel() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-20">
      <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-5" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        <KeyRoundIcon className="w-6 h-6" style={{ color: 'var(--primary)' }} />
      </div>
      <div className="text-[12px] font-mono uppercase tracking-wider mb-2" style={{ color: 'var(--foreground)' }}>{t('teamKeys.emptyTitle')}</div>
      <p className="text-[12px] mx-auto max-w-md" style={{ color: 'var(--muted-foreground)' }}>
        {t('teamKeys.emptyHintPrefix')}
        <strong style={{ color: 'var(--foreground)' }}>{t('teamKeys.emptyHintTeamAdmin')}</strong>{t('teamKeys.emptyHintMiddle')}
        <Link to="/user/import" className="underline" style={{ color: 'var(--primary)' }}>{t('teamKeys.emptyHintImportLink')}</Link>{t('teamKeys.emptyHintSuffix')}
      </p>
    </div>
  );
}

// ── Page footer ──────────────────────────────────────────────────────────
function PageFooter() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-3 text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}>
      {t('teamKeys.footer')}
    </div>
  );
}

// ── Icons (subset borrowed from vault page's icon library) ───────────────
function SvgIcon({ d, className = 'w-4 h-4', style }: { d: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
const ICON_KEY_ROUND = 'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z';
const ICON_SEARCH = 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z';
const ICON_X = 'M6 18L18 6M6 6l12 12';
const ICON_EYE = 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z';
const ICON_CHECK = 'M4.5 12.75l6 6 9-13.5';
const ICON_CLIPBOARD = 'M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184';
const ICON_NETWORK = 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5';
const ICON_ZAP = 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z';
const ICON_INFO = 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z';
const ICON_WRENCH = 'M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z';

function KeyRoundIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_KEY_ROUND} {...p} />; }
function SearchIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SEARCH} {...p} />; }
function XIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_X} {...p} />; }
function EyeIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EYE} {...p} />; }
function CheckIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHECK} {...p} />; }
function ClipboardIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CLIPBOARD} {...p} />; }
function NetworkIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_NETWORK} {...p} />; }
function ZapIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_ZAP} {...p} />; }
function InfoIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_INFO} {...p} />; }
function WrenchIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_WRENCH} {...p} />; }
