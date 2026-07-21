import type { MemberEgressView } from '@/shared/api/team/oauth-contribute';

export type EgressPresentation =
  | 'loading'
  | 'load_failed'
  | 'overridden'
  | 'inherited'
  | 'not_configured';

/** Keep configuration source and effective availability separate. An inherited
 * scope does not necessarily mean the group has an egress value configured. */
export function deriveEgressPresentation(
  view: MemberEgressView | undefined,
  isPending: boolean,
): EgressPresentation {
  if (!view) return isPending ? 'loading' : 'load_failed';
  if (view.scope === 'overridden') return 'overridden';
  return view.has_effective_egress ? 'inherited' : 'not_configured';
}
