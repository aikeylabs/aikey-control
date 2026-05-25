/**
 * User Trust Check page — /user/trust-check
 *
 * M5 Day 4: SOURCE/BAND tab switching + detail drawer.
 *
 *  - SOURCE tab (default): single flat table of every alias.
 *  - BAND tab: same rows, grouped by trust band (Risky → Suspect →
 *    Trusted → Unverified) with each section sorted by most-recent
 *    check time. The grouping is pure front-end derivation; no
 *    additional endpoint.
 *  - Detail drawer: clicking a row opens a slide-over with sub-scores
 *    (L1/L2/L3/combined), cascade history (last 10 verifies), and
 *    signals_summary. Fetches `GET /v1/status/{alias}`.
 *
 * Day 5: i18n + chrome-mcp E2E + `make e2e-trust-check` driver.
 *
 * File-size budget: index.tsx coordinates state and routes to sibling
 * files. SourceTable / drawer / icons / hooks / derive each own their
 * domain — keep this file under ~400 lines per the splitting rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { VerifyRecord, TrustSummary } from './api';
import {
  computeHealthSummary,
  dedupByBaseUrl,
  groupByBand,
  type BaseUrlGroup,
  type HealthSummary,
  type TrustRow,
} from './derive';
import { AliasDetailDrawer } from './drawer';
import {
  useAliasDetail,
  useRealtimeDetection,
  useStartTrustLocalService,
  useTriggerVerify,
  useTrustView,
  useVerifyPolling,
} from './hooks';
import { GaugeIcon, KeyIcon, RefreshIcon, ScanIcon } from './icons';
import { SourceTable, type VerifyErrorState } from './table';
import { TRUST_CHECK_CSS } from './trust-check-css';

// Real filter chips (Day 5 post-A2). The UI template originally had
// 11 chips + 2 select-pills but most of them needed data trust-local
// doesn't carry (per-app slot binding, edition tag, oauth vs key
// classification) — they were placeholders for a future
// usage-ledger join. We dropped those instead of faking them; they
// can come back when M5.2 / M6 wires the actual data sources.
//
// What stays:
//   - "in use": last_verify_result != "never" (at least one verify ran)
//   - "not checked": last_verified_at == null
// What's gone: app1/2/3, team, personal, oauth, KEY, trial,
// production, the "Any status" pill, the "Last 24h" pill.
//
// Filters compose with AND. Empty filter set = show all rows.
type ChipKey = 'in_use' | 'not_checked';

const CHIPS: { key: ChipKey; label: string }[] = [
  { key: 'in_use', label: 'in use' },
  { key: 'not_checked', label: 'not checked' },
];

function matchesChip(row: TrustRow, key: ChipKey): boolean {
  switch (key) {
    case 'in_use':
      // Read the plugin-supplied flag directly. The "is this alias
      // currently `aikey use`-selected" decision lives in
      // server_local/services/in_use.py, NOT here — web is passthrough.
      return row.is_in_use;
    case 'not_checked':
      // Trust data freshness, not vault state — `checked === 'never'`
      // covers both "in-use but unverified" and "stale historical
      // never-verified". Same field web has always had; not a plugin
      // concept, just a derive.ts helper output.
      return row.checked === 'never';
  }
}

export default function UserTrustCheckPage() {
  const [activeTab, setActiveTab] = useState<'source' | 'band'>('source');
  const [expandedAlias, setExpandedAlias] = useState<string | null>(null);

  // Filter state — toggleable chips + free-text search. Plain useState
  // (not zustand) because nothing outside this page consumes it; URL-
  // sync (?chip=…&q=…) is an obvious Day-N future improvement when we
  // have a deeplink need.
  const [activeChips, setActiveChips] = useState<Set<ChipKey>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const { status, rows: allRows, metrics, isOffline, summaries } = useTrustView();
  // Apply filter chips + search BEFORE the table render. We filter
  // `rows` here so both SOURCE and BAND views see the same subset and
  // the same filter has the same effect across tabs.
  const rows = useMemo<TrustRow[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    return allRows.filter((r) => {
      // Chips compose with OR (any active chip matches keeps the row);
      // empty chip set = pass everything. OR semantics match how
      // ops dashboards usually expect chip-toggles to work — "show me
      // either of these subsets", not "the intersection".
      if (activeChips.size > 0) {
        const matches = Array.from(activeChips).some((k) => matchesChip(r, k));
        if (!matches) return false;
      }
      if (q.length > 0) {
        const hay = `${r.alias_name} ${r.source_name} ${r.source_meta} ${r.model} ${r.provider}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, activeChips, searchQuery]);
  const isFiltered = activeChips.size > 0 || searchQuery.trim().length > 0;

  const isLoading = status.isLoading;
  const loadError = status.error && !isOffline ? status.error : null;
  // "no rows" has two flavours: truly empty (no aliases observed) vs
  // filtered-empty (filters too restrictive). We display different
  // copy in TablePanelBody for each.
  const isEmpty = !isLoading && !isOffline && !loadError && allRows.length === 0;
  const isFilteredEmpty =
    !isLoading && !isOffline && !loadError && allRows.length > 0 && rows.length === 0;

  const toggleChip = useCallback((key: ChipKey) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveChips(new Set());
    setSearchQuery('');
  }, []);

  // ── Verify state ────────────────────────────────────────────
  // `inFlight[alias_name]` = verify_id while a cascade is running.
  // Stored at page level so the bulk "Run checks" button + the per-row
  // button see the same truth.
  const [inFlight, setInFlight] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, VerifyErrorState>>({});

  const verify = useTriggerVerify();
  const qc = useQueryClient();

  // Map verify_id → alias so polling completions know which row to clear.
  // Ref because no render needs to read it.
  const verifyIdToAlias = useRef<Record<string, string>>({});

  const inFlightIds = useMemo(() => Object.values(inFlight), [inFlight]);
  const verifyResults = useVerifyPolling(inFlightIds);

  // Detail drawer query — disabled (no fetch) while no row is expanded.
  const detail = useAliasDetail(expandedAlias);

  // Watch polling results for terminal transitions. When status leaves
  // "running", clear the alias from inFlight + invalidate the parent
  // /v1/status query so the row refreshes its score/band, and
  // invalidate the drawer detail too if it happens to be open on this
  // alias.
  useEffect(() => {
    let mutated = false;
    const nextInFlight = { ...inFlight };
    const nextErrors = { ...errors };
    const completedAliases: string[] = [];

    for (const result of verifyResults) {
      const data = result.data;
      if (!data || data.status === 'running') continue;
      const alias = verifyIdToAlias.current[data.verify_id];
      if (!alias || !(alias in nextInFlight)) continue;
      delete nextInFlight[alias];
      completedAliases.push(alias);
      mutated = true;
      // Stage 2.6 (2026-05-22) added `'error'` as a terminal status for
      // upstream / config failures (cascade_real._write_error writes it
      // explicitly + commits). Old M5 code only knew 'fail' /
      // 'inconclusive' — missing the 'error' branch silently dropped
      // upstream-failure surfacing from the row chip. See bugfix doc:
      // 2026-05-22-cascade-error-paths-missed-commit.md.
      const isFailure =
        data.status === 'fail' ||
        data.status === 'failed' ||
        data.status === 'error' ||
        data.status === 'inconclusive';
      if (isFailure) {
        const fallbackByStatus: Record<string, string> = {
          fail:         'Cascade verify came back as fail.',
          failed:       'Cascade verify came back as failed.',
          error:        'Cascade verify hit an error before completing — see message.',
          inconclusive: 'Cascade verify was inconclusive — retry to refine the score.',
        };
        nextErrors[alias] = {
          kind: 'verify_terminal',
          status: data.status,
          message: data.error_message || fallbackByStatus[data.status] || 'Cascade verify did not pass.',
        };
      } else {
        delete nextErrors[alias];
      }
    }
    if (mutated) {
      setInFlight(nextInFlight);
      setErrors(nextErrors);
      void qc.invalidateQueries({ queryKey: ['trust-local', 'status'] });
      // Refresh the drawer if the user is staring at one of the
      // aliases that just finished.
      if (expandedAlias && completedAliases.includes(expandedAlias)) {
        void qc.invalidateQueries({
          queryKey: ['trust-local', 'detail', expandedAlias],
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyResults, qc]);

  // Per-row + bulk verify trigger. Returns the verify_id (or null on
  // error) so the bulk caller can serialise without re-querying the
  // in-flight map.
  const triggerVerifyFor = useCallback(
    async (row: TrustRow, opts: { force?: boolean } = {}): Promise<string | null> => {
      if (inFlight[row.alias_name]) return inFlight[row.alias_name];
      try {
        const rec = await verify.mutateAsync({
          alias_name: row.alias_name,
          provider_id: row.provider,
          model: row.model,
          force: opts.force ?? false,
        });
        verifyIdToAlias.current[rec.verify_id] = row.alias_name;
        setInFlight((s) => ({ ...s, [row.alias_name]: rec.verify_id }));
        setErrors((e) => {
          if (!(row.alias_name in e)) return e;
          const next = { ...e };
          delete next[row.alias_name];
          return next;
        });
        return rec.verify_id;
      } catch (err) {
        // M6 decision 3.1: no rate-limit lane on the manual path. All
        // failures go through the generic error state.
        setErrors((s) => ({
          ...s,
          [row.alias_name]: {
            kind: 'generic',
            message: err instanceof Error ? err.message : String(err),
          },
        }));
        return null;
      }
    },
    [verify, inFlight],
  );

  // Bulk "Run checks": serial fan-out across visible rows. Serial
  // (vs parallel) because one L3 cascade burns ~30s of upstream
  // tokens — parallel × N would be costly + risk trust-local CPU
  // contention. Errors per row don't abort the batch.
  const [bulkRunning, setBulkRunning] = useState(false);
  const onRunChecks = useCallback(async () => {
    if (bulkRunning) return;
    setBulkRunning(true);
    try {
      for (const row of rows) {
        if (inFlight[row.alias_name]) continue;
        await triggerVerifyFor(row);
      }
    } finally {
      setBulkRunning(false);
    }
  }, [bulkRunning, rows, inFlight, triggerVerifyFor]);

  const onRefresh = () => void status.refetch();

  // Service-restart button on the offline banner. We don't auto-
  // invalidate the status query on success — the 30s background tick
  // (and the explicit Refresh button) picks up the new live state.
  // Showing the mutation's own pending/error state on the banner is
  // enough feedback without racing manual re-fetches.
  const startService = useStartTrustLocalService();
  const onRowClick = useCallback((row: TrustRow) => {
    setExpandedAlias((prev) => (prev === row.alias_name ? null : row.alias_name));
  }, []);
  const onCloseDrawer = useCallback(() => setExpandedAlias(null), []);

  // Build a verify_id → record map once per render so the table can
  // look up progress without an O(N×M) scan in the row body.
  const verifyById: Record<string, VerifyRecord> = useMemo(() => {
    const out: Record<string, VerifyRecord> = {};
    for (const r of verifyResults) {
      if (r.data) out[r.data.verify_id] = r.data;
    }
    return out;
  }, [verifyResults]);

  return (
    <div className="trust-check-page">
      <style>{TRUST_CHECK_CSS}</style>

      <header className="tc-header">
        <div className="tc-header-title">
          {/* H1 aligned to "Trust Check" 2026-05-23 — matches the
              sidebar nav label + route directory + .trust-check-page
              CSS namespace + "Run Checks" / "Check History" UI copy.
              Per drawer.tsx terminology comment (2026-05-22 v2),
              user-facing strings use the action name "Check". The
              technical package name "Degrade Detector" lives in the
              repo path + marketing copy; the underlying engine
              "trust-local" still appears in the subtitle. */}
          <h1 className="tc-title">Trust Check</h1>
          <span
            className={`tc-observer-pill ${isOffline ? 'tc-observer-off' : 'tc-observer-on'}`}
            title={
              isOffline
                ? 'trust-local is offline — observer is not collecting evidence'
                : 'trust-local is up — observer is collecting evidence'
            }
          >
            <span className="tc-observer-dot" />
            {isOffline ? 'OBSERVER OFFLINE' : 'OBSERVER ON'}
          </span>
          <p className="tc-subtitle">
            Trust signals across your provider sources · powered by trust-local
          </p>
        </div>
        <div className="tc-header-actions">
          <RealtimeDetectionToggle />
          <button
            type="button"
            className="tc-btn"
            onClick={onRefresh}
            disabled={isLoading || status.isFetching}
            title={status.isFetching ? 'Refreshing…' : 'Re-fetch /v1/status now'}
          >
            <RefreshIcon />
            {status.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="tc-btn tc-btn-primary"
            onClick={() => void onRunChecks()}
            disabled={
              bulkRunning ||
              isLoading ||
              isOffline ||
              rows.length === 0 ||
              rows.every((r) => inFlight[r.alias_name])
            }
            title={
              isOffline
                ? 'trust-local is offline'
                : bulkRunning
                  ? 'Running checks across visible rows…'
                  : 'Trigger a Check run for every row in the table'
            }
          >
            <ScanIcon />
            {bulkRunning ? 'Running…' : 'Run checks'}
          </button>
        </div>
      </header>

      {isOffline && (() => {
        // Two distinct cold states share the `isOffline` flag, but the
        // user-facing remediation differs and we MUST differentiate —
        // pointing a not-installed user at `aikey service restart` is
        // misleading and steers them away from the actual fix
        // (`aikey app install`). Bugfix:
        // 20260525-trust-check-web-uninstalled-vs-offline-confusion.md.
        //
        // The error code comes from the console envelope which forwards
        // the CLI's `{"ok":false, "error":"TRUST_LOCAL_NOT_INSTALLED"}`
        // JSON. See hooks.ts::StartServiceError for the typed shape.
        const notInstalled =
          startService.isError &&
          startService.error?.errorCode === 'TRUST_LOCAL_NOT_INSTALLED';
        return (
          <div className="tc-banner tc-banner-offline" role="status">
            <span className="tc-banner-dot" />
            <div className="tc-banner-body">
              <div>
                {notInstalled ? (
                  <>
                    <strong>Trust Check is not installed.</strong>{' '}
                    Run{' '}
                    <code>aikey app install degrade-detector</code> in a
                    terminal to install the trust-local service
                    (~23MB binary, runs on 127.0.0.1:8801).
                  </>
                ) : (
                  <>
                    <strong>trust-local is offline.</strong>{' '}
                    {startService.isError ? (
                      <span className="tc-banner-err">
                        Couldn't start it: {startService.error?.detail}.
                        Try <code>aikey service restart trust-local</code>{' '}
                        in a terminal.
                      </span>
                    ) : (
                      <>
                        Click <strong>Start service</strong> to relaunch
                        it, or run{' '}
                        <code>aikey service start trust-local</code> in
                        a terminal. The page auto-recovers on next 30s
                        tick.
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            {!notInstalled && (
              <button
                type="button"
                className="tc-btn tc-btn-primary tc-banner-action"
                onClick={() => startService.mutate()}
                disabled={startService.isPending}
                title="POST /api/internal/services/trust-local/start (local-server shells out to launchctl)"
              >
                {startService.isPending ? 'Starting…' : 'Start service'}
              </button>
            )}
          </div>
        );
      })()}

      <HealthOverviewPanel isLoading={isLoading} summaries={summaries} />


      <section className="tc-panel" data-origin-name="Trust table">
        <div className="tc-panel-header">
          <div className="tc-tabs" role="tablist" aria-label="Trust table mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'source'}
              className={`tc-tab-btn ${activeTab === 'source' ? 'active' : ''}`}
              onClick={() => setActiveTab('source')}
            >
              <KeyIcon />
              SOURCE
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'band'}
              className={`tc-tab-btn ${activeTab === 'band' ? 'active' : ''}`}
              onClick={() => setActiveTab('band')}
            >
              <GaugeIcon />
              BAND
            </button>
            <span className="tc-tab-hint">
              BAND is sorted by latest detection time, not by rank.
            </span>
          </div>

          <div className="tc-filters" data-source-filters>
            {CHIPS.map((chip) => {
              const active = activeChips.has(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  className={`tc-chip ${active ? 'active' : ''}`}
                  onClick={() => toggleChip(chip.key)}
                  aria-pressed={active}
                  title={`Toggle "${chip.label}" filter`}
                >
                  {chip.label}
                </button>
              );
            })}
            {isFiltered && (
              <button
                type="button"
                className="tc-chip tc-chip-clear"
                onClick={clearFilters}
                title="Clear all filters"
              >
                clear
              </button>
            )}
          </div>

          <div className="tc-search-row">
            <input
              className="tc-search"
              placeholder="Search alias, source, model, provider…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search rows"
            />
          </div>
        </div>

        <TablePanelBody
          activeTab={activeTab}
          isLoading={isLoading}
          isOffline={isOffline}
          isEmpty={isEmpty}
          isFilteredEmpty={isFilteredEmpty}
          loadError={loadError}
          rows={rows}
          summaries={summaries}
          inFlight={inFlight}
          errors={errors}
          verifyById={verifyById}
          expandedAlias={expandedAlias}
          onCheck={triggerVerifyFor}
          onRowClick={onRowClick}
          onClearFilters={clearFilters}
        />
      </section>

      {expandedAlias && (
        <AliasDetailDrawer
          alias={expandedAlias}
          detail={detail.data}
          isLoading={detail.isLoading}
          error={detail.error}
          onClose={onCloseDrawer}
          onRemoved={onCloseDrawer}
        />
      )}

      {/* 2026-05-23: page-foot disclaimer. Paired with the harmonic-mean
          Score redesign + "replicate ≥ 3 times" guidance in the drawer
          nullReason. Together these answer the provider-pushback risk
          identified when raw MIN (15/100) was read as a verdict.
          Wording mirrors degrade-detector/docs/user-guide.zh.md "结果
          怎么读" section — keep the two in sync if either changes. */}
      <footer className="tc-disclaimer" aria-label="About these results">
        <p className="tc-disclaimer-title">About these results</p>
        <ul>
          <li>
            A single Check is <strong>one observation, not a verdict</strong>.
            Replicate ≥ 3 times and look for a consistently low layer before
            treating an anomaly as evidence.
          </li>
          <li>
            All data stays <strong>on your machine</strong>. Degrade detection
            does not upload your conversations, KEYs, or Check results.
          </li>
          <li>
            AiKey does <strong>not certify or de-certify any provider</strong>.
            Scores reflect this run's measurement against a healthy baseline;
            they are informational, not endorsements or accusations.
          </li>
          <li>
            Heuristic statistical detection has <strong>false positives and
            false negatives</strong>. Verify independently before taking
            action (refund, switching providers, public posts).
          </li>
          <li>
            Tool provided as-is. AiKey is not liable for decisions made on
            the basis of these results.
          </li>
        </ul>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TablePanelBody — switches between loading / offline / error / empty
// states, and dispatches the table render to either the flat SOURCE
// view or the grouped BAND view.
// ---------------------------------------------------------------------------

function TablePanelBody({
  activeTab,
  isLoading,
  isOffline,
  isEmpty,
  isFilteredEmpty,
  loadError,
  rows,
  summaries,
  inFlight,
  errors,
  verifyById,
  expandedAlias,
  onCheck,
  onRowClick,
  onClearFilters,
}: {
  activeTab: 'source' | 'band';
  isLoading: boolean;
  isOffline: boolean;
  isEmpty: boolean;
  isFilteredEmpty: boolean;
  loadError: Error | null;
  rows: TrustRow[];
  summaries: ReturnType<typeof useTrustView>['summaries'];
  inFlight: Record<string, string>;
  errors: Record<string, VerifyErrorState>;
  verifyById: Record<string, VerifyRecord>;
  expandedAlias: string | null;
  onCheck: (row: TrustRow, opts?: { force?: boolean }) => Promise<string | null>;
  onRowClick: (row: TrustRow) => void;
  onClearFilters: () => void;
}) {
  if (isLoading) {
    return (
      <div className="tc-empty">
        <span className="tc-spin-dot tc-spin-dot-lg" />
        <div className="tc-empty-title">Loading trust signals…</div>
        <div className="tc-empty-note">Fetching /v1/status from trust-local</div>
      </div>
    );
  }
  if (isOffline) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-title">No data while trust-local is offline.</div>
        <div className="tc-empty-note">
          Rows refresh automatically once the service is back up.
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-title">Couldn't load trust signals.</div>
        <div className="tc-empty-note">{loadError.message}</div>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-title">No sources observed yet.</div>
        <div className="tc-empty-note">
          Send a request through aikey-proxy — once trust-local sees one
          observation it shows up here automatically.
        </div>
      </div>
    );
  }
  if (isFilteredEmpty) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-title">No rows match the current filter.</div>
        <div className="tc-empty-note">
          Try toggling a chip off, broadening the search, or{' '}
          <button
            type="button"
            className="tc-empty-link"
            onClick={onClearFilters}
          >
            clear all filters
          </button>
          .
        </div>
      </div>
    );
  }
  const commonTableProps = {
    inFlight,
    errors,
    verifyById,
    expandedAlias,
    onCheck,
    onRowClick,
  };
  if (activeTab === 'band') {
    // Stage 7 (2026-05-22): BAND tab = baseurl dedup. Single source of
    // truth for `base_url` is vault → /v1/status; web does NOT
    // re-derive. See memory: no-proxy-restart-for-vault-mutations
    // sibling spec and three-lane-flow doc §1.
    const groups = dedupByBaseUrl(rows);
    return (
      <BaseUrlList
        groups={groups}
        inFlight={inFlight}
        errors={errors}
        verifyById={verifyById}
        expandedAlias={expandedAlias}
        onCheck={onCheck}
        onRowClick={onRowClick}
      />
    );
  }
  // Suppress lint warning on the now-unused groupByBand import — band
  // grouping is no longer the BAND tab semantic, but the helper is
  // still exported in case future ops dashboards want it.
  void groupByBand;
  void summaries;
  return <SourceTable rows={rows} {...commonTableProps} />;
}

// ---------------------------------------------------------------------------
// HealthOverviewPanel — Stage 7 (2026-05-22) hero card.
//
// Replaces the M5 4-card metric grid with a single panel matching the
// template's `.health-overview` shape: left = circular gauge of overall
// 24h health, right = one-line description + stat grid. All numbers
// come from `computeHealthSummary` in derive.ts — keeping this component
// dumb makes it trivial to retest the formula independently of the UI.
//
// CSS-only: the ring uses a `conic-gradient` background driven by
// `--health-pct`; no SVG, no canvas. The stats grid is a regular
// CSS grid; collapses to a stack on narrow screens via the existing
// `@media (max-width: 1024px)` breakpoint shared with the table panel.
// ---------------------------------------------------------------------------

function HealthOverviewPanel({
  isLoading,
  summaries,
}: {
  isLoading: boolean;
  summaries: TrustSummary[];
}) {
  const health: HealthSummary = computeHealthSummary(summaries);
  const ringDisplay = isLoading
    ? '—'
    : health.overallPct == null
      ? '—'
      : String(health.overallPct);
  // Ring fill % drives the conic-gradient. 0 when no data so the ring
  // renders as an empty track instead of a misleading "100% red" wedge.
  const ringFill = health.overallPct ?? 0;
  // Map band → token for the ring stroke colour. Single source of band
  // rules lives in derive.deriveBand; the colour mapping is purely
  // presentational and kept here.
  const ringColor =
    health.band === 'trust'
      ? 'var(--tc-trust)'
      : health.band === 'suspect'
        ? 'var(--warning)'
        : health.band === 'risk'
          ? 'var(--destructive)'
          : 'var(--muted-foreground)';

  return (
    <section
      className="tc-health-panel"
      data-origin-name="Health overview"
      aria-label={`Overall health ${ringDisplay} percent`}
    >
      <div
        className="tc-health-ring"
        style={{
          ['--health-pct' as string]: `${ringFill}%`,
          ['--health-color' as string]: ringColor,
        }}
      >
        <div className="tc-health-ring-inner">
          <div className="tc-health-score">{ringDisplay}</div>
          <div className="tc-health-score-label">Health</div>
        </div>
      </div>
      <div className="tc-health-copy">
        <div className="tc-health-head">
          <div>
            <h2 className="tc-health-title">
              {isLoading ? 'Loading 24h health…' : 'Overall source health'}
            </h2>
            <p className="tc-health-desc">
              {isLoading ? ' ' : health.description}
            </p>
          </div>
          <span className="tc-health-window">Last 24h</span>
        </div>
        <div className="tc-health-stats">
          <HealthStat
            label="Checked Accounts"
            value={
              isLoading
                ? '—'
                : `${health.checkedCount} / ${health.totalCount}`
            }
            note="KEY + OAuth sources verified in 24h"
          />
          <HealthStat
            label="Healthy"
            value={isLoading ? '—' : health.healthyCount}
            note="safe for normal use"
            color="var(--tc-trust)"
          />
          <HealthStat
            label="Needs Review"
            value={isLoading ? '—' : health.needsReviewCount}
            note="route drift or stale checks"
            color="var(--warning)"
          />
        </div>
      </div>
    </section>
  );
}

function HealthStat({
  label,
  value,
  note,
  color,
}: {
  label: string;
  value: number | string;
  note: string;
  color?: string;
}) {
  return (
    <div className="tc-health-stat">
      <div className="tc-health-stat-label">{label}</div>
      <div className="tc-health-stat-value" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="tc-health-stat-note">{note}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BaseUrlList — Stage 7 (2026-05-22) BAND-tab view.
//
// Renders one row per unique `base_url` group (computed in derive.ts).
// Replaces the M5 band-grouped sections with a flat dedup'd list. The
// representative row (worst-band member) drives the row's score + the
// per-row Check button; clicking opens the drawer for that alias.
//
// Why not reuse SourceTable: each group row carries metadata that
// SourceTable's columns don't (alias count, gateway label). Repurposing
// SourceTable would require introducing optional cells — cleaner to
// give baseurl-dedup its own short markup that mirrors the same
// padding/typography tokens via the .tc-band-row* classes.
// ---------------------------------------------------------------------------

function BaseUrlList({
  groups,
  inFlight,
  errors,
  verifyById,
  expandedAlias,
  onCheck,
  onRowClick,
}: {
  groups: BaseUrlGroup[];
  inFlight: Record<string, string>;
  errors: Record<string, VerifyErrorState>;
  verifyById: Record<string, VerifyRecord>;
  expandedAlias: string | null;
  onCheck: (row: TrustRow, opts?: { force?: boolean }) => Promise<string | null>;
  onRowClick: (row: TrustRow) => void;
}) {
  void errors;
  void verifyById;
  if (groups.length === 0) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-title">No gateways to show.</div>
        <div className="tc-empty-note">
          Once trust-local sees credentials with a base_url they appear
          here, deduped by gateway.
        </div>
      </div>
    );
  }
  return (
    <div className="tc-band-view">
      <div className="tc-band-note">
        <div>
          <strong>By base URL</strong>
          <span style={{ marginLeft: 8 }}>
            One row per unique gateway. Aliases sharing a base URL collapse
            into a single row — vault is the single source of truth.
          </span>
        </div>
        <span className="tc-mono">latest first</span>
      </div>
      <div className="tc-baseurl-list">
        {groups.map((group) => {
          const rep = group.representative;
          const running = !!inFlight[rep.alias_name];
          const isExpanded = expandedAlias === rep.alias_name;
          return (
            <div
              key={group.base_url || `__unknown__:${rep.alias_name}`}
              className={`tc-baseurl-row tc-band-${group.band} ${isExpanded ? 'selected' : ''}`}
              onClick={(ev) => {
                const target = ev.target as HTMLElement;
                if (target.closest('button')) return;
                onRowClick(rep);
              }}
              title="Click to view cascade history for representative alias"
            >
              <div className="tc-baseurl-cell tc-baseurl-gateway">
                <strong>{group.label}</strong>
                <span className="tc-mono tc-baseurl-sub">
                  {group.rows.length} alias{group.rows.length === 1 ? '' : 'es'}
                  {' · '}
                  {group.rows
                    .map((r) => r.alias_name)
                    .slice(0, 3)
                    .join(', ')}
                  {group.rows.length > 3 ? '…' : ''}
                </span>
              </div>
              <div className="tc-baseurl-cell">
                <span className="tc-mono tc-baseurl-sub">Confidence</span>
                <div className={`tc-score-wrap tc-band-${group.band}`}>
                  <div className="tc-score-head">
                    <span>{rep.score || '—'}</span>
                    <span className={`tc-pill tc-pill-${group.band}`}>
                      {rep.band_label}
                    </span>
                  </div>
                </div>
              </div>
              <div className="tc-baseurl-cell">
                <span className="tc-mono tc-baseurl-sub">Last Check</span>
                <div className="tc-mono">{rep.checked}</div>
              </div>
              <div className="tc-baseurl-cell tc-baseurl-action">
                <button
                  type="button"
                  className="tc-btn"
                  disabled={running}
                  onClick={() => void onCheck(rep)}
                  title={`Trigger a Check run for ${rep.alias_name}`}
                >
                  {running ? 'Checking…' : 'Check'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RealtimeDetectionToggle — top-right control (2026-05-23) that flips
// the proxy-side D-rule scoring for user_chat traffic. Default OFF, so
// existing operators see no behaviour change until they opt in. Flip
// here writes to trust-local's settings row; proxy picks up the change
// via 5s poll (see degrade-detector/proxy-plugin/rhythm/
// settings_poller.go). UI hint mentions the ~5s lag so the operator
// isn't confused when their next chat doesn't immediately produce a
// D-rule observation.
//
// Visual: simple amber switch matching the page's dark theme; not an
// iOS-style slider (no shared switch component in the project yet, and
// introducing one for this single control would violate the
// "ui-redesign-feature-and-visual-consistency" principle).
// ---------------------------------------------------------------------------

function RealtimeDetectionToggle() {
  const { query, setEnabled } = useRealtimeDetection();
  const enabled = !!query.data?.enabled;
  const isLoading = query.isLoading || setEnabled.isPending;

  // When the GET itself failed (trust-local offline), hide the toggle
  // entirely — the OFFLINE pill in the header already tells the user
  // why, and showing a half-broken switch they can't flip is worse
  // than no switch at all.
  if (query.isError) {
    return null;
  }

  const onClick = () => {
    if (isLoading) return;
    setEnabled.mutate(!enabled);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Real-time degrade detection"
      className={`tc-realtime-toggle ${enabled ? 'on' : 'off'}`}
      onClick={onClick}
      disabled={isLoading}
      title={
        enabled
          ? 'Real-time detection ON — D-rules (D4/D5/D6) run on every user chat through the proxy. ' +
            'Click to disable. Up to 5s before the proxy picks up the change.'
          : 'Real-time detection OFF (default). Click to enable D-rules ' +
            '(D4/D5/D6) on every user chat through the proxy. Up to 5s before ' +
            'the proxy picks up the change. Per-chat overhead: ~5-10ns per SSE chunk.'
      }
    >
      <span className="tc-realtime-toggle-track" aria-hidden>
        <span className="tc-realtime-toggle-knob" />
      </span>
      <span className="tc-realtime-toggle-label">
        Real-time {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
