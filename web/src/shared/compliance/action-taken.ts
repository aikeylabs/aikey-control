/**
 * `compliance_events.action_taken` — the FRONTEND half of the value domain.
 *
 * ── What this file is for ────────────────────────────────────────────────────
 * The database CHECK constraint (aikey-config-tool/pkg/dbmigrate/schema_enums.go,
 * `ComplianceActionTakenValues`) decides which outcomes can exist. The console
 * decides which outcomes a human can SEE and FILTER FOR. Those two lists were
 * never linked, and on 2026-08-10 the gap produced exactly the failure the
 * migration's own comment had argued against:
 *
 *   `audit` was relaxed into the constraint so tool-block scan findings could
 *   land ("we saw something, we changed nothing, we told nobody"). The console
 *   still knew four values. The rows arrived, and the console
 *     · offered no filter option → they could not be listed at all, and
 *     · fell through `default: return 'green'` in the badge helper → they were
 *       painted in ALLOW's green, i.e. rendered as "nothing matched".
 *   The database preserved the distinction; the presentation layer erased it.
 *
 * ── The four outlets this module owns ────────────────────────────────────────
 * "The console knows about an action value" is not one fact, it is four, and a
 * value that is missing from any one of them is broken in a different way:
 *
 *   1. filter options   → `complianceActionFilterOptions()`  (else: unfilterable)
 *   2. badge styling    → `complianceActionBadgeVariant()`   (else: mis-colored)
 *   3. i18n labels      → `COMPLIANCE_ACTION_LABEL_SUFFIX`   (else: raw key)
 *   4. summary counts   → `COMPLIANCE_ACTION_SUMMARY_ACTIONS` (else: uncounted)
 *
 * They live together HERE so there is one place to change, and so the fence
 * (`action-taken.contract.test.ts`) can assert all four against the Go domain in
 * one sweep instead of chasing four call sites in two repositories.
 *
 * ── One copy, two consoles ───────────────────────────────────────────────────
 * This module is imported by BOTH consoles:
 *   · aikey-control        — pages/user/compliance (the Personal self-view, which
 *                            aikey-control-master also renders verbatim for the
 *                            team member self-view)
 *   · aikey-control-master — pages/master/compliance/audit (the admin team view),
 *                            via `aikey-control-web/shared/compliance/action-taken.ts`
 * It is a real cross-repo import through the `file:` package dep, NOT a mirrored
 * copy plus a dual-edit test — same rule the vite config states for
 * `@/shared/api/user/*`: user/web is the source of truth, so a dual-edit trap
 * cannot form.
 *
 * ── Why hand-written and not generated from the Go enum ──────────────────────
 * The Go side DOES have a single enumeration, so codegen was possible. It was
 * rejected, for the same reasons control-events/event-types.ts states:
 *   · A generated list would still leave three of the four outlets manual — a
 *     value needs a human-written BILINGUAL label and a deliberate color. A
 *     generated-but-unlabeled value renders its raw i18n key, so the fence has
 *     to exist either way; codegen would only remove the smallest of the four
 *     chores while the fence still carries the actual guarantee.
 *   · It would add a build-time artifact to `restart-personal`, `restart-trial1`,
 *     `build-server-stack` and release.sh (build-time-codegen-propagation), and
 *     any of those picking up a stale copy is itself a bug class.
 * A value domain that changes once or twice a year does not earn that. The fence
 * reads the Go source directly and goes red the moment the two disagree.
 *
 * 🔴 Adding a value: add it to `COMPLIANCE_ACTION_TAKEN_VALUES`, give it a
 * variant, a label suffix, a place in the filter order, and translate the label
 * in BOTH locales of BOTH catalogs. The fence names whichever you forget.
 */

/**
 * Every value the database may hold, in the order the Go domain lists them.
 *
 * Semantics (verbatim from schema_enums.go — these are OUTCOMES, i.e. what the
 * proxy actually did, not what the detector wished for):
 *   allow  nothing matched, or the matched rule is advisory only
 *   mask   the matched span was rewritten before the bytes were forwarded
 *   block  the request was refused; nothing was forwarded
 *   warn   recorded AND surfaced to the user; bytes forwarded unchanged
 *   audit  recorded ONLY; bytes forwarded unchanged, and nobody is told
 */
export const COMPLIANCE_ACTION_TAKEN_VALUES = [
  'allow',
  'mask',
  'block',
  'warn',
  'audit',
] as const;

export type ComplianceActionTaken = (typeof COMPLIANCE_ACTION_TAKEN_VALUES)[number];

/** Badge variants used for action chips — a subset of `BadgeVariant`. */
export type ComplianceActionBadgeVariant = 'red' | 'yellow' | 'green' | 'gray' | 'dim';

/**
 * Outcome → chip style. Every value gets a DISTINCT variant; the fence asserts
 * pairwise distinctness, because two outcomes sharing a color is precisely how
 * `audit` became indistinguishable from `allow`.
 *
 * The palette is the console's existing six badge classes (index.css) — nothing
 * new was invented for this:
 *   block → red    (.badge-revoked)   the request was refused
 *   mask  → yellow (.badge-suspended) the bytes were altered
 *   warn  → gray   (.badge-neutral)   recorded and surfaced, bytes unchanged
 *   audit → dim    (.badge-dim)       recorded silently, bytes unchanged
 *   allow → green  (.badge-active)    nothing to see
 *
 * Why `dim` for `audit`: it is the one unassigned token, and its documented role
 * ("one hierarchy tier below the status pills: no fill, muted text, regular
 * weight — still reads as a classifier without competing with the row") is an
 * exact description of what `audit` means. It also places `audit` correctly on
 * the ladder — visually quieter than `warn`'s filled chip, and unmistakably not
 * `allow`'s green fill, which was the whole defect.
 *
 * `.badge-protocol` (blue) is deliberately NOT used: it is reserved for wire-
 * protocol labels, and reusing it here would make one color mean two things.
 */
export const COMPLIANCE_ACTION_BADGE_VARIANT: Record<
  ComplianceActionTaken,
  ComplianceActionBadgeVariant
> = {
  block: 'red',
  mask: 'yellow',
  warn: 'gray',
  audit: 'dim',
  allow: 'green',
};

/**
 * Style for a value this build does not know.
 *
 * 🔴 This is the treatment the OLD `default: return 'green'` should always have
 * had. That branch was not merely missing `audit` — it asserted, about every
 * value that had not been invented yet, that it was safe. A server one version
 * ahead could ship `quarantine` and this console would draw it as "nothing
 * matched". Neutral gray makes no such claim: the chip still carries the raw
 * value as its text, so the reader sees an outcome they do not recognize rather
 * than a reassuring green one.
 */
export const UNKNOWN_COMPLIANCE_ACTION_VARIANT: ComplianceActionBadgeVariant = 'gray';

/** Values already reported, so a table of N rows warns once, not N times. */
const warnedUnknownActions = new Set<string>();

/**
 * Chip variant for an `action_taken` string straight off the wire.
 *
 * Unknown values fall back to neutral AND log once — the console must not fail
 * to render a row it cannot classify (that would hide the event entirely), but
 * a silent fallback is how this drifted in the first place. The console warning
 * is the developer-facing signal; the fence below is the CI-facing one.
 */
export function complianceActionBadgeVariant(action: string): ComplianceActionBadgeVariant {
  const known = COMPLIANCE_ACTION_BADGE_VARIANT[action as ComplianceActionTaken];
  if (known) return known;
  if (!warnedUnknownActions.has(action)) {
    warnedUnknownActions.add(action);
    console.warn(
      `[compliance] unknown action_taken "${action}" — rendering it neutral. The server ` +
        `is writing an outcome this console does not know; add it to ` +
        `shared/compliance/action-taken.ts (value + variant + label in both locales).`,
    );
  }
  return UNKNOWN_COMPLIANCE_ACTION_VARIANT;
}

/** Test-only: clears the warn-once memo so a case can assert the warning fires. */
export function __resetUnknownActionWarnings(): void {
  warnedUnknownActions.clear();
}

/**
 * Order the filter dropdown offers, most-intervention first — an operator scans
 * for "what did we stop" before "what did we let through". `audit` sits between
 * `warn` and `allow`: a finding fired (unlike `allow`) but nobody was told
 * (unlike `warn`).
 */
export const COMPLIANCE_ACTION_FILTER_ORDER: readonly ComplianceActionTaken[] = [
  'block',
  'mask',
  'warn',
  'audit',
  'allow',
];

/** i18n namespace a page labels its action filter from. */
export type ComplianceActionLabelScope = 'complianceAudit' | 'compliancePage';

/**
 * Action → i18n key, per page namespace. The admin team view labels from
 * `complianceAudit.`, the self-view from `compliancePage.`.
 *
 * 🔴 Written out as WHOLE dotted keys rather than assembled from a prefix and a
 * suffix, which would be half the lines. Two reasons, both mechanical:
 *   · `grep compliancePage.actionAudit` has to find this file. A key spliced
 *     together at runtime is invisible to the next person and to tooling.
 *   · the i18n fences depend on it — R4 (orphan keys) counts a quoted dotted
 *     string as a reference, so an assembled key would report all ten of these
 *     live keys as dead, and resolving a backtick-interpolated
 *     `<scope>.<suffix>` key would additionally spend from the dynamic-call-site
 *     budget. This is the copy-table shape i18n-key-coverage.test.ts explicitly
 *     recommends over interpolation.
 */
export const COMPLIANCE_ACTION_LABEL_KEY: Record<
  ComplianceActionLabelScope,
  Record<ComplianceActionTaken, string>
> = {
  complianceAudit: {
    block: 'complianceAudit.actionBlock',
    mask: 'complianceAudit.actionMask',
    warn: 'complianceAudit.actionWarn',
    audit: 'complianceAudit.actionAudit',
    allow: 'complianceAudit.actionAllow',
  },
  compliancePage: {
    block: 'compliancePage.actionBlock',
    mask: 'compliancePage.actionMask',
    warn: 'compliancePage.actionWarn',
    audit: 'compliancePage.actionAudit',
    allow: 'compliancePage.actionAllow',
  },
};

/** Full i18n key for one action under one page's namespace. */
export function complianceActionLabelKey(
  action: ComplianceActionTaken,
  scope: ComplianceActionLabelScope,
): string {
  return COMPLIANCE_ACTION_LABEL_KEY[scope][action];
}

/**
 * The action filter's options, covering the whole value domain by construction.
 *
 * Callers that need an "all actions" entry prepend their own — it is not an
 * action value and must not leak into the domain.
 */
export function complianceActionFilterOptions(
  t: (key: string) => string,
  scope: ComplianceActionLabelScope,
): { value: string; label: string }[] {
  return COMPLIANCE_ACTION_FILTER_ORDER.map((action) => ({
    value: action,
    label: t(complianceActionLabelKey(action, scope)),
  }));
}

/**
 * Actions the self-view's summary bar counts, in card order.
 *
 * 🔴 Known gap, PRE-EXISTING and deliberately left alone here: `warn` has never
 * had a card either, so these counts have never summed to the total. That is a
 * separate call (add a fifth card, or relabel the bar as a partial breakdown)
 * and it is flagged rather than folded into this change. The fence asserts only
 * that every action listed here is a real domain value and that `audit` is
 * among them — so this list can never again silently drop the value this module
 * exists for, without pretending the `warn` hole is fixed.
 */
export type ComplianceSummaryAction = 'mask' | 'allow' | 'block' | 'audit';

export const COMPLIANCE_ACTION_SUMMARY_ACTIONS: readonly ComplianceSummaryAction[] = [
  'mask',
  'allow',
  'block',
  'audit',
];

/**
 * Summary-card accent per carded action, matching that action's badge color so
 * the card and the chips it counts read as the same thing. The three hex values
 * are the ones the cards already used; `audit` follows `.badge-dim`'s muted
 * foreground token, the same token its chip uses.
 *
 * Keyed by `ComplianceSummaryAction`, NOT by the full domain — deliberately. If
 * someone later gives `warn` a card, extending the union is a compile error
 * until they also supply a color and a label suffix here, which is a stronger
 * guarantee than a fence and removes any temptation to name a translation key
 * that does not exist in the catalogs.
 */
export const COMPLIANCE_ACTION_SUMMARY_COLOR: Record<ComplianceSummaryAction, string> = {
  mask: '#fb923c',
  allow: '#4ade80',
  block: '#f87171',
  audit: 'var(--muted-foreground)',
};

/** Summary-card i18n key per carded action (whole keys — see the note above). */
export const COMPLIANCE_ACTION_SUMMARY_LABEL_KEY: Record<ComplianceSummaryAction, string> = {
  mask: 'compliancePage.summaryMasked',
  allow: 'compliancePage.summaryAllowed',
  block: 'compliancePage.summaryBlocked',
  audit: 'compliancePage.summaryAudited',
};
