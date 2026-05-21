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

import type { TrustSummary } from './api';

export type StatusBand = 'trust' | 'suspect' | 'risk' | 'info';

export interface TrustRow {
  /** Stable identity for React keys + per-row Check button binding. */
  alias_name: string;
  use_label: string;
  use_kind: string;
  source_name: string;
  source_meta: string;
  model: string;
  provider: string;
  score: number;
  band: StatusBand;
  band_label: string;
  checked: string;
  /** Day 3 will set this from a verify-id polling map; Day 2 always
   *  false because we don't trigger verifies yet. */
  running?: boolean;
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

export function deriveBandLabel(band: StatusBand): string {
  switch (band) {
    case 'trust':
      return 'Trusted';
    case 'suspect':
      return 'Suspect';
    case 'risk':
      return 'Risky';
    case 'info':
      return 'Unverified';
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

function deriveSourceLabels(alias: string): { name: string; meta: string } {
  const oauthMatch = alias.match(/^(?:oauth:)?session_([a-f0-9]+)/i);
  if (oauthMatch) {
    return {
      name: 'OAuth account',
      meta: `session_${oauthMatch[1].slice(0, 8)}…`,
    };
  }
  if (alias.includes('@') && alias.includes('.')) {
    // Bare email-like identity (e.g. FreySilvaqzs@qualityservice.com)
    return {
      name: alias,
      meta: 'OAuth identity',
    };
  }
  const appMatch = alias.match(/^app:([^:]+):([0-9a-f-]+)/i);
  if (appMatch) {
    const slug = appMatch[1];
    const idTail = appMatch[2].slice(0, 8);
    return {
      name: slug,
      meta: `app key · ${idTail}…`,
    };
  }
  return { name: alias, meta: 'personal BYOK' };
}

function deriveUseLabel(summary: TrustSummary): { label: string; kind: string } {
  // Day 2: trust-local doesn't tell us "which app is currently using this
  // alias" — that's a usage_events join we don't have here. Show the
  // alias_name primary identity, and tag with `verified` vs `unverified`
  // so the column carries SOME signal. Day 4 will join with usage-ledger
  // to fill in actual `app1` / `app2` slot bindings (kickoff §2.1).
  const verifiedTag = summary.last_verified_at == null ? 'unverified' : 'last 24h';
  return { label: summary.alias_name.split(/[:@/]/)[0] || summary.alias_name, kind: verifiedTag };
}

// ---------------------------------------------------------------------------
// Main projection: TrustSummary (server shape) → TrustRow (UI shape).
// ---------------------------------------------------------------------------

export function summaryToRow(s: TrustSummary): TrustRow {
  const band = deriveBand(s.s_combined);
  const score = s.s_combined == null ? 0 : Math.round(s.s_combined);
  const { label: use_label, kind: use_kind } = deriveUseLabel(s);
  const { name: source_name, meta: source_meta } = deriveSourceLabels(s.alias_name);

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
    checked: formatTimeSince(s.last_verified_at),
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
  label: string;
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

export function deriveMetrics(items: TrustSummary[]): TrustMetrics {
  const now = Date.now() / 1000;
  let inUse = 0;
  let review = 0;
  let checked24h = 0;

  for (const s of items) {
    // "in use" = has a verify result other than "never". Day 4 swaps
    // to a real usage_events join if needed.
    if (s.last_verify_result && s.last_verify_result !== 'never') inUse += 1;

    // review = needs operator attention: score < 80 OR anomaly_suggested
    const band = deriveBand(s.s_combined);
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
