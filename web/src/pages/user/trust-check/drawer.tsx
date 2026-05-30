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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
        aria-label={t('trustCheck.drawerAriaLabel', { alias })}
      >
        <header className="tc-drawer-header">
          <div>
            <div className="tc-drawer-eyebrow">{t('trustCheck.drawerEyebrow')}</div>
            <h2 className="tc-drawer-title">{alias}</h2>
          </div>
          <button
            type="button"
            className="tc-drawer-close"
            onClick={onClose}
            title={t('trustCheck.drawerCloseTitle')}
            aria-label={t('trustCheck.drawerCloseAria')}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="tc-drawer-body">
          {isLoading && (
            <div className="tc-empty">
              <span className="tc-spin-dot tc-spin-dot-lg" />
              <div className="tc-empty-title">{t('trustCheck.drawerLoadingTitle')}</div>
              <div className="tc-empty-note">
                GET /v1/status/{encodeURIComponent(alias)}
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="tc-empty">
              <div className="tc-empty-title">{t('trustCheck.drawerLoadErrorTitle')}</div>
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
  const { t } = useTranslation();
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
    helperText = t('trustCheck.removeInUseHint');
    helperKind = 'info';
  } else if (err instanceof TrustAliasInUseError) {
    helperText = t('trustCheck.removeNowInUseHint');
    helperKind = 'warn';
  } else if (err) {
    helperText = err.message;
    helperKind = 'error';
  } else if (armed && !busy) {
    helperText = t('trustCheck.removeArmedHint');
    helperKind = 'warn';
  }

  return (
    <footer className="tc-drawer-footer" aria-label={t('trustCheck.removeFooterAria')}>
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
            {t('trustCheck.removeCancel')}
          </button>
        )}
        <button
          type="button"
          className={`tc-drawer-footer-remove ${armed ? 'armed' : ''}`}
          onClick={onPrimaryClick}
          disabled={isInUse || busy}
          title={isInUse ? t('trustCheck.removeInUseButtonTitle') : undefined}
        >
          {busy
            ? t('trustCheck.removing')
            : armed
              ? t('trustCheck.removeConfirm')
              : t('trustCheck.removeButton')}
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
  const { t } = useTranslation();
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">{t('trustCheck.subScoresTitle')}</h3>
      <div className="tc-subscores">
        <SubScore
          label={t('trustCheck.l1Label')}
          value={detail.s_l1}
          hint={t('trustCheck.l1Hint')}
          description={t('trustCheck.l1Description')}
        />
        <SubScore
          label={t('trustCheck.l2Label')}
          value={detail.s_l2}
          hint={t('trustCheck.l2Hint')}
          description={t('trustCheck.l2Description')}
        />
        <SubScore
          label={t('trustCheck.l2ContentLabel')}
          value={detail.s_l2_content ?? null}
          hint={t('trustCheck.l2ContentHint')}
          description={t('trustCheck.l2ContentDescription')}
        />
        <SubScore
          label={t('trustCheck.l2CrowdLabel')}
          value={detail.s_l2_crowd ?? null}
          hint={
            detail.s_l2_crowd_source
              ? t('trustCheck.l2CrowdSourceHint', { source: detail.s_l2_crowd_source })
              : t('trustCheck.l2CrowdFallbackHint')
          }
          description={t('trustCheck.l2CrowdDescription')}
          unitLabel={
            detail.s_l2_crowd == null && detail.s_l2_crowd_source == null
              ? t('trustCheck.l2CrowdNoData')
              : undefined
          }
        />
        <SubScore
          label={t('trustCheck.l3Label')}
          value={detail.s_l3}
          hint={t('trustCheck.l3Hint')}
          description={t('trustCheck.l3Description')}
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
          label={t('trustCheck.scoreLabel')}
          value={detail.s_display}
          hint={
            detail.s_combined != null && detail.s_display != null
              ? t('trustCheck.scoreHintWithWeakest', { value: detail.s_combined })
              : t('trustCheck.scoreHintDefault')
          }
          highlight
          description={t('trustCheck.scoreDescription')}
        />
      </div>

      {/* Data source row (v2 改动): local vs trust-net 不是分层标签，
          而是数据来源。单独一行显示, 避免和 L1/L2/L3 标签混淆. */}
      <h3 className="tc-drawer-section-title" style={{ marginTop: 16 }}>
        {t('trustCheck.dataSourceTitle')}
      </h3>
      <div className="tc-subscores">
        <SubScore
          label={t('trustCheck.localLabel')}
          value={null}
          hint={t('trustCheck.localHint')}
          description={t('trustCheck.localDescription')}
          unitLabel={t('trustCheck.localUnit')}
        />
        <SubScore
          label={t('trustCheck.trustNetLabel')}
          value={null}
          hint={t('trustCheck.trustNetHint')}
          description={t('trustCheck.trustNetDescription')}
          unitLabel={t('trustCheck.trustNetUnit')}
        />
      </div>
      <div className="tc-drawer-meta">
        <span>
          {t('trustCheck.metaProvider')} <code>{detail.provider_id}</code>
        </span>
        <span>
          {t('trustCheck.metaModel')} <code>{detail.model}</code>
        </span>
        <span>
          {t('trustCheck.metaLastVerify')} {formatTimeSince(detail.last_verified_at)} ·{' '}
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
  const { t } = useTranslation();
  const [expandedVerify, setExpandedVerify] = useState<string | null>(null);
  if (history.length === 0) {
    return (
      <section className="tc-drawer-section">
        <h3 className="tc-drawer-section-title">{t('trustCheck.checkHistoryTitle')}</h3>
        <div className="tc-drawer-empty">
          {t('trustCheck.checkHistoryEmptyPrefix')}{' '}
          <strong>{t('trustCheck.checkHistoryEmptyButton')}</strong>{' '}
          {t('trustCheck.checkHistoryEmptyTail')}
        </div>
      </section>
    );
  }
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">
        {t('trustCheck.checkHistoryTitle')}{' '}
        <span className="tc-drawer-section-count">({history.length})</span>
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
  const { t } = useTranslation();
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
              <strong>{t('trustCheck.historyErrorLabel')}</strong> {entry.error_message}
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
  const { t } = useTranslation();
  const detail = useVerifyDetail(verifyId);
  if (detail.isLoading) {
    return (
      <div className="tc-history-detail-loading">
        <span className="tc-spin-dot" /> {t('trustCheck.scoringLoadingDetail')}
      </div>
    );
  }
  if (detail.error) {
    return (
      <div className="tc-history-error">
        <strong>{t('trustCheck.scoringLoadErrorPrefix')}</strong> {detail.error.message}
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
          {t('trustCheck.scoringEmptyNote')}
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
                    {t('trustCheck.scoringQScore', { value: Math.round((p.a?.score ?? p.q?.score) as number) })}
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
          <summary>{t('trustCheck.scoringRawSummary', { count: otherEntries.length })}</summary>
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
  const { t } = useTranslation();
  if (observations.length === 0) {
    return (
      <section className="tc-drawer-section">
        <h3 className="tc-drawer-section-title">{t('trustCheck.recentObsTitle')}</h3>
        <div className="tc-drawer-empty">
          {t('trustCheck.recentObsEmpty')}
        </div>
      </section>
    );
  }
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">
        {t('trustCheck.recentObsTitle')}{' '}
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
  const { t } = useTranslation();
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
        ? t('trustCheck.obsScoreDetail', { score: obs.score })
        : '';
  return (
    <div className="tc-history-row" title={t('trustCheck.obsTraceTitle', { traceId: obs.trace_id })}>
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
  const { t } = useTranslation();
  if (!signals || Object.keys(signals).length === 0) return null;
  return (
    <section className="tc-drawer-section">
      <h3 className="tc-drawer-section-title">{t('trustCheck.signalsTitle')}</h3>
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
