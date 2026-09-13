/**
 * The ONE sensitivity-level badge (敏感等级 / sensitivity level, L1–L5).
 *
 * spec: R-compliance-grading-7.S1 · R-compliance-grading-4.S1
 * (需求包 roadmap20260320/技术实现/阶段9-商业化版本/博时基金合规能力融合, task 4.6;
 * contract: design.md §4b「web（两侧共用）`<LevelBadge level={n} labels={labels} />`」)
 *
 * # What problem this solves
 *
 * A finding now carries the customer's data-classification grade, and three
 * different surfaces render it: the master 分类分级 tree (4.2), the audit page
 * (4.5) and the member self-view (5.1). The partner implementation this feature
 * merges from wrote the grade chip inline in EIGHT files, and two of the eight
 * ended up drawing L4 and L5 the same colour
 * (research-合作方设计深读与融合设计.md §230). Nothing failed: every copy
 * compiled and rendered; the only symptom was that the two grades an auditor
 * most needs to tell apart became indistinguishable.
 *
 * So there is one component, and `level-action-literal.test.ts`
 * (aikey-control-master/web/src/pages/master/compliance) scans both web trees
 * to prove there is no second one.
 *
 * # 🔴 Why this file knows no level NAMES
 *
 * The word an org uses for L4 is that ORG's word; the next customer calls the
 * same grade something else. The names live in the org's own document
 * (`organizations.compliance_grading.labels`, served on
 * `GET /v1/compliance/policy` as `policy.grading.labels`, shaped
 * `{"<level>": "<that org's name for it>"}`) and arrive here as the `labels`
 * prop. A name written into this tree would
 * render confidently and wrongly for every org but the one it was copied from
 * — the silent kind of wrong, because the badge still looks right.
 *
 * Colour is the one thing this file DOES decide: it is a pure display concern
 * derived from the ordinal, carries no policy, and is identical for every
 * tenant.
 *
 * # 🔴 Why an absent level renders nothing
 *
 * A detector older than this release reports no grade at all. Drawing “L1”, a
 * dash, or an empty chip would state something about data we never received —
 * the same shape as the 2026-08-10 bug where the member self-view blamed an old
 * detector for a by-design absence
 * (workflow/CI/bugfix/20260810-team-compliance-selfview-blames-old-detector.md),
 * and as `derivePasswordTier`'s rule one directory over: unknown renders
 * nothing rather than a plausible default.
 */
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeVariant } from '@/shared/ui/Badge';

/**
 * A level (the decimal string the grading document uses as its JSON object
 * keys) → the customer's own name for it. Shape is `policy.grading.labels`
 * verbatim; this tree never authors one.
 */
export type LevelLabels = Record<string, string>;

/**
 * Level → chip style. The ONLY such table in web; the source scan in
 * level-action-literal.test.ts fails on a second one, in either tree, whether
 * written as a table or as a branch on the level.
 *
 * All five are pairwise distinct — that is the partner defect, verbatim — and
 * every value maps to a DIFFERENT class in index.css, not merely a different
 * BadgeVariant spelling (`green`/`active` share `.badge-active`, so picking
 * both would look identical on screen while passing a naive distinctness test).
 *
 *   1 → green   nothing to protect. Same token, same meaning, as the action
 *               chip's `allow` one file over: “nothing to see here”.
 *   2 → dim     a classifier, one hierarchy tier below the status pills.
 *   3 → gray    neutral fill: notable, not yet alarming.
 *   4 → yellow  warning.
 *   5 → red     the highest grade the document defines.
 *
 * `protocol` (blue) is deliberately NOT used, even though it would give a
 * tidier monotone ramp: `action-taken.ts` in this directory reserves it for
 * wire-protocol labels, and one colour meaning two things is what that
 * reservation exists to prevent. Spending `green` on L1 instead costs a
 * strictly-increasing visual weight and buys keeping an existing written rule
 * intact — and L1 IS the “nothing to protect” case, so green is not a misread
 * there the way it would be at L3.
 */
export const LEVEL_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  '1': 'green',
  '2': 'dim',
  '3': 'gray',
  '4': 'yellow',
  '5': 'red',
};

const LOWEST_LEVEL = 1;
const HIGHEST_LEVEL = 5;

/**
 * The chip style for a level.
 *
 * Out-of-range clamps to the nearest end rather than falling through to an
 * unstyled chip: the document is defined over L1–L5 (proposal.md 名词字典), so
 * a 6 can only come from a server ahead of this build, and dropping the chip on
 * the floor would hide a grade we were explicitly told about.
 */
export function levelBadgeVariant(level: number): BadgeVariant {
  const clamped = Math.min(HIGHEST_LEVEL, Math.max(LOWEST_LEVEL, Math.trunc(level)));
  return LEVEL_BADGE_VARIANTS[String(clamped)];
}

/**
 * The chip text: `<prefix> L<n>` plus the customer's name when the document
 * has one.
 *
 * A level with no entry in `labels` is not supposed to reach a console —
 * master's intake drops it (service/internal/compliance/intake_level.go, so
 * that an org which never configured grading keeps behaving exactly as before,
 * R-compliance-grading-3.S1). If one does, the level is a fact we were handed
 * and the name is not: print the fact, omit the rest, invent nothing.
 */
export function formatLevelBadgeText(
  level: number,
  labels: LevelLabels | undefined,
  prefix: string,
): string {
  const name = labels?.[String(Math.trunc(level))];
  return name ? `${prefix} L${level}·${name}` : `${prefix} L${level}`;
}

export interface LevelBadgeProps {
  /** `compliance_findings.level` / `compliance_events.max_level`. Absent ⇒ nothing renders. */
  level?: number | null;
  /** `policy.grading.labels`. Absent ⇒ the level renders without a name. */
  labels?: LevelLabels;
  className?: string;
}

/**
 * 🔴 Its own slot — never the password-tier chip's
 * (R-compliance-grading-7.S1). Both concepts got called 「级」 and they answer
 * different questions: password tier = how much the DETECTOR was allowed to
 * infer; sensitivity level = how secret the DATA is (proposal.md 拍板点 24).
 * Sharing one chip would let a reader take 「高级级」 for 「高敏感等级」.
 */
export function LevelBadge({ level, labels, className }: LevelBadgeProps) {
  const { t } = useTranslation();
  if (level == null || !Number.isFinite(level)) return null;
  return (
    <Badge variant={levelBadgeVariant(level)} className={className}>
      {formatLevelBadgeText(level, labels, t('complianceGrading.levelBadge.prefix'))}
    </Badge>
  );
}
