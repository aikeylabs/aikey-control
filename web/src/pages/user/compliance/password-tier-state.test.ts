// Fences R-credential-password-tier-6.S2 (member view): the level renders ONLY
// when the enforcing node reported it, and maps exactly audit→basic / mask→advanced.
import { describe, expect, it } from 'vitest';
import { derivePasswordTier } from './password-tier-state';
import type { EffectivePacksReport } from '@/shared/api/user/compliance';

const base: EffectivePacksReport = { built_in: [], engines: [], pulled: [], cursor: 0 };

describe('derivePasswordTier', () => {
  it('maps the runtime ceiling to the level', () => {
    expect(derivePasswordTier({ ...base, action_policy: { lane_grade_ceilings: { 'password.credential_password.tier_inferred': 'audit' } } })).toBe('basic');
    expect(derivePasswordTier({ ...base, action_policy: { lane_grade_ceilings: { 'password.credential_password.tier_inferred': 'mask' } } })).toBe('advanced');
  });
  it('renders nothing when the backend cannot know (team mirror / old proxy / junk)', () => {
    expect(derivePasswordTier(undefined)).toBeUndefined();
    expect(derivePasswordTier(base)).toBeUndefined(); // identity-only mirror: no action_policy
    expect(derivePasswordTier({ ...base, action_policy: {} })).toBeUndefined();
    expect(derivePasswordTier({ ...base, action_policy: { lane_grade_ceilings: {} } })).toBeUndefined();
    expect(derivePasswordTier({ ...base, action_policy: { lane_grade_ceilings: { 'password.credential_password.tier_inferred': 'warn' } } })).toBeUndefined();
    // address entries alone must not fabricate a password level:
    expect(derivePasswordTier({ ...base, action_policy: { lane_grade_ceilings: { 'address.cn_address.tier_mask': 'mask' } } })).toBeUndefined();
  });
});
