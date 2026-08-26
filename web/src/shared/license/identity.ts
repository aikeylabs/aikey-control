/**
 * The licensed-identity row, and the only place any SPA composes it.
 *
 * # Why this module exists, and why it lives in user/web
 *
 * `specs/license-identity` (ID-02) requires the licensed company name to render
 * **byte-identically** on the web sign-in page, the web settings page,
 * `aikey status` and `aikey doctor`. Three SPAs render that row — the Personal
 * SPA (this repo), the Production SPA (aikey-control-master/web) and the Trial
 * composer — and all three resolve `@/shared/*`. A shared module that lives in
 * only one repo has to be aliased in every vite config that can bundle it; the
 * precedent is `shared/compliance/*` and `shared/usage/*`, and the comment in
 * trial-server/web/vite.config.ts spells out why: a second copy is a dual-edit
 * trap where one repo is always a commit behind.
 *
 * 🚫 So there must not be a master-side copy of this file. If a build fails to
 * resolve `@/shared/license-identity`, the fix is the missing alias, never a
 * local duplicate.
 *
 * # The three states, and why they may never collapse into two
 *
 * 需求变更 2026-08-18: every surface renders this row **always**, and an
 * unlicensed Personal install says so. (The previous rule — design D9,
 * "Personal shows nothing" — is superseded; see the update document.) That
 * splits "no company name" into two situations that must stay distinguishable:
 *
 * * **unlicensed** — this deployment has no licence and is not supposed to have
 *   one. A legitimate resting state.
 * * **error** — a deployment that *does* carry licensing, whose identity could
 *   not be established: unreachable, or licensed-capable but never activated.
 *
 * 🔴 Collapsing error into unlicensed renders a Production server that was never
 * activated as a Personal install. The operator is then told there is no licence
 * to install — which stops them doing the one thing that fixes it.
 *
 * # Why the strings are duplicated from Go rather than imported
 *
 * The surfaces span Go, TypeScript and Rust. No shared implementation spans
 * them, so `aikey-license-core/identity` is the authority and every other
 * language copies the literals; `aikey-license-core/crossrepo` is the fence that
 * fails when a copy drifts. 🚫 Do not "tidy" these constants.
 */

/** Prefixes the row in every state. Mirrors `identity.LicensedToLabel`. */
export const LICENSED_TO_LABEL = 'Licensed to: ';

/** Mirrors `identity.UnlicensedLine`. */
export const UNLICENSED_LINE = 'Licensed to: Personal edition (not commercially licensed)';

/**
 * Mirrors `identity.ErrorLine`.
 *
 * 🚫 Names no cause on purpose: the same row appears on a sign-in card with no
 * room for a diagnosis, and the causes need different next actions. The cause is
 * carried alongside — as a `title` here, as a warning line in the CLI.
 */
export const ERROR_LINE = 'Licensed to: unavailable';

/** Which of the three answers a surface is giving. */
export type LicenseIdentityState =
  | { kind: 'licensed'; companyName: string }
  | { kind: 'unlicensed' }
  | { kind: 'error'; cause: string };

/**
 * The one renderer, in every state. Mirrors `identity.LineFor`.
 *
 * 🚫 The blank-name guard maps to {@link ERROR_LINE}, never
 * {@link UNLICENSED_LINE}: a licensing-capable deployment that answered with an
 * empty name has not been activated, and rendering it as "Personal edition"
 * hides that behind a legitimate-looking state.
 *
 * 🚫 The name is emitted verbatim — no trim, no case fold, no truncation. Those
 * are all reasonable-looking UI decisions and every one of them makes two
 * surfaces disagree while both believe they are right.
 */
export function lineFor(state: LicenseIdentityState): string {
  switch (state.kind) {
    case 'licensed':
      return state.companyName.trim() === ''
        ? ERROR_LINE
        : `${LICENSED_TO_LABEL}${state.companyName}`;
    case 'unlicensed':
      return UNLICENSED_LINE;
    default:
      return ERROR_LINE;
  }
}

/**
 * The cause a surface may show next to {@link ERROR_LINE}, or null.
 *
 * 🔴 Split out so "does this state have something to explain?" has an answer a
 * test can read, rather than being buried in JSX.
 */
export function causeFor(state: LicenseIdentityState): string | null {
  return state.kind === 'error' ? state.cause : null;
}

/** The one-field shape `GET /v1/license/identity` returns. */
export interface LicenseIdentityDTO {
  schema_version: number;
  company_name: string;
}

/**
 * Maps a successful response body onto a state.
 *
 * Separated from the HTTP call so the mapping — the part that can silently get
 * the "unactivated is not Personal" rule wrong — is testable without a network.
 */
export function stateFromBody(body: LicenseIdentityDTO | null | undefined): LicenseIdentityState {
  const name = body?.company_name ?? '';
  if (name.trim() !== '') return { kind: 'licensed', companyName: name };
  // 200 with no name: the deployment mounts licensing but holds no activated
  // licence. 🚫 Not 'unlicensed' — see the module comment.
  return {
    kind: 'error',
    cause:
      'This deployment is licensed but has no activated licence yet. ' +
      'Import or activate one on the licence page.',
  };
}

/**
 * Maps a failed request onto a state.
 *
 * 🔴 404 is design D9 speaking, not a fault: a Personal-mode control plane
 * mounts no licensing route at all, so the route's absence IS the answer "this
 * deployment is not commercially licensed". Every other failure is an error —
 * an unreachable control plane must not read as "no licence here".
 */
export function stateFromFailure(status: number | undefined, detail: string): LicenseIdentityState {
  if (status === 404) return { kind: 'unlicensed' };
  if (status === undefined) {
    return {
      kind: 'error',
      cause: `The control plane could not be reached (${detail}). Check that it is running.`,
    };
  }
  return {
    kind: 'error',
    cause: `The control plane answered ${status} for the licence identity (${detail}).`,
  };
}
