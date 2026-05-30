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
import { useTranslation } from 'react-i18next';

import type { VerifyRecord } from './api';
import type { StatusBand, TrustRow } from './derive';
import { ScanIcon, SpinDotInline } from './icons';

/**
 * Per-row verify failure modes. M6 decision 3.1 removed the 24h
 * 'rate_limited' lane; manual path is unlimited.
 */
export type VerifyErrorState =
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
  const { t } = useTranslation();
  return (
    <div className="tc-table-scroll">
      <table className="tc-table">
        <thead>
          <tr>
            <th>{t('trustCheck.thUse')}</th>
            <th>{t('trustCheck.thSource')}</th>
            <th>{t('trustCheck.thModel')}</th>
            <th>{t('trustCheck.thConfidence')}</th>
            <th>{t('trustCheck.thChecked')}</th>
            <th>{t('trustCheck.thAction')}</th>
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
                title={t('trustCheck.rowClickTitle')}
              >
                <RowCell primary={row.use_label} secondary={row.use_kind} />
                <RowCell primary={row.source_name} secondary={row.source_meta} />
                <RowCell
                  primary={<span style={{ fontWeight: 500 }}>{row.model}</span>}
                  secondary={row.provider}
                />
                <td>
                  <ScorePill
                    score={row.score}
                    band={row.band}
                    label={row.band_label}
                    weakestLayer={row.weakest_layer}
                  />
                </td>
                <td>
                  {running ? (
                    <span className="tc-status-running" title={t('trustCheck.verifyInProgressTitle')}>
                      <span className="tc-spin-dot" />
                      {verifyRec?.progress
                        ? `Q${verifyRec.progress.n_done}/${verifyRec.progress.n_total}`
                        : t('trustCheck.statusRunning')}
                    </span>
                  ) : (
                    <span className="tc-mono">{row.checked}</span>
                  )}
                </td>
                <td>
                  <div className="tc-action-cell">
                    {running ? (
                      <button type="button" className="tc-btn tc-btn-primary" disabled>
                        <SpinDotInline /> {t('trustCheck.checkingInline')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="tc-btn"
                        onClick={() => void onCheck(row)}
                        title={t('trustCheck.checkActionTitle')}
                      >
                        <ScanIcon /> {t('trustCheck.check')}
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
  weakestLayer,
}: {
  score: number;
  band: StatusBand;
  label: string;
  weakestLayer?: { name: string; score: number } | null;
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
      {weakestLayer && (
        <div
          className="tc-score-weakest"
          title={`Headline score is harmonic mean of L1/L2/L3. Hidden weak signal: ${weakestLayer.name}=${weakestLayer.score}. Click row for full by-layer breakdown.`}
        >
          <span className="tc-score-weakest-icon" aria-hidden="true">
            ⚠
          </span>
          {weakestLayer.name} {weakestLayer.score}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VerifyErrorChip — small inline status pill rendered under the Check
// button when a verify fails or is inconclusive. Kept inline (vs a
// toast) because the failure is per-row and the user needs to see
// WHICH row is stuck.
//
// M6 decision 3.1: rate-limited path removed (manual is unlimited).
// VerifyErrorState.kind has only 'verify_terminal' | 'generic' now.
// ---------------------------------------------------------------------------

export function VerifyErrorChip({ err }: { err: VerifyErrorState }) {
  const { t } = useTranslation();
  if (err.kind === 'verify_terminal') {
    // 2026-05-22: Stage 2.6 surfaced `'error'` (upstream / config
    // failures, distinct from `fail` / `inconclusive`). Map each
    // explicit terminal status to its own variant + chip label so the
    // operator can tell "cascade hit an Anthropic 429" apart from
    // "Anthropic returned content that scored as fail".
    const variant =
      err.status === 'fail' || err.status === 'failed'
        ? 'fail'
        : err.status === 'error'
          ? 'error'
          : 'inconclusive';
    const label =
      variant === 'fail'
        ? t('trustCheck.errChipVerifyFailed')
        : variant === 'error'
          ? t('trustCheck.errChipUpstreamError')
          : t('trustCheck.errChipInconclusive');
    return (
      <span className={`tc-err-chip tc-err-${variant}`} title={err.message}>
        {label}
      </span>
    );
  }
  return (
    <span className="tc-err-chip tc-err-generic" title={err.message}>
      {t('trustCheck.errChipError')}
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
