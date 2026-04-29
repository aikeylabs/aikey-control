/**
 * /user/vault — User Vault page (v3.1 layout).
 *
 * Renders the local vault (Personal API keys + OAuth accounts) in the
 * same visual language as /user/overview v3.1 (identity strip → metric
 * row → keys card with toolbar + table + footer → page footer).
 *
 * Data flow is unchanged from v2: every vault-touching action goes
 * through the Go importpkg handler which spawns the Rust aikey cli
 * (`_internal vault-op` / `_internal query` / `_internal update-alias`).
 * The session cookie is shared with /user/import; unlock once, both
 * pages are unlocked.
 *
 * Per-key telemetry (`last_used_at`, `use_count`) is returned by the
 * cli as of v1.0.6-alpha. Proxy-side increment wiring is future work;
 * values are 0 / null until then, and the UI renders those honestly
 * ("never" and "0 uses"). The Activity-7D hero sparkline is client-
 * side mocked per 2026-04-23 plan C.
 *
 * Design anchors:
 *   .superdesign/design_iterations/user_vault_3_1.html
 *   roadmap20260320/技术实现/阶段3-增强版KEY管理/个人vault-Web页面-技术方案.md
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { importApi } from '@/shared/api/user/import';
import { formatRelativeTime } from '@/shared/utils/datetime-intl';
import {
  vaultApi,
  pickHookReadiness,
  type VaultRecord,
  type PersonalVaultRecord,
  type OAuthVaultRecord,
} from '@/shared/api/user/vault';
import { useHookReadinessStore } from '@/store';
import { HookReadinessBanner } from '@/shared/components/HookReadinessBanner';
import { SearchableSelect } from '@/shared/ui/SearchableSelect';
import { ProviderMultiSelect } from '@/shared/ui/ProviderMultiSelect';

// ── Derived types ────────────────────────────────────────────────────────

type TypeFilter = 'all' | 'personal' | 'oauth';
type SortKey = 'created' | 'last_used' | 'alias';

// ── Helpers ──────────────────────────────────────────────────────────────

function rowKey(r: VaultRecord): string {
  return `${r.target}:${r.id}`;
}

/** True when an alias looks like an ID (snake_case, kebab-case, no @).
 *  Controls whether we render it in Inter (friendly) or JetBrains Mono
 *  (code-identity). See user_vault_3_1.html §.alias-main.mono. */
function isMonoAlias(s: string | null | undefined): boolean {
  if (!s) return false;
  if (s.includes('@')) return false;
  if (s.includes(' ')) return false;
  return /^[a-z0-9._\-]+$/.test(s);
}

function formatCreatedShort(unix: number | null | undefined): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

/** Human "4 min ago" / "Yesterday" / "2026-04-23" rendering — now
 * locale-aware via `formatRelativeTime` (previously hardcoded
 * English). Still falls back to the ISO-style `formatCreatedShort`
 * for deltas beyond a month so old records read stably. */
function formatRelative(unix: number | null | undefined): string {
  if (!unix) return 'never';
  const diffSec = Date.now() / 1000 - unix;
  if (diffSec >= 30 * 86400) return formatCreatedShort(unix);
  return formatRelativeTime(unix * 1000) || 'never';
}

/** "expires in 27d" / "expires in 4h" / "expired" / null when unknown. */
function formatExpiresIn(unix: number | null | undefined): string | null {
  if (!unix) return null;
  const diff = unix - Date.now() / 1000;
  if (diff <= 0) return 'expired';
  if (diff < 3600) return `expires in ${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `expires in ${Math.floor(diff / 3600)}h`;
  return `expires in ${Math.floor(diff / 86400)}d`;
}

/** Canonical brand color for a provider, matching the 3.1 template's
 *  `--chart-*` palette. Unknown / unmapped providers fall through to a
 *  neutral gray rather than inventing new colors (keeps the chip system
 *  disciplined the way import-page chips are). */
function providerBrandColor(provider: string | null | undefined): string {
  const p = (provider ?? '').toLowerCase();
  if (p.includes('anthropic') || p.includes('claude')) return 'var(--chart-anthropic)';
  if (p.includes('openai')) return 'var(--chart-openai)';
  if (p.includes('codex')) return 'var(--chart-codex)';
  if (p.includes('kimi') || p.includes('moonshot')) return 'var(--chart-kimi)';
  if (p.includes('gemini') || p.includes('google')) return 'var(--chart-gemini)';
  return 'var(--chart-neutral)';
}

/** Short display name for the Provider column. Strips "_oauth" / "_api"
 *  suffixes and lowercases. Returns the raw per-credential provider (so
 *  "claude" OAuth rows and "anthropic" API-key rows are visually distinct
 *  in the Provider column). For grouping or "which API protocol" semantics
 *  use providerProtocolFamily() instead. */
function providerDisplayName(r: VaultRecord): string {
  const raw = r.target === 'personal' ? (r.provider_code ?? 'unknown') : r.provider;
  return raw.toLowerCase().replace(/_oauth$|_api$/, '');
}

/** Shell wrapper that honours the currently-routed account for a given
 *  provider family. Users don't need `aikey` at all at call time — they
 *  just run e.g. `claude` / `codex` / `kimi` and the aikey proxy maps
 *  the request to whichever alias is currently in use for that family.
 *
 *  Returns null when we don't ship a dedicated wrapper for the provider
 *  (caller should fall back to the generic `aikey` hint). Mapping is
 *  intentionally narrow — only covers the 3 families that actually have
 *  first-class shell wrappers today; adding more is a config change, not
 *  a UI guess. */
function providerShellCommand(family: string | null | undefined): string | null {
  const p = (family ?? '').toLowerCase();
  if (p.includes('anthropic') || p.includes('claude')) return 'claude';
  if (p.includes('openai') || p.includes('codex')) return 'codex';
  if (p.includes('kimi') || p.includes('moonshot')) return 'kimi';
  return null;
}


/** Route-token tail "vk_9f2a…a7e3" from full route_token. */
function shortRouteToken(rt: string | null | undefined): string | null {
  if (!rt) return null;
  const stripped = rt.replace(/^aikey_vk_/, '');
  if (stripped.length <= 10) return `vk_${stripped}`;
  return `vk_${stripped.slice(0, 4)}…${stripped.slice(-4)}`;
}

// ── Main component ───────────────────────────────────────────────────────

export default function UserVaultPage() {
  const qc = useQueryClient();

  // Vault session (shared with /user/import).
  const { data: vault, refetch: refetchVault, dataUpdatedAt } = useQuery({
    queryKey: ['vault-status'],
    queryFn: importApi.vaultStatus,
    refetchInterval: 10_000,
    staleTime: 0,
  });
  const unlocked = Boolean(vault?.unlocked);

  // Unlock banner state.
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const unlockMut = useMutation({
    mutationFn: importApi.vaultUnlock,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        setUnlockPassword('');
        setUnlockError(null);
        refetchVault();
      } else {
        setUnlockError(res.error_message || 'unlock failed');
      }
    },
    onError: (e: Error) => setUnlockError(e.message),
  });

  const lockMut = useMutation({
    mutationFn: importApi.vaultLock,
    onSuccess: () => {
      refetchVault();
      qc.removeQueries({ queryKey: ['vault-list'] });
    },
  });

  // Auto-lock countdown state was previously held here, ticking once per
  // second — that forced a full-page re-render every tick and measurably
  // degraded scroll smoothness (the mm:ss mm:ss mm:ss cadence would
  // re-render IdentityStrip / MetricsRow / the SVG sparklines / every
  // table Row on each beat). The countdown is now owned by UnlockBanner
  // itself so only that banner re-paints per second; the rest of the page
  // re-renders only on real data / UI changes.

  // Vault list (runs in both locked and unlocked states — locked path
  // returns metadata-only records).
  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: ['vault-list', unlocked ? 'unlocked' : 'locked'],
    queryFn: vaultApi.list,
    staleTime: 30_000,
  });

  const records = listData?.records ?? [];
  const counts = listData?.counts ?? { personal: 0, oauth: 0, team: 0, total: 0 };

  // Filters + sort. Status filter removed 2026-04-24 — in practice
  // 99% of keys are `status:'active'`, errored keys are rare and when
  // they do appear the row-level status chip is already visually
  // distinct (red vs green pill) so the filter pills duplicate the
  // signal without meaningfully narrowing the list.
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filteredList = records.filter((r) => {
      if (typeFilter !== 'all' && r.target !== typeFilter) return false;
      if (q) {
        const alias = (r.alias ?? '').toLowerCase();
        const provider = providerDisplayName(r);
        const family = (r.protocol_family ?? '').toLowerCase();
        const prefix =
          r.target === 'personal' ? (r.secret_prefix ?? '').toLowerCase() : '';
        if (
          !alias.includes(q) &&
          !provider.includes(q) &&
          !family.includes(q) &&
          !prefix.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
    return filteredList.slice().sort((a, b) => {
      switch (sortKey) {
        case 'alias': {
          const aa = (a.alias ?? '').toLowerCase();
          const bb = (b.alias ?? '').toLowerCase();
          return aa.localeCompare(bb);
        }
        case 'last_used': {
          const aa = a.last_used_at ?? 0;
          const bb = b.last_used_at ?? 0;
          return bb - aa;
        }
        case 'created':
        default:
          return b.created_at - a.created_at;
      }
    });
  }, [records, typeFilter, search, sortKey]);

  // Row-level interactions (rename / delete / drawer).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [drawerRecord, setDrawerRecord] = useState<VaultRecord | null>(null);
  // Drawer open "mode" (2026-04-24 user request):
  //   - 'persistent' → opened by the explicit View details button; stays
  //     open even as the user scrolls the table behind the drawer.
  //   - 'peek' → opened by a row click or the IN USE chip; auto-closes on
  //     scroll so a passing click doesn't leave a drawer dangling while
  //     the user scans the list further down.
  const [drawerMode, setDrawerMode] = useState<'persistent' | 'peek'>('persistent');

  // Pull the readiness setter up here so all mutations can see it.
  // Hook coverage v1 review (2026-04-27 round 2): ANY vault response
  // that goes through the merge_hook_status path on the CLI side
  // (use / add / batch_import / delete_target) carries the three hook
  // fields. Each mutation's onSuccess MUST feed them back into the
  // store — otherwise the banner won't surface for users on the pure-
  // Web onboarding path who only Add (never Use).
  const setHookReadinessFromMutation = useHookReadinessStore((s) => s.setReadiness);

  const renameMut = useMutation({
    mutationFn: vaultApi.rename,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault-list'] }),
  });
  const deleteMut = useMutation({
    mutationFn: vaultApi.delete,
    onSuccess: (res) => {
      // CLI's handle_delete_target merges hook status; refresh the store.
      setHookReadinessFromMutation(pickHookReadiness(res));
      qc.invalidateQueries({ queryKey: ['vault-list'] });
    },
  });
  const addMut = useMutation({
    mutationFn: vaultApi.add,
    onSuccess: (res) => {
      // First-time Web-Add path — this is precisely the user journey
      // the hook coverage v1 banner is built for. Feed envelope fields
      // into the store so the banner can decide whether to show
      // "Almost ready" / "Shell undetectable" / etc.
      setHookReadinessFromMutation(pickHookReadiness(res));
      qc.invalidateQueries({ queryKey: ['vault-list'] });
    },
  });

  // ── aikey use (routing switch) state ──────────────────────────────────
  //
  // Mirrors the `switchTo` single-source-of-truth contract in the design
  // spec (user_vault_3_1_1.html). One function drives row buttons AND the
  // popover-pick path so optimistic / rollback / toast are always in sync.
  //
  // "unset" is deliberately unsupported: clicking an already-in-use row is
  // a no-op (per 2026-04-24 user decision — keeps the "one active per
  // provider" rule safe from accidental provider-idle states).
  type ToastKind = 'success' | 'error';
  interface ToastEntry {
    id: number;
    kind: ToastKind;
    title: string;
    sub?: string;
    cliHint?: string;
    undo?: () => void;
  }
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdRef = useRef(0);
  const [justSwitchedIds, setJustSwitchedIds] = useState<Set<string>>(() => new Set());
  const [switchingIds, setSwitchingIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const switchMut = useMutation({
    mutationFn: vaultApi.use,
    onSuccess: (res) => {
      // Hook coverage v1: feed envelope's hook fields into the shared
      // store so <HookReadinessBanner> can render the right CTA.
      setHookReadinessFromMutation(pickHookReadiness(res));
      qc.invalidateQueries({ queryKey: ['vault-list'] });
    },
  });

  const pushToast = useCallback((t: Omit<ToastEntry, 'id'>): number => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 5000);
    return id;
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Optimistic cache surgery: mark target in_use, clear in_use on any sibling
  // sharing the same protocol_family (the grouping key + routing scope).
  // `setQueryData` returns a new tuple so React Query re-renders subscribers
  // immediately. Returns the pre-switch "previous active of same family"
  // (for undo) and a rollback function that restores the pre-edit snapshot.
  //
  // Why family (not raw providerDisplayName): the CLI-side `write_bindings_
  // canonical` helper normalizes every binding write to the canonical
  // protocol code and UPSERTs, which effectively clears any prior
  // different-alias sibling (e.g. activating a codex OAuth clears the
  // prior openai-personal binding because both collapse to provider_code=
  // "openai"). The optimistic UI mirrors that same family boundary so
  // the pre-server-confirm state matches what the server ends up writing.
  type ListShape = { records: VaultRecord[]; counts: typeof counts; locked: boolean };
  function applyOptimisticSwitch(target: VaultRecord): {
    previousForUndo: VaultRecord | null;
    rollback: () => void;
  } {
    const qKey = ['vault-list'];
    const snapshot = qc.getQueryData<ListShape>(qKey);
    const targetFamily = target.protocol_family ?? 'unknown';
    const previousHolder: { value: VaultRecord | null } = { value: null };
    qc.setQueryData<ListShape | undefined>(qKey, (old) => {
      if (!old) return old;
      const newRecords = old.records.map((rec) => {
        if (rowKey(rec) === rowKey(target)) {
          return { ...rec, in_use: true } as VaultRecord;
        }
        if ((rec.protocol_family ?? 'unknown') === targetFamily && rec.in_use === true) {
          previousHolder.value = rec;
          return { ...rec, in_use: false } as VaultRecord;
        }
        return rec;
      });
      return { ...old, records: newRecords };
    });
    return {
      previousForUndo: previousHolder.value,
      rollback: () => {
        if (snapshot) qc.setQueryData(qKey, snapshot);
      },
    };
  }

  // Single entry point for "route all of provider X through this key". Used
  // by both the inline row Use button AND the popover pick. Guarded against
  // re-entrant clicks via `switchingIds`.
  function switchTo(target: VaultRecord) {
    if (target.in_use === true) return;
    if (!unlocked) {
      pushToast({
        kind: 'error',
        title: 'Unlock vault first',
        sub: 'Enter your master password to switch routing',
      });
      return;
    }
    const tk = rowKey(target);
    if (switchingIds.has(tk)) return;
    setSwitchingIds((prev) => {
      const n = new Set(prev);
      n.add(tk);
      return n;
    });
    const { previousForUndo, rollback } = applyOptimisticSwitch(target);
    switchMut.mutate(
      { target: target.target as 'personal' | 'oauth', id: target.id },
      {
        onSettled: () => {
          setSwitchingIds((prev) => {
            const n = new Set(prev);
            n.delete(tk);
            return n;
          });
        },
        onSuccess: () => {
          // Flash route-pulse once (650ms window matches .just-switched CSS).
          setJustSwitchedIds((prev) => {
            const n = new Set(prev);
            n.add(tk);
            return n;
          });
          setTimeout(() => {
            setJustSwitchedIds((prev) => {
              const n = new Set(prev);
              n.delete(tk);
              return n;
            });
          }, 650);
          const providerTag = providerDisplayName(target).toUpperCase();
          const aliasLabel = target.alias ?? '(unnamed)';
          const cli = 'aikey use ' + (target.alias ?? '');
          pushToast({
            kind: 'success',
            title: providerTag + ' now routes through ' + aliasLabel,
            sub: (previousForUndo ? 'was ' + (previousForUndo.alias ?? '(unnamed)') + ' · ' : '') + cli,
            cliHint: cli,
            undo: previousForUndo ? () => switchTo(previousForUndo!) : undefined,
          });
        },
        onError: (err: unknown) => {
          rollback();
          pushToast({
            kind: 'error',
            title: 'Failed to set routing',
            sub: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  // Group filtered records by the CLI-supplied `protocol_family` field,
  // preserving the sort order of the filtered list (first-seen family pins
  // the group position). claude OAuths + anthropic API keys land in one
  // group; codex OAuths + openai API keys land in another. The canonical
  // mapping lives in Rust (`oauth_provider_to_canonical`) so it stays in
  // sync with proxy routing and `aikey use` selection — the frontend just
  // honors whatever family the CLI assigned.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, VaultRecord[]>();
    for (const r of filtered) {
      const fam = r.protocol_family ?? 'unknown';
      if (!map.has(fam)) {
        map.set(fam, []);
        order.push(fam);
      }
      map.get(fam)!.push(r);
    }
    return order.map((provider) => ({
      provider,
      color: providerBrandColor(provider),
      records: map.get(provider)!,
    }));
  }, [filtered]);

  // Pagination by GROUP (protocol family). User choice 2026-04-24:
  // each page shows up to N provider groups in full, so group headers
  // never split across pages and the in-page rhythm (header +
  // children) stays intact. Page size tuned to 3 — typical vaults hold
  // 3-6 providers, so one page usually covers the full set; heavier
  // vaults with 10+ providers still read well 3-at-a-time.
  const GROUPS_PER_PAGE = 3;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(grouped.length / GROUPS_PER_PAGE));
  // Clamp page when the grouped list shrinks (filter / search narrows
  // the dataset). Without this, deep-paging then narrowing the filter
  // leaves the user on an empty page with no visible recovery button.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);
  const pagedGroups = useMemo(
    () => grouped.slice((currentPage - 1) * GROUPS_PER_PAGE, currentPage * GROUPS_PER_PAGE),
    [grouped, currentPage],
  );
  const pageKeyCount = useMemo(
    () => pagedGroups.reduce((sum, g) => sum + g.records.length, 0),
    [pagedGroups],
  );

  function toggleGroup(provider: string) {
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(provider)) n.delete(provider);
      else n.add(provider);
      return n;
    });
  }

  useEffect(() => {
    if (!drawerRecord) return;
    const still = (records as VaultRecord[]).some((r) => rowKey(r) === rowKey(drawerRecord));
    if (!still) setDrawerRecord(null);
  }, [records, drawerRecord]);

  // Peek-mode drawer auto-dismissal + wheel forwarding.
  //
  // When the overlay is showing, the user's wheel / trackpad events
  // land on the overlay (pointer-events: auto) and never reach the
  // page's real scroll container — so the table stays frozen and the
  // peek drawer just sits there. The fix has two moving parts:
  //
  //   1. `dismissIfOutsideDrawer`  — any wheel/touchmove outside the
  //      drawer closes the peek (user wants to browse, not stay in
  //      the drawer).
  //   2. Wheel forwarding           — on the *first* dismissing wheel
  //      we also forward its delta to the underlying scroll host
  //      (typically the UserShell main pane), so the table moves in
  //      sync with the gesture instead of the user feeling the first
  //      scroll was "eaten" by the drawer close. Subsequent wheels
  //      in the same gesture hit the container naturally because the
  //      effect's cleanup has already removed this listener (the
  //      overlay is unmounted together with drawerRecord).
  //
  // `forwarded` flag guards against multiple wheels landing in the
  // same React tick before the effect re-evaluates — without it the
  // table would double-scroll.
  useEffect(() => {
    if (!drawerRecord || drawerMode !== 'peek') return;

    // Find the nearest scrollable ancestor starting from the vault
    // page root — that's the UserShell main pane / document scroller
    // depending on layout. Element is truly scrollable when it has
    // overflow auto|scroll AND content taller than its client box.
    const findScrollHost = (start: HTMLElement | null): HTMLElement | null => {
      let cur: HTMLElement | null = start;
      while (cur && cur !== document.body) {
        const s = getComputedStyle(cur);
        if (
          (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          cur.scrollHeight > cur.clientHeight
        ) {
          return cur;
        }
        cur = cur.parentElement;
      }
      const root = document.scrollingElement as HTMLElement | null;
      if (root && root.scrollHeight > root.clientHeight) return root;
      return null;
    };

    let forwarded = false;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest('.drawer')) return;
      if (forwarded) return;
      forwarded = true;
      const anchor = document.querySelector<HTMLElement>('.vault-page');
      const host = findScrollHost(anchor);
      if (host) {
        // Normalise deltaMode: 0=pixel, 1=line, 2=page. Most
        // trackpads are 0; mouse wheel may be 1 or 2.
        const lineHeight = 16;
        let top = e.deltaY;
        let left = e.deltaX;
        if (e.deltaMode === 1) { top *= lineHeight; left *= lineHeight; }
        else if (e.deltaMode === 2) { top *= host.clientHeight; left *= host.clientWidth; }
        host.scrollBy({ top, left, behavior: 'auto' });
      }
      setDrawerRecord(null);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest('.drawer')) return;
      setDrawerRecord(null);
    };
    // `capture: true` so stopPropagation inside the drawer doesn't
    // blind us to events outside. `passive: true` since we never
    // preventDefault — we observe + forward programmatically.
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('touchmove', onTouchMove, { capture: true });
    };
  }, [drawerRecord, drawerMode]);

  function beginEdit(r: VaultRecord) {
    setEditingId(rowKey(r));
    setEditDraft(r.alias ?? '');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }
  function saveEdit(r: VaultRecord) {
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed === r.alias) {
      cancelEdit();
      return;
    }
    renameMut.mutate({ target: r.target, id: r.id, new_value: trimmed }, { onSuccess: cancelEdit });
  }
  function confirmDelete(r: VaultRecord) {
    deleteMut.mutate(
      { target: r.target, id: r.id },
      {
        onSuccess: () => {
          setDeletingId(null);
          if (drawerRecord && rowKey(drawerRecord) === rowKey(r)) {
            setDrawerRecord(null);
          }
        },
      },
    );
  }

  // Add Key modal state.
  const [addOpen, setAddOpen] = useState(false);

  // "Updated Xm ago" microcopy next to the refresh button. `nowTick`
  // advances on a 30s interval so the rendered string refreshes even
  // when the query itself hasn't refetched — otherwise "Updated 0m ago"
  // would stick until the next 10s polling beat lands.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const updatedAgo = useMemo(() => {
    void nowTick; // re-compute on every tick
    return dataUpdatedAt ? formatRelative(Math.floor(dataUpdatedAt / 1000)) : '—';
  }, [dataUpdatedAt, nowTick]);

  // Totals — still used by the card-header chip row ("N active / N
  // error"). The Total keys / Health / Activity metric cards were
  // removed 2026-04-23 (user request) so `healthPct` / `totalUses` went
  // with them; if you're reviving those cards, reintroduce the memos.
  const activeCount = useMemo(
    () => records.filter((r) => r.status === 'active').length,
    [records],
  );
  const errorCount = useMemo(
    () => records.filter((r) => r.status !== 'active').length,
    [records],
  );

  return (
    <div className="vault-page h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      <style>{VAULT_CSS}</style>

      {/* The shell already draws breadcrumb / Invite; we render the 3.1
          content stack inside the scroll region. */}
      <div className="flex-1 overflow-y-auto">
        {/* Full-width content. The old max-w-[1200px] cap mirrored the
            design mock's centered desktop preview, but on 1440+ px
            external displays it left large empty gutters and wasted
            horizontal space in the keys card. Removed 2026-04-23. */}
        <div className="px-6 py-5 space-y-5">
          {/* Hook coverage v1 banner — populated by switchMut.onSuccess. */}
          <HookReadinessBanner />
          <IdentityStrip counts={counts} onRefresh={() => refetchVault()} updatedAgo={updatedAgo} />

          <UnlockBanner
            unlocked={unlocked}
            ttlSeconds={vault?.ttl_seconds ?? null}
            password={unlockPassword}
            onPasswordChange={setUnlockPassword}
            onUnlock={() => unlockMut.mutate({ password: unlockPassword })}
            unlockPending={unlockMut.isPending}
            unlockError={unlockError}
            onLock={() => lockMut.mutate()}
          />

          {/* Hero metric row (Total keys / Health / Activity · 7D) was
              removed 2026-04-23 per user request — the card-header
              chips right below already convey "N stored / N active /
              N error", and usage trend data isn't fed by a real
              pipeline yet. */}

          {/* Toolbar (search + filter pills + sort tabs) lives OUTSIDE
              the table card, matching master pages' FilterBar pattern
              (see pages/master/orgs/virtual-keys/index.tsx). Puts the
              filter controls above a standalone card so the card only
              frames the tabular data — same visual hierarchy master
              uses across seats / virtual-keys / bindings / usage. */}
          <FilterStrip
            search={search}
            onSearchChange={setSearch}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            counts={counts}
            locked={!unlocked}
            onOpenAdd={() => setAddOpen(true)}
          />

          <section className="card overflow-hidden">
            <CardHeader
              counts={counts}
              activeCount={activeCount}
              errorCount={errorCount}
            />

            <div className="overflow-x-auto">
              {listLoading && <EmptyState message="Loading…" />}
              {listError && <EmptyState message={`Failed to load: ${(listError as Error).message}`} />}
              {!listLoading && !listError && records.length === 0 && (
                <VaultEmptyPanel />
              )}
              {!listLoading && !listError && records.length > 0 && filtered.length === 0 && (
                <EmptyState message="No records match your filters." />
              )}
              {filtered.length > 0 && (
                <table className="vault">
                  <thead>
                    <tr>
                      <th
                        style={{ width: '36%' }}
                        className={`th-sortable ${sortKey === 'alias' ? 'active' : ''}`}
                        onClick={() => setSortKey('alias')}
                        aria-sort={sortKey === 'alias' ? 'ascending' : 'none'}
                      >
                        Alias <span className="th-hint">editable</span>
                        {sortKey === 'alias' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th style={{ width: '22%' }}>Protocols</th>
                      <th style={{ width: '14%' }}>Status</th>
                      <th
                        style={{ width: '12%' }}
                        className={`th-sortable ${sortKey === 'created' ? 'active' : ''}`}
                        onClick={() => setSortKey('created')}
                        aria-sort={sortKey === 'created' ? 'descending' : 'none'}
                      >
                        Created
                        {sortKey === 'created' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th
                        style={{ width: '16%' }}
                        className={`th-sortable ${sortKey === 'last_used' ? 'active' : ''}`}
                        onClick={() => setSortKey('last_used')}
                        aria-sort={sortKey === 'last_used' ? 'descending' : 'none'}
                      >
                        Last used
                        {sortKey === 'last_used' && <span className="th-sort-arrow">↓</span>}
                      </th>
                      <th style={{ width: 130, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGroups.map((g) => {
                      const collapsed = collapsedGroups.has(g.provider);
                      const personalCount = g.records.filter((r) => r.target === 'personal').length;
                      const oauthCount = g.records.filter((r) => r.target === 'oauth').length;
                      return (
                        <React.Fragment key={g.provider}>
                          <GroupHeaderRow
                            provider={g.provider}
                            color={g.color}
                            totalCount={g.records.length}
                            personalCount={personalCount}
                            oauthCount={oauthCount}
                            collapsed={collapsed}
                            onToggle={() => toggleGroup(g.provider)}
                          />
                          {g.records.map((r, idx) => {
                            const k = rowKey(r);
                            return (
                              <Row
                                key={k}
                                record={r}
                                locked={!unlocked}
                                isEditing={editingId === k}
                                editDraft={editDraft}
                                onEditDraftChange={setEditDraft}
                                onBeginEdit={() => beginEdit(r)}
                                onCancelEdit={cancelEdit}
                                onSaveEdit={() => saveEdit(r)}
                                renamePending={renameMut.isPending}
                                isDeleting={deletingId === k}
                                onBeginDelete={() => setDeletingId(k)}
                                onCancelDelete={() => setDeletingId(null)}
                                onConfirmDelete={() => confirmDelete(r)}
                                deletePending={deleteMut.isPending}
                                onOpenDrawer={(mode) => {
                                  setDrawerRecord(r);
                                  setDrawerMode(mode ?? 'persistent');
                                }}
                                isLastInGroup={idx === g.records.length - 1}
                                isGroupCollapsed={collapsed}
                                switchPending={switchingIds.has(k)}
                                justSwitched={justSwitchedIds.has(k)}
                                onSwitch={() => switchTo(r)}
                              />
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <CardFooter
              pageKeyCount={pageKeyCount}
              filteredCount={filtered.length}
              totalCount={counts.total}
              currentPage={currentPage}
              totalPages={totalPages}
              groupsPerPage={GROUPS_PER_PAGE}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            />
          </section>

          <PageFooter />
        </div>
      </div>

      {addOpen && (
        <AddKeyModal
          onClose={() => setAddOpen(false)}
          onSubmitPersonal={(payload) =>
            addMut.mutateAsync(payload).then(() => setAddOpen(false))
          }
          pending={addMut.isPending}
        />
      )}

      {drawerRecord && (
        <DetailDrawer
          record={drawerRecord}
          locked={!unlocked}
          onClose={() => setDrawerRecord(null)}
          onBeginRename={() => {
            beginEdit(drawerRecord);
            setDrawerRecord(null);
          }}
          onDelete={() => {
            setDeletingId(rowKey(drawerRecord));
            setDrawerRecord(null);
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ── Identity strip ───────────────────────────────────────────────────────

function IdentityStrip({
  counts,
  onRefresh,
  updatedAgo,
}: {
  counts: { personal: number; oauth: number; team: number; total: number };
  onRefresh: () => void;
  updatedAgo: string;
}) {
  return (
    <section className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          <ShieldIcon className="w-4 h-4" style={{ color: 'var(--primary)' }} />
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold font-mono tracking-wide truncate" style={{ color: 'var(--foreground)' }}>My Vault</div>
          <div
            className="flex items-center gap-2 text-[11px] font-mono"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <span>{counts.total} KEYS</span>
            <span className="opacity-40">·</span>
            <span>{counts.personal} PERSONAL</span>
            <span className="opacity-40">·</span>
            <span>{counts.oauth} OAUTH</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="text-[12px] font-mono flex items-center gap-1.5"
          style={{ color: 'var(--muted-foreground)' }}
          title="Last refreshed"
        >
          <RefreshIcon className="w-3 h-3" />
          Updated {updatedAgo}
        </span>
        <button
          className="btn btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
          onClick={onRefresh}
          title="Refresh"
          aria-label="Refresh"
        >
          <RotateIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </section>
  );
}

// ── Unlock banner ────────────────────────────────────────────────────────

function UnlockBanner(props: {
  unlocked: boolean;
  /** Raw TTL seconds from the latest `/vault/status` response. The
   *  banner owns the per-second countdown internally so the page
   *  doesn't re-render every tick — that change fixes a scroll-jank
   *  regression where all Rows / metrics were rebuilt each second. */
  ttlSeconds: number | null;
  password: string;
  onPasswordChange: (s: string) => void;
  onUnlock: () => void;
  unlockPending: boolean;
  unlockError: string | null;
  onLock: () => void;
}) {
  // Local tick state — isolated here so only this component re-renders
  // each second. Starts fresh whenever the parent hands us a new
  // ttlSeconds (happens on unlock, on mutations that extend, and on
  // the /vault/status poll every 10s).
  const [remaining, setRemaining] = useState<number | null>(props.ttlSeconds);
  useEffect(() => {
    setRemaining(props.ttlSeconds);
  }, [props.ttlSeconds]);
  useEffect(() => {
    if (!props.unlocked || remaining === null) return;
    const id = setInterval(() => {
      setRemaining((s) => (s === null || s <= 0 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [props.unlocked, remaining === null]);

  // Locked banner is collapsed by default — matches the /user/import
  // layout so the two pages feel like siblings. Clicking UNLOCK expands
  // the inline password form; Cancel collapses it back.
  const [expanded, setExpanded] = useState(false);
  // Auto-collapse whenever the caller transitions to unlocked so the
  // next lock cycle starts from the collapsed state.
  useEffect(() => {
    if (props.unlocked) setExpanded(false);
  }, [props.unlocked]);

  if (props.unlocked) {
    return (
      <div className="unlock-banner">
        <span className="dot" aria-hidden="true" />
        <LockOpenIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
        {/* Casing aligned 2026-04-24 with the locked-banner structure:
            uppercase bold status label + em-dash + sentence-case
            descriptive clause. Previously the outer span had `uppercase`
            applied to the whole line, which turned the auto-lock
            countdown ("AUTO-LOCK IN 14M 55S") into shouty status copy
            and broke the locked/unlocked typographic parity. */}
        <span className="flex-1 flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-sm font-bold uppercase tracking-wider"
            style={{ color: 'var(--foreground)' }}
          >
            Vault Unlocked
          </span>
          {remaining !== null && (
            <span
              className="text-xs font-mono truncate"
              style={{ color: 'var(--muted-foreground)' }}
            >
              — auto-lock in{' '}
              <span style={{ color: 'var(--foreground)' }}>
                {Math.floor(remaining / 60)}m{' '}
                {String(remaining % 60).padStart(2, '0')}s
              </span>
            </span>
          )}
        </span>
        <button
          className="btn btn-outline text-[11px] px-2.5 py-1 flex items-center gap-1"
          onClick={props.onLock}
        >
          <LockIcon className="w-3 h-3" />
          Lock now
        </button>
      </div>
    );
  }
  return (
    <div className="unlock-banner locked">
      <LockIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
      {/* Casing + structure aligned with /user/import's Vault Locked
          banner (2026-04-24): uppercase bold status label + sentence-
          case descriptive clause separated by an em-dash. Matches the
          sibling-page voice instead of the earlier all-caps string. */}
      <span className="flex-1 flex items-center gap-2 min-w-0">
        <span
          className="font-mono text-sm font-bold uppercase tracking-wider"
          style={{ color: 'var(--foreground)' }}
        >
          Vault Locked
        </span>
        <span
          className="text-xs font-mono truncate"
          style={{ color: 'var(--muted-foreground)' }}
        >
          — Unlock with Master Password to edit or add keys
        </span>
      </span>
      {!expanded ? (
        // Collapsed default — mirrors /user/import. Only a single
        // UNLOCK button; the password field stays hidden until the user
        // commits to unlocking.
        <button
          className="btn btn-primary px-4 py-1.5 text-[11px]"
          onClick={() => setExpanded(true)}
        >
          UNLOCK
        </button>
      ) : (
        <div className="flex flex-col items-end gap-1.5">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              props.onUnlock();
            }}
          >
            <input
              type="password"
              className="field-input"
              placeholder="Master password"
              style={{ width: 220 }}
              value={props.password}
              onChange={(e) => props.onPasswordChange(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary px-3 py-1.5 text-[11px]"
              disabled={props.unlockPending || !props.password}
            >
              {props.unlockPending ? 'UNLOCKING…' : 'UNLOCK'}
            </button>
            <button
              type="button"
              className="btn btn-ghost text-[11px] px-2 py-1.5"
              onClick={() => {
                setExpanded(false);
                props.onPasswordChange('');
              }}
            >
              Cancel
            </button>
          </form>
          {props.unlockError && (
            <span
              className="text-[11px] font-mono"
              style={{ color: '#fca5a5' }}
            >
              {props.unlockError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}


function formatCompactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Card header ──────────────────────────────────────────────────────────

function CardHeader({
  counts,
  activeCount,
  errorCount,
}: {
  counts: { personal: number; oauth: number; team: number; total: number };
  activeCount: number;
  errorCount: number;
}) {
  return (
    <div
      className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap"
      style={{
        borderBottom: '1px solid var(--border)',
        /* Darker header band matches master pages' inner-card header
           (e.g. pages/master/orgs/virtual-keys — `rgba(0,0,0,0.2)`
           over var(--card)). Gives the table body the same
           "lighter panel / darker lid" hierarchy master uses. */
        backgroundColor: 'rgba(0,0,0,0.2)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        <h3 className="text-xs font-mono font-bold tracking-wider uppercase whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>All keys</h3>
        <span className="chip">{counts.total} stored</span>
        {activeCount > 0 && (
          <span className="chip success">
            <span className="status-dot" style={{ width: 5, height: 5 }} />
            {activeCount} active
          </span>
        )}
        {errorCount > 0 && (
          <span className="chip danger">
            <span className="status-dot error" style={{ width: 5, height: 5 }} />
            {errorCount} error
          </span>
        )}
      </div>
      {/* Removed 2026-04-24 per user request:
          - "ROUTING · N PROVIDERS" chip + its RoutePopover (per-row
            Use button + drawer "Route via this key" already cover the
            same action surface).
          - Export button (placeholder for a v1.0 feature that never
            landed).
          Import + Add key buttons moved 2026-04-25 to the FilterStrip
          toolbar above the card — master pages keep filters + actions
          together in the top toolbar. */}
    </div>
  );
}

// ── Filter strip ─────────────────────────────────────────────────────────

function FilterStrip(props: {
  search: string;
  onSearchChange: (s: string) => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (v: TypeFilter) => void;
  counts: { personal: number; oauth: number; team: number; total: number };
  locked: boolean;
  onOpenAdd: () => void;
}) {
  return (
    <div
      /* FilterStrip follows master's FilterBar layout (naked toolbar,
         no frame / no bg, left-aligned, right-side controls via
         ml-auto). Sizes bumped 2026-04-25 so the toolbar feels
         generous rather than cramped — master uses w-52 / py-1.5 /
         text-xs which reads tiny against a full vault table, so here
         we upsize to w-72 / py-2 / text-sm while keeping the same
         structure.
         Import + Add key CTAs moved here from CardHeader 2026-04-25
         per UX — top toolbar is master's standard "filters + actions"
         pattern (search / pills on the left, action buttons on the
         ml-auto right). */
      className="flex items-center gap-4 flex-wrap"
    >
      <div className="flex items-center gap-4 flex-wrap min-w-0">
        <div className="relative">
          <SearchIcon
            className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--muted-foreground)' }}
          />
          <input
            type="text"
            className="pl-10 pr-3 py-2 text-sm w-72"
            placeholder="Search alias…"
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            aria-label="Search keys"
          />
        </div>

        {/* Type filter — segmented capsule. Status filter removed
            2026-04-24 (near-all keys are active in practice, row-
            level status chip carries the signal when an error shows
            up). The "Type" label prefix was removed 2026-04-25 — the
            All/API/OAuth pill labels already read as type filters. */}
        <div className="filter-group" role="radiogroup" aria-label="Filter by type">
          <FilterPill
            active={props.typeFilter === 'all'}
            onClick={() => props.onTypeFilterChange('all')}
            label="All"
            count={props.counts.total}
          />
          <FilterPill
            active={props.typeFilter === 'personal'}
            onClick={() => props.onTypeFilterChange('personal')}
            icon={<KeyRoundIcon className="w-2.5 h-2.5" />}
            label="Key"
            count={props.counts.personal}
          />
          <FilterPill
            active={props.typeFilter === 'oauth'}
            onClick={() => props.onTypeFilterChange('oauth')}
            icon={<UserCheckIcon className="w-2.5 h-2.5" />}
            label="OAuth"
            count={props.counts.oauth}
          />
        </div>
      </div>

      {/* Right-aligned actions. Sort tabs were moved into the table's
          <thead> 2026-04-25 — column headers themselves are now click-
          to-sort. Import + Add key fill that ml-auto slot now. */}
      <div className="flex items-center gap-4 ml-auto flex-shrink-0">
        {/* Gap between Import and Add key doubled (gap-2 → gap-4)
            2026-04-25 so the two CTAs don't read as a single lump. */}
        <a
          className="btn btn-outline text-[11px] px-2.5 py-1 flex items-center gap-1"
          href="/user/import"
          title="Bulk import from text or file"
        >
          <UploadIcon className="w-3 h-3" />
          Import
        </a>
        <button
          className="btn btn-primary btn-primary-dim text-[11px] px-3 py-1 flex items-center gap-1"
          onClick={props.onOpenAdd}
          disabled={props.locked}
          title={props.locked ? 'Unlock vault to add keys' : 'Add a new key'}
        >
          <PlusIcon className="w-3 h-3" />
          Add key
        </button>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button className={`filter-pill${active ? ' active' : ''}`} onClick={onClick}>
      {icon}
      {label}
      {typeof count === 'number' && <span className="count">{count}</span>}
    </button>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────

// React.memo: 20+ rows × Provider chip + chips + icons don't need to
// re-diff on unrelated parent state (filter changes, drawer open, etc.)
// as long as THIS row's props are unchanged. Major scroll-smoothness
// win since the page already re-renders on poll beats.

// ── Toast stack ──────────────────────────────────────────────────────
//
// Bottom-center stack for routing-switch feedback. Each toast has a 5s
// timer (CSS animation); the stack removes its entry via `onDismiss`.
function ToastStack(props: {
  toasts: Array<{
    id: number;
    kind: 'success' | 'error';
    title: string;
    sub?: string;
    undo?: () => void;
  }>;
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {props.toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' error' : ''}`} data-open="true">
          <span className="toast-icon">
            {t.kind === 'success' ? (
              <ZapIcon className="w-3 h-3" />
            ) : (
              <InfoIcon className="w-3 h-3" />
            )}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.sub && <div className="toast-sub">{t.sub}</div>}
          </div>
          <div className="toast-actions">
            {t.undo && (
              <button
                type="button"
                className="toast-undo"
                onClick={() => {
                  t.undo!();
                  props.onDismiss(t.id);
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => props.onDismiss(t.id)}
              aria-label="Dismiss"
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
          <span className="toast-timer" />
        </div>
      ))}
    </div>
  );
}

// ── Group header row ─────────────────────────────────────────────────
//
// Renders a single <tr.group-row> spanning all table columns. Shows the
// provider name + entry count. Click the chevron button to collapse /
// expand the group's children (state lives in parent; this component
// only fires onToggle). The prior right-side ROUTING chip was removed
// 2026-04-24 per user request — per-row .in-use marker (yellow tint +
// IN USE pill on the active child) carries the same info without
// duplicating it at the group level.
function GroupHeaderRow(props: {
  provider: string;
  color: string;
  totalCount: number;
  personalCount: number;
  oauthCount: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { provider, color, totalCount, personalCount, oauthCount, collapsed, onToggle } = props;
  const parts: string[] = [];
  if (personalCount > 0) parts.push(`${personalCount} KEY`);
  if (oauthCount > 0) parts.push(`${oauthCount} OAUTH`);
  const entryWord = totalCount === 1 ? 'entry' : 'entries';
  return (
    <tr className="group-row" data-collapsed={collapsed ? 'true' : 'false'} data-group-provider={provider}>
      <td colSpan={6}>
        <div className="gr-inner">
          <button
            type="button"
            className="gr-toggle"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={`Toggle ${provider} group`}
          >
            <ChevronDownIcon className="w-3 h-3" />
          </button>
          <span className="gr-dot" style={{ background: color }} aria-hidden="true" />
          <span className="gr-name">{provider}</span>
          <span className="gr-meta">
            · {totalCount} {entryWord}
            {parts.length > 0 && (
              <>
                <span className="gr-sep">·</span>
                {parts.map((p, i) => (
                  <React.Fragment key={p}>
                    {p}
                    {i < parts.length - 1 && <span className="gr-sep">·</span>}
                  </React.Fragment>
                ))}
              </>
            )}
          </span>
        </div>
      </td>
    </tr>
  );
}

const Row = React.memo(function Row(props: {
  record: VaultRecord;
  locked: boolean;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange: (v: string) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  renamePending: boolean;
  isDeleting: boolean;
  onBeginDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  deletePending: boolean;
  /** Opens the DetailDrawer. `mode` defaults to 'persistent'; 'peek'
   *  is used by row-level / IN-USE-chip clicks so the drawer auto-closes
   *  when the user scrolls past it (see VaultPage drawerMode). */
  onOpenDrawer: (mode?: 'persistent' | 'peek') => void;
  /** True when this row is the last under its group header — controls the
   *  tree-indent connector ending for the tr.group-child::before pseudo. */
  isLastInGroup?: boolean;
  /** True when the group this row belongs to is collapsed — hide the row
   *  via .group-hidden class while keeping it in the DOM for scroll stability. */
  isGroupCollapsed?: boolean;
  /** Pending UI state for the Use button — disables + shows progress cursor. */
  switchPending?: boolean;
  /** Briefly apply .just-switched for the route-pulse keyframe animation
   *  after a successful switch (600ms). Parent sets then clears this prop. */
  justSwitched?: boolean;
  onSwitch?: () => void;
}) {
  const r = props.record;
  const lockedTitle = props.locked ? 'Unlock vault to use this action' : undefined;
  const providerName = providerDisplayName(r);
  const isOAuth = r.target === 'oauth';
  const aliasMono = isMonoAlias(r.alias);

  // Secondary alias line: route_token tail + contextual hint.
  const rtTail = shortRouteToken(
    r.target === 'personal'
      ? (r as PersonalVaultRecord).route_token
      : null,
  );
  let subLine: React.ReactNode;
  if (r.target === 'personal') {
    const p = r as PersonalVaultRecord;
    subLine = (
      <>
        {rtTail ?? ''}
        {rtTail && p.provider_code && <span className="mx-1 opacity-40">·</span>}
        {p.provider_code && <span>{p.provider_code}</span>}
      </>
    );
  } else {
    const o = r as OAuthVaultRecord;
    const expires = formatExpiresIn(o.token_expires_at);
    subLine = (
      <>
        {providerName} session
        {expires && (
          <>
            <span className="mx-1 opacity-40">·</span>
            <span>{expires}</span>
          </>
        )}
      </>
    );
  }

  const trClasses = [
    'group-child',
    'row-clickable',
    props.isLastInGroup ? 'last-in-group' : '',
    props.isGroupCollapsed ? 'group-hidden' : '',
    r.in_use === true ? 'in-use' : '',
    props.justSwitched ? 'just-switched' : '',
  ].filter(Boolean).join(' ');

  // Row-level click opens the detail drawer (2026-04-24 user request:
  // "non in-use rows should also open a drawer showing Route via this
  // key hint + aikey activate CTA"). Skip when the click landed on an
  // interactive descendant — inline action buttons, the alias edit
  // input, etc. — so each cell-level action keeps its own semantics.
  const onRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, input, textarea, a, [role="button"]')) return;
    // Row-level open is a "peek" — casual click while scanning; the
    // drawer auto-closes on scroll so it doesn't linger.
    props.onOpenDrawer('peek');
  };

  return (
    <tr className={trClasses} onClick={onRowClick}>
      <td>
        {props.isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              className="inline-input"
              autoFocus
              value={props.editDraft}
              onChange={(e) => props.onEditDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onSaveEdit();
                if (e.key === 'Escape') props.onCancelEdit();
              }}
              style={{ width: 220 }}
            />
            <button
              className="btn btn-primary text-[10px] px-2 py-0.5 flex items-center"
              onClick={props.onSaveEdit}
              disabled={props.renamePending}
              title="Save alias"
            >
              <CheckIcon className="w-3 h-3" />
            </button>
            <button
              className="btn btn-ghost text-[10px] px-1.5 py-0.5 flex items-center"
              onClick={props.onCancelEdit}
              title="Cancel"
            >
              <XIcon className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <div
              className={`alias-main${aliasMono ? ' mono' : ''}`}
              style={r.alias ? undefined : { color: 'var(--muted-foreground)', fontStyle: 'italic' }}
            >
              {r.in_use === true && (
                /* CLI-style "active" dot — mirrors the green ● aikey
                   route prints next to the currently-routing row so
                   web and terminal read as one visual system. Placed
                   before the alias text, sibling to the IN USE chip. */
                <span
                  className="active-dot"
                  aria-hidden="true"
                  title="Currently routing"
                />
              )}
              {r.alias || '(unnamed)'}
              {/* IN USE chip moved to the Actions column (2026-04-25)
                  so every row's rightmost cell has the same routing
                  affordance — a "Use" button when the key is idle,
                  an "IN USE" chip when it's already the active route.
                  The green ● left of the alias retains the inline
                  signal; this keeps alias-cell tidy and the status
                  legible in the column users scan for actions. */}
            </div>
            <div className="alias-sub">{subLine}</div>
          </>
        )}
      </td>

      <td>
        <span className="provider-cell">
          <span
            className="prov-dot"
            style={{ background: providerBrandColor(providerName) }}
            aria-hidden="true"
          />
          <span className="name">{providerName}</span>
          <span className={`kind-pill${isOAuth ? ' oauth' : ''}`}>
            {isOAuth ? 'OAUTH' : 'KEY'}
          </span>
        </span>
      </td>

      <td>
        {r.status === 'active' ? (
          <span className="chip success">
            <span className="status-dot" style={{ width: 5, height: 5 }} />
            ACTIVE
          </span>
        ) : (
          <span className="chip danger">
            <span className="status-dot error" style={{ width: 5, height: 5 }} />
            {String(r.status).toUpperCase()}
          </span>
        )}
      </td>

      <td
        className="font-mono text-[11.5px]"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {formatCreatedShort(r.created_at)}
      </td>

      <td>
        {/* Last-used telemetry isn't wired up yet (v1.0 ships without
            per-key usage tracking), so every row currently ends up as
            "never / 0 uses" which reads as noise. Until the feature
            lands, collapse the cell to a single muted em-dash when
            there's no real signal — keeps the column present for
            future expansion but stops shouting placeholder text. */}
        {r.last_used_at ? (
          <>
            <div className="text-[12px]">{formatRelative(r.last_used_at)}</div>
            <div
              className="text-[11px] font-mono"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {r.use_count > 0 ? `${formatCompactNumber(r.use_count)} uses` : '0 uses'}
            </div>
          </>
        ) : (
          <div
            className="text-[12px]"
            style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}
          >
            —
          </div>
        )}
      </td>

      <td style={{ textAlign: 'right' }}>
        {props.isDeleting ? (
          <div className="flex items-center gap-1 justify-end">
            <span
              className="text-[11px] font-mono mr-1"
              style={{ color: '#fca5a5' }}
            >
              Delete forever?
            </span>
            <button
              className="btn btn-danger text-[10px] px-2.5 py-1"
              onClick={props.onConfirmDelete}
              disabled={props.deletePending || props.locked}
              title={
                props.locked
                  ? 'Unlock vault to delete'
                  : props.deletePending
                  ? 'Deleting…'
                  : 'Confirm delete'
              }
            >
              Delete
            </button>
            <button
              className="btn btn-ghost text-[10px] px-2 py-1"
              onClick={props.onCancelDelete}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="row-actions">
            {/* Same cell, two states:
                  • in_use:false → "Use" switcher button (unchanged action)
                  • in_use:true  → "IN USE" chip (clickable, opens drawer
                                   in peek mode with shell-usage hint)
                Keeping both variants in the same slot means the user's
                eye scans one column for "is this routing? can I make
                it route?" rather than hunting across alias + actions
                cells. */}
            {props.onSwitch && r.in_use !== true && (
              <button
                type="button"
                className="row-use-btn"
                title={
                  props.locked
                    ? 'Unlock vault to switch routing'
                    : 'Route all requests through ' + (r.alias ?? '(unnamed)') + '  (aikey use)'
                }
                onClick={props.onSwitch}
                disabled={props.locked || !!props.switchPending}
                aria-label="Set as active key"
              >
                <ZapIcon className="w-3 h-3" />
                Use
              </button>
            )}
            {r.in_use === true && (
              <button
                type="button"
                className="in-use-chip"
                title="Click to see how to use this account in a shell"
                aria-label="Currently in use — click to see shell usage"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenDrawer('peek');
                }}
              >
                <ZapIcon className="w-2.5 h-2.5" />
                IN USE
              </button>
            )}
            <button
              className="icon-btn"
              title="View details"
              onClick={(e) => {
                e.stopPropagation();
                // Explicit View Details → persistent drawer (stays open
                // while the user scrolls / explores the list).
                props.onOpenDrawer('persistent');
              }}
            >
              <EyeIcon className="w-3.5 h-3.5" />
            </button>
            <button
              className="icon-btn primary"
              title={lockedTitle ?? 'Rename alias'}
              onClick={props.onBeginEdit}
              disabled={props.locked}
            >
              <EditIcon className="w-3.5 h-3.5" />
            </button>
            <button
              className="icon-btn danger"
              title={lockedTitle ?? 'Delete'}
              onClick={props.onBeginDelete}
              disabled={props.locked}
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
},
// Custom compare: the call site passes inline arrow callbacks, so the
// default shallow compare would always fail and memo would be a no-op.
// We intentionally ignore the callback props — closures capture the
// `record` and parent state references, and since `record` equality
// gates re-render, any callback that needs fresh data will see it on
// the render triggered by a record-change.
(prev, next) => {
  if (prev.record !== next.record) return false;
  if (prev.locked !== next.locked) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.isDeleting !== next.isDeleting) return false;
  if (prev.renamePending !== next.renamePending) return false;
  if (prev.deletePending !== next.deletePending) return false;
  if (prev.isLastInGroup !== next.isLastInGroup) return false;
  if (prev.isGroupCollapsed !== next.isGroupCollapsed) return false;
  if (prev.switchPending !== next.switchPending) return false;
  if (prev.justSwitched !== next.justSwitched) return false;
  // editDraft only matters when this row is the one being edited.
  if (next.isEditing && prev.editDraft !== next.editDraft) return false;
  return true;
});

// ── Card footer ──────────────────────────────────────────────────────────

function CardFooter({
  pageKeyCount,
  filteredCount,
  totalCount,
  currentPage,
  totalPages,
  groupsPerPage,
  onPrev,
  onNext,
}: {
  /** Keys rendered on the current page (after group-based slicing). */
  pageKeyCount: number;
  /** Keys matching the current search/filter, across all pages. */
  filteredCount: number;
  /** Keys stored in the vault in total (pre-filter). */
  totalCount: number;
  currentPage: number;
  totalPages: number;
  groupsPerPage: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  // Count copy is context-aware:
  // - multi-page: "Showing N on this page · M filtered · Y total"
  // - single-page, filtered: "Showing N of Y keys" (same as pre-pagination)
  // - single-page, unfiltered: "Showing N of Y keys" (same as pre-pagination)
  // The two-level counter avoids lying when pagination hides keys.
  return (
    <div
      className="px-5 py-2.5 flex items-center justify-between text-[12px] font-mono gap-4 flex-wrap"
      style={{
        borderTop: '1px solid var(--border)',
        color: 'var(--muted-foreground)',
        /* Same dark overlay as the top CardHeader — mirrored "top/
           bottom lid" so the tbody reads as the lighter content band
           between. Was var(--surface-1) which looked like an odd
           dark strip; the overlay matches master's rhythm. */
        background: 'rgba(0,0,0,0.2)',
      }}
    >
      <span>
        {totalPages > 1 ? (
          <>
            Showing <span style={{ color: 'var(--foreground)' }}>{pageKeyCount}</span> on this page ·{' '}
            <span style={{ color: 'var(--foreground)' }}>{filteredCount}</span> filtered ·{' '}
            <span style={{ color: 'var(--foreground)' }}>{totalCount}</span> total
          </>
        ) : (
          <>
            Showing <span style={{ color: 'var(--foreground)' }}>{filteredCount}</span> of{' '}
            <span style={{ color: 'var(--foreground)' }}>{totalCount}</span> keys
          </>
        )}
      </span>
      {/* Real pagination (2026-04-24): slicing happens by PROTOCOL GROUP,
          not by row — so a group header never appears twice or gets its
          children split across pages. groupsPerPage=3 in the default
          configuration; tune via the constant at the top of VaultPage. */}
      <div className="flex items-center gap-2">
        <button
          className="btn btn-ghost text-[10px] px-2 py-1"
          onClick={onPrev}
          disabled={prevDisabled}
          title={prevDisabled ? 'Already on the first page' : 'Previous page'}
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="w-3 h-3" />
          Prev
        </button>
        <span title={`${groupsPerPage} provider group${groupsPerPage === 1 ? '' : 's'} per page`}>
          Page <span style={{ color: 'var(--foreground)' }}>{currentPage}</span> /{' '}
          <span style={{ color: 'var(--foreground)' }}>{totalPages}</span>
        </span>
        <button
          className="btn btn-ghost text-[10px] px-2 py-1"
          onClick={onNext}
          disabled={nextDisabled}
          title={nextDisabled ? 'No more pages' : 'Next page'}
          aria-label="Next page"
        >
          Next
          <ChevronRightIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Page footer ──────────────────────────────────────────────────────────

function PageFooter() {
  return (
    <section
      className="flex flex-col gap-2 text-[12px] font-mono pt-1 pb-6"
      style={{ color: 'var(--muted-foreground)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/user/cli-guide" className="hover:text-[color:var(--foreground)] flex items-center gap-1.5">
            <BookOpenIcon className="w-3 h-3" />
            Docs
          </a>
          <a href="#" className="hover:text-[color:var(--foreground)] flex items-center gap-1.5">
            <LifeBuoyIcon className="w-3 h-3" />
            Support
          </a>
          <a href="#" className="hover:text-[color:var(--foreground)] flex items-center gap-1.5">
            <ShieldCheckIcon className="w-3 h-3" />
            Security
          </a>
        </div>
        <span>control-vault</span>
      </div>
      {/*
        Why a footer encryption disclosure on the vault page (2026-04-22):
        Users land here after typing their master password and reasonably ask
        "is this thing actually secure?". Naming the primitives in plain text
        makes the security model auditable at a glance — Argon2id for the
        password-to-key derivation, AES-256-GCM for at-rest authenticated
        encryption of every vault entry. "Never leaves this device" is the
        privacy claim: master password material never crosses the network
        and is never written to disk in any reversible form (the only
        long-lived artefact is the public Argon2 hash).

        Tone (2026-04-27): replaced the param-explicit form
        "Argon2id (m=64 MiB, t=3, p=4)" with "Defense-in-depth" framing.
        The numeric params are accurate but they read as documentation,
        not assurance. Industry terms ("authenticated encryption",
        "key derivation", "defense-in-depth") signal authority while
        staying technically faithful — exact params are still discoverable
        in VAULT_SPEC.md and the storage module for security reviewers.
      */}
      <div className="flex items-center gap-1.5 text-[11px] opacity-80">
        <LockIcon className="w-3 h-3" />
        <span>
          Defense-in-depth vault —{' '}
          <span style={{ color: 'var(--foreground)' }}>AES-256-GCM</span> authenticated encryption ·{' '}
          <span style={{ color: 'var(--foreground)' }}>Argon2id</span> key derivation · master password never leaves this device.
        </span>
      </div>
    </section>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <span className="text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
        {message}
      </span>
    </div>
  );
}

// Full-pane empty panel — rendered when the vault holds zero records.
// Visual parity with /user/virtual-keys' tk-empty card (key-in-ring +
// title + description + Import link) so the two "no keys" states read
// as a family. Description is vault-specific: only points at the Import
// page (no "ask admin" alternative, since the vault is the user's own
// local store).
function VaultEmptyPanel() {
  return (
    <div className="flex p-7">
      <div className="vault-empty">
        <div className="vault-empty-ring">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        </div>
        <div className="vault-empty-title">Your vault is empty</div>
        <p className="vault-empty-desc">
          Get started by importing your keys from the{' '}
          <Link to="/user/import" className="vault-empty-link">Import</Link> page.
        </p>
      </div>
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────

function DetailDrawer(props: {
  record: VaultRecord;
  locked: boolean;
  onClose: () => void;
  onBeginRename: () => void;
  onDelete: () => void;
}) {
  const r = props.record;
  // `copiedField` drives the check-icon flash on any drawer copy button
  // (base_url, route token, CLI reveal command). A single slot is enough
  // because the buttons are mutually exclusive — clicking a second one
  // immediately reassigns the flash to the new field. Cleared after ~1.2s
  // via setTimeout.
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  // Reveal-via-HTTP (setRevealed / doReveal / 60s auto-mask) removed
  // 2026-04-24 (security review round 2): plaintext never crosses the
  // browser boundary. The Secret row below shows only masked prefix/suffix
  // from the unlocked list response; the CLI command box provides the
  // one-path-to-plaintext route.

  function copy(text: string) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
  }

  // Copy + 1.2s check-icon flash for drawer field copy buttons. The
  // `fieldKey` identifies which button should light up (base_url vs
  // route_token vs …) so simultaneous buttons don't cross-flash.
  function copyField(fieldKey: string, text: string) {
    copy(text);
    setCopiedField(fieldKey);
    window.setTimeout(
      () => setCopiedField((k) => (k === fieldKey ? null : k)),
      1200,
    );
  }

  const alias = r.alias ?? (r.target === 'oauth' ? '(unnamed OAuth account)' : '(unnamed)');
  const aliasMono = isMonoAlias(r.alias);
  const lockedTitle = props.locked ? 'Unlock vault to use this action' : undefined;
  const isPersonal = r.target === 'personal';
  const personal = isPersonal ? (r as PersonalVaultRecord) : null;
  const oauth = !isPersonal ? (r as OAuthVaultRecord) : null;
  const providerName = providerDisplayName(r);

  return (
    <>
      <div className="drawer-overlay" data-open="true" onClick={props.onClose} />
      <aside className="drawer" data-open="true" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="content">
            <div className={`alias-title${aliasMono ? ' mono' : ''}`}>{alias}</div>
            <div className="meta-row">
              <span className="provider-cell">
                <span
                  className="prov-dot"
                  style={{ background: providerBrandColor(providerName) }}
                />
                <span
                  className="name font-mono"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  {providerName}
                </span>
                <span className={`kind-pill${!isPersonal ? ' oauth' : ''}`}>
                  {isPersonal ? 'KEY' : 'OAUTH'}
                </span>
              </span>
              {r.status === 'active' ? (
                <span className="chip success">
                  <span className="status-dot" style={{ width: 5, height: 5 }} />
                  ACTIVE
                </span>
              ) : (
                <span className="chip danger">
                  <span className="status-dot error" style={{ width: 5, height: 5 }} />
                  {String(r.status).toUpperCase()}
                </span>
              )}
            </div>
          </div>
          <button
            className="drawer-close"
            onClick={props.onClose}
            title="Close (Esc)"
            aria-label="Close drawer"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="drawer-body">
          {/* Credential */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <KeyRoundIcon className="w-3 h-3" />
              Credential
            </div>
            <div className="drawer-field">
              <span className="k">Alias</span>
              <span className="v">
                {alias}
                <span className="ro-pill">EDITABLE</span>
              </span>
            </div>
            {isPersonal && personal && (
              <>
                {/* Provider + Type removed from Credential 2026-04-24 —
                    the drawer header meta-row already shows the provider
                    chip + KEY/OAUTH kind pill + status chip. Duplicating
                    the same facts a row below just pushed the actionable
                    Credential fields (Secret / base_url / route_url /
                    Route token) further down. Moved to Meta so detail-
                    hunters can still find them without cluttering the
                    hero area.

                    (The wrapping `{isPersonal && personal && (<>...</>)}`
                    stays — Secret / base_url / route_url etc. below
                    still depend on `personal` being non-null.) */}
                <div className="drawer-field">
                  <span className="k">Secret</span>
                  <span className="v" style={{ width: '100%' }}>
                    {/* Masked-only display. The Web UI no longer reveals
                        plaintext — plaintext never crosses the HTTP surface
                        (2026-04-24 security review round 2). See the "Get
                        via CLI" row below for the one path to plaintext. */}
                    <div className="secret-view masked" style={{ width: '100%' }}>
                      <div className="plain">
                        {personal.secret_prefix === null ? (
                          <span className="mid">{'•'.repeat(24)}</span>
                        ) : (
                          <>
                            <span className="prefix">{personal.secret_prefix}</span>
                            <span className="mid">
                              {'•'.repeat(
                                Math.max(
                                  8,
                                  Math.min(
                                    24,
                                    (personal.secret_len ?? 16) -
                                      personal.secret_prefix.length -
                                      (personal.secret_suffix?.length ?? 0),
                                  ),
                                ),
                              )}
                            </span>
                            <span className="suffix">{personal.secret_suffix}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </span>
                </div>
                {/* Get-via-CLI: the only remaining path to plaintext. Users
                    click Copy here, paste the command in a terminal, enter
                    their vault password, and `aikey get` places the secret
                    on their clipboard (auto-clears after 30s). Plaintext
                    never crosses the browser. */}
                {(() => {
                  const cliCmd = `aikey get ${r.alias}`;
                  const copied = copiedField === 'cli_get';
                  return (
                    <div className="drawer-field">
                      <span className="k">Get via CLI</span>
                      <span className="v stack">
                        <div className="drawer-tokenbox" tabIndex={0} aria-label="Reveal command">
                          <span className="mono">{cliCmd}</span>
                          <button
                            type="button"
                            className="copy-btn"
                            title="Copy command"
                            aria-label="Copy command"
                            onClick={() => copyField('cli_get', cliCmd)}
                          >
                            {copied ? (
                              <CheckIcon className="w-3.5 h-3.5" />
                            ) : (
                              <ClipboardIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <span className="hint mono dim">
                          Run in terminal · clipboard auto-clears in 30s
                        </span>
                      </span>
                    </div>
                  );
                })()}
                {(() => {
                  // base_url: show the user-supplied URL when present, otherwise
                  // fall back to the provider's recommended default URL sourced
                  // from the CLI's PROVIDER_DEFAULTS registry (`official_base_url`).
                  // Layout: .v.stack (column) + .inline-copy + .hint — lifted
                  // wholesale from user_vault_3_1_1.html template so the "URL
                  // + small ghost copy + lowercase mono hint" rhythm matches
                  // the new drawer design exactly.
                  const effectiveUrl =
                    personal.base_url ?? personal.official_base_url ?? null;
                  const isDefault = !personal.base_url;
                  if (!effectiveUrl) {
                    return (
                      <div className="drawer-field">
                        <span className="k">base_url</span>
                        <span className="v">
                          <span className="mono dim">unknown provider</span>
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div className="drawer-field">
                      <span className="k">base_url</span>
                      {/* Compacted 2026-04-24: URL sits alone on line 1
                          (so long custom URLs still have the full row to
                          wrap), and the hint + copy icon pair up on
                          line 2 — the icon reads as an inline action
                          attached to the hint rather than a floating
                          button next to the URL value. */}
                      <span className="v stack">
                        <span className="mono">{effectiveUrl}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="hint">
                            {isDefault ? 'provider default' : 'custom override'}
                          </span>
                          <button
                            type="button"
                            className="inline-copy"
                            title={isDefault ? 'Copy provider default URL' : 'Copy base_url'}
                            aria-label="Copy base_url"
                            onClick={() => copyField('base_url', effectiveUrl)}
                          >
                            {copiedField === 'base_url' ? (
                              <CheckIcon className="w-3.5 h-3.5" />
                            ) : (
                              <ClipboardIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </span>
                      </span>
                    </div>
                  );
                })()}
                {/* route_url — the aikey-proxy URL clients should actually
                    point at. Mirrors `aikey route` output so users can
                    copy the same value from the drawer without switching
                    to the terminal. Surfaced by CLI
                    `_internal query list_*` as `route_url`; undefined on
                    older CLI builds (graceful fallback: skip the row). */}
                {personal.route_url && (
                  <div className="drawer-field">
                    <span className="k">route_url</span>
                    {/* Same compact layout as base_url (2026-04-24):
                        URL alone on line 1, hint + copy icon together
                        on line 2. Keeps the two URL rows visually
                        consistent. */}
                    <span className="v stack">
                      <span className="mono">{personal.route_url}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="hint">SDK base URL (via aikey-proxy)</span>
                        <button
                          type="button"
                          className="inline-copy"
                          title="Copy route URL (aikey-proxy endpoint)"
                          aria-label="Copy route_url"
                          onClick={() => copyField('route_url', personal.route_url!)}
                        >
                          {copiedField === 'route_url' ? (
                            <CheckIcon className="w-3.5 h-3.5" />
                          ) : (
                            <ClipboardIcon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </span>
                    </span>
                  </div>
                )}
                {personal.route_token && (
                  <div className="drawer-field">
                    <span className="k">Route token</span>
                    {/* .drawer-tokenbox — a <div> (not <textarea>) per the
                        new template. word-break: break-all wraps the full
                        token naturally, corner-anchored .copy-btn sits
                        inside the box's reserved bottom-right padding. */}
                    <span className="v stack">
                      <div className="drawer-tokenbox" tabIndex={0} aria-label="Route token">
                        {personal.route_token}
                        <button
                          type="button"
                          className="copy-btn"
                          title="Copy route token"
                          aria-label="Copy route token"
                          onClick={() => copyField('route_token', personal.route_token!)}
                        >
                          {copiedField === 'route_token' ? (
                            <CheckIcon className="w-3.5 h-3.5" />
                          ) : (
                            <ClipboardIcon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </span>
                  </div>
                )}
              </>
            )}
            {!isPersonal && oauth && (
              <>
                {/* Provider + Type moved to Meta section (2026-04-24) —
                    see the sibling personal-branch comment for
                    rationale. Header meta-row already carries both. */}
                <div className="drawer-field">
                  <span className="k">Identity</span>
                  <span className="v">
                    <MailIcon className="w-3 h-3" />
                    {oauth.display_identity ?? oauth.external_id ?? '(anonymous)'}
                  </span>
                </div>
                {/* Session row removed 2026-04-24 — it was a pure
                    placeholder ("Token never shown in browser") and
                    carried no actionable info for the user; any future
                    session-state detail (expiry, rotation) belongs in
                    the Meta section below next to Expires. */}
                {oauth.org_uuid && (
                  <div className="drawer-field">
                    <span className="k">Org UUID</span>
                    <span className="v mono dim">{oauth.org_uuid}</span>
                  </div>
                )}
                {oauth.account_tier && (
                  <div className="drawer-field">
                    <span className="k">Tier</span>
                    <span className="v">{oauth.account_tier}</span>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Actions — .drawer-actions layout per user_vault_3_1_1.html:
              full-width primary CTA (Route) up top, three secondary
              actions below. Logic is unchanged from the prior block —
              only the visual chrome switched to .action-btn. The new
              "Route via this key" button copies the CLI command
              `aikey activate <alias>` to the clipboard instead of
              triggering a server-side routing switch (safer default:
              user explicitly runs the command when/where they want;
              works even when vault is locked). */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <WrenchIcon className="w-3 h-3" />
              Actions
            </div>
            <div className="drawer-actions">
              {r.alias && (
                <button
                  type="button"
                  className={`action-btn primary-route${r.in_use === true ? ' routing' : ''}`}
                  title={
                    r.in_use === true
                      ? `This key is already routing — command: aikey activate ${r.alias}`
                      : `Copy CLI command: aikey activate ${r.alias}`
                  }
                  onClick={() => copyField('route_cmd', `aikey activate ${r.alias}`)}
                >
                  {copiedField === 'route_cmd' ? (
                    <>
                      <CheckIcon className="w-3.5 h-3.5" />
                      Command copied
                    </>
                  ) : (
                    <>
                      <ZapIcon className="w-3.5 h-3.5" />
                      {r.in_use === true ? 'Routing via this key' : 'Route via this key'}
                    </>
                  )}
                </button>
              )}
              {/* Usage hint for the primary Route CTA — clarifies that
                  the button *copies* a shell command rather than triggering
                  a server-side switch. Sits between the full-width Route
                  button (above) and the three secondary actions (below)
                  so the explanation reads adjacent to the action it
                  describes. Copy style switches post-click:
                    - default: shows the 2-step instruction
                    - after click: shows the exact command the user just
                      copied, so they can verify before pasting */}
              {r.alias && (() => {
                // Two hint lines for in-use keys (shell shortcut is the
                // main thing the user cares about — the Route button is
                // secondary in that case). One hint line for not-in-use
                // keys (primary action is Route itself).
                const shellCmd = providerShellCommand(r.protocol_family ?? null);
                const justCopied = copiedField === 'route_cmd';
                const isInUse = r.in_use === true;
                return (
                  <>
                    {isInUse && shellCmd && (
                      <div className="drawer-actions-hint" role="note">
                        <PlayIcon className="w-3 h-3" />
                        <span>
                          Run <code className="font-mono">{shellCmd}</code> in a terminal — routes via this key.
                        </span>
                      </div>
                    )}
                    <div className="drawer-actions-hint" role="note">
                      {justCopied ? (
                        <>
                          <CheckIcon className="w-3 h-3" />
                          <span>Copied — paste in a terminal.</span>
                        </>
                      ) : isInUse ? (
                        <>
                          <ZapIcon className="w-3 h-3" />
                          <span>
                            Or copy <code className="font-mono">aikey activate {r.alias}</code> to re-apply.
                          </span>
                        </>
                      ) : (
                        <>
                          <ZapIcon className="w-3 h-3" />
                          <span>
                            Copy <code className="font-mono">aikey activate {r.alias}</code>, run in a terminal.
                          </span>
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
              {/* Secondary actions wrapper — 80% centered row (2026-04-24
                  user request: buttons narrower than full width, hint
                  above still spans 100%). Wrapping in .drawer-actions-row
                  lets the parent flex-column layout center the row
                  without affecting the hint's width. */}
              <div className="drawer-actions-row">
              {/* "Reveal & copy" button removed 2026-04-24 — the drawer's
                  "Get via CLI" copyable command is now the single plaintext
                  path. No in-browser reveal exists. */}
              <button
                type="button"
                className="action-btn"
                onClick={props.onBeginRename}
                disabled={props.locked}
                title={lockedTitle ?? 'Rename this alias'}
              >
                <EditIcon className="w-3.5 h-3.5" />
                Rename alias
              </button>
              <button
                type="button"
                className="action-btn danger"
                onClick={props.onDelete}
                disabled={props.locked}
                title={lockedTitle ?? 'Delete this key — cannot be undone'}
              >
                <TrashIcon className="w-3.5 h-3.5" />
                Delete
              </button>
              </div>
            </div>
          </div>


          {/* Meta — field order: Provider, Type, Status, Last used,
              Created, Use count, Expires (OAuth only), Target. Provider
              and Type moved here 2026-04-24 from the Credential section
              — the drawer header already highlights them (provider dot
              + KEY/OAUTH pill + status chip), so duplicating them
              inside Credential was burying the actionable rows (Secret /
              base_url / route_url / Route token) below the fold.
              Keeping them available in Meta preserves the values for
              anyone who wants to read / copy them. Fields without data
              (last_model / fingerprint / 7D usage from the template)
              are omitted here until the proxy telemetry pipeline
              lands. */}
          <div className="drawer-section">
            <div className="drawer-section-title">
              <InfoIcon className="w-3 h-3" />
              Meta
            </div>
            <div className="drawer-field">
              <span className="k">Protocol</span>
              <span className="v">
                {providerName}
                <span className="ro-pill">RO</span>
              </span>
            </div>
            <div className="drawer-field">
              <span className="k">Type</span>
              <span className="v">
                {isPersonal ? 'KEY' : 'OAuth session'}
                <span className="ro-pill">RO</span>
              </span>
            </div>
            <div className="drawer-field">
              <span className="k">Status</span>
              <span className="v">
                {r.status === 'active' ? (
                  <>
                    <span className="status-dot" style={{ width: 5, height: 5 }} />
                    <span style={{ color: 'var(--success)' }}>Active</span>
                  </>
                ) : (
                  <>
                    <span className="status-dot error" style={{ width: 5, height: 5 }} />
                    <span style={{ color: '#fca5a5' }}>{String(r.status)}</span>
                  </>
                )}
              </span>
            </div>
            <div className="drawer-field">
              <span className="k">Last used</span>
              <span className="v">
                {formatRelative(r.last_used_at)}
                {r.last_used_at && (
                  <span className="mono dim">
                    · {formatCreatedShort(r.last_used_at)}
                  </span>
                )}
              </span>
            </div>
            <div className="drawer-field">
              <span className="k">Created</span>
              <span className="v">{formatCreatedShort(r.created_at)}</span>
            </div>
            <div className="drawer-field">
              <span className="k">Use count</span>
              <span className="v mono">{r.use_count ?? 0}</span>
            </div>
            {oauth?.token_expires_at && (
              <div className="drawer-field">
                <span className="k">Expires</span>
                <span className="v">
                  {formatExpiresIn(oauth.token_expires_at)}
                  <span className="mono dim">
                    · {formatCreatedShort(oauth.token_expires_at)}
                  </span>
                </span>
              </div>
            )}
            <div className="drawer-field">
              <span className="k">Target</span>
              <span className="v mono dim">{r.target}</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Add Key modal ────────────────────────────────────────────────────────

type AddKind = 'api' | 'oauth';

// ── Provider presets ────────────────────────────────────────────────────
//
// OAuth 预设保留在本地: `aikey account login <provider>` 仅支持 3 家 (claude /
// codex / kimi),与 API Key 的"协议清单"语义不同,不复用 ProviderMultiSelect。
// API Key 的 providers 预设已统一迁到 shared/ui/ProviderMultiSelect 的
// `KNOWN_PROTOCOLS`,同 import 页面一套 (带品牌别名 + CJK 搜索)。

const OAUTH_PROVIDER_PRESETS: string[] = ['claude', 'codex', 'kimi'];

// AddKeyModal client-side validation. Mirrors CLI core
// `commands_account::validate_alias` (non-empty / ≤128 chars / no
// control chars) and adds light UX-only minimums (alias ≥ 2 chars,
// secret ≥ 8 chars) plus base_url URL-format check. Server still
// re-validates — this is just to fail-fast in the modal so the user
// doesn't round-trip the CLI bridge for trivial mistakes.
const ALIAS_MIN_LEN = 2;
const ALIAS_MAX_LEN = 128;
const SECRET_MIN_LEN = 8;
type AddKeyField = 'alias' | 'secret' | 'baseUrl';
interface AddKeyValidationError {
  field: AddKeyField;
  message: string;
}
function validateAddKey(args: {
  alias: string;
  secret: string;
  baseUrl: string;
}): AddKeyValidationError | null {
  const alias = args.alias.trim();
  if (!alias) return { field: 'alias', message: 'Alias is required' };
  if (alias.length < ALIAS_MIN_LEN) {
    return { field: 'alias', message: `Alias must be at least ${ALIAS_MIN_LEN} characters` };
  }
  if (alias.length > ALIAS_MAX_LEN) {
    return { field: 'alias', message: `Alias exceeds ${ALIAS_MAX_LEN} characters` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(alias)) {
    return { field: 'alias', message: 'Alias contains control characters' };
  }
  if (!args.secret) return { field: 'secret', message: 'Plaintext secret is required' };
  if (args.secret.length < SECRET_MIN_LEN) {
    return { field: 'secret', message: `Secret must be at least ${SECRET_MIN_LEN} characters` };
  }
  // base_url is optional; when present it must be a parseable absolute
  // http(s) URL — relative paths or missing scheme are common typos.
  const baseUrl = args.baseUrl.trim();
  if (baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      return { field: 'baseUrl', message: 'base_url must be a valid URL (e.g. https://api.example.com/v1)' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { field: 'baseUrl', message: 'base_url must use http or https' };
    }
  }
  return null;
}

function AddKeyModal(props: {
  onClose: () => void;
  onSubmitPersonal: (payload: {
    alias: string;
    secret_plaintext: string;
    provider?: string;
    providers?: string[];
    base_url?: string;
  }) => Promise<unknown>;
  pending: boolean;
}) {
  const [kind, setKind] = useState<AddKind>('api');
  const [alias, setAlias] = useState('');
  // API-Key kind accepts multiple providers (aggregator gateways like
  // openrouter frequently serve several protocols through one key).
  const [providers, setProviders] = useState<string[]>(['openai']);
  // OAuth kind is single-select — `aikey account login <provider>` takes
  // exactly one provider name.
  const [oauthProvider, setOauthProvider] = useState('claude');
  const [secret, setSecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Field that should flash red when validation fails. Cleared after
  // ~1.2s so the user can retry without manually dismissing the flash.
  const [flashField, setFlashField] = useState<AddKeyField | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);

  // Auto-clear flashField after the CSS animation finishes.
  useEffect(() => {
    if (!flashField) return;
    const t = window.setTimeout(() => setFlashField(null), 1200);
    return () => clearTimeout(t);
  }, [flashField]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (kind !== 'api') return;
    // Client-side validation. Mirrors the CLI core's `validate_alias`
    // (non-empty / ≤128 chars / no control chars, see
    // commands_account::validate_alias) plus light UX-only rules
    // (min length, base_url format) so users see a clear inline error
    // before the round-trip to the CLI bridge. The bridge still
    // re-validates server-side as the source of truth.
    const v = validateAddKey({ alias, secret, baseUrl });
    if (v) {
      setErr(v.message);
      // Re-trigger flash even if same field fails twice in a row
      // (set null first, then to field on next tick).
      setFlashField(null);
      window.setTimeout(() => setFlashField(v.field), 0);
      return;
    }
    try {
      // Pass `providers` as an array when the user picked ≥ 1 preset /
      // custom value; backend writes entries.supported_providers = JSON
      // array and entries.provider_code = providers[0] (routing default).
      // An empty array degrades to "leave provider unset" — the user
      // can attach a provider later by renaming + retry from the CLI.
      const payload: {
        alias: string;
        secret_plaintext: string;
        providers?: string[];
        provider?: string;
        base_url?: string;
      } = {
        alias: alias.trim(),
        secret_plaintext: secret,
        base_url: baseUrl.trim() || undefined,
      };
      if (providers.length > 0) {
        payload.providers = providers;
        payload.provider = providers[0];
      }
      await props.onSubmitPersonal(payload);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <div
      className="modal-overlay"
      data-open="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal-panel">
        <div className="modal-header">
          <span className="inline-flex items-center gap-2 font-semibold text-[13.5px]">
            <PlusCircleIcon className="w-4 h-4" style={{ color: 'var(--primary)' }} />
            Add key
            <span
              className="text-[10px] font-mono tracking-widest uppercase ml-1"
              style={{ color: 'var(--muted-foreground)' }}
            >
              · stored locally, never leaves device
            </span>
          </span>
          <button
            className="icon-btn"
            title="Close"
            onClick={props.onClose}
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="contents">
          <div className="modal-body">
            <div className="form-row">
              <span className="form-label">
                <ShapesIcon className="w-3 h-3" />
                Kind
              </span>
              <div className="seg">
                <button
                  type="button"
                  className={kind === 'api' ? 'active' : ''}
                  onClick={() => setKind('api')}
                >
                  <KeyIcon className="w-3 h-3" />
                  API Key
                </button>
                <button
                  type="button"
                  className={kind === 'oauth' ? 'active' : ''}
                  onClick={() => setKind('oauth')}
                >
                  <UserCheckIcon className="w-3 h-3" />
                  OAuth
                </button>
              </div>
              <span className="form-help">
                API Key = paste a secret you already have. OAuth = sign in through the CLI and we'll store the session.
              </span>
            </div>

            {kind === 'api' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="form-row">
                    <label className="form-label" htmlFor="add-alias">
                      <TagIcon className="w-3 h-3" />
                      Alias <span className="req">*</span>
                    </label>
                    <input
                      id="add-alias"
                      type="text"
                      className={`field-input${flashField === 'alias' ? ' field-input-flash' : ''}`}
                      placeholder="e.g. openai-prod"
                      autoFocus
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <label className="form-label">
                      <GlobeIcon className="w-3 h-3" />
                      Protocols <span className="req">*</span>
                    </label>
                    {/* v4.2: 统一使用 shared ProviderMultiSelect (同 import 页),
                        带品牌别名搜索 (输入 "GLM" 找 zhipu / "豆包" 找 doubao) +
                        portal-based dropdown (不再被弹窗底栏裁剪)。 */}
                    <ProviderMultiSelect
                      values={providers}
                      onChange={setProviders}
                      placeholder="Search or add protocol…"
                    />
                    <span className="form-help">
                      Search a family (e.g. "anthropic", "openai", "gemini") or type a custom name. Aggregator gateways (openrouter / yunwu / 0011) aren't in the list — pick the underlying protocol they expose.
                    </span>
                  </div>
                </div>
                <div className="form-row">
                  <label className="form-label" htmlFor="add-secret">
                    <KeyIcon className="w-3 h-3" />
                    Plaintext secret <span className="req">*</span>
                  </label>
                  <input
                    id="add-secret"
                    type="password"
                    className={`field-input${flashField === 'secret' ? ' field-input-flash' : ''}`}
                    placeholder="sk-..."
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  <span className="form-help">
                    Encrypted with your master key on save — we never send it to our servers.
                  </span>
                </div>
                <div className="form-row">
                  <label className="form-label" htmlFor="add-baseurl">
                    <LinkIcon className="w-3 h-3" />
                    base_url{' '}
                    <span
                      className="normal-case tracking-normal"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      · optional
                    </span>
                  </label>
                  <input
                    id="add-baseurl"
                    type="text"
                    className={`field-input${flashField === 'baseUrl' ? ' field-input-flash' : ''}`}
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                  <span className="form-help">
                    Custom gateway URL if you route through your own proxy. Leave blank for provider default.
                  </span>
                </div>
                {err && (
                  <span className="text-[12px] font-mono" style={{ color: '#fca5a5' }}>
                    {err}
                  </span>
                )}
              </>
            ) : (
              <OAuthGuide provider={oauthProvider} onProviderChange={setOauthProvider} />
            )}
          </div>
          <div className="modal-footer">
            <span
              className="text-[10px] font-mono uppercase tracking-widest inline-flex items-center gap-1"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <ShieldCheckIcon className="w-3 h-3" style={{ color: 'var(--success)' }} />
              Encrypted with master key on save
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost text-[11px] px-3 py-1.5"
                onClick={props.onClose}
              >
                Cancel
              </button>
              {kind === 'api' && (
                <button
                  type="submit"
                  className="btn btn-primary btn-primary-dim text-[11px] px-4 py-1.5 flex items-center gap-1"
                  disabled={props.pending}
                >
                  {props.pending ? (
                    'Saving…'
                  ) : (
                    <>
                      <CheckIcon className="w-3 h-3" />
                      Save key
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function OAuthGuide({
  provider,
  onProviderChange,
}: {
  provider: string;
  onProviderChange: (v: string) => void;
}) {
  const cmd = `aikey account login ${provider}`;
  return (
    <>
      <div className="form-row">
        <span className="form-label">
          <GlobeIcon className="w-3 h-3" />
          Provider
        </span>
        <SearchableSelect
          value={provider}
          onChange={onProviderChange}
          options={OAUTH_PROVIDER_PRESETS.map((p) => ({ value: p, label: p }))}
          placeholder="Search or type a provider…"
          allowCustom
        />
        <span className="form-help">
          Custom providers are passed verbatim to <span className="font-mono">aikey account login &lt;provider&gt;</span>.
        </span>
      </div>
      <div
        className="p-3 rounded"
        style={{
          background: 'rgba(56,189,248,0.06)',
          border: '1px solid rgba(56,189,248,0.25)',
        }}
      >
        <div
          className="text-[11px] font-mono mb-2"
          style={{ color: '#7dd3fc' }}
        >
          Run this in your terminal to authorize — the session token lands in your local vault automatically:
        </div>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 p-2 font-mono text-[12px]"
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid var(--border)',
            }}
          >
            {cmd}
          </code>
          <button
            type="button"
            className="btn btn-outline text-[11px] px-3 py-1.5"
            onClick={() => {
              if (navigator.clipboard) navigator.clipboard.writeText(cmd);
              else fallbackCopy(cmd);
            }}
          >
            Copy
          </button>
        </div>
        <div
          className="text-[10px] font-mono mt-2"
          style={{ color: 'var(--muted-foreground)' }}
        >
          After login completes, close this dialog — the new OAuth row will appear on next list refresh.
        </div>
      </div>
    </>
  );
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

// ── Icon library ─────────────────────────────────────────────────────────

function SvgIcon({
  d,
  className = 'w-3.5 h-3.5',
  style,
}: {
  d: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// heroicons v2 outline paths
const ICON_EYE =
  'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z';
const ICON_CLIPBOARD =
  'M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184';
const ICON_EDIT =
  'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10';
const ICON_TRASH =
  'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0';
const ICON_CHECK = 'M4.5 12.75l6 6 9-13.5';
const ICON_X = 'M6 18L18 6M6 6l12 12';
const ICON_MAIL =
  'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75';
const ICON_INFO =
  'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z';
const ICON_WRENCH =
  'M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z';
const ICON_KEY_ROUND =
  'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z';
const ICON_KEY =
  'M21 7.5l-2.25-2.25m0 0L16.5 3m2.25 2.25L16.5 7.5m2.25-2.25v6.75a2.25 2.25 0 01-2.25 2.25h-1.5M5.25 6H3m6 3.75l-6 6m0 0l2.25 2.25m-2.25-2.25l2.25-2.25m0 0L9 13.5m2.25 6.75h6a2.25 2.25 0 002.25-2.25V16.5';
const ICON_LOCK =
  'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z';
const ICON_LOCK_OPEN =
  'M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z';
const ICON_SHIELD =
  'M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z';
const ICON_SHIELD_CHECK =
  'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z';
const ICON_SEARCH =
  'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z';
const ICON_PLUS = 'M12 4.5v15m7.5-7.5h-15';
const ICON_PLUS_CIRCLE =
  'M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z';
const ICON_UPLOAD =
  'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5';
const ICON_REFRESH =
  'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99';
const ICON_ROTATE =
  'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99';
const ICON_BOOK_OPEN =
  'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25';
const ICON_LIFE_BUOY =
  'M16.712 4.33a9.027 9.027 0 011.652 1.306c.51.51.944 1.064 1.306 1.652M16.712 4.33l-3.448 4.138m3.448-4.138a9.014 9.014 0 00-9.424 0M19.67 7.288l-4.138 3.448m4.138-3.448a9.014 9.014 0 010 9.424m-4.138-5.976a3.736 3.736 0 00-.88-1.388 3.737 3.737 0 00-1.388-.88m2.268 2.268a3.765 3.765 0 010 2.528m-2.268-4.796a3.765 3.765 0 00-2.528 0m4.796 4.796c-.181.506-.475.982-.88 1.388a3.736 3.736 0 01-1.388.88m2.268-2.268l4.138 3.448m0 0a9.027 9.027 0 01-1.306 1.652c-.51.51-1.064.944-1.652 1.306m0 0l-3.448-4.138m3.448 4.138a9.014 9.014 0 01-9.424 0m5.976-4.138a3.765 3.765 0 01-2.528 0m0 0a3.736 3.736 0 01-1.388-.88 3.737 3.737 0 01-.88-1.388m2.268 2.268L7.288 19.67m0 0a9.024 9.024 0 01-1.652-1.306 9.027 9.027 0 01-1.306-1.652m0 0l4.138-3.448M4.33 16.712a9.014 9.014 0 010-9.424m4.138 5.976a3.765 3.765 0 010-2.528m0 0c.181-.506.475-.982.88-1.388a3.736 3.736 0 011.388-.88m-2.268 2.268L4.33 7.288m6.406 1.18L7.288 4.33m0 0a9.024 9.024 0 00-1.652 1.306A9.025 9.025 0 004.33 7.288';
const ICON_CHEVRON_LEFT = 'M15.75 19.5L8.25 12l7.5-7.5';
const ICON_CHEVRON_RIGHT = 'M8.25 4.5l7.5 7.5-7.5 7.5';
const ICON_CHEVRON_DOWN = 'M19.5 8.25l-7.5 7.5-7.5-7.5';
const ICON_ZAP = 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z';
/* heroicons v2 "play" — filled triangle used for the shell-command hint
   ("Run `claude` in any terminal ..."), visually distinct from ZapIcon
   so the two hint lines read as different actions. */
const ICON_PLAY =
  'M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z';
const ICON_USER_CHECK =
  'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z';
const ICON_SHAPES =
  'M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3';
const ICON_TAG =
  'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z';
const ICON_GLOBE =
  'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418';
const ICON_LINK =
  'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244';

function EyeIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EYE} {...p} />; }
function ClipboardIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CLIPBOARD} {...p} />; }
function EditIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_EDIT} {...p} />; }
function TrashIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_TRASH} {...p} />; }
function CheckIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHECK} {...p} />; }
function XIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_X} {...p} />; }
function MailIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_MAIL} {...p} />; }
function InfoIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_INFO} {...p} />; }
function WrenchIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_WRENCH} {...p} />; }
function KeyRoundIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_KEY_ROUND} {...p} />; }
function KeyIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_KEY} {...p} />; }
function LockIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LOCK} {...p} />; }
function LockOpenIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LOCK_OPEN} {...p} />; }
function ShieldIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SHIELD} {...p} />; }
function ShieldCheckIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SHIELD_CHECK} {...p} />; }
function SearchIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SEARCH} {...p} />; }
function PlusIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_PLUS} {...p} />; }
function PlusCircleIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_PLUS_CIRCLE} {...p} />; }
function UploadIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_UPLOAD} {...p} />; }
function RefreshIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_REFRESH} {...p} />; }
function RotateIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_ROTATE} {...p} />; }
function BookOpenIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_BOOK_OPEN} {...p} />; }
function LifeBuoyIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LIFE_BUOY} {...p} />; }
function ChevronLeftIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHEVRON_LEFT} {...p} />; }
function ChevronRightIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHEVRON_RIGHT} {...p} />; }
function ChevronDownIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_CHEVRON_DOWN} {...p} />; }
function ZapIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_ZAP} {...p} />; }
function PlayIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_PLAY} {...p} />; }
function UserCheckIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_USER_CHECK} {...p} />; }
function ShapesIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_SHAPES} {...p} />; }
function TagIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_TAG} {...p} />; }
function GlobeIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_GLOBE} {...p} />; }
function LinkIcon(p: { className?: string; style?: React.CSSProperties }) { return <SvgIcon d={ICON_LINK} {...p} />; }

// ── CSS ──────────────────────────────────────────────────────────────────
// Adopted from .superdesign/design_iterations/user_vault_3_1.html. Uses
// the same surface-1/surface-2 tokens and --chart-* brand palette as the
// /user/overview v3.1 page so the two pages feel like one product.

const VAULT_CSS = `
.vault-page {
  /* Brand dot colors — kept here so the page is self-contained. Match
     user_overview_3_1's palette exactly so provider chips read the same
     across pages. */
  --chart-anthropic: #ca8a04;
  --chart-kimi:      #38bdf8;
  --chart-openai:    #a78bfa;
  --chart-codex:     #22d3ee;
  --chart-gemini:    #f472b6;
  --chart-neutral:   #52525b;
  --success:         #4ade80;
  --warning:         #f97316;
  --destructive:     #ef4444;
  --info:            #60a5fa;
  --surface-1:       #1f1f23;
  --surface-2:       #27272a;
}

/* ---- Buttons ------------------------------------------------- */
.vault-page .btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-weight: 600; border-radius: var(--radius-sm);
  transition: background 150ms ease, border-color 150ms ease, color 120ms ease;
  cursor: pointer; border: 1px solid transparent; white-space: nowrap;
  font-size: 0.75rem;
  padding: 0.375rem 0.75rem;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
}
.vault-page .btn-primary {
  background: var(--primary); color: var(--primary-foreground);
  border-color: rgba(250, 204, 21, 0.55);
}
.vault-page .btn-primary:hover:not(:disabled) { background: #fde047; }
.vault-page .btn-outline {
  background: var(--surface-1); color: var(--foreground);
  border-color: var(--border);
}
.vault-page .btn-outline:hover:not(:disabled) { background: var(--surface-2); border-color: var(--muted-foreground); }
.vault-page .btn-ghost { background: transparent; color: var(--muted-foreground); }
.vault-page .btn-ghost:hover:not(:disabled) { color: var(--foreground); background: var(--surface-1); }
.vault-page .btn-danger {
  background: rgba(239, 68, 68, 0.1); color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.35);
}
.vault-page .btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18); color: #fecaca;
  border-color: rgba(239, 68, 68, 0.55);
}
.vault-page .btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Custom tooltip for disabled buttons — renders the \`title\` text as a
   styled bubble on hover/focus so users immediately understand *why*
   an action is greyed out (most often: "Unlock vault to …"). The
   native browser tooltip also still fires as a fallback but its
   500ms+ delay is too slow for "why can't I click this?" copy. We
   intentionally scope to :disabled so enabled buttons don't double
   up with both a visual hover state and a floating bubble. */
.vault-page .btn[title]:disabled,
.vault-page .icon-btn[title]:disabled,
.vault-page .row-use-btn[title]:disabled { position: relative; }

.vault-page .btn[title]:disabled:hover::after,
.vault-page .btn[title]:disabled:focus-visible::after,
.vault-page .icon-btn[title]:disabled:hover::after,
.vault-page .icon-btn[title]:disabled:focus-visible::after,
.vault-page .row-use-btn[title]:disabled:hover::after,
.vault-page .row-use-btn[title]:disabled:focus-visible::after {
  content: attr(title);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 10px;
  background: var(--card);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: 5px;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--font-sans);
  font-weight: 500;
  letter-spacing: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  z-index: 100;
}
.vault-page .btn[title]:disabled:hover::before,
.vault-page .btn[title]:disabled:focus-visible::before,
.vault-page .icon-btn[title]:disabled:hover::before,
.vault-page .icon-btn[title]:disabled:focus-visible::before,
.vault-page .row-use-btn[title]:disabled:hover::before,
.vault-page .row-use-btn[title]:disabled:focus-visible::before {
  content: "";
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px; height: 8px;
  background: var(--card);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  pointer-events: none;
  z-index: 99;
}

/* ---- Chips & dots ------------------------------------------- */
.vault-page .chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 3px 7px; font-size: 10.5px;
  font-family: var(--font-mono);
  border-radius: 4px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  letter-spacing: 0.04em;
}
.vault-page .chip.success { color: rgba(134,239,172,0.65); background: rgba(74,222,128,0.04);  border-color: rgba(74,222,128,0.16); }
.vault-page .chip.warning { color: var(--warning); background: rgba(249,115,22,0.09);  border-color: rgba(249,115,22,0.32); }
.vault-page .chip.danger  { color: #fca5a5;       background: rgba(239,68,68,0.1);     border-color: rgba(239,68,68,0.35); }
.vault-page .chip.info    { color: var(--info);   background: rgba(96,165,250,0.08);   border-color: rgba(96,165,250,0.3); }

.vault-page .kind-pill {
  display: inline-flex; align-items: center;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase;
  border-radius: 3px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.vault-page .kind-pill.oauth {
  color: #c4b5fd;
  border-color: rgba(167,139,250,0.35);
  background: rgba(167,139,250,0.06);
}

.vault-page .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--success);
  box-shadow: 0 0 3px rgba(74, 222, 128, 0.35);
  flex-shrink: 0; display: inline-block;
  opacity: 0.75;
}
.vault-page .status-dot.idle  { background: var(--muted-foreground); box-shadow: none; }
.vault-page .status-dot.stale { background: var(--warning); box-shadow: 0 0 6px rgba(249,115,22,0.6); }
.vault-page .status-dot.error { background: var(--destructive); box-shadow: 0 0 6px rgba(239,68,68,0.7); }

.vault-page .prov-dot {
  width: 6px; height: 6px; border-radius: 2px;
  display: inline-block; flex-shrink: 0;
  opacity: 0.55;
}

/* ---- Cards / metrics --------------------------------------- */
/* Inset bottom box-shadow + outer 1px border stack into two adjacent
   horizontal lines at the card bottom — mirrors master's "double-line"
   table ending. Same pattern as .draft-row on /user/import. */
.vault-page .card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: inset 0 -1px 0 0 var(--border);
}

/* ---- Unlock banner ----------------------------------------- */
.vault-page .unlock-banner {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.6rem 0.95rem;
  border-radius: var(--radius-sm);
  background: rgba(74, 222, 128, 0.05);
  border: 1px solid rgba(74, 222, 128, 0.25);
  font-size: 12.5px; color: var(--foreground);
}
.vault-page .unlock-banner .dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--success); box-shadow: 0 0 6px rgba(74,222,128,0.7);
  flex-shrink: 0;
}
/* Locked-state theme matches /user/import's .unlock-banner (gold gradient
   + primary inset rail) so the two pages feel like siblings during the
   unlock flow. Avoids the orange/warning look we had before — orange
   implies error, but "locked" is simply a gated state, not a failure. */
.vault-page .unlock-banner.locked {
  background: linear-gradient(90deg, rgba(250, 204, 21,0.08) 0%, rgba(250, 204, 21,0.02) 100%);
  border: 1px solid rgba(250, 204, 21,0.35);
  box-shadow: inset 3px 0 0 0 var(--primary);
}
.vault-page .unlock-banner.locked .dot {
  background: var(--primary); box-shadow: 0 0 6px rgba(250, 204, 21,0.6);
}

/* ---- Inputs ------------------------------------------------ */
.vault-page .field-input,
.vault-page .search-input {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--foreground);
  font-size: 12.5px;
  padding: 6px 10px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.vault-page .field-input:focus,
.vault-page .search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(250, 204, 21,0.15);
}
.vault-page .search-input { padding-left: 30px; width: 100%; }
/* Monospace override for form fields carrying code-like values (e.g. the
   route-token textarea in the drawer). Required because the project-wide
   "input, select, textarea { font-family: var(--font-sans) !important }"
   rule in index.css wins over the Tailwind font-mono class otherwise.
   Using the .field-input.font-mono combo as the selector avoids
   introducing a new class name — both pieces are already existing
   classes the component composes. */
.vault-page .field-input.font-mono {
  font-family: var(--font-mono) !important;
}

/* Segmented capsule container — one outer border wraps a row of
   pills; inner pills are borderless and share the container's frame.
   Replaces the earlier row-of-standalone-pills (each with its own
   border + hairline) which visually competed with the table's own
   frame. */
/* Toolbar sizes bumped 2026-04-25 — user flagged the inputs/pills
   as "too small/cramped" against the full-width vault table. Pills
   and seg buttons now match the 36px search input height so the
   whole row reads as a coherent, generously-sized toolbar. */
.vault-page .filter-group {
  display: inline-flex; align-items: stretch;
  padding: 3px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 999px;
  gap: 0;
}

.vault-page .filter-pill {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 6px 14px;
  font-family: var(--font-mono);
  font-size: 12px; letter-spacing: 0.05em;
  color: var(--muted-foreground);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  transition: color 120ms ease, background 120ms ease;
  cursor: pointer;
}
.vault-page .filter-pill:hover:not(.active) {
  color: var(--foreground);
  background: rgba(255, 255, 255, 0.04);
}
.vault-page .filter-pill.active {
  background: rgba(250, 204, 21, 0.12);
  color: var(--primary);
  font-weight: 600;
}
.vault-page .filter-pill .count {
  font-size: 11px; color: var(--muted-foreground); opacity: 0.8; margin-left: 3px;
}
.vault-page .filter-pill.active .count { color: var(--primary); opacity: 1; }

.vault-page .filter-group-label {
  font-family: var(--font-mono);
  font-size: 11px; letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.7; padding-right: 4px;
}

.vault-page .seg {
  display: inline-flex; padding: 3px;
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.vault-page .seg button {
  font-family: var(--font-mono);
  font-size: 11.5px; letter-spacing: 0.05em;
  padding: 5px 12px; border-radius: 3px;
  color: var(--muted-foreground);
  background: transparent; border: none; cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.vault-page .seg button:hover { color: var(--foreground); }
.vault-page .seg button.active {
  background: var(--surface-2); color: var(--foreground);
  box-shadow: inset 0 0 0 1px var(--border);
}

/* ---- Vault table ------------------------------------------- */
.vault-page table.vault { width: 100%; border-collapse: collapse; }
.vault-page table.vault th {
  /* 2026-04-25: thead row gets the same rgba(0,0,0,0.2) dark overlay
     as the CardHeader above, so the whole "lid" above tbody reads as
     one continuous dark band. Previous note about "master has no th
     bg" was a misread — we want the CardHeader + thead to visually
     chain together, which requires the same overlay on both. */
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  font-weight: 600;
  text-align: left;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--border);
  padding: 12px 20px;
  white-space: nowrap;
}
.vault-page table.vault th .th-hint {
  font-size: 9.5px; letter-spacing: 0.05em;
  text-transform: none;
  color: var(--muted-foreground);
  opacity: 0.55; font-weight: 500; margin-left: 0.3rem;
}
/* Click-to-sort column headers. Muted by default, brighten on hover,
   and the active-sort column gets foreground + a ↓ arrow to mirror
   master's "click the column header" pattern. */
.vault-page table.vault th.th-sortable {
  cursor: pointer;
  user-select: none;
  transition: color 120ms ease, background 120ms ease;
}
.vault-page table.vault th.th-sortable:hover {
  color: var(--foreground);
  background: rgba(0, 0, 0, 0.32);
}
.vault-page table.vault th.th-sortable.active {
  color: var(--foreground);
}
.vault-page table.vault th .th-sort-arrow {
  display: inline-block;
  margin-left: 4px;
  font-size: 10px;
  color: var(--primary);
  vertical-align: baseline;
}
.vault-page table.vault td {
  border-bottom: 1px solid color-mix(in oklab, var(--border) 35%, transparent);
  /* 2026-04-24 bump: cell padding 9→11 and height 36→42; text
     13→14 via .alias-main / .provider-cell .name / span.mono
     individually. Gives the table a more generous row rhythm. */
  padding: 11px 14px; font-size: 13.5px;
  vertical-align: middle; height: 42px;
}
/* Keep the last row's bottom border so it stacks with the CardFooter's
   top border directly below — mirrors master's "double-line at table
   bottom" pattern (last-row border + footer border-top abut with no
   gap, reads as a crisp two-line divider). */
.vault-page table.vault tbody tr {
  transition: background 120ms ease, box-shadow 120ms ease;
}
.vault-page table.vault tbody tr:hover {
  background: rgba(250, 204, 21, 0.035);
  box-shadow: inset 2px 0 0 0 rgba(250, 204, 21, 0.6);
}
.vault-page table.vault tbody tr:hover .row-actions { opacity: 1; }
/* Whole-row click opens the detail drawer (2026-04-24). Cursor hints
   at affordance; inline buttons still take precedence via the
   closest('button, input, ...') skip check in the JS handler. */
.vault-page table.vault tbody tr.row-clickable { cursor: pointer; }
.vault-page table.vault tbody tr.row-clickable button,
.vault-page table.vault tbody tr.row-clickable input,
.vault-page table.vault tbody tr.row-clickable textarea,
.vault-page table.vault tbody tr.row-clickable a { cursor: auto; }
.vault-page table.vault tbody tr.row-clickable .in-use-chip { cursor: pointer; }

/* ── in-use row: persistent row-level tint removed 2026-04-24 per
   user request — the .in-use-chip (sky-blue) inside the alias cell
   is the sole indicator now, so the in-use row flows with every
   other row in hover / height / background. .just-switched still
   fires a one-shot pulse after a successful switch for transient
   feedback; keyframe kept sans inset bar so it pulses a halo only. */
@keyframes route-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
  50%  { box-shadow: 0 0 0 6px rgba(56, 189, 248, 0); }
  100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
}
.vault-page table.vault tbody tr.in-use.just-switched {
  animation: route-pulse 600ms ease-out 1;
}

/* ── Row inline Use button ─ only on non-active rows (design spec). */
.vault-page .row-use-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 28px;
  padding: 0 9px;
  margin-right: 2px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-sans);
  letter-spacing: 0.01em;
  color: var(--primary);
  background: transparent;
  border: 1px solid rgba(250, 204, 21, 0.35);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
}
.vault-page .row-use-btn:hover:not(:disabled) {
  background: rgba(250, 204, 21, 0.1);
  border-color: rgba(250, 204, 21, 0.7);
}
.vault-page .row-use-btn:disabled {
  opacity: 0.5;
  cursor: progress;
}
.vault-page .row-use-btn:focus-visible {
  outline: none;
  border-color: rgba(250, 204, 21, 0.9);
  box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.15);
}

/* ── Protocol grouping (tree view) ──────────────────────────────────
   Group header tr.group-row injected before each provider; children
   tagged .group-child so their first cell gains a tree-indent guide.
   Collapse state toggled via data-collapsed on the header + .group-hidden
   class added/removed on children. */
/* Group header background is neutral — the provider-agnostic yellow
   gradient we had before (2026-04-23) made the whole table read warm
   because every provider (anthropic / openai / kimi / …) got the same
   yellow stripe regardless of its brand color. Leave yellow to the
   in-use / routing signal below where it carries meaning. */
.vault-page table.vault tbody tr.group-row > td {
  padding: 9px 14px 9px 10px;
  background: var(--surface-1);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.vault-page table.vault tbody tr.group-row:first-child > td { border-top: none; }
.vault-page table.vault tbody tr.group-row:hover > td {
  background: var(--surface-2);
}
.vault-page .gr-inner {
  display: flex; align-items: center; gap: 10px;
  min-height: 28px;
}
.vault-page .gr-toggle {
  width: 22px; height: 22px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  flex-shrink: 0;
}
.vault-page .gr-toggle:hover {
  background: var(--surface-2);
  color: var(--foreground);
  border-color: var(--muted-foreground);
}
.vault-page .gr-toggle svg { transition: transform 160ms ease; }
.vault-page tr.group-row[data-collapsed="true"] .gr-toggle svg { transform: rotate(-90deg); }
.vault-page .gr-dot {
  width: 8px; height: 8px; border-radius: 999px;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.03);
}
.vault-page .gr-name {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  /* Muted color matching the table <th> so the group divider row
     reads as "part of the header chrome" rather than a data row. */
  color: var(--muted-foreground);
  letter-spacing: 0.005em;
  text-transform: lowercase;
}
.vault-page .gr-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  opacity: 0.78;
}
.vault-page .gr-meta .gr-sep { opacity: 0.4; margin: 0 4px; }
/* .gr-status / .gr-alias / .gr-idle-dot removed 2026-04-24 — the
   ROUTING/IDLE badge on each group header is gone; the per-row
   .in-use marker (yellow tint + IN USE pill on the active child)
   carries the same signal without doubling it up. */

/* Child rows — tree indent + horizontal connector on first cell. */
.vault-page tr.group-child td:first-child {
  position: relative;
  padding-left: 38px;
}
.vault-page tr.group-child td:first-child::before {
  content: "";
  position: absolute;
  left: 22px; top: 0; bottom: 0; width: 1px;
  background: linear-gradient(
    180deg,
    transparent 0,
    rgba(255, 255, 255, 0.08) 14%,
    rgba(255, 255, 255, 0.08) 86%,
    transparent 100%
  );
  pointer-events: none;
}
.vault-page tr.group-child td:first-child::after {
  content: "";
  position: absolute;
  left: 22px; top: 50%;
  width: 10px; height: 1px;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}
.vault-page tr.group-child.last-in-group td:first-child::before {
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.08) 0,
    rgba(255, 255, 255, 0.08) 50%,
    transparent 50%,
    transparent 100%
  );
}
.vault-page tr.group-child.group-hidden { display: none; }

/* Header routing chip + .rp-* popover CSS removed 2026-04-24 along
   with the RoutePopover component — switch-routing action surface is
   now the per-row Use button + drawer "Route via this key". */


/* ── Toast stack (switch feedback + undo) ──────────────────────────── */
.vault-page .toast-stack {
  position: fixed;
  bottom: 20px; left: 50%;
  transform: translateX(-50%);
  z-index: 95;
  display: flex; flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.vault-page .toast {
  display: flex; align-items: flex-start; gap: 10px;
  min-width: 320px;
  max-width: 480px;
  padding: 10px 12px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3);
  color: var(--foreground);
  transform: translateY(12px);
  opacity: 0;
  transition: opacity 180ms ease, transform 220ms cubic-bezier(.3,0,.2,1);
  pointer-events: auto;
  position: relative;
  overflow: hidden;
}
.vault-page .toast[data-open="true"] { transform: translateY(0); opacity: 1; }
.vault-page .toast.error { border-color: rgba(239, 68, 68, 0.45); }
.vault-page .toast .toast-icon {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  border-radius: 999px;
  background: rgba(250, 204, 21, 0.14);
  color: var(--primary);
}
.vault-page .toast.error .toast-icon {
  background: rgba(239, 68, 68, 0.14);
  color: var(--destructive);
}
.vault-page .toast .toast-body { flex: 1; min-width: 0; }
.vault-page .toast .toast-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--foreground);
}
.vault-page .toast .toast-sub {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted-foreground);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vault-page .toast .toast-actions {
  display: inline-flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.vault-page .toast .toast-undo {
  font-size: 11px; font-weight: 600;
  color: var(--primary);
  background: transparent;
  border: 1px solid rgba(250, 204, 21, 0.4);
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.vault-page .toast .toast-undo:hover {
  background: rgba(250, 204, 21, 0.1);
  border-color: rgba(250, 204, 21, 0.7);
}
.vault-page .toast .toast-dismiss {
  width: 22px; height: 22px;
  border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.vault-page .toast .toast-dismiss:hover { color: var(--foreground); }
.vault-page .toast .toast-timer {
  position: absolute;
  left: 0; bottom: 0; height: 2px;
  background: var(--primary);
  opacity: 0.6;
  width: 100%;
  transform-origin: left center;
  animation: toast-timer 5000ms linear forwards;
}
.vault-page .toast.error .toast-timer { background: var(--destructive); }
@keyframes toast-timer {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

.vault-page .alias-main {
  font-family: var(--font-sans);
  font-weight: 500; font-size: 14px;
  color: var(--foreground);
}
/* Green "active" dot rendered before the alias on routing rows —
   visual parity with the CLI's ● indicator in aikey route. */
.vault-page .alias-main .active-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.75);
  margin-right: 8px;
  vertical-align: middle;
  position: relative;
  top: -1px;
  flex-shrink: 0;
}
/* ── IN-USE chip (alias cell) ────────────────────────────────────────
   Replaces the earlier alias-in-use-dot green pip. Appears to the right
   of the alias on the currently-routing row, paired with the yellow
   accent on the whole tr.in-use. */
.vault-page .in-use-chip {
  /* Sized to match .row-use-btn (28px height) but with a wider
     horizontal padding + flex-shrink:0 + white-space:nowrap so the
     "IN USE" label never wraps to a second line when the actions
     column gets tight. */
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px;
  padding: 0 12px;
  margin-right: 2px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
  border-radius: 6px;
  /* Sky-blue palette (#38bdf8 = rgb 56 189 248) — CLI's cyan "active
     routing" accent. Distinct from the yellow brand chrome so status
     reads as a separate axis from interactive chrome. */
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.45);
  vertical-align: middle;
  position: relative;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.vault-page .in-use-chip:hover {
  background: rgba(56, 189, 248, 0.28);
  border-color: rgba(56, 189, 248, 0.75);
}
.vault-page .in-use-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.45);
}
.vault-page .in-use-chip::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 4px;
  border: 1px solid rgba(56, 189, 248, 0.6);
  animation: in-use-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
@keyframes in-use-pulse {
  0%   { opacity: 0.7; transform: scale(1);    }
  70%  { opacity: 0;   transform: scale(1.15); }
  100% { opacity: 0;   transform: scale(1.15); }
}
.vault-page .alias-sub {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted-foreground);
  opacity: 0.75; margin-top: 1px;
}
.vault-page .alias-main.mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.vault-page .provider-cell {
  display: inline-flex; align-items: center; gap: 0.5rem;
  min-width: 0;
}
.vault-page .provider-cell .name {
  font-size: 13.5px; color: var(--muted-foreground);
}

.vault-page .row-actions {
  display: inline-flex; align-items: center; gap: 4px;
  opacity: 0.4; transition: opacity 150ms ease;
}
.vault-page .icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  border: 1px solid transparent;
  background: transparent;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
  cursor: pointer;
}
.vault-page .icon-btn:hover:not(:disabled) {
  color: var(--foreground);
  background: var(--surface-1);
  border-color: var(--border);
}
.vault-page .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.vault-page .icon-btn.primary:hover:not(:disabled) { color: var(--primary); border-color: rgba(250, 204, 21,0.4); }
.vault-page .icon-btn.danger:hover:not(:disabled)  { color: #fca5a5; background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.4); }

.vault-page .inline-input {
  background: rgba(0,0,0,0.5); border: 1px solid var(--primary);
  border-radius: var(--radius-sm); padding: 4px 8px;
  color: var(--foreground); font-family: var(--font-mono);
  font-size: 13px; outline: none;
  box-shadow: 0 0 0 2px rgba(250, 204, 21,0.15);
}

/* ---- Drawer ------------------------------------------------ */
.vault-page ~ .drawer-overlay,
.drawer-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 90;
  opacity: 0; pointer-events: none;
  transition: opacity 180ms ease;
}
.drawer-overlay[data-open="true"] { opacity: 1; pointer-events: auto; }

.drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 460px; max-width: calc(100vw - 40px);
  background: var(--surface-2, #27272a);
  border-left: 1px solid var(--border);
  box-shadow: -20px 0 40px -10px rgba(0,0,0,0.6);
  z-index: 95;
  display: flex; flex-direction: column;
  transform: translateX(100%);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer[data-open="true"] { transform: translateX(0); }

.drawer-head {
  padding: 18px 22px 14px;
  display: flex; align-items: flex-start; gap: 12px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(250, 204, 21,0.04) 0%, transparent 100%);
}
.drawer-head .content { flex: 1; min-width: 0; }
.drawer-head .alias-title {
  font-family: var(--font-sans);
  font-size: 17px; font-weight: 600;
  color: var(--foreground);
  word-break: break-all;
}
.drawer-head .alias-title.mono { font-family: var(--font-mono); letter-spacing: -0.01em; }
.drawer-head .meta-row {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; flex-wrap: wrap; font-size: 12px;
}
.drawer-head .provider-cell {
  display: inline-flex; align-items: center; gap: 0.5rem;
  min-width: 0;
}
.drawer-head .provider-cell .name { font-size: 12.5px; }
.drawer-head .prov-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
.drawer-head .kind-pill {
  display: inline-flex; align-items: center;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase;
  border-radius: 3px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.drawer-head .kind-pill.oauth {
  color: #c4b5fd;
  border-color: rgba(167,139,250,0.35);
  background: rgba(167,139,250,0.06);
}
.drawer-head .chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 3px 7px; font-size: 10.5px;
  font-family: var(--font-mono);
  border-radius: 4px;
  background: rgba(0,0,0,0.2);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.drawer-head .chip.success { color: #6ee7b7; background: rgba(74,222,128,0.08); border-color: rgba(74,222,128,0.3); }
.drawer-head .chip.danger { color: #fca5a5; background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.35); }
.drawer-head .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
  flex-shrink: 0; display: inline-block;
}
.drawer-head .status-dot.error { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.7); }

.drawer-close {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  color: var(--muted-foreground);
  background: transparent; border: 1px solid transparent;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
  flex-shrink: 0;
}
.drawer-close:hover {
  color: var(--foreground);
  background: rgba(0,0,0,0.15);
  border-color: var(--border);
}

/* Drawer visual refresh aligned with user_vault_3_1_1.html (2026-04-24):
   more generous padding / taller fields / flat group rhythm, dedicated
   .drawer-tokenbox for the route-token wrap, .inline-copy ghost button,
   .drawer-actions CTA row with a primary-route highlight. Logic/handlers
   unchanged — this is pure visual polish per user request. */
.drawer-body {
  /* min-height: 0 is the flex-child scrolling escape hatch — without
     it a flex item defaults to min-height: auto which prevents it
     from shrinking below its content's intrinsic size, so overflow-y:
     auto never triggers and the tail of the content (including the
     Actions row with Route / Reveal / Rename / Delete) disappears
     below the viewport. User bug report 2026-04-24. */
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  /* Tightened padding / section gap 2026-04-24 in the same pass as
     .drawer-field — keeps the rhythm consistent when the whole drawer
     became more compact. */
  padding: 18px 24px 22px;
  color: var(--foreground);
  display: flex; flex-direction: column; gap: 22px;
}
.drawer-section { margin-bottom: 0; }
.drawer-section:last-child { margin-bottom: 0; }
.drawer-section-title {
  font-family: var(--font-mono);
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--muted-foreground);
  margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
  opacity: 0.78;
}
.drawer-section-title svg { opacity: 0.9; }

/* Flat group — fields stack with a 1px bottom rule separating them,
   no extra frame / background. Matches template .drawer-group. */
.drawer-group {
  display: flex; flex-direction: column;
}
.drawer-field {
  display: grid;
  grid-template-columns: 112px 1fr;
  gap: 6px 16px;
  /* Tightened 2026-04-24 (padding 13→9px, min-height 44→34px) so longer
     drawers fit without forcing a scroll, and the rows read more
     compact — the prior spacing made OAuth keys with lots of fields
     (Identity + Org + Tier + Meta + Actions) feel sparse. */
  padding: 9px 2px;
  /* Softer separator than the table / card frames use — these are
     intra-group dividers, not structural boundaries, so a mid-opacity
     tint reads as a rhythm marker rather than another hairline to
     compete with the drawer-head bottom rule (2026-04-24). */
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 14px;
  align-items: start;
  min-height: 38px;
}
.drawer-field:last-child { border-bottom: none; }
.drawer-field .k {
  font-family: var(--font-mono);
  color: var(--muted-foreground);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  font-size: 11px;
  padding-top: 4px;
  opacity: 0.68;
}
.drawer-field .v {
  color: var(--foreground);
  word-break: break-word;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  min-width: 0;
  line-height: 1.45;
}
.drawer-field .v.stack {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.drawer-field .v .dim  { color: var(--muted-foreground); }
.drawer-field .v .mono { font-family: var(--font-mono); }
.drawer-field .v .truncate {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 100%;
}
.drawer-field .v .hint {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted-foreground);
  opacity: 0.62;
  letter-spacing: 0.05em;
  text-transform: lowercase;
}
.drawer-field .v .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74,222,128,0.7);
  display: inline-block;
}
.drawer-field .v .status-dot.error { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.7); }

/* Status line (Meta section) — label coloured to match the dot. */
.drawer-field .status-line {
  display: inline-flex; align-items: center; gap: 8px;
}
.drawer-field .status-line .label { color: var(--success); font-weight: 500; }

/* Inline copy — ghost button for plain-text values (base_url, etc). */
.vault-page .inline-copy {
  color: var(--muted-foreground);
  background: transparent;
  border: none;
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex; align-items: center;
  opacity: 0.7;
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
}
.vault-page .inline-copy:hover {
  color: var(--foreground);
  background: rgba(255,255,255,0.05);
  opacity: 1;
}

/* Route-token wrap box — free word-break, corner-anchored copy button.
   Replaces the earlier readonly <textarea>; a div renders the value more
   cleanly than a form element (no focus ring conflict w/ browser default,
   no double-scrollbar on long tokens, and obeys drawer typography). */
.vault-page .drawer-tokenbox {
  position: relative;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 11px 44px 32px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--foreground);
  word-break: break-all;
  max-height: 96px;
  overflow-y: auto;
  width: 100%;
  line-height: 1.5;
  scrollbar-width: thin;
}
.vault-page .drawer-tokenbox::-webkit-scrollbar { width: 6px; }
.vault-page .drawer-tokenbox::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12); border-radius: 3px;
}
.vault-page .drawer-tokenbox .copy-btn {
  position: absolute;
  bottom: 6px; right: 6px;
  width: 26px; height: 26px;
  color: var(--muted-foreground);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 120ms ease, background 120ms ease;
}
.vault-page .drawer-tokenbox .copy-btn:hover {
  background: rgba(255,255,255,0.06);
  color: var(--foreground);
}

/* Actions row — inline (not a sticky footer). Route is the primary CTA
   and spans the full first row; secondary actions share the second. */
.vault-page .drawer-actions {
  /* 2026-04-24 restructure: buttons constrained to 80% and centered,
     but the hint text between primary + secondary still spans 100% so
     the instructional copy (e.g. "Run claude in any terminal ...")
     can stretch without awkward wrapping inside a narrower column.
     Flex-column stacks the items; width constraints are applied to
     individual descendants (.primary-route, .drawer-actions-row)
     while .drawer-actions-hint stays at the default auto width
     (= full container). */
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vault-page .drawer-actions .action-btn.primary-route {
  /* Override the base flex:1 1 140px: center-locked 80% column. */
  flex: 0 0 auto;
  width: 80%;
  align-self: center;
}
.vault-page .drawer-actions-row {
  display: flex;
  gap: 10px;
  width: 80%;
  align-self: center;
}
.vault-page .drawer-actions-row .action-btn {
  /* Inside the constrained 80% row, secondary buttons share space
     evenly (flex:1). Keeps Rename / Delete pairing even-width. */
  flex: 1 1 0;
  min-width: 0;
}
/* Usage hint under the Route CTA — claims the full row width so it
   breaks between the primary (full-width) Route button and the
   secondary-action row below. Mono font matches surrounding code
   references; inline "code" children get a subtle surface background
   so the copied command stands out from the sentence prose. */
.vault-page .drawer-actions-hint {
  flex-basis: 100%;
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  margin: -2px 2px 2px 2px;
  font-family: var(--font-sans);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--muted-foreground);
}
.vault-page .drawer-actions-hint svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--primary);
  opacity: 0.75;
}
.vault-page .drawer-actions-hint code {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11.5px;
  color: var(--foreground);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 3px;
  margin: 0 1px;
}
.vault-page .drawer-actions .action-btn {
  flex: 1 1 140px;
  min-width: 0;
  padding: 10px 14px;
  font-size: 12.5px;
  font-weight: 500;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 7px;
  background: rgba(255,255,255,0.025);
  border: 1px solid var(--border);
  color: var(--foreground);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.vault-page .drawer-actions .action-btn:hover:not(:disabled) {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.15);
}
.vault-page .drawer-actions .action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.vault-page .drawer-actions .action-btn svg { opacity: 0.75; flex-shrink: 0; }
.vault-page .drawer-actions .action-btn:hover:not(:disabled) svg { opacity: 1; }

/* Primary — Route via this key. Warm-yellow glow theme.
   Sizing (width, flex, align-self) handled by the structural rule
   higher up (search for ".action-btn.primary-route { flex: 0 0 auto"). */
.vault-page .drawer-actions .action-btn.primary-route {
  background:
    linear-gradient(180deg, rgba(250, 204, 21,0.14), rgba(250, 204, 21,0.08));
  border-color: rgba(250, 204, 21, 0.42);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 0 18px -8px rgba(250, 204, 21, 0.45);
}
.vault-page .drawer-actions .action-btn.primary-route:hover:not(:disabled) {
  background:
    linear-gradient(180deg, rgba(250, 204, 21,0.22), rgba(250, 204, 21,0.12));
  border-color: rgba(250, 204, 21, 0.6);
}
.vault-page .drawer-actions .action-btn.primary-route.routing {
  cursor: default;
  background: rgba(250, 204, 21, 0.06);
  border-color: rgba(250, 204, 21, 0.35);
  box-shadow: none;
}
.vault-page .drawer-actions .action-btn.primary-route.routing:hover {
  background: rgba(250, 204, 21, 0.06);
  border-color: rgba(250, 204, 21, 0.35);
}
/* Danger — Delete. */
.vault-page .drawer-actions .action-btn.danger {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.25);
}
.vault-page .drawer-actions .action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
  border-color: rgba(239, 68, 68, 0.45);
}

.ro-pill {
  display: inline-flex; align-items: center;
  font-family: var(--font-mono);
  font-size: 9px; font-weight: 600;
  letter-spacing: 0.05em;
  padding: 1px 5px; border-radius: 2px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  margin-left: 2px;
}

.secret-view {
  flex: 1; min-width: 0;
  /* Matches 3.1 template — uses the page background token so the
     secret chip reads as "sunken" relative to the drawer surface-2
     panel, not as a darker-than-panel overlay. */
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 7px 8px 7px 10px;
  display: flex; align-items: center; gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px; overflow: hidden;
}
.secret-view .plain {
  flex: 1; min-width: 0;
  color: var(--foreground);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.secret-view .plain .prefix { color: #a5b4fc; }
.secret-view .plain .suffix { color: #fcd34d; }
.secret-view .plain .mid    { color: var(--foreground); letter-spacing: 0; }
.secret-view.masked .plain .mid {
  color: var(--muted-foreground); letter-spacing: 0.05em;
}
.secret-view .icon-btn {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 3px;
  color: var(--muted-foreground);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.secret-view .icon-btn:hover:not(:disabled) {
  color: var(--foreground);
  background: rgba(255,255,255,0.04);
  border-color: var(--border);
}
.secret-view .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* Drawer action buttons — same .btn system as the toolbar. */
.drawer-section .btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-weight: 600; border-radius: var(--radius-sm);
  border: 1px solid transparent; cursor: pointer;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
  transition: background 150ms ease, border-color 150ms ease, color 120ms ease;
}
.drawer-section .btn-outline {
  background: var(--surface-1, #1f1f23);
  color: var(--foreground);
  border-color: var(--border);
}
.drawer-section .btn-outline:hover:not(:disabled) {
  background: var(--surface-2, #27272a);
  border-color: var(--muted-foreground);
}
.drawer-section .btn-danger {
  background: rgba(239, 68, 68, 0.1); color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.35);
}
.drawer-section .btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18); color: #fecaca;
  border-color: rgba(239, 68, 68, 0.55);
}
.drawer-section .btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ---- Modal ------------------------------------------------- */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 100;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
  transition: opacity 180ms ease;
}
.modal-overlay[data-open="true"] { opacity: 1; pointer-events: auto; }
.modal-panel {
  width: 540px; max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px);
  background: var(--surface-2, #27272a);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 30px 60px -20px rgba(0,0,0,0.6);
  display: flex; flex-direction: column;
  transform: translateY(8px);
  transition: transform 180ms ease;
}
.modal-overlay[data-open="true"] .modal-panel { transform: translateY(0); }
.modal-header, .modal-footer {
  padding: 14px 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.modal-header { border-bottom: 1px solid var(--border); }
.modal-footer {
  border-top: 1px solid var(--border);
  background: rgba(0,0,0,0.15);
  border-bottom-left-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-md);
}
.modal-body {
  padding: 16px 18px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.9rem;
  color: var(--foreground);
}
.modal-body .form-row { display: flex; flex-direction: column; gap: 0.3rem; }
.modal-body .form-label {
  display: inline-flex; align-items: center; gap: 0.35rem;
  /* Aligned with table <th> style 2026-04-25: mono + bold +
     uppercase + muted-foreground. Previously too light (no explicit
     font-weight) which made labels blend into field values. */
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.modal-body .form-help {
  font-size: 12px; color: var(--muted-foreground);
}
.modal-body .req { color: var(--destructive, #ef4444); }
.modal-body .field-input {
  background: var(--surface-1, #1f1f23);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--foreground);
  font-size: 12.5px; padding: 6px 10px;
  width: 100%;
}
.modal-body .field-input:focus {
  outline: none; border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(250, 204, 21,0.15);
}
/* Validation-fail flash — red border + glow pulses twice over ~1s
   so the user's eye is drawn to the offending field even if they
   missed the inline error message. Class is auto-removed after 1.2s
   (timer in AddKeyModal). 2026-04-25. */
.modal-body .field-input.field-input-flash {
  animation: modal-field-flash 0.5s ease-in-out 2;
  border-color: rgba(239, 68, 68, 0.8) !important;
}
.modal-body .field-input.field-input-flash:focus {
  border-color: rgba(239, 68, 68, 0.9) !important;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2) !important;
}
@keyframes modal-field-flash {
  0%, 100% {
    background: var(--surface-1, #1f1f23);
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
  }
  50% {
    background: rgba(239, 68, 68, 0.08);
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.25);
  }
}
.modal-body .seg {
  display: inline-flex; padding: 2px;
  background: var(--surface-1, #1f1f23); border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.modal-body .seg button {
  font-family: var(--font-mono);
  font-size: 10px; letter-spacing: 0.05em;
  padding: 3px 9px; border-radius: 3px;
  color: var(--muted-foreground);
  background: transparent; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.modal-body .seg button.active {
  background: var(--surface-2, #27272a); color: var(--foreground);
  box-shadow: inset 0 0 0 1px var(--border);
}
.modal-footer .btn {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-weight: 600; border-radius: var(--radius-sm);
  border: 1px solid transparent; cursor: pointer;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
}
.modal-footer .btn-primary {
  background: var(--primary); color: var(--primary-foreground);
  border-color: rgba(250, 204, 21, 0.55);
}
.modal-footer .btn-ghost { background: transparent; color: var(--muted-foreground); }
.modal-footer .btn-ghost:hover { color: var(--foreground); background: rgba(0,0,0,0.15); }

.modal-header .icon-btn {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
}
.modal-header .icon-btn:hover {
  color: var(--foreground);
  background: rgba(0,0,0,0.15);
  border-color: var(--border);
}

/* ---- Empty-state panel -------------------------------------- */
/* Rendered when records.length === 0. Mirrors /user/virtual-keys'
   tk-empty card so both "no keys" states read as a visual family. */
.vault-page .vault-empty {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
  padding: 48px 32px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.vault-page .vault-empty-ring {
  width: 56px; height: 56px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  color: var(--primary);
  margin-bottom: 14px;
  box-shadow: 0 0 0 6px rgba(250, 204, 21,0.04);
}
.vault-page .vault-empty-title {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--foreground);
  margin-bottom: 10px;
}
.vault-page .vault-empty-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted-foreground);
  max-width: 420px;
}
.vault-page .vault-empty-link {
  font-family: var(--font-mono);
  color: var(--primary);
  font-size: 12.5px;
  text-decoration: none;
  border-bottom: 1px solid rgba(250, 204, 21,0.35);
  transition: border-color 150ms ease, color 150ms ease;
}
.vault-page .vault-empty-link:hover {
  color: #fde047;
  border-bottom-color: rgba(250, 204, 21,0.7);
}

/* Scrollbar polish — matches Overview v3.1. */
.vault-page ::-webkit-scrollbar { width: 10px; height: 10px; }
.vault-page ::-webkit-scrollbar-track { background: transparent; }
.vault-page ::-webkit-scrollbar-thumb {
  background: var(--surface-2);
  border: 2px solid var(--background);
  border-radius: 6px;
}
.vault-page ::-webkit-scrollbar-thumb:hover { background: var(--muted-foreground); }
`;
