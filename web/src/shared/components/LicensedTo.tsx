/**
 * LicensedTo — the licensed-identity row, rendered verbatim
 * (specs/license-identity, commercial-licensing-v2 tasks.md G2).
 *
 * specs/license-identity names four surfaces that must show a BYTE-IDENTICAL
 * string: the web sign-in page, the web settings page, `aikey status` and
 * `aikey doctor`. Any two of them differing is a defect, not a display
 * preference.
 *
 * 🔴 So this component does exactly one thing with the value it receives: it
 * puts it in the DOM. It does not truncate it, title-case it, localise it,
 * abbreviate it or fall back to a brand name. Those are all reasonable-looking
 * UI decisions — a designer asking for the long Chinese legal name to be clipped
 * on a narrow sign-in card is the realistic way this dies — and every one of
 * them breaks the requirement. `licensed-to.test.ts` fails on each shape.
 *
 * 🚫 Nothing else about the licence appears here. The sign-in page is
 * unauthenticated, so what this renders is visible to anyone who can reach the
 * deployment; the endpoint behind it returns one field for that reason
 * (design D12: term, maintenance date, ceilings and enforcement mode never
 * reach a member surface).
 *
 * 🔴 This file is BYTE-EQUAL in aikey-control/web and aikey-control-master/web,
 * enforced by hook-components.dual-edit.test.ts. `@/shared/components/*` is not
 * vite-aliased, so a user page importing it gets the MASTER copy in the trial
 * and production builds — two copies that drift means two surfaces that
 * disagree. Both of its imports are aliased to user/web in the master and trial
 * configs, which is what lets one file serve both repos. 🚫 Edit both copies, or
 * neither.
 *
 * # 需求变更 2026-08-18 — three states, and why this no longer renders nothing
 *
 * This component used to render nothing whenever `company_name` was absent. That
 * single branch covered three different situations and distinguished none of
 * them:
 *
 *   * licensing does not apply here (design D9's Personal case),
 *   * this deployment IS licensed but was never activated,
 *   * the control plane could not be reached.
 *
 * All three showed an empty space, so a Production server nobody ever activated
 * looked exactly like a deployment with nothing to activate — and the operator
 * was never told the one thing that would have fixed it. The wording for each
 * state now comes from `@/shared/license/identity`, which mirrors
 * `aikey-license-core/identity`.
 *
 * 🚫 This component must not compose any of those sentences itself. A row worded
 * here would differ from the row `aikey status` prints, which is ID-02's failure
 * with extra steps.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchLicenseIdentity } from '@/shared/license/api';
import { causeFor, lineFor, type LicenseIdentityState } from '@/shared/license/identity';

export interface LicensedToProps {
  className?: string;
}

export function LicensedTo({ className }: LicensedToProps) {
  const { data } = useQuery<LicenseIdentityState>({
    queryKey: ['license', 'identity'],
    queryFn: fetchLicenseIdentity,
    // The company name changes only when a licence is imported, so this is not
    // on any hot path. `staleTime` keeps a sign-in page from re-fetching on
    // every keystroke-induced re-render.
    staleTime: 5 * 60_000,
    // 🚫 No retry: fetchLicenseIdentity resolves a failure INTO a state rather
    // than throwing, so a retry would only repeat a question already answered.
    retry: false,
  });

  // Before the first answer arrives there is nothing truthful to say. 🚫 Not the
  // unlicensed row — that is a claim, and no claim has been established yet.
  if (!data) return null;

  const cause = causeFor(data);

  return (
    <span
      className={className}
      data-testid="licensed-to"
      data-license-state={data.kind}
      // The diagnosis, where a diagnosis exists. It is a title rather than
      // inline text because the row itself must stay byte-identical with the
      // other three surfaces.
      title={cause ?? undefined}
    >
      {lineFor(data)}
    </span>
  );
}
