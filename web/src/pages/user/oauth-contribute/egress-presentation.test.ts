import { describe, expect, it } from 'vitest';
import type { MemberEgressView } from '@/shared/api/team/oauth-contribute';
import { deriveEgressPresentation } from './egress-presentation';

function view(input: Partial<MemberEgressView>): MemberEgressView {
  return {
    is_owner: false,
    scope: 'inherited',
    has_effective_egress: false,
    ...input,
  };
}

describe('deriveEgressPresentation', () => {
  it('distinguishes loading from a failed load', () => {
    expect(deriveEgressPresentation(undefined, true)).toBe('loading');
    expect(deriveEgressPresentation(undefined, false)).toBe('load_failed');
  });

  it('shows inherited only when the group default has an effective value', () => {
    expect(deriveEgressPresentation(view({ has_effective_egress: true }), false)).toBe('inherited');
    expect(deriveEgressPresentation(view({ has_effective_egress: false }), false)).toBe('not_configured');
  });

  it('keeps an account override distinct', () => {
    expect(deriveEgressPresentation(view({ scope: 'overridden', has_effective_egress: true }), false)).toBe('overridden');
  });
});
