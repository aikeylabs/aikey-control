/**
 * SourceTable + supporting row primitives (ScorePill, VerifyErrorChip,
 * formatEpoch).
 *
 * Extracted from index.tsx at Day 4 to keep the page file under the
 * 500-line review threshold once the drawer + BAND tab additions land.
 * No behaviour change vs the inline version that shipped in Day 3 —
 * just a code-move + import surface.
 *
 * Row click behaviour is delegated to the parent via `onRowClick`
 * (Day 4): we don't want this component to own the "which alias is
 * expanded" state, since BAND view will render the same rows in a
 * different shell and both views must share a single expanded-alias
 * selection.
 */
import type { ReactNode } from 'react';

import type { VerifyRecord } from './api';
import type { StatusBand, TrustRow } from './derive';
import { ScanIcon, SpinDotInline } from './icons';

export type VerifyErrorState =
  | { kind: 'rate_limited'; message: string; nextEligibleAt: number | null }
  | { kind: 'verify_terminal'; status: string; message: string }
  | { kind: 'generic'; message: string };

export function SourceTable({
  rows,
  inFlight,
  errors,
  verifyById,
  expandedAlias,
  onCheck,
  onRowClick,
}: {
  rows: TrustRow[];
  inFlight: Record<string, string>;
  errors: Record<string, VerifyErrorState>;
  verifyById: Record<string, VerifyRecord>;
  expandedAlias: string | null;
  onCheck: (row: TrustRow, opts?: { force?: boolean }) => Promise<string | null>;
  onRowClick: (row: TrustRow) => void;
}) {
  return (
    <div className="tc-table-scroll">
      <table className="tc-table">
        <thead>
          <tr>
            <th>Use</th>
            <th>Source</th>
            <th>Model</th>
            <th>Confidence</th>
            <th>Checked</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const verifyId = inFlight[row.alias_name];
            const verifyRec = verifyId ? verifyById[verifyId] : undefined;
            const running = !!verifyId;
            const err = errors[row.alias_name];
            const isExpanded = expandedAlias === row.alias_name;
            return (
              <tr
                key={row.alias_name}
                className={isExpanded ? 'selected tc-row-clickable' : 'tc-row-clickable'}
                onClick={(ev) => {
                  // Ignore clicks that originated on the inline action
                  // button — otherwise clicking "Check" would also toggle
                  // the drawer, which is surprising.
                  const target = ev.target as HTMLElement;
                  if (target.closest('button')) return;
                  onRowClick(row);
                }}
                title="Click to view cascade history"
              >
                <RowCell primary={row.use_label} secondary={row.use_kind} />
                <RowCell primary={row.source_name} secondary={row.source_meta} />
                <RowCell
                  primary={<span style={{ fontWeight: 500 }}>{row.model}</span>}
                  secondary={row.provider}
                />
                <td>
                  <ScorePill score={row.score} band={row.band} label={row.band_label} />
                </td>
                <td>
                  {running ? (
                    <span className="tc-status-running" title="Cascade verify in progress">
                      <span className="tc-spin-dot" />
                      {verifyRec?.progress
                        ? `Q${verifyRec.progress.n_done}/${verifyRec.progress.n_total}`
                        : 'running'}
                    </span>
                  ) : (
                    <span className="tc-mono">{row.checked}</span>
                  )}
                </td>
                <td>
                  <div className="tc-action-cell">
                    {running ? (
                      <button type="button" className="tc-btn tc-btn-primary" disabled>
                        <SpinDotInline /> Checking
                      </button>
                    ) : err?.kind === 'rate_limited' ? (
                      <button
                        type="button"
                        className="tc-btn"
                        onClick={() => void onCheck(row, { force: true })}
                        title={`Last verify under 24h. Click to retry now (force=true).${
                          err.nextEligibleAt
                            ? ` Auto-eligible at ${formatEpoch(err.nextEligibleAt)}.`
                            : ''
                        }`}
                      >
                        <ScanIcon /> Retry now
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="tc-btn"
                        onClick={() => void onCheck(row)}
                        title="Trigger a fresh cascade verify (POST /v1/verify)"
                      >
                        <ScanIcon /> Check
                      </button>
                    )}
                    {err && <VerifyErrorChip err={err} />}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowCell({ primary, secondary }: { primary: ReactNode; secondary: ReactNode }) {
  return (
    <td>
      <div className="tc-id">
        <span className="tc-id-primary">{primary}</span>
        <span className="tc-id-secondary">{secondary}</span>
      </div>
    </td>
  );
}

export function ScorePill({
  score,
  band,
  label,
}: {
  score: number;
  band: StatusBand;
  label: string;
}) {
  return (
    <div className="tc-score-wrap">
      <div className="tc-score-head">
        <span>{score}</span>
        <span className={`tc-pill tc-pill-${band}`}>{label}</span>
      </div>
      <div className="tc-score-bar">
        <div
          className="tc-score-fill"
          style={{ ['--score' as string]: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VerifyErrorChip — small inline status pill rendered under the Check
// button when a verify fails or hits the 24h rate limit. Kept inline
// (vs a toast) because the failure is per-row and the user needs to
// see WHICH row is stuck.
// ---------------------------------------------------------------------------

export function VerifyErrorChip({ err }: { err: VerifyErrorState }) {
  if (err.kind === 'rate_limited') {
    return (
      <span className="tc-err-chip tc-err-rate-limited" title={err.message}>
        24h limit · retry with force
      </span>
    );
  }
  if (err.kind === 'verify_terminal') {
    return (
      <span
        className={`tc-err-chip tc-err-${err.status === 'fail' ? 'fail' : 'inconclusive'}`}
        title={err.message}
      >
        {err.status === 'fail' ? 'Verify failed' : 'Inconclusive'}
      </span>
    );
  }
  return (
    <span className="tc-err-chip tc-err-generic" title={err.message}>
      Error
    </span>
  );
}

export function formatEpoch(epochSec: number): string {
  // Local-time short format; the absolute time is shown in tooltip
  // because the row is too narrow for a full timestamp.
  const d = new Date(epochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
