/**
 * Phase 4 阶段 3 — Connected Apps list page (/user/apps).
 *
 * Renders the user's third-party AI agents that have registered with
 * AiKey and may call upstream providers using vault-managed keys.
 *
 * Visual reference: .superdesign/design_iterations/connected_apps_panel_1.html.
 * We translate the mockup's structure into Tailwind + CSS-variable
 * styles so the page matches the existing AiKey control UI rather
 * than introducing a parallel design system.
 *
 * Display scope (Phase 4 阶段 3 revised 2026-05-21): ALL apps are
 * shown regardless of app_kind, including first-party (e.g.
 * degrade-detector). Rationale: the Apps page is the "money/spend
 * view of every agent using my keys", and first-party apps DO use
 * the user's keys (even if via follow-user-active mode), so they
 * belong in the same list for transparency. First-party rows are
 * visually distinguished by a "FIRST-PARTY" badge in the App
 * identity column.
 *
 * Binding empty-state handling: a first-party + follow_user_active=true
 * app legitimately has zero rows in `user_profile_provider_bindings`
 * (it dynamically resolves the user's default `aikey use` selection
 * at request time — see TR-406 E2E for the kept-empty invariant).
 * The previous "No bindings → red BINDING_NOT_FOUND warning" copy
 * would mislabel that working state as broken; we now branch on
 * `follow_user_active` to show the right message.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  appsApi,
  bindingTypeLabel,
  type AppListRow,
  type AppBinding,
  type AppRegisterResponse,
} from '@/shared/api/user/apps';
import { importApi } from '@/shared/api/user/import';
import { VaultStatusPill } from '../_shared/VaultStatusPill';
import { AddAppModal } from './AddAppModal';
import { TokenRevealModal } from './TokenRevealModal';

// ── Helpers ─────────────────────────────────────────────────────────────

/** "4 min ago" / "2 days ago" / "—" for last-used timestamps. */
function relativeTime(unixSeconds: number | null): string {
  if (unixSeconds == null) return '—';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

type RowStatus = 'active' | 'inactive';

/**
 * Derive the displayed row status from the API row. Today the list
 * payload only distinguishes "has an active key" vs "doesn't"; explicit
 * paused/revoked/error states need a richer payload from `_internal
 * app list` (planned for Phase B+ refinement). The hook keeps the
 * derivation in one place so a payload upgrade lands cleanly.
 */
function rowStatus(row: AppListRow): RowStatus {
  return row.has_active_key ? 'active' : 'inactive';
}

/** Two-letter avatar fallback for apps that don't ship a vendor logo. */
function appInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// ── Sub-components ──────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  note?: string;
  color?: string;
}

function MetricCard({ label, value, note, color }: MetricCardProps) {
  return (
    <div
      className="rounded-md border p-3"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--border)',
      }}
    >
      <div
        className="text-[11px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {label}
      </div>
      <div
        className="text-2xl font-semibold mt-1 font-mono"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value}
      </div>
      {note ? (
        <div
          className="text-[11px] mt-0.5"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const isActive = status === 'active';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider"
      style={{ color: isActive ? 'var(--success)' : 'var(--muted-foreground)' }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: isActive ? 'var(--success)' : 'var(--muted-foreground)' }}
      />
      {isActive ? 'Active' : 'No active key'}
    </span>
  );
}

function BindingPill({ binding }: { binding: AppBinding }) {
  return (
    <div
      className="rounded px-2 py-1 text-[12px] font-mono inline-flex items-center gap-2"
      style={{
        background: 'var(--secondary, #3f3f46)',
        color: 'var(--foreground)',
      }}
    >
      <span style={{ color: '#ca8a04' }}>{binding.upstream}</span>
      <span style={{ color: 'var(--muted-foreground)' }}>→</span>
      <span>{binding.key_source_label ?? binding.key_source_ref}</span>
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {bindingTypeLabel(binding.key_source_type)}
      </span>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'inactive';

export default function UserAppsListPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');

  // Add flow state machine:
  //   null  → no modal open (default)
  //   'add' → AddAppModal mounted (user is filling the form)
  //   { kind: 'reveal', payload } → TokenRevealModal mounted with the
  //      register response. Switching from 'add' to 'reveal' atomically
  //      replaces one modal with the other (no flicker, no double-modal).
  type AddFlow =
    | null
    | { kind: 'add' }
    | { kind: 'reveal'; payload: AppRegisterResponse };
  const [addFlow, setAddFlow] = useState<AddFlow>(null);

  const appsQuery = useQuery({
    queryKey: ['user-apps-list'],
    queryFn: appsApi.list,
    refetchInterval: 30_000,
  });

  // Vault status — drives mutation-button gating (locked → disabled +
  // tooltip "Unlock vault first"). The VaultStatusPill in the header
  // owns the user-visible unlock UI; we just read the cached status
  // here to know whether to enable the per-row buttons.
  const vaultQuery = useQuery({
    queryKey: ['vault-status'],
    queryFn: importApi.vaultStatus,
    refetchInterval: 10_000,
    staleTime: 0,
  });
  const vaultLocked = !vaultQuery.data?.unlocked;

  // Show every app the backend returns. The decision to include
  // first-party (e.g. degrade-detector) was made 2026-05-21 — see file
  // header for rationale.
  const allApps = useMemo(
    () => appsQuery.data?.apps ?? [],
    [appsQuery.data],
  );

  // Provider dropdown choices come from the actual data (so we never
  // offer "Anthropic" when no app declares it). Sorted for stable order.
  const providerChoices = useMemo(() => {
    const set = new Set<string>();
    allApps.forEach((app) => app.upstreams.forEach((u) => set.add(u)));
    return Array.from(set).sort();
  }, [allApps]);

  const filtered = useMemo(() => {
    return allApps.filter((app) => {
      if (statusFilter !== 'all') {
        const s = rowStatus(app);
        if (s !== statusFilter) return false;
      }
      if (providerFilter !== 'all') {
        if (!app.upstreams.includes(providerFilter)) return false;
      }
      return true;
    });
  }, [allApps, statusFilter, providerFilter]);

  // Metric summary — counts reflect the WHOLE population (pre status/
  // provider filter) so the cards don't shift when the user toggles a
  // chip; the table below shifts, the totals do not.
  const metrics = useMemo(() => {
    const total = allApps.length;
    let active = 0;
    let inactive = 0;
    allApps.forEach((app) => {
      if (rowStatus(app) === 'active') active++;
      else inactive++;
    });
    return { total, active, inactive };
  }, [allApps]);

  // ── Mutations ─────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['user-apps-list'] });

  const pauseM = useMutation({
    mutationFn: (slug: string) => appsApi.pause(slug),
    onSuccess: invalidate,
  });
  const resumeM = useMutation({
    mutationFn: (slug: string) => appsApi.resume(slug),
    onSuccess: invalidate,
  });
  const revokeM = useMutation({
    mutationFn: (slug: string) => appsApi.revoke(slug),
    onSuccess: invalidate,
  });

  // ── Render ────────────────────────────────────────────────────────────

  if (appsQuery.isLoading) {
    return (
      <section className="p-6">
        <div
          className="rounded-md border p-8 text-center text-sm"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border)',
            color: 'var(--muted-foreground)',
          }}
        >
          Loading connected apps…
        </div>
      </section>
    );
  }

  if (appsQuery.isError) {
    // list endpoint is unlock-free (see shared/api/user/apps.ts header),
    // so this branch only fires on infrastructure errors (CLI subprocess
    // crash, JSON parse failure, network issue). Display the raw message.
    const err = appsQuery.error as Error;
    return (
      <section className="p-6">
        <div
          className="rounded-md border p-6 text-sm"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--destructive, #ef4444)',
            color: 'var(--destructive, #ef4444)',
          }}
        >
          <strong>Failed to load apps.</strong>
          <div className="mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {err.message || 'Unknown error.'}
          </div>
        </div>
      </section>
    );
  }

  // Empty state — when there are no third-party apps at all (typical
  // for a fresh install).
  if (allApps.length === 0) {
    return (
      <section className="p-6" aria-labelledby="apps-title">
        <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1
              id="apps-title"
              className="text-lg font-bold font-mono tracking-wide"
              style={{ color: 'var(--foreground)' }}
            >
              Connected Apps
            </h1>
            <p
              className="text-[12px] mt-1"
              style={{ color: 'var(--muted-foreground)' }}
            >
              These apps can call AI providers through AiKey. They never receive your real provider keys.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddFlow({ kind: 'add' })}
              className="rounded px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider"
              style={{
                background: '#ca8a04',
                color: 'var(--primary-foreground, #18181b)',
              }}
              title="Register a third-party app — get an env block + a one-time bearer."
            >
              + Add App
            </button>
            <VaultStatusPill invalidateOnUnlock={[['user-apps-list']]} />
          </div>
        </header>

        <div
          className="rounded-md border p-8 text-center"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border)',
          }}
        >
          <div
            className="text-base font-semibold"
            style={{ color: 'var(--foreground)' }}
          >
            No connected apps yet
          </div>
          <p
            className="mt-2 text-[13px] max-w-[520px] mx-auto"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Apps appear here once they register with AiKey. Click <strong>+ Add App</strong> above
            to register a third-party agent (e.g. <span className="font-mono">claude-mem</span>),
            or run the CLI command below from your terminal — vendor installers also call this.
          </p>
          <div
            className="mt-4 inline-block rounded px-3 py-2 font-mono text-[12px]"
            style={{
              background: 'var(--secondary, #3f3f46)',
              color: 'var(--foreground)',
            }}
          >
            aikey app register --slug &lt;name&gt; --upstreams &lt;list&gt;
          </div>
        </div>

        {/* Modals (same machine as the populated state — kept identical
            so behaviour matches regardless of whether the user starts
            with zero apps or already has some). */}
        {addFlow?.kind === 'add' ? (
          <AddAppModal
            onClose={() => setAddFlow(null)}
            onRegistered={(payload) => setAddFlow({ kind: 'reveal', payload })}
          />
        ) : null}
        {addFlow?.kind === 'reveal' ? (
          <TokenRevealModal
            result={addFlow.payload}
            onClose={() => setAddFlow(null)}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="p-6" aria-labelledby="apps-title">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1
            id="apps-title"
            className="text-lg font-bold font-mono tracking-wide"
            style={{ color: 'var(--display-foreground)' }}
          >
            Connected Apps
          </h1>
          <p
            className="text-[12px] mt-1"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Third-party agents authorized to use your AiKey-managed keys. They never receive your real provider keys.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAddFlow({ kind: 'add' })}
            className="rounded px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider"
            style={{
              background: '#ca8a04',
              color: 'var(--primary-foreground, #18181b)',
            }}
            title="Register a third-party app — get an env block + a one-time bearer."
          >
            + Add App
          </button>
          <VaultStatusPill invalidateOnUnlock={[['user-apps-list']]} />
        </div>
      </header>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Connected" value={metrics.total} note="registered locally" />
        <MetricCard
          label="Active"
          value={metrics.active}
          color="var(--success)"
          note="ready to call providers"
        />
        <MetricCard
          label="No active key"
          value={metrics.inactive}
          color="var(--muted-foreground)"
          note="register again to issue"
        />
        <MetricCard
          label="Spend (30d)"
          value="—"
          note="coming soon"
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'active', 'inactive'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className="rounded-full px-3 py-1 text-[12px] font-mono uppercase tracking-wider transition-colors"
              style={
                statusFilter === s
                  ? {
                      background: '#ca8a04',
                      color: 'var(--primary-foreground, #18181b)',
                      border: '1px solid #ca8a04',
                    }
                  : {
                      background: 'transparent',
                      color: 'var(--muted-foreground)',
                      border: '1px solid var(--border)',
                    }
              }
            >
              {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'No active key'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
          Provider:
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="rounded px-2 py-1 text-[12px] font-mono"
            style={{
              background: 'var(--card)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            <option value="all">Any</option>
            {providerChoices.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Table */}
      <div
        className="rounded-md border overflow-x-auto"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr
              className="text-left text-[11px] font-mono uppercase tracking-wider"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <th className="px-4 py-3 font-normal">App</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 font-normal">Provider bindings</th>
              <th className="px-4 py-3 font-normal">Last call</th>
              <th className="px-4 py-3 font-normal text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[13px]"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  No apps match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((app) => {
                const status = rowStatus(app);
                const isPending = pauseM.isPending || resumeM.isPending || revokeM.isPending;
                return (
                  <tr
                    key={app.slug}
                    className="border-t"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {/* App identity */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-start gap-3">
                        <div
                          className="rounded w-8 h-8 flex items-center justify-center text-[11px] font-bold font-mono"
                          style={{
                            background: '#ca8a04',
                            color: 'var(--primary-foreground, #18181b)',
                          }}
                        >
                          {appInitials(app.name)}
                        </div>
                        <div className="min-w-0">
                          <div
                            className="font-semibold flex items-center gap-2 flex-wrap"
                            style={{ color: 'var(--foreground)' }}
                          >
                            <Link
                              to={`/user/apps/${app.slug}`}
                              className="hover:underline"
                              style={{ color: 'inherit' }}
                            >
                              {app.name}
                            </Link>
                            {app.app_kind === 'first-party' ? (
                              <span
                                className="rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider"
                                style={{
                                  background: '#ca8a04',
                                  color: 'var(--primary-foreground, #18181b)',
                                }}
                                title="Built-in AiKey component (e.g. degrade-detector). Manageable here but tightly integrated with another panel — see related sidebar entries before changing bindings."
                              >
                                First-party
                              </span>
                            ) : null}
                          </div>
                          <div
                            className="text-[11px] font-mono"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {app.slug}
                          </div>
                          {app.vendor ? (
                            <div
                              className="text-[11px]"
                              style={{ color: 'var(--muted-foreground)' }}
                            >
                              Vendor: {app.vendor}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 align-top">
                      <StatusBadge status={status} />
                    </td>

                    {/* Bindings — empty state is mode-aware:
                        - follow_user_active=true → app dynamically resolves
                          the user's default `aikey use` selection at request
                          time (TR-406 invariant: by design no per-app row
                          exists in user_profile_provider_bindings). Show an
                          INFORMATIONAL message, not a red warning.
                        - follow_user_active=false → app uses static
                          per-binding lookup, so empty really IS broken;
                          runtime would return BINDING_NOT_FOUND. Show a red
                          warning so the user knows to fix it. */}
                    <td className="px-4 py-3 align-top">
                      {app.bindings.length === 0 ? (
                        app.follow_user_active ? (
                          <span
                            className="text-[12px]"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            Uses your default key dynamically (<code className="font-mono">aikey use</code> selection)
                          </span>
                        ) : (
                          <span
                            className="text-[12px]"
                            style={{ color: 'var(--destructive, #ef4444)' }}
                          >
                            No bindings · runtime calls will fail with BINDING_NOT_FOUND
                          </span>
                        )
                      ) : (
                        <div className="flex flex-col gap-1">
                          {app.bindings.map((b) => (
                            <BindingPill key={`${app.slug}-${b.upstream}`} binding={b} />
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Last call */}
                    <td className="px-4 py-3 align-top">
                      <span
                        className="font-mono text-[12px]"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {relativeTime(app.last_used_at)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 align-top text-right">
                      <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                        <Link
                          to={`/user/apps/${app.slug}`}
                          className="rounded border px-2 py-1 text-[11px] font-mono uppercase tracking-wider"
                          style={{
                            background: 'transparent',
                            color: 'var(--foreground)',
                            borderColor: 'var(--border)',
                          }}
                        >
                          Open
                        </Link>
                        {/*
                          Pause / Resume disabled for first-party apps for the
                          same reason as Revoke: ensure_first_party_app_keys
                          self-heals paused / revoked rows back to active on
                          the next CLI startup, so the UI action is at best a
                          transient 401 that auto-flips back. (2026-05-23, see
                          Revoke gating note below for full reasoning.)
                        */}
                        {status === 'active' ? (
                          <button
                            type="button"
                            disabled={isPending || vaultLocked || app.app_kind === 'first-party'}
                            title={
                              app.app_kind === 'first-party'
                                ? 'First-party app state is self-healing and cannot be paused from the UI. Stop the plugin service itself to halt traffic.'
                                : vaultLocked
                                ? 'Unlock vault first'
                                : undefined
                            }
                            onClick={() => pauseM.mutate(app.slug)}
                            className="rounded border px-2 py-1 text-[11px] font-mono uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              background: 'transparent',
                              color: 'var(--foreground)',
                              borderColor: 'var(--border)',
                            }}
                          >
                            Pause
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending || vaultLocked || app.app_kind === 'first-party'}
                            title={
                              app.app_kind === 'first-party'
                                ? 'First-party app state is self-healing and cannot be resumed from the UI (the next CLI startup auto-recovers active state).'
                                : vaultLocked
                                ? 'Unlock vault first'
                                : undefined
                            }
                            onClick={() => resumeM.mutate(app.slug)}
                            className="rounded border px-2 py-1 text-[11px] font-mono uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              background: 'transparent',
                              color: 'var(--foreground)',
                              borderColor: 'var(--border)',
                            }}
                          >
                            Resume
                          </button>
                        )}
                        {/*
                          Revoke is disabled for first-party apps because their
                          bearer + app_record row are re-asserted by
                          `ensure_first_party_app_keys` self-heal on the next
                          CLI startup (see aikey-cli migrations.rs §self-heal).
                          A revoke would 401 the running plugin for a few
                          seconds then auto-recreate — disruptive AND
                          ineffective. To actually remove a first-party app
                          the user must uninstall the plugin itself.
                          (2026-05-23, mirrors Switch button Mode B gating
                          on the detail page.)
                        */}
                        <button
                          type="button"
                          disabled={isPending || vaultLocked || app.app_kind === 'first-party'}
                          title={
                            app.app_kind === 'first-party'
                              ? 'First-party app bearer is self-healing and cannot be revoked from the UI. Uninstall the plugin itself to remove the app.'
                              : vaultLocked
                              ? 'Unlock vault first'
                              : undefined
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke all active keys for "${app.name}"?\n\nThe agent will immediately return 401 on its next request. The app record stays — re-register to issue a new bearer.\n\nThis cannot be undone.`,
                              )
                            ) {
                              revokeM.mutate(app.slug);
                            }
                          }}
                          className="rounded border px-2 py-1 text-[11px] font-mono uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            background: 'transparent',
                            color: 'var(--destructive, #ef4444)',
                            borderColor: 'var(--destructive, #ef4444)',
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mutation error surfacing — keep simple; React Query also exposes
          errors on row buttons via their disabled states. */}
      {(pauseM.error || resumeM.error || revokeM.error) ? (
        <div
          className="mt-3 rounded p-2 text-[12px] font-mono"
          style={{
            background: 'var(--card)',
            color: 'var(--destructive, #ef4444)',
            border: '1px solid var(--destructive, #ef4444)',
          }}
          role="alert"
        >
          Last action failed:{' '}
          {(pauseM.error || resumeM.error || revokeM.error)?.message ?? 'unknown'}
        </div>
      ) : null}

      {/* Add → Reveal modal state machine. AddAppModal closes itself on
          Cancel; on success it calls onRegistered which swaps the
          state to 'reveal' (TokenRevealModal mounts in its place).
          TokenRevealModal's Done button closes the flow entirely. */}
      {addFlow?.kind === 'add' ? (
        <AddAppModal
          onClose={() => setAddFlow(null)}
          onRegistered={(payload) => setAddFlow({ kind: 'reveal', payload })}
        />
      ) : null}
      {addFlow?.kind === 'reveal' ? (
        <TokenRevealModal
          result={addFlow.payload}
          onClose={() => setAddFlow(null)}
        />
      ) : null}
    </section>
  );
}
