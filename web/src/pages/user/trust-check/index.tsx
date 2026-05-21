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

import { TrustLocalRateLimitedError, type VerifyRecord } from './api';
import { groupByBand, type TrustRow } from './derive';
import { AliasDetailDrawer } from './drawer';
import {
  useAliasDetail,
  useTriggerVerify,
  useTrustView,
  useVerifyPolling,
} from './hooks';
import { GaugeIcon, KeyIcon, RefreshIcon, ScanIcon } from './icons';
import { SourceTable, type VerifyErrorState } from './table';
import { TRUST_CHECK_CSS } from './trust-check-css';

// Filter chips are still static — Day 5 wires them to a real filter
// state. Keeping the list here so the Day 1 visual stays intact.
const MOCK_FILTERS: { label: string; active?: boolean }[] = [
  { label: 'in use', active: true },
  { label: 'app1' },
  { label: 'app2' },
  { label: 'app3' },
  { label: 'team' },
  { label: 'personal' },
  { label: 'oauth' },
  { label: 'KEY' },
  { label: 'trial' },
  { label: 'production' },
  { label: 'not checked' },
];

export default function UserTrustCheckPage() {
  const [activeTab, setActiveTab] = useState<'source' | 'band'>('source');
  const [expandedAlias, setExpandedAlias] = useState<string | null>(null);

  const { status, rows, metrics, isOffline, summaries } = useTrustView();
  const isLoading = status.isLoading;
  const loadError = status.error && !isOffline ? status.error : null;
  const isEmpty = !isLoading && !isOffline && !loadError && rows.length === 0;

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
      if (data.status === 'fail' || data.status === 'inconclusive') {
        nextErrors[alias] = {
          kind: 'verify_terminal',
          status: data.status,
          message:
            data.error_message ||
            (data.status === 'fail'
              ? 'Cascade verify came back as fail.'
              : 'Cascade verify was inconclusive — retry to refine the score.'),
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
        if (err instanceof TrustLocalRateLimitedError) {
          setErrors((s) => ({
            ...s,
            [row.alias_name]: {
              kind: 'rate_limited',
              message: 'Verified within the last 24h.',
              nextEligibleAt: err.nextEligibleAt,
            },
          }));
        } else {
          setErrors((s) => ({
            ...s,
            [row.alias_name]: {
              kind: 'generic',
              message: err instanceof Error ? err.message : String(err),
            },
          }));
        }
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
        <div>
          <h1 className="tc-title">Degrade Detector</h1>
          <p className="tc-subtitle">
            Trust signals across your provider sources · powered by trust-local
          </p>
        </div>
        <div className="tc-header-actions">
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
                  : 'Trigger cascade verify for every row in the table'
            }
          >
            <ScanIcon />
            {bulkRunning ? 'Running…' : 'Run checks'}
          </button>
        </div>
      </header>

      {isOffline && (
        <div className="tc-banner tc-banner-offline" role="status">
          <span className="tc-banner-dot" />
          <div>
            <strong>trust-local is offline.</strong> Start it via{' '}
            <code>aikey trust sync</code> or{' '}
            <code>make run-local</code> in <code>degrade-detector/</code>{' '}
            — the page auto-recovers on next 30s tick.
          </div>
        </div>
      )}

      <div className="tc-metrics" data-origin-name="Trust metric grid">
        <MetricCard
          color="var(--primary)"
          label="Sources"
          value={isLoading ? '—' : metrics.sources}
          note="KEY + OAuth"
        />
        <MetricCard
          color="var(--tc-trust)"
          label="In Use"
          value={isLoading ? '—' : metrics.in_use}
          note="Active routes"
        />
        <MetricCard
          color="var(--warning)"
          label="Review"
          value={isLoading ? '—' : metrics.review}
          note="Needs check"
        />
        <MetricCard
          color="var(--tc-info)"
          label="Checked"
          value={isLoading ? '—' : metrics.checked_24h}
          note="Last 24h"
        />
      </div>

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
            {MOCK_FILTERS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className={`tc-chip ${chip.active ? 'active' : ''}`}
                disabled
                title="Filter chips wired Day 5"
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="tc-search-row">
            <input
              className="tc-search"
              placeholder="Search key alias, OAuth account, app…"
              defaultValue=""
              disabled
            />
            <span className="tc-select-pill">Any status</span>
            <span className="tc-select-pill">Last 24h</span>
          </div>
        </div>

        <TablePanelBody
          activeTab={activeTab}
          isLoading={isLoading}
          isOffline={isOffline}
          isEmpty={isEmpty}
          loadError={loadError}
          rows={rows}
          summaries={summaries}
          inFlight={inFlight}
          errors={errors}
          verifyById={verifyById}
          expandedAlias={expandedAlias}
          onCheck={triggerVerifyFor}
          onRowClick={onRowClick}
        />
      </section>

      {expandedAlias && (
        <AliasDetailDrawer
          alias={expandedAlias}
          detail={detail.data}
          isLoading={detail.isLoading}
          error={detail.error}
          onClose={onCloseDrawer}
        />
      )}
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
  loadError,
  rows,
  summaries,
  inFlight,
  errors,
  verifyById,
  expandedAlias,
  onCheck,
  onRowClick,
}: {
  activeTab: 'source' | 'band';
  isLoading: boolean;
  isOffline: boolean;
  isEmpty: boolean;
  loadError: Error | null;
  rows: TrustRow[];
  summaries: ReturnType<typeof useTrustView>['summaries'];
  inFlight: Record<string, string>;
  errors: Record<string, VerifyErrorState>;
  verifyById: Record<string, VerifyRecord>;
  expandedAlias: string | null;
  onCheck: (row: TrustRow, opts?: { force?: boolean }) => Promise<string | null>;
  onRowClick: (row: TrustRow) => void;
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
  const commonTableProps = {
    inFlight,
    errors,
    verifyById,
    expandedAlias,
    onCheck,
    onRowClick,
  };
  if (activeTab === 'band') {
    const sections = groupByBand(rows, summaries);
    return (
      <div className="tc-band-view">
        {sections.map((section) => (
          <div key={section.band} className="tc-band-section">
            <div className={`tc-band-section-header tc-band-section-${section.band}`}>
              <span className={`tc-pill tc-pill-${section.band}`}>{section.label}</span>
              <span className="tc-band-section-count">
                {section.rows.length} row{section.rows.length === 1 ? '' : 's'}
              </span>
            </div>
            <SourceTable rows={section.rows} {...commonTableProps} />
          </div>
        ))}
      </div>
    );
  }
  return <SourceTable rows={rows} {...commonTableProps} />;
}

// ---------------------------------------------------------------------------
// MetricCard — tiny standalone presenter for the 4 metric tiles above
// the table. Kept inline because it's not re-used anywhere else yet.
// ---------------------------------------------------------------------------

function MetricCard({
  color,
  label,
  value,
  note,
}: {
  color: string;
  label: string;
  value: number | string;
  note: string;
}) {
  return (
    <div className="tc-metric" style={{ ['--metric-color' as string]: color }}>
      <div className="tc-metric-label">{label}</div>
      <div className="tc-metric-value">{value}</div>
      <div className="tc-metric-note">{note}</div>
    </div>
  );
}
