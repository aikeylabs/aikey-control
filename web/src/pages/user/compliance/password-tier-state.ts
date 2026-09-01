/**
 * Password-lane level derivation (阶段8/合规密码档分级 R-credential-password-tier-6).
 *
 * Single exit for reading the level off the enforcing node's runtime ceilings:
 * 'audit' ⇒ basic (simple — inferred hits recorded only), 'mask' ⇒ advanced.
 * ANY other shape — absent action_policy (team identity-only mirror), absent
 * key (older proxy), unknown value — returns undefined and the page renders
 * NOTHING for it. Claiming a level this backend cannot know is the 2026-08-10
 * "blames old detector" bug shape (wire-label-display.test.ts's sibling rule).
 */
import type { EffectivePacksReport } from '@/shared/api/user/compliance';

export const PASSWORD_TIER_CEILING_KEY = 'password.credential_password.tier_inferred';

export type PasswordTier = 'basic' | 'advanced';

export function derivePasswordTier(report: EffectivePacksReport | undefined): PasswordTier | undefined {
  const ceiling = report?.action_policy?.lane_grade_ceilings?.[PASSWORD_TIER_CEILING_KEY];
  if (ceiling === 'audit') return 'basic';
  if (ceiling === 'mask') return 'advanced';
  return undefined;
}
