/**
 * Pure derivations: trust summary → display row + metric counts.
 *
 * Keep these as plain functions (no React, no hooks) so they're
 * cheap to unit-test and easy to reuse from the M5.2 ops dashboard
 * later (which speaks the same trust-summary shape).
 *
 * Band thresholds live here as the single source of truth — Day 5 we
 * pin them with a CLI parity test (`aikey trust status` output must
 * use the same buckets so the user sees consistent labels in CLI
 * + web).
 */

import type { CascadeHistoryEntry, TrustSummary } from './api';

export type StatusBand = 'trust' | 'suspect' | 'risk' | 'info';

// ---------------------------------------------------------------------------
// i18n indirection (Option B). derive.ts is a PURE function module — no
// React, no hooks, unit-testable without booting i18next, and reusable
// from a CLI that prints the same labels. To keep that property while
// still localising display text, derive functions return a `LabelRef`
// (a catalog key + optional interpolation vars) for any FIXED label
// instead of a hard-coded English string. The React consumers resolve
// it via `t(ref.key, ref.vars)`; the CLI can resolve it against its own
// catalog. User-provided values (aliases, base_url hosts, brand proper
// nouns) stay as plain strings and are NEVER wrapped in a key.
//
// All keys live under the `trustCheck.trustCheckLeftover.*` namespace
// in shared/i18n/locales/{en,zh}/common.json.
// ---------------------------------------------------------------------------

export type LabelRef = { key: string; vars?: Record<string, unknown> };

/** Namespace prefix for every trust-check leftover label key. */
const L = 'trustCheck.trustCheckLeftover.';

export interface TrustRow {
  /** Stable identity for React keys + per-row Check button binding. */
  alias_name: string;
  /** Either a raw user-provided value (e.g. app slug / personal-key
   *  alias) or a fixed-label LabelRef (e.g. "OAuth account"). */
  use_label: string | LabelRef;
  /** Always a fixed label ("unverified" / "last 24h"). */
  use_kind: LabelRef;
  /** Raw alias / app slug / email (plain string) OR a fixed LabelRef. */
  source_name: string | LabelRef;
  /** Fixed label ("OAuth identity" / "personal BYOK" / app key) LabelRef,
   *  OR a raw derived session id string for oauth-session aliases. */
  source_meta: string | LabelRef;
  model: string;
  provider: string;
  score: number;
  band: StatusBand;
  /** Always a fixed band label LabelRef (Trusted/Suspect/Risky/Unverified). */
  band_label: LabelRef;
  /** Weakest layer subtitle for the score pill — surfaces real signal
   *  the headline ``score`` (harmonic mean) hides. Set only when the
   *  weakest layer is < 80; null when all layers are 80+ (no hidden
   *  weakness worth flagging) or when no layer scores landed yet.
   *
   *  Why this exists: the headline ``score`` is ``s_display`` (harmonic
   *  mean of L1/L2/L3) which for e.g. L1=70 / L2=100 / L3=95 evaluates
   *  to ~86 — practically indistinguishable from a clean 88. The
   *  third-party-vs-official discrimination signal (a 15-point L1 drop)
   *  gets averaged away. We surface it explicitly below the headline
   *  so users see "L1 70 ⚠" beside the 86 and know to inspect.
   *
   *  Spec source: 2026-05-25 BR analysis where 0011-test1 (aicoding.2233.ai
   *  third-party gateway) and the official OAuth account both rendered
   *  as ~TRUSTED 86/88 despite a real 15-point L1 gap. See drawer
   *  "by-layer breakdown" for the full layer view. */
  weakest_layer: { name: string; score: number } | null;
  checked: string;
  /** Day 3 will set this from a verify-id polling map; Day 2 always
   *  false because we don't trigger verifies yet. */
  running?: boolean;
  /** Mirrored from server's TrustSummary. The web is intentionally
   *  passthrough on these — see
   *  `workflow/CI/requirements/2026-05-21-plugin-owns-domain-logic-web-stays-generic.md`. */
  is_in_use: boolean;
  is_oauth: boolean;
  /** Vault's `base_url` for this credential. Single source of truth
   *  is vault → trust-local → /v1/status; do NOT re-derive on the
   *  web side. Stage 7 BAND view uses this for dedup; null
   *  collapses into a synthetic "Unknown gateway" group. */
  base_url: string | null;
  /** Epoch seconds; null when never verified. Surfaced as TrustRow
   *  field too so dedupByBaseUrl can sort "latest first" without
   *  having to re-look-up the summary. */
  last_verified_at: number | null;
}

export interface TrustMetrics {
  sources: number;
  in_use: number;
  review: number;
  checked_24h: number;
}

// ---------------------------------------------------------------------------
// Score → band mapping. See kickoff §5.2:
//   >= 80    Trusted
//   60..79   Suspect
//   <  60    Risky
//   null     Info (never verified; rendered as "—")
//
// "Watch" (in the UI template) is reserved for P1 — quarantine signal
// that has no trust-local field today.
// ---------------------------------------------------------------------------

export function deriveBand(score: number | null | undefined): StatusBand {
  if (score == null) return 'info';
  if (score >= 80) return 'trust';
  if (score >= 60) return 'suspect';
  return 'risk';
}

export function deriveBandLabel(band: StatusBand): LabelRef {
  switch (band) {
    case 'trust':
      return { key: L + 'bandTrusted' };
    case 'suspect':
      return { key: L + 'bandSuspect' };
    case 'risk':
      return { key: L + 'bandRisky' };
    case 'info':
      return { key: L + 'bandUnverified' };
  }
}

// ---------------------------------------------------------------------------
// Time-since formatting. Returns short strings ("12m", "3h", "2d")
// matching the UI mockup. "never" when last_verified_at is null,
// "just now" when < 60 s ago.
// ---------------------------------------------------------------------------

export function formatTimeSince(epochSec: number | null | undefined): string {
  if (epochSec == null) return 'never';
  const nowSec = Date.now() / 1000;
  const delta = nowSec - epochSec;
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)}d`;
  // months for older verifies — we don't expect this to show often, the
  // 24-hour rate limit means active users will see fresh data on every
  // page visit.
  return `${Math.floor(delta / (86400 * 30))}mo`;
}

// ---------------------------------------------------------------------------
// alias → secondary-line presentation. Different alias families read
// differently in the UI:
//   - "claude" / "kimi-official"            → straight personal BYOK
//   - "OAuth · session_abc12345"            → derived from
//                                             oauth:session_<hex> alias
//   - "Claude Pro OAuth · FreySilvaqzs@…"   → OAuth identity exposed
//   - "app:degrade-detector:<keyid>"        → app-resource synthetic
//                                             (followed by team/personal label)
// trust-local's PerAliasTrust.alias_name carries the canonical id; the
// fallback heuristics below mirror what `aikey trust status` prints to
// keep CLI ↔ web identifiers byte-aligned per kickoff §7.1 invariant.
// ---------------------------------------------------------------------------

function deriveSourceLabels(
  alias: string,
): { name: string | LabelRef; meta: string | LabelRef } {
  const oauthMatch = alias.match(/^(?:oauth:)?session_([a-f0-9]+)/i);
  if (oauthMatch) {
    // `name` is a fixed label → LabelRef. `meta` is the derived session
    // id (`session_abc12345…`) — a raw identifier, not translatable
    // prose, so it stays a plain string per the LabelRef contract.
    return {
      name: { key: L + 'sourceOauthAccount' },
      meta: `session_${oauthMatch[1].slice(0, 8)}…`,
    };
  }
  if (alias.includes('@') && alias.includes('.')) {
    // Bare email-like identity (e.g. FreySilvaqzs@qualityservice.com).
    // `name` is the raw user email — keep it a plain string.
    return {
      name: alias,
      meta: { key: L + 'sourceOauthIdentity' },
    };
  }
  const appMatch = alias.match(/^app:([^:]+):([0-9a-f-]+)/i);
  if (appMatch) {
    const slug = appMatch[1];
    const idTail = appMatch[2].slice(0, 8);
    // `name` is the raw app slug (user-defined) — plain string. `meta`
    // is the fixed "app key · {idTail}…" template with the id tail var.
    return {
      name: slug,
      meta: { key: L + 'sourceAppKey', vars: { idTail } },
    };
  }
  return { name: alias, meta: { key: L + 'sourcePersonalByok' } };
}

function deriveUseLabel(
  summary: TrustSummary,
): { label: string | LabelRef; kind: LabelRef } {
  // Day 2: trust-local doesn't tell us "which app is currently using this
  // alias" — that's a usage_events join we don't have here. Show a
  // generic source-kind label so the column carries SOME signal without
  // duplicating what the Source column already shows. Day 4 will join
  // with usage-ledger to fill in actual `app1` / `app2` slot bindings
  // (kickoff §2.1).
  //
  // 2026-05-22: previously this used `alias_name.split(/[:@/]/)[0]`,
  // which for OAuth identity aliases like `FreySilvaqzs@qualityservice.com`
  // produced `FreySilvaqzs` — the email local-part — exactly mirroring
  // the Source column's full-email rendering. Two columns showing the
  // same identity twice ("FreySilvaqzs" + "FreySilvaqzs@qualityservice.com")
  // read as a UI bug. Generalise: keep the alias as label ONLY when it
  // doesn't already match a structured family handled by deriveSourceLabels;
  // for OAuth / app-resource / oauth-session aliases, show the family
  // name so the column stays meaningful but distinct.
  const verifiedTag: LabelRef =
    summary.last_verified_at == null
      ? { key: L + 'useKindUnverified' }
      : { key: L + 'useKindLast24h' };
  const alias = summary.alias_name;
  // OAuth email-identity aliases (`local@domain.tld`) — Source column
  // already shows the full email + "OAuth identity" sub-label. Show a
  // semantic family label here instead of the local-part.
  if (alias.includes('@') && alias.includes('.')) {
    return { label: { key: L + 'sourceOauthAccount' }, kind: verifiedTag };
  }
  // oauth:session_<hex> — same family, give it the same label.
  if (/^(?:oauth:)?session_[a-f0-9]+/i.test(alias)) {
    return { label: { key: L + 'sourceOauthAccount' }, kind: verifiedTag };
  }
  // app-resource synthetic (`app:<slug>:<keyid>`) — show the slug; the
  // Source column carries the `app key · <id>...` detail. The slug is a
  // raw user-defined value → plain string, NOT keyed.
  const appMatch = alias.match(/^app:([^:]+):/i);
  if (appMatch) {
    return { label: appMatch[1], kind: verifiedTag };
  }
  // Plain personal BYOK — the alias is the natural label here too,
  // but deriveSourceLabels' meta is "personal BYOK", not a copy of
  // the alias, so this is the one case where label == Source name is
  // intentional (the alias IS the identity for personal keys). Raw
  // user value → plain string.
  return { label: alias.split(/[:/]/)[0] || alias, kind: verifiedTag };
}

// ---------------------------------------------------------------------------
// Main projection: TrustSummary (server shape) → TrustRow (UI shape).
// ---------------------------------------------------------------------------

// Display-score fallback chain. Prefer ``s_display`` (harmonic mean of
// L1/L2/L3 — UI headline as of 2026-05-23) over the raw MIN-veto
// ``s_combined`` because the latter reads as a definitive verdict on
// single-run data. See api.ts s_display doc comment + drawer.tsx
// "Score" sub-card for the broader display redesign.
//
// Order: s_display → s_combined → s_l2 → s_l3 → s_l1 → null
//
// Why s_l2 before s_l3 in the fallback (v2 2026-05-22):
//   - L2 = answer-content × 0.7 + crowd × 0.3 (the operator's primary
//     "is the upstream actually working" signal — direct evidence)
//   - L3 = rhythm fingerprint (more sensitive to baseline staleness;
//     a passing L2 with a low L3 usually means "model still serves
//     correct answers but its streaming pattern shifted")
//   - L1 = protocol shape (last resort; only meaningful when L2/L3
//     never landed, i.e. probe never reached upstream)
//
// s_combined still appears in the chain after s_display so a backend
// shipping pre-2026-05-23 (s_display absent) keeps working.
function displayScore(s: TrustSummary): number | null {
  if (typeof s.s_display === 'number') return s.s_display;
  if (typeof s.s_combined === 'number') return s.s_combined;
  if (typeof s.s_l2 === 'number') return s.s_l2;
  if (typeof s.s_l3 === 'number') return s.s_l3;
  if (typeof s.s_l1 === 'number') return s.s_l1;
  return null;
}

export function summaryToRow(s: TrustSummary): TrustRow {
  const effective = displayScore(s);
  const band = deriveBand(effective);
  const score = effective == null ? 0 : Math.round(effective);
  const { label: use_label, kind: use_kind } = deriveUseLabel(s);
  const { name: source_name, meta: source_meta } = deriveSourceLabels(s.alias_name);

  // Identify the weakest layer when at least one layer is below the
  // trust threshold (80). The L2-composite (`s_l2`) reads as the
  // canonical L2 number — we deliberately ignore the sub-components
  // (s_l2_content / s_l2_crowd) here because the table is the
  // overview surface; the drawer shows the full breakdown.
  const layers: Array<{ name: string; score: number | null }> = [
    { name: 'L1', score: s.s_l1 ?? null },
    { name: 'L2', score: s.s_l2 ?? null },
    { name: 'L3', score: s.s_l3 ?? null },
  ];
  let weakest: { name: string; score: number } | null = null;
  for (const layer of layers) {
    if (typeof layer.score === 'number' && layer.score < 80) {
      if (weakest == null || layer.score < weakest.score) {
        weakest = { name: layer.name, score: Math.round(layer.score) };
      }
    }
  }

  return {
    alias_name: s.alias_name,
    use_label,
    use_kind,
    source_name,
    source_meta,
    model: s.model,
    provider: s.provider_id,
    score,
    band,
    band_label: deriveBandLabel(band),
    weakest_layer: weakest,
    checked: formatTimeSince(s.last_verified_at),
    // Passthrough server flags. The merge that decides these lives in
    // trust-local's services/in_use.py — web doesn't recompute.
    is_in_use: s.is_in_use ?? false,
    is_oauth: s.is_oauth ?? false,
    base_url: s.base_url ?? null,
    last_verified_at: s.last_verified_at,
  };
}

// ---------------------------------------------------------------------------
// 4 metric cards. Counts derived from the same payload as the table —
// keeps "totals match what you see" trivially true.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Band grouping for the BAND tab. Returns rows partitioned into one
// section per band, with sections in fixed order (risk → suspect →
// trust → info — most urgent first) and rows within each section
// sorted by "most recently checked" descending.
//
// Why "most-recent first": operators triaging this view care most
// about the freshest signal — a Suspect from 30s ago is more
// actionable than a Suspect from 6h ago. The kickoff doc literally
// says "BAND is sorted by latest detection time, not by rank".
// ---------------------------------------------------------------------------

export interface BandSection {
  band: StatusBand;
  /** Band display label LabelRef (same as TrustRow.band_label). */
  label: LabelRef;
  rows: TrustRow[];
}

// Display order in the BAND tab — Risky first because that's the
// operator's "what needs my attention RIGHT NOW" list; Unverified
// (info) last because it's the "fine, just no data yet" bucket.
const BAND_DISPLAY_ORDER: StatusBand[] = ['risk', 'suspect', 'trust', 'info'];

export function groupByBand(rows: TrustRow[], summaries: TrustSummary[]): BandSection[] {
  // We index summaries by alias so we can extract the original
  // last_verified_at for sorting. summaryToRow's `checked` field is a
  // formatted string ("12m"), which isn't sortable — and re-parsing
  // it would be lossy. Carrying the epoch around in the row would
  // bloat its shape; the indirection is cheaper.
  const verifiedAtByAlias: Record<string, number> = {};
  for (const s of summaries) {
    verifiedAtByAlias[s.alias_name] = s.last_verified_at ?? 0;
  }
  const buckets: Record<StatusBand, TrustRow[]> = {
    trust: [],
    suspect: [],
    risk: [],
    info: [],
  };
  for (const r of rows) buckets[r.band].push(r);

  return BAND_DISPLAY_ORDER.filter((b) => buckets[b].length > 0).map((band) => ({
    band,
    label: deriveBandLabel(band),
    rows: buckets[band].sort(
      (a, b) =>
        (verifiedAtByAlias[b.alias_name] ?? 0) - (verifiedAtByAlias[a.alias_name] ?? 0),
    ),
  }));
}

// ---------------------------------------------------------------------------
// §6.6 T formula — M6 Stage 4
//
// Per `降智检测分层方案.md` §6.6 + M6 plan §3.7 decision (web derive
// implements the formula directly so M7 backend can mirror byte-for-byte
// without changing UI semantics):
//
//   α_eff = α_base × crowd_conf   (α_base = 0.6, decision fixed in spec)
//   T     = α_eff · S_server + (1 − α_eff) · S_local
//
// Edge cases (§6.6 original):
//   crowd_conf = 0           → α_eff = 0 → T = S_local   (M6 阶段 5 前的常态)
//   S_local = null (0 样本)  → fall back to S_server (when crowd_conf>0)
//   both null                → T = null  ("unverified")
//
// M6 specifics:
//   - S_local = pass rate over 24h cascade verdicts, per §6.8 P3 method
//     (n_pass / n_total × 100). Filter to terminal verdicts only.
//   - S_server = summary.s_l2 (Stage 5 fills; until then = null)
//   - crowd_conf = read from server-side `state.payload.crowd_conf`
//     (M5/M6 schema currently doesn't expose it on TrustSummary; default
//      to 0 until Stage 5 plumbs the field through)
//   - questions_version rotation: cross-version samples within the same
//     24h are split. The "primary" T uses the row count's leading
//     version; the per-version breakdown is exposed for the drawer.
// ---------------------------------------------------------------------------

const ALPHA_BASE = 0.6;  // §6.6 fixed decision
const WINDOW_SECONDS_24H = 86400;
// Terminal cascade verdicts that contribute to S_local. Excludes
// 'running' / 'error' rows — those don't have an actionable score.
const TERMINAL_STATUSES = new Set(['passed', 'failed', 'inconclusive', 'pass', 'fail']);

/** One row in the per-version breakdown returned by `computeT24h`. */
export interface T24hVersionBucket {
  questions_version: string | null;
  n_samples: number;
  pass_count: number;
  S_local: number;
  T: number;
  band: StatusBand;
}

/** §6.6 T formula output. */
export interface T24hResult {
  /** Final §6.6 total. Null when 0 samples + no server score. */
  T: number | null;
  /** Local score (pass rate × 100) over 24h cascade verdicts. */
  S_local: number | null;
  /** Server-side aggregate (Stage 5 will fill via L2 crowd quorum). */
  S_server: number | null;
  /** [0, 1]. Multiplied into α_eff. M6 阶段 5 前 = 0. */
  crowd_conf: number;
  /** α_base × crowd_conf. M6 阶段 5 前 = 0. */
  alpha_eff: number;
  /** Total terminal-status cascade rows within 24h. */
  n_samples: number;
  /** Subset of n_samples that returned `passed` / `pass`. */
  pass_count: number;
  /** Band from T (or `info` when T is null). */
  band: StatusBand;
  /** Per-version breakdown when 24h window includes multiple
   *  question-bank versions. Empty when single version (or no samples). */
  version_buckets: T24hVersionBucket[];
}

/**
 * Compute T per §6.6 over the 24h window of a single alias.
 *
 * `history`     — cascade rows for this alias (typically all rows from
 *                 GET /v1/status/{alias}'s cascade_history; this function
 *                 filters by 24h + terminal status itself).
 * `summary`     — server's TrustSummary (provides S_server hints if any).
 * `nowSec`      — clock injection point for tests. Default Date.now()/1000.
 *
 * The function is pure (no side effects, no React) so it's trivially
 * unit-testable and reusable in CLI / future ops dashboards.
 */
export function computeT24h(
  history: readonly CascadeHistoryEntry[],
  summary: Pick<TrustSummary, 's_l2' | 'last_verified_at'> | null = null,
  nowSec?: number,
): T24hResult {
  const now = nowSec ?? Date.now() / 1000;
  const windowStart = now - WINDOW_SECONDS_24H;

  // 1. Filter to terminal-status rows inside the 24h window.
  const samples = history.filter((h) => {
    if (h.triggered_at <= windowStart) return false;
    return TERMINAL_STATUSES.has(h.status);
  });

  // 2. Server hints (placeholder — Stage 5 wires real S_server +
  //    crowd_conf from state.payload). Until then crowd_conf = 0 → α_eff = 0
  //    → T = S_local, matching the §6.6 边界 for empty crowd data.
  const S_server: number | null =
    summary && typeof summary.s_l2 === 'number' ? summary.s_l2 : null;
  // TODO Stage 5: read crowd_conf from summary once API exposes it.
  const crowd_conf = 0;
  const alpha_eff = ALPHA_BASE * crowd_conf;

  // 3. S_local: §6.8 P3 method (题组通过率 × 100).
  let S_local: number | null = null;
  let pass_count = 0;
  if (samples.length > 0) {
    pass_count = samples.filter(
      (s) => s.status === 'passed' || s.status === 'pass',
    ).length;
    S_local = (pass_count / samples.length) * 100;
  }

  // 4. T per §6.6 + edge cases.
  let T: number | null;
  if (S_local == null && S_server == null) {
    T = null;
  } else if (S_local == null) {
    // 0 local samples, server has data → T = S_server only.
    T = S_server;
  } else if (S_server == null) {
    // M6 阶段 5 前的常态:S_server 缺失 → T = S_local.
    T = S_local;
  } else {
    T = alpha_eff * S_server + (1 - alpha_eff) * S_local;
  }

  // 5. Per-version breakdown when multiple question_bank versions
  //    appear in the 24h window. Calling code shows them split in the
  //    drawer so users see "v1: 5/5, v2: 1/2 (question rotation)"
  //    instead of mixed numbers that can't be compared.
  const buckets = buildVersionBuckets(samples);

  return {
    T: T == null ? null : roundTo1(T),
    S_local: S_local == null ? null : roundTo1(S_local),
    S_server,
    crowd_conf,
    alpha_eff: roundTo3(alpha_eff),
    n_samples: samples.length,
    pass_count,
    band: deriveBand(T),
    version_buckets: buckets,
  };
}

function buildVersionBuckets(
  samples: readonly CascadeHistoryEntry[],
): T24hVersionBucket[] {
  if (samples.length === 0) return [];
  const byVersion = new Map<string, CascadeHistoryEntry[]>();
  for (const s of samples) {
    const v = s.questions_version ?? '__no_version__';
    const arr = byVersion.get(v) ?? [];
    arr.push(s);
    byVersion.set(v, arr);
  }
  // Only return a meaningful breakdown when there are 2+ versions.
  // Single-version is the default case; no UI need to flash a "split".
  if (byVersion.size < 2) return [];

  const out: T24hVersionBucket[] = [];
  for (const [version, rows] of byVersion.entries()) {
    const passes = rows.filter(
      (r) => r.status === 'passed' || r.status === 'pass',
    ).length;
    const sl = (passes / rows.length) * 100;
    out.push({
      questions_version: version === '__no_version__' ? null : version,
      n_samples: rows.length,
      pass_count: passes,
      S_local: roundTo1(sl),
      // T == S_local when crowd_conf=0 (M6); using the same simplified
      // form here keeps the per-version pill consistent with the
      // overall pill.
      T: roundTo1(sl),
      band: deriveBand(sl),
    });
  }
  // Sort by sample count desc — primary bucket first (UI shows it
  // bigger / above the rotation note).
  out.sort((a, b) => b.n_samples - a.n_samples);
  return out;
}

function roundTo1(x: number): number {
  return Math.round(x * 10) / 10;
}

function roundTo3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function deriveMetrics(items: TrustSummary[]): TrustMetrics {
  const now = Date.now() / 1000;
  let inUse = 0;
  let review = 0;
  let checked24h = 0;

  for (const s of items) {
    // "in use" = vault's active binding flag from the plugin. Same
    // semantic as the chip's matchesChip(in_use), so the card count
    // and the chip filter agree.
    if (s.is_in_use) inUse += 1;

    // review = needs operator attention: score < 80 OR anomaly_suggested.
    // Use the same s_combined → s_l3 fallback as the row pill so this
    // count agrees with what the user sees per-row.
    const band = deriveBand(displayScore(s));
    if (band === 'suspect' || band === 'risk' || s.anomaly_suggested) review += 1;

    if (s.last_verified_at != null && now - s.last_verified_at < 86400) {
      checked24h += 1;
    }
  }

  return {
    sources: items.length,
    in_use: inUse,
    review,
    checked_24h: checked24h,
  };
}

// ---------------------------------------------------------------------------
// Stage 7 (2026-05-22): Health overview panel
//
// Replaces the 4-card metric grid. The user-facing question is "are my
// sources healthy overall in the last 24h?" — one big number + brief
// supplementary stats. Definition decisions:
//
//   - "overallPct" = mean of `s_combined` across rows that were verified
//     within the 24h window. We deliberately do NOT recompute §6.6 T24h
//     here (that requires per-alias history → N round-trips); the
//     latest-verify-score over a 24h-checked subset is a reasonable
//     proxy for "current health" and stays cheap. M7 will swap this for
//     a true T24h aggregate once §6.6 lives backend-side.
//   - "checkedCount / totalCount" → "42 / 48" template stat.
//   - "healthyCount" = rows in 'trust' band (single-source band rule
//     from deriveBand) — keeps the per-band UI label and this stat in
//     agreement.
//   - "needsReviewCount" = mirrors deriveMetrics.review (anomaly OR
//     suspect/risk band).
//   - "description" — one-line prose hint derived from overallPct;
//     localised string lives here so the page stays declarative.
//
// Returns nulls (not 0) for overallPct when no rows have a usable score
// — UI renders "—" rather than "0%" which would imply "everything's
// broken" instead of "no data yet".
// ---------------------------------------------------------------------------

export interface HealthSummary {
  /** Integer 0..100, or null when no rows have a usable s_combined. */
  overallPct: number | null;
  /** How many rows were verified within the last 24h. */
  checkedCount: number;
  /** Total in-scope sources (= `metrics.sources`). */
  totalCount: number;
  /** Count of rows currently in the 'trust' band. */
  healthyCount: number;
  /** Count of rows needing operator attention (mirrors `metrics.review`). */
  needsReviewCount: number;
  /** Tier hint for UI colouring — same band scale as deriveBand. */
  band: StatusBand;
  /** One-line description LabelRef, derived from overallPct. */
  description: LabelRef;
}

export function computeHealthSummary(items: TrustSummary[]): HealthSummary {
  const now = Date.now() / 1000;
  let checkedCount = 0;
  let healthyCount = 0;
  let needsReviewCount = 0;

  // Mean over rows checked within 24h that have a usable score. We
  // restrict to checked-recently rows for two reasons: (a) keeps the
  // ring number in sync with the "Checked Accounts" stat (same subset)
  // and (b) stale verify scores from days ago shouldn't dominate the
  // current-health signal.
  let sumScore = 0;
  let scoreCount = 0;

  for (const s of items) {
    const verifiedRecently =
      s.last_verified_at != null && now - s.last_verified_at < 86400;
    if (verifiedRecently) checkedCount += 1;

    // Same s_combined → s_l3 fallback chain the row pill uses, so the
    // overall ring + Healthy / Needs Review stats stay in sync with
    // what the operator sees per row. Without this M6 always shows
    // ring '—' even right after a passing cascade.
    const score = displayScore(s);
    const band = deriveBand(score);
    if (band === 'trust') healthyCount += 1;
    if (band === 'suspect' || band === 'risk' || s.anomaly_suggested) {
      needsReviewCount += 1;
    }

    if (verifiedRecently && typeof score === 'number') {
      sumScore += score;
      scoreCount += 1;
    }
  }

  const overallPct: number | null =
    scoreCount > 0 ? Math.round(sumScore / scoreCount) : null;
  const band = deriveBand(overallPct);

  const description = describeHealth(overallPct, needsReviewCount, items.length);

  return {
    overallPct,
    checkedCount,
    totalCount: items.length,
    healthyCount,
    needsReviewCount,
    band,
    description,
  };
}

function describeHealth(
  overall: number | null,
  needsReview: number,
  total: number,
): LabelRef {
  if (total === 0) return { key: L + 'healthNoSources' };
  if (overall == null) return { key: L + 'healthNoRecentChecks' };
  if (overall >= 80) {
    // i18next resolves the `_one` / `_other` plural suffix from `count`,
    // so we pass the base key + a `count` var rather than baking the
    // pluralisation here. The singular/plural English (and zh) wording
    // lives in the catalog.
    return needsReview === 0
      ? { key: L + 'healthStable' }
      : { key: L + 'healthMostlyStable', vars: { count: needsReview } };
  }
  if (overall >= 60) {
    return { key: L + 'healthNeedsReview', vars: { count: needsReview } };
  }
  return { key: L + 'healthMultipleFlagged', vars: { count: needsReview } };
}

// ---------------------------------------------------------------------------
// Stage 7: BAND view = baseurl dedup (replaces band-grouping)
//
// Multiple aliases routing through the same `base_url` collapse to one
// row. Rationale: a relay gateway like `aicoding.2233.ai/v1` either
// degrades all credentials behind it or none — showing one row per
// alias is noise. One row per baseurl, with the worst-confidence
// member surfaced as the representative + a count of members.
//
// Null base_url groups under a synthetic "Unknown gateway" key so
// they're not silently dropped. Sort order: latest verify time desc,
// matching the template's "latest first" caption.
//
// IMPORTANT: this function does NOT re-derive base_url — it consumes
// the field as-provided by trust-local's /v1/status. The single
// source of truth is vault (see in_use.py + Stage 7 backend doc).
// ---------------------------------------------------------------------------

export interface BaseUrlGroup {
  /** Vault base_url verbatim, or "" for unknown. */
  base_url: string;
  /** Display label for the gateway. A raw host+path string for personal
   *  base_url groups (user-config value, NOT keyed), or a fixed LabelRef
   *  for the "Unknown gateway" / "OAuth (official)" cases. */
  label: string | LabelRef;
  /** Aliases sharing this baseurl. Sorted: lowest score first
   *  (worst risk surfaces). */
  rows: TrustRow[];
  /** Representative row used for the BAND list display. = rows[0]
   *  (worst risk). */
  representative: TrustRow;
  /** Latest `last_verified_at` across the group; null if none. */
  latest_verified_at: number | null;
  /** Worst band across the group (used for row colouring). */
  band: StatusBand;
}

const UNKNOWN_BASE_URL_KEY = '';
const UNKNOWN_BASE_URL_LABEL: LabelRef = { key: L + 'gatewayUnknown' };
// 2026-05-23: OAuth credentials are not user-configurable to a non-
// official endpoint (vault deliberately does NOT store base_url for
// OAuth — there's nothing to store). Pre-fix, OAuth rows fell into
// "Unknown gateway" alongside genuine missing-baseurl rows, which is
// misleading: an Anthropic / OpenAI OAuth account has a perfectly
// well-known upstream — it's the official API. Group OAuth rows by
// provider with an explicit "{provider} OAuth (official)" label
// instead. Key prefix keeps them separate from base_url groups.
const OAUTH_KEY_PREFIX = 'oauth:';

function oauthGroupKey(providerId: string): string {
  return OAUTH_KEY_PREFIX + (providerId || 'unknown');
}

function oauthGroupLabel(providerId: string): LabelRef {
  const p = (providerId || '').trim();
  if (!p) return { key: L + 'gatewayOauthOfficial' };
  // Provider id mapping mirrors the canonical short names trust-local
  // uses (anthropic, openai, google, kimi_code, moonshot, ...). Render
  // the casual brand name so the label reads naturally to users. Brand
  // names are proper nouns → stay plain strings, passed into the
  // "{{brand}} OAuth (official)" key as the `brand` interpolation var
  // (only the "OAuth (official)" wrapper is localised).
  const brand =
    p === 'anthropic' ? 'Anthropic' :
    p === 'openai'    ? 'OpenAI'    :
    p === 'google'    ? 'Google'    :
    p === 'kimi_code' ? 'Kimi'      :
    p === 'moonshot'  ? 'Moonshot'  :
    p.charAt(0).toUpperCase() + p.slice(1);
  return { key: L + 'gatewayBrandOauthOfficial', vars: { brand } };
}

export function dedupByBaseUrl(rows: readonly TrustRow[]): BaseUrlGroup[] {
  const byKey = new Map<string, TrustRow[]>();
  for (const r of rows) {
    let key: string;
    if (r.base_url && r.base_url.length > 0) {
      // Personal API key with explicit base_url → one row per gateway.
      key = r.base_url;
    } else if (r.is_oauth) {
      // OAuth without base_url is the normal case (vault doesn't store
      // one). Group by provider so e.g. Anthropic OAuth and OpenAI
      // OAuth land in separate rows, both correctly labeled as
      // official.
      key = oauthGroupKey(r.provider);
    } else {
      // Genuine "vault unreachable / pre-baseurl-column" catchall.
      key = UNKNOWN_BASE_URL_KEY;
    }
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }

  const out: BaseUrlGroup[] = [];
  for (const [key, members] of byKey.entries()) {
    // Worst-band-first ordering inside the group — operator sees the
    // member dragging the gateway's health down first.
    const sorted = [...members].sort((a, b) => bandRank(a.band) - bandRank(b.band));
    const representative = sorted[0]!;
    const latest_verified_at = members.reduce<number | null>((acc, r) => {
      if (r.last_verified_at == null) return acc;
      return acc == null || r.last_verified_at > acc ? r.last_verified_at : acc;
    }, null);

    let label: string | LabelRef;
    if (key === UNKNOWN_BASE_URL_KEY) {
      label = UNKNOWN_BASE_URL_LABEL;
    } else if (key.startsWith(OAUTH_KEY_PREFIX)) {
      label = oauthGroupLabel(key.slice(OAUTH_KEY_PREFIX.length));
    } else {
      // Raw host+path from the user's configured base_url — plain string.
      label = labelForBaseUrl(key);
    }

    out.push({
      base_url: key,
      label,
      rows: sorted,
      representative,
      latest_verified_at,
      band: representative.band,
    });
  }

  // Sort groups: "latest first" matches template's caption + matches
  // operator's "what happened last" mental model.
  out.sort((a, b) => {
    const at = a.latest_verified_at ?? 0;
    const bt = b.latest_verified_at ?? 0;
    return bt - at;
  });

  return out;
}

// risk ranks lowest (= worst, surfaces first); info ranks last.
function bandRank(band: StatusBand): number {
  switch (band) {
    case 'risk':
      return 0;
    case 'suspect':
      return 1;
    case 'trust':
      return 2;
    case 'info':
      return 3;
  }
}

/**
 * Human-readable label for a baseurl. Strips protocol + trailing
 * slashes, keeps host + path. Pure string formatting — no host-name
 * canonicalisation, no provider inference. URL parse failure (e.g.
 * malformed vault entry) falls back to the raw string.
 */
function labelForBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.replace(/\/$/, '');
    return tail ? `${u.host}${tail}` : u.host;
  } catch {
    return url;
  }
}
