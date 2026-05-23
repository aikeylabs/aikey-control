/**
 * AliasDetailDrawer — slides in from the right when the user clicks a
 * row. Shows: (1) the alias's three sub-scores (s_l1 / s_l2 / s_l3)
 * + combined, (2) the last 10 Check runs with status +
 * duration, (3) the latest run's `scoring_detail` blob (questions
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
 * history refresh without unmounting.
 *
 * v2 terminology (2026-05-22): "cascade" 概念已废弃。所有 user-facing
 * 字符串 + 注释里的 "cascade" 一律改用 "Check"（用户视角的动作名）
 * 或 "run"（一次执行）。代码里的 CascadeHistoryEntry / CascadeHistoryPanel
 * 等类型/组件名暂时保留（API 字段 `cascade_history` 仍是 schema），
 * 待 S5/S6 orchestrator 落地时统一改名为 RunHistory*。
 */
import { useState } from 'react';

import {
  TrustAliasInUseError,
  type CascadeHistoryEntry,
  type RecentObservation,
  type TrustStatusDetail,
} from './api';
import { formatTimeSince } from './derive';
import { useResetTracking, useVerifyDetail } from './hooks';
import { CloseIcon } from './icons';
import { formatEpoch } from './table';

export function AliasDetailDrawer({
  alias,
  detail,
  isLoading,
  error,
  onClose,
  onRemoved,
}: {
  alias: string;
  detail: TrustStatusDetail | undefined;
  isLoading: boolean;
  error: Error | null;
  onClose: () => void;
  /** Fired after a successful `Remove detection history`. Parent
   *  closes the drawer; the list refresh is handled inside the
   *  hook via QueryClient invalidation. */
  onRemoved: () => void;
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
              <RecentObservationsPanel
                observations={detail.recent_observations ?? []}
              />
              <SignalsPanel signals={detail.signals_summary} />
            </>
          )}
        </div>

        {detail && !isLoading && (
          <RemoveTrackingFooter
            alias={alias}
            isInUse={!!detail.is_in_use}
            onRemoved={onRemoved}
          />
        )}
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// RemoveTrackingFooter — drawer-bottom action that wipes this alias's
// degrade-detection history (events + state.alias) via POST /v1/status/
// {alias}/reset-tracking. Does NOT touch the vault credential.
//
// Design choices (locked 2026-05-23):
//   - "Remove detection history" wording — not "Delete alias" — to make
//     clear the credential survives.
//   - Disabled while `is_in_use` because the proxy would write fresh
//     observations within seconds, making the click feel like it
//     "didn't work". User must `aikey use` to another alias first.
//   - Two-click confirm WITHOUT a timeout: first click arms the button
//     (label flips to "Click again to confirm"); the armed state stays
//     until the user clicks again, closes the drawer, or hits Cancel.
//     We deliberately avoid a countdown timer — surprise auto-revert
//     while the user is reading is worse UX than a stable armed state.
//   - 409 (vault flipped to in_use between page load and click) gets a
//     dedicated toast-style inline message via TrustAliasInUseError.
//     Other errors render the message verbatim.
// ---------------------------------------------------------------------------

function RemoveTrackingFooter({
  alias,
  isInUse,
  onRemoved,
}: {
  alias: string;
  isInUse: boolean;
  onRemoved: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const reset = useResetTracking();

  const onPrimaryClick = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    reset.mutate(alias, {
      onSuccess: () => {
        onRemoved();
      },
    });
  };

  const onCancel = () => {
    setArmed(false);
    reset.reset();
  };

  const busy = reset.isPending;
  const err = reset.error;

  let helperText: string | null = null;
  let helperKind: 'info' | 'warn' | 'error' = 'info';
  if (isInUse) {
    helperText =
      `Currently in use — switch with \`aikey use\` to another alias first to remove.`;
    helperKind = 'info';
  } else if (err instanceof TrustAliasInUseError) {
    helperText =
      `Alias is now in use; switch with \`aikey use\` first, then retry.`;
    helperKind = 'warn';
  } else if (err) {
    helperText = err.message;
    helperKind = 'error';
  } else if (armed && !busy) {
    helperText =
      'This clears detection history for this alias. The credential in your vault is preserved.';
    helperKind = 'warn';
  }

  return (
    <footer className="tc-drawer-footer" aria-label="Remove detection history">
      {helperText && (
        <div className={`tc-drawer-footer-hint tc-drawer-footer-hint-${helperKind}`}>
          {helperText}
        </div>
      )}
      <div className="tc-drawer-footer-actions">
        {armed && !busy && (
          <button
            type="button"
            className="tc-drawer-footer-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className={`tc-drawer-footer-remove ${armed ? 'armed' : ''}`}
          onClick={onPrimaryClick}
          disabled={isInUse || busy}
          title={
            isInUse
              ? 'Currently in use — switch via `aikey use` first'
              : undefined
          }
        >
          {busy
            ? 'Removing…'
            : armed
              ? 'Click again to confirm'
              : 'Remove detection history'}
        </button>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// SubScoresPanel — v2 layer semantics (2026-05-22).
//
// 分层 (L1/L2/L3) 跟 数据来源 (Local / Trust-net) 是**两个独立维度**，分两行
// 显示，不再混标签（旧的 "L1 · local / L2 · trust-net / L3 · cascade" 标签
// 在 v2 里是错的——分层和来源是正交的，"cascade" 这个概念也已经废弃）。
//
// v2 分层定义（[降智检测分层方案-v2-2026-05-22.md](../../../../../../roadmap20260320/技术实现/阶段4-增值版/降智检测分层方案-v2-2026-05-22.md)):
//   - L1 = 协议规则 (Check 10 探针的 response headers / host / body.model 跑 A/B/C/D5)
//   - L2 = 答案对比 + 共识 (L2-content × 0.7 + L2-crowd × 0.3, crowd null 时退化纯 content)
//   - L3 = 节奏指纹 (10 流式探针 ITT/n_chunks 跟 baseline 比)
//   - Combined = M7 backend 化时定义新合成公式，M6 留 null
//
// 数据来源行 (Local / Trust-net):
//   - Local: 本机 Check 探针 + observation 数据 (manual ③ / auto ② / 实时旁路 ①)
//   - Trust-net: trust-central crowd quorum (M6 阶段 5 stub 返 null,P1 才有真数据)
// ---------------------------------------------------------------------------

function SubScoresPanel({ detail }: { detail: TrustStatusDetail }) {
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">Sub-scores</h3>
      <div className="tc-subscores">
        <SubScore
          label="L1 · Protocol rules"
          value={detail.s_l1}
          hint="A/B/C/D5 rules on Check probe responses"
          description={
            'How: 5 deterministic rules run against each of the 10 Check ' +
            'probe responses — A) domain allowlist, B) anthropic-ratelimit-* ' +
            'headers present, C) body shape matches Anthropic schema, ' +
            'D) model field consistent across SSE chunks, D5) chunk ' +
            'metadata complete.\n' +
            'Score: average pass rate across all rule × probe cells, ' +
            'scaled to 0–100.\n' +
            'Read: ≥80 healthy; 60–80 one rule degraded (often D model ' +
            'drift); <60 strongly suggests a proxy rewriting responses ' +
            'or a non-Anthropic origin.\n' +
            'Null until you trigger Check once.'
          }
        />
        <SubScore
          label="L2 · Answer match + crowd"
          value={detail.s_l2}
          hint="0.7 × content + 0.3 × crowd"
          description={
            'How: blended score = 0.7 × L2-content (answer correctness) + ' +
            '0.3 × L2-crowd (peer consensus). The 0.7/0.3 weighting ' +
            'lets a correct-but-divergent answer still score high while ' +
            'penalising both wrong answers and outlier responses.\n' +
            'Score: 0–100, both inputs on the same scale.\n' +
            'Read: ≥80 healthy. If low, drill into L2-content vs L2-crowd ' +
            'below — wrong answers (L2-content) vs divergence from healthy ' +
            'peers (L2-crowd) imply different root causes.\n' +
            'Null until first Check.'
          }
        />
        <SubScore
          label="└ L2-content"
          value={detail.s_l2_content ?? null}
          hint="pass_rate × 100 over 10 probes"
          description={
            'How: StructuredScorer compares each of the 10 Check probe ' +
            'answers against the expected canonical answer (exact + ' +
            'fuzzy match), produces a pass_rate.\n' +
            'Score: pass_rate × 100.\n' +
            'Read: ≥80 healthy; sustained <60 means the model is not ' +
            'returning correct answers to deterministic prompts — ' +
            'either a downgraded model or aggressive prompt rewriting.\n' +
            'Null until first Check runs.'
          }
        />
        <SubScore
          label="└ L2-crowd"
          value={detail.s_l2_crowd ?? null}
          hint={
            detail.s_l2_crowd_source
              ? `source: ${detail.s_l2_crowd_source}`
              : "remote quorum or 24h fallback"
          }
          description={
            'How: prefers trust-central remote quorum (aggregated recent ' +
            'Checks from many users on the same model). When remote is ' +
            'empty or unreachable, falls back to this host\'s own past-24h ' +
            'Check average. The "source" badge tells you which path served ' +
            'the number — `remote` / `local_24h`.\n' +
            'Score: 0–100, alignment with peer-group average.\n' +
            'Read: ≥80 = aligned with peers; <70 means your responses ' +
            'diverge from what other users see for the same model — a ' +
            'strong proxy-rewrite signal that L2-content alone cannot ' +
            'detect (your answers can be self-consistent yet collectively ' +
            'wrong).\n' +
            'Null when both sources are empty (e.g. first-ever Check on ' +
            'a brand-new model + remote stub still returning null).'
          }
          unitLabel={
            detail.s_l2_crowd == null && detail.s_l2_crowd_source == null
              ? "no data"
              : undefined
          }
        />
        <SubScore
          label="L3 · Rhythm fingerprint"
          value={detail.s_l3}
          hint="ITT / n_chunks vs baseline"
          description={
            'How: across 10 streaming probes, collects the inter-token-time ' +
            '(ITT) distribution and per-probe n_chunks. Compares both ' +
            'against the per-model baseline (shipped with the detector or ' +
            'learned locally on first use).\n' +
            'Score: 0–100, where 100 = rhythm matches baseline exactly.\n' +
            'Read: ≥80 healthy; 40–80 watch (network jitter can dip a real ' +
            'Anthropic endpoint here); <40 strongly suggests the upstream ' +
            'is a re-tokenising proxy or model mirror — the timing ' +
            'signature of inference + streaming is very hard to forge. ' +
            'Requires probes to actually stream; falls back to neutral 50 ' +
            'if no baseline exists for the model.'
          }
        />
        {/* 2026-05-23 display-layer redesign — see api.ts s_display
            doc comment + degrade-detector/docs/user-guide.zh.md "结果
            怎么读" section.

            Why we display harmonic mean (s_display) instead of MIN
            (s_combined): a raw MIN like "15/100" reads to non-technical
            viewers as a definitive provider verdict, which is
            statistically dishonest for one run + commercially risky
            (providers dispute the score). Harmonic mean is biased
            toward low values (single weak layer still drags the
            headline down) but never collapses to MIN, so the headline
            communicates "信号矛盾,需复测" rather than "fail".

            We KEEP the MIN value visible inline as the "weakest layer"
            sub-hint so an advanced user can still see which layer
            dragged the score and by how much. */}
        <SubScore
          label="Score"
          value={detail.s_display}
          hint={
            detail.s_combined != null && detail.s_display != null
              ? `harmonic mean · weakest layer = ${detail.s_combined}`
              : "harmonic mean of L1 / L2 / L3 (single run; replicate for confidence)"
          }
          highlight
          description={
            'How: harmonic mean of L1 / L2 / L3 (non-null layers only). ' +
            'Harmonic mean is biased toward the lowest layer so a single ' +
            'weak signal still drags the headline, but never collapses to ' +
            'a raw MIN — which would read as a definitive verdict that ' +
            'one observation does not warrant.\n' +
            'Score: 0–100; weakest-layer raw value (MIN) is shown in the ' +
            'hint for advanced users.\n' +
            'Read: a single low run is ONE observation, not a verdict. ' +
            'Replicate the Check ≥3 times and look for the SAME layer to ' +
            'stay low before treating an anomaly as evidence. Network ' +
            'jitter, transient quota issues, or one bad probe can drag ' +
            'a single run.\n' +
            'Null only when no layer has produced a score yet (first-ever ' +
            'Check, or all probes ineligible).'
          }
        />
      </div>

      {/* Data source row (v2 改动): local vs trust-net 不是分层标签，
          而是数据来源。单独一行显示, 避免和 L1/L2/L3 标签混淆. */}
      <h3 className="tc-drawer-section-title" style={{ marginTop: 16 }}>
        Data source
      </h3>
      <div className="tc-subscores">
        <SubScore
          label="Local · this host"
          value={null}
          hint="Check probes + observations on this host"
          description={
            'What: every Check probe (manual ③ / auto ②) plus real-time ' +
            'observations (① per chat) run on this machine. Stored in ' +
            'trust_local.sqlite, never uploaded — your prompts, answers, ' +
            'and KEYs stay on disk.\n' +
            'Feeds: L1 (protocol rules), L2-content (answer match), ' +
            'L3 (rhythm fingerprint). All three layer scores above are ' +
            '100% local.\n' +
            'Status: "active" means the proxy + trust-local are running ' +
            'and observations are flowing into the DB.'
          }
          unitLabel="active"
        />
        <SubScore
          label="Trust-net · consensus"
          value={null}
          hint="remote crowd quorum"
          description={
            'What: aggregated Check results from many AiKey users on the ' +
            'same model, served by the trust-central quorum endpoint. ' +
            'Gives L2-crowd a peer-group baseline so we can flag responses ' +
            'that look self-consistent but collectively wrong (the kind ' +
            'of drift a single host cannot detect alone).\n' +
            'Status: "pending P1" — this build ships a stub that always ' +
            'returns null. The real crowd aggregator lands in P1.\n' +
            'Fallback: while remote is unavailable (now, or future ' +
            'outages), L2-crowd auto-uses this host\'s own 24h Check ' +
            'history average. The "source" badge on the L2-crowd card ' +
            'tells you which path served the number.'
          }
          unitLabel="pending P1"
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
  description,
  unitLabel,
}: {
  label: string;
  value: number | null;
  hint: string;
  highlight?: boolean;
  /** Hover tooltip explaining HOW the layer is detected, the scoring
   *  formula, and how to read the number (threshold guidance). Always
   *  rendered when present — both when value is "—" (so the user
   *  understands why the cell is empty) and when value is a real
   *  number (so the user knows what 70 vs 33 means). Multi-line via
   *  '\n' is honoured by the native title attribute on all modern
   *  browsers. */
  description?: string;
  /** Optional non-numeric status label rendered in place of "—" when
   *  value is null. v2 (2026-05-22) added so the "Data source" row
   *  can show "active" / "pending P1" instead of a misleading score
   *  dash. Numeric value (when present) still wins. */
  unitLabel?: string;
}) {
  const isMissing = value == null;
  return (
    <div
      className={`tc-subscore ${highlight ? 'highlight' : ''} ${isMissing ? 'missing' : ''}`}
      title={description}
    >
      <div className="tc-subscore-label">{label}</div>
      <div className="tc-subscore-value">
        {isMissing ? unitLabel ?? '—' : Math.round(value!)}
      </div>
      <div className="tc-subscore-hint">{hint}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CheckHistoryPanel — table of the last ≤10 Check runs. Each row is
// clickable to expand the scoring_detail blob (questions / answers /
// per-question score) inline.
//
// v2 (2026-05-22): renamed from CascadeHistoryPanel. "Cascade" 概念在
// v2 已经废弃 — 用户视角是"Check"。Type 名 CascadeHistoryEntry 仍保留
// 是因为 API JSON 字段 `cascade_history` 还在 schema 上;后续 S6
// orchestrator 重命名 schema 时统一改 RunHistoryEntry。
// ---------------------------------------------------------------------------

function CascadeHistoryPanel({ history }: { history: CascadeHistoryEntry[] }) {
  const [expandedVerify, setExpandedVerify] = useState<string | null>(null);
  if (history.length === 0) {
    return (
      <section className="tc-drawer-section">
        <h3 className="tc-drawer-section-title">Check history</h3>
        <div className="tc-drawer-empty">
          No runs yet. Click <strong>Check</strong> on this row to trigger one.
        </div>
      </section>
    );
  }
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">
        Check history <span className="tc-drawer-section-count">({history.length})</span>
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
  // Status enum (degrade-detector server_local emits both short + long
  // forms; test_l2_crowd.py confirms both shapes are alive in the wild):
  //   passed / pass  → cascade verdict OK   → trust (green)
  //   failed / fail  → cascade verdict says degraded → risk (red)
  //   error          → check couldn't complete (upstream 429 /
  //                    config issue) — not a verdict, but the user
  //                    needs to notice; treat as risk (red) per UX
  //                    request 2026-05-23.
  //   running        → in progress → suspect (orange)
  //   inconclusive   → not enough data, retry → info (blue) — soft
  //                    state, NOT a fail.
  //   default        → info (blue) — unknown status, surface as
  //                    neutral rather than silently painting red.
  switch (status) {
    case 'pass':
    case 'passed':
      return 'trust';
    case 'fail':
    case 'failed':
    case 'error':
      return 'risk';
    case 'running':
      return 'suspect';
    case 'inconclusive':
      return 'info';
    default:
      return 'info';
  }
}

// ---------------------------------------------------------------------------
// SignalsPanel — renders `signals_summary` as a key:value list. The
// shape is free-form (trust-local writes whatever was diagnostic for
// the alias), so we just iterate. Skipped if empty/null.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RecentObservationsPanel (F1 — 2026-05-23)
//
// D-rule passive hits: D4 / D5 / D6 fired by the proxy rhythm observer
// during real user chats (not Check probes). Separate from the
// CASCADE HISTORY panel above which lists explicit Check runs.
//
// Why a panel rather than rolling these into the score: D-rule
// observations are FACTS ("this rule fired on this chunk"), the score
// is a JUDGEMENT (aggregate over many runs). Listing the facts gives
// the user evidence + lets them spot patterns (e.g., D6 every second
// chat → consistent batching anomaly). The score panel above stays
// the headline; this panel is the audit trail.
//
// Empty state: any alias that hasn't had a D-rule hit gets a friendly
// "No recent observations" line. This is the normal state for
// healthy traffic — the panel always exists so the layout doesn't
// reshuffle when a hit appears.
// ---------------------------------------------------------------------------

function RecentObservationsPanel({
  observations,
}: {
  observations: RecentObservation[];
}) {
  if (observations.length === 0) {
    return (
      <section className="tc-drawer-section">
        <h3 className="tc-drawer-section-title">Recent observations</h3>
        <div className="tc-drawer-empty">
          No D-rule hits on this credential. Healthy traffic produces zero
          observations — they appear here when the proxy spots a buffer-
          restream signature (D4), a model-name swap (D5), or a non-Anthropic
          batching rhythm (D6) on chat traffic.
        </div>
      </section>
    );
  }
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">
        Recent observations{' '}
        <span className="tc-drawer-section-count">({observations.length})</span>
      </h3>
      <div className="tc-history">
        {observations.map((obs) => (
          <RecentObservationRow
            key={`${obs.trace_id}-${obs.rule}-${obs.occurred_at}`}
            obs={obs}
          />
        ))}
      </div>
    </section>
  );
}

function RecentObservationRow({ obs }: { obs: RecentObservation }) {
  // Rule → pill tone mapping (re-uses the existing pill colours so the
  // panel feels visually consistent with the CASCADE HISTORY pills).
  // D4 buffer-restream and D5 model-swap are stronger signals than D6
  // (a single chat outside the native batching window can be noise),
  // so D4/D5 = risk, D6 = suspect.
  const pillTone: 'risk' | 'suspect' = obs.rule === 'D6' ? 'suspect' : 'risk';
  const detail =
    obs.reason && obs.reason.length > 0
      ? obs.reason
      : obs.score != null
        ? `score ${obs.score}`
        : '';
  return (
    <div className="tc-history-row" title={`trace ${obs.trace_id}`}>
      <div className="tc-history-row-head">
        <span className={`tc-pill tc-pill-${pillTone}`}>{obs.rule}</span>
        <span className="tc-mono">{formatEpoch(obs.occurred_at)}</span>
        {detail && <span className="tc-obs-detail">{detail}</span>}
        <span className="tc-history-row-id">
          <code>{obs.trace_id.slice(0, 8)}…</code>
        </span>
      </div>
    </div>
  );
}

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
