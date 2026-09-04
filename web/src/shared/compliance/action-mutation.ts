/**
 * Which compliance actions actually rewrote what the upstream model received.
 *
 * 🔴 WHY THIS HAS A NAME (bugfix 2026-09-04-warn-rows-look-masked)
 *
 * `redacted_snippet` is an AUDIT-VIEW redaction: the detector computes it for
 * EVERY finding, whatever action the policy took. Only `mask` rewrites the
 * forwarded body — in aikey-proxy `filter_dispatch.go` the `ActionMask` branch
 * is the sole caller of `setText()`, while `ActionWarn` logs
 * `proxy.filter.warned` ("passed through") and falls through untouched.
 * `block` forwards nothing at all.
 *
 * So a `warn` row renders the same `{{ADDR}}` shape as a genuine mask while the
 * model received the original text verbatim. Found on winpc2 2026-09-04: a
 * 乡-level Chinese address graded TierWarn by the address lane (by design — the
 * lane caps TierWarn at warn, `actionpolicy/policy.go` laneTierCeilings) went
 * upstream in the clear, and four audit rows displayed `{{ADDR}}`. Reading that
 * page, nobody could tell the leak from a successful mask.
 *
 * The distinction is a fact about the ENFORCEMENT CONTRACT, not about one
 * table cell, and it is re-derived wherever compliance events are rendered
 * (self-view list, self-view drawer, master audit, triage). One home for it, so
 * the next renderer asks this function instead of re-deciding from the badge.
 */

/**
 * Actions that leave the forwarded content byte-identical to what the user
 * typed. `mask` is excluded because it rewrites; `block` because nothing is
 * forwarded at all — neither one misleads a reader who sees a masked snippet.
 */
const SENT_UNCHANGED: ReadonlySet<string> = new Set(['warn', 'allow', 'audit']);

/**
 * True when this action did NOT change what the model received — i.e. any
 * masked snippet shown alongside it is display-only.
 *
 * Unknown / future action values return false: a renderer must not promise
 * "the original was sent" for an action whose enforcement semantics this build
 * does not know. Silence is the safe default here; the badge still shows the
 * raw action string.
 */
export function sentUnchanged(action: string | null | undefined): boolean {
  if (!action) return false;
  return SENT_UNCHANGED.has(action.toLowerCase());
}
