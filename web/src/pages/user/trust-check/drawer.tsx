/**
 * AliasDetailDrawer — slides in from the right when the user clicks a
 * row. Shows: (1) the alias's three sub-scores (s_l1 / s_l2 / s_l3)
 * + combined, (2) the last 10 cascade verify runs with status +
 * duration, (3) the latest verify's `scoring_detail` blob (questions
 * + answers + per-question score) when expanded.
 *
 * Why a slide-over drawer (vs inline expand under the row): the
 * questions/answers payload is multi-line; expanding inline shoves
 * the rest of the table out of view and makes it hard to compare
 * across rows. A side drawer keeps the table visible.
 *
 * Why the drawer owns no data — `useAliasDetail(alias)` is called in
 * the parent so the drawer can be a pure render component. This
 * keeps the open/close animation re-mount-free (no flicker between
 * cached + fresh data) and means the drawer survives a row's
 * cascade_history refresh without unmounting.
 */
import { useState } from 'react';

import type { CascadeHistoryEntry, TrustStatusDetail } from './api';
import { formatTimeSince } from './derive';
import { useVerifyDetail } from './hooks';
import { CloseIcon } from './icons';
import { formatEpoch } from './table';

export function AliasDetailDrawer({
  alias,
  detail,
  isLoading,
  error,
  onClose,
}: {
  alias: string;
  detail: TrustStatusDetail | undefined;
  isLoading: boolean;
  error: Error | null;
  onClose: () => void;
}) {
  // Drawer renders an absolutely-positioned overlay covering the
  // right ~480px of the page. Clicking the dimmer or pressing the
  // close button dismisses; we intentionally don't trap focus or
  // intercept Escape at Day 4 — that's a Day 5 accessibility pass.
  return (
    <>
      <div className="tc-drawer-dimmer" onClick={onClose} aria-hidden />
      <aside
        className="tc-drawer"
        role="dialog"
        aria-label={`Detail for ${alias}`}
      >
        <header className="tc-drawer-header">
          <div>
            <div className="tc-drawer-eyebrow">Alias detail</div>
            <h2 className="tc-drawer-title">{alias}</h2>
          </div>
          <button
            type="button"
            className="tc-drawer-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close detail drawer"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="tc-drawer-body">
          {isLoading && (
            <div className="tc-empty">
              <span className="tc-spin-dot tc-spin-dot-lg" />
              <div className="tc-empty-title">Loading detail…</div>
              <div className="tc-empty-note">
                GET /v1/status/{encodeURIComponent(alias)}
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="tc-empty">
              <div className="tc-empty-title">Couldn't load detail.</div>
              <div className="tc-empty-note">{error.message}</div>
            </div>
          )}

          {detail && !isLoading && (
            <>
              <SubScoresPanel detail={detail} />
              <CascadeHistoryPanel history={detail.cascade_history} />
              <SignalsPanel signals={detail.signals_summary} />
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// SubScoresPanel — shows s_l1 / s_l2 / s_l3 / s_combined.
//
// L1 = local features, L2 = trust-net cross-user signal, L3 = cascade
// verify. The combined number is what the table's pill shows; the
// breakdown helps the user understand "why is this rated Suspect?".
// Each subscore is null until trust-local has run the corresponding
// stage at least once — rendered as "—" in that case.
// ---------------------------------------------------------------------------

function SubScoresPanel({ detail }: { detail: TrustStatusDetail }) {
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">Sub-scores</h3>
      <div className="tc-subscores">
        <SubScore label="L1 · local" value={detail.s_l1} hint="signals from this proxy" />
        <SubScore label="L2 · trust-net" value={detail.s_l2} hint="cross-user quorum" />
        <SubScore label="L3 · cascade" value={detail.s_l3} hint="active verify" />
        <SubScore
          label="Combined"
          value={detail.s_combined}
          hint="band decision input"
          highlight
        />
      </div>
      <div className="tc-drawer-meta">
        <span>
          provider <code>{detail.provider_id}</code>
        </span>
        <span>
          model <code>{detail.model}</code>
        </span>
        <span>
          last verify {formatTimeSince(detail.last_verified_at)} ·{' '}
          <code>{detail.last_verify_result}</code>
        </span>
      </div>
    </section>
  );
}

function SubScore({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: number | null;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div className={`tc-subscore ${highlight ? 'highlight' : ''}`}>
      <div className="tc-subscore-label">{label}</div>
      <div className="tc-subscore-value">{value == null ? '—' : Math.round(value)}</div>
      <div className="tc-subscore-hint">{hint}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CascadeHistoryPanel — table of the last ≤10 cascade verifies. Each
// row is clickable to expand the scoring_detail blob (questions /
// answers / per-question score) inline.
// ---------------------------------------------------------------------------

function CascadeHistoryPanel({ history }: { history: CascadeHistoryEntry[] }) {
  const [expandedVerify, setExpandedVerify] = useState<string | null>(null);
  if (history.length === 0) {
    return (
      <section className="tc-drawer-section">
        <h3 className="tc-drawer-section-title">Cascade history</h3>
        <div className="tc-drawer-empty">
          No verifies yet. Click <strong>Check</strong> on this row to trigger one.
        </div>
      </section>
    );
  }
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">
        Cascade history <span className="tc-drawer-section-count">({history.length})</span>
      </h3>
      <div className="tc-history">
        {history.map((entry) => (
          <CascadeHistoryRow
            key={entry.verify_id}
            entry={entry}
            expanded={expandedVerify === entry.verify_id}
            onToggle={() =>
              setExpandedVerify((prev) =>
                prev === entry.verify_id ? null : entry.verify_id,
              )
            }
          />
        ))}
      </div>
    </section>
  );
}

function CascadeHistoryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: CascadeHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`tc-history-row ${expanded ? 'expanded' : ''}`}>
      <button type="button" className="tc-history-row-head" onClick={onToggle}>
        <span className={`tc-pill tc-pill-${pillForStatus(entry.status)}`}>
          {entry.status}
        </span>
        <span className="tc-mono">
          {entry.completed_at
            ? `${formatEpoch(entry.completed_at)} · ${entry.duration_ms ?? 0}ms`
            : `started ${formatEpoch(entry.triggered_at)}`}
        </span>
        <span className="tc-history-row-id">
          <code>{entry.verify_id.slice(0, 8)}…</code>
        </span>
      </button>
      {expanded && (
        <div className="tc-history-detail">
          {entry.error_message && (
            <div className="tc-history-error">
              <strong>Error:</strong> {entry.error_message}
            </div>
          )}
          <ScoringDetailPanel verifyId={entry.verify_id} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoringDetailPanel (Day 5)
//
// Renders `scoring_detail` for a single verify run — the per-question
// rubric the cascade L3 used. Trust-local writes a free-shape JSON
// blob; the renderer therefore stays defensive and uses a thin
// "best-effort known field" strategy:
//   - `questions_asked` (list) + `answers_received` (list) → pair-up
//     by index, render Q + answer + per-question score if present.
//   - Anything else → JSON-pretty in a foldable `<pre>`.
//
// Why not strict typing: scoring_detail's shape is owned by the
// scoring service (server_central/scorer) and is expected to evolve
// per question pack version. Hard-typing it on the web side would
// turn every scorer rev into a 2-PR coordination dance. Defensive
// render keeps the web compatible across versions.
//
// Fetched only when expanded (lazy) — see useVerifyDetail.
// ---------------------------------------------------------------------------

interface ScoringQuestion {
  qid?: string;
  text?: string;
  expected?: unknown;
  score?: number | null;
}
interface ScoringAnswer {
  qid?: string;
  text?: string;
  score?: number | null;
}

function ScoringDetailPanel({ verifyId }: { verifyId: string }) {
  const detail = useVerifyDetail(verifyId);
  if (detail.isLoading) {
    return (
      <div className="tc-history-detail-loading">
        <span className="tc-spin-dot" /> loading scoring detail…
      </div>
    );
  }
  if (detail.error) {
    return (
      <div className="tc-history-error">
        <strong>Couldn't load detail:</strong> {detail.error.message}
      </div>
    );
  }
  const data = detail.data;
  if (!data) return null;

  // Extract known fields with `unknown` guard; everything else falls
  // through to the JSON pretty-print.
  const sd = (data.scoring_detail ?? {}) as Record<string, unknown>;
  const questions = Array.isArray(sd.questions_asked) ? (sd.questions_asked as ScoringQuestion[]) : null;
  const answers = Array.isArray(sd.answers_received) ? (sd.answers_received as ScoringAnswer[]) : null;
  const knownKeys = new Set(['questions_asked', 'answers_received']);
  const otherEntries = Object.entries(sd).filter(([k]) => !knownKeys.has(k));

  // Pair Q+A by qid when both sides carry one, else by index. Falls
  // back to "no questions captured" when scoring_detail is empty —
  // common for the M3 mock path (scoring_mirror.py) that doesn't run
  // a real L3 cascade.
  const pairs: Array<{ q: ScoringQuestion | null; a: ScoringAnswer | null }> = [];
  if (questions || answers) {
    const len = Math.max(questions?.length ?? 0, answers?.length ?? 0);
    for (let i = 0; i < len; i++) {
      const q = questions?.[i] ?? null;
      let a: ScoringAnswer | null = null;
      if (answers) {
        // Prefer qid match; index fallback covers no-qid mode.
        a =
          (q?.qid && answers.find((ans) => ans.qid === q.qid)) ||
          answers[i] ||
          null;
      }
      pairs.push({ q, a });
    }
  }

  return (
    <div className="tc-scoring-detail">
      {pairs.length === 0 && otherEntries.length === 0 && (
        <div className="tc-history-detail-note">
          No scoring detail recorded — typically the verify came from
          the M3 mock path and only the band-level outcome was stored.
        </div>
      )}

      {pairs.length > 0 && (
        <div className="tc-scoring-questions">
          {pairs.map((p, idx) => (
            <div key={p.q?.qid ?? idx} className="tc-scoring-question">
              <div className="tc-scoring-question-head">
                <span className="tc-mono">Q{idx + 1}</span>
                {p.q?.qid && <code>{p.q.qid}</code>}
                {(p.a?.score ?? p.q?.score) != null && (
                  <span className="tc-scoring-q-score">
                    score {Math.round((p.a?.score ?? p.q?.score) as number)}
                  </span>
                )}
              </div>
              {p.q?.text && <div className="tc-scoring-q-text">{p.q.text}</div>}
              {p.a?.text && (
                <div className="tc-scoring-a-text">
                  <span className="tc-scoring-a-label">A:</span>
                  {p.a.text}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {otherEntries.length > 0 && (
        <details className="tc-scoring-raw">
          <summary>Raw scoring fields ({otherEntries.length})</summary>
          <pre>
            {JSON.stringify(Object.fromEntries(otherEntries), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function pillForStatus(status: string): 'trust' | 'suspect' | 'risk' | 'info' {
  // Re-use the table pill palette so a "pass" cascade reads the same
  // green as a Trusted band, etc. Inconclusive maps to info (blue)
  // not warning, because "inconclusive" isn't a soft fail — it's
  // "we don't know yet, retry".
  switch (status) {
    case 'pass':
      return 'trust';
    case 'fail':
      return 'risk';
    case 'inconclusive':
      return 'info';
    case 'running':
      return 'suspect';
    default:
      return 'info';
  }
}

// ---------------------------------------------------------------------------
// SignalsPanel — renders `signals_summary` as a key:value list. The
// shape is free-form (trust-local writes whatever was diagnostic for
// the alias), so we just iterate. Skipped if empty/null.
// ---------------------------------------------------------------------------

function SignalsPanel({ signals }: { signals: Record<string, unknown> | null | undefined }) {
  if (!signals || Object.keys(signals).length === 0) return null;
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">Signals</h3>
      <dl className="tc-signals">
        {Object.entries(signals).map(([k, v]) => (
          <div key={k} className="tc-signals-row">
            <dt>{k}</dt>
            <dd>
              <code>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</code>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
