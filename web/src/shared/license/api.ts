/**
 * The licensed-identity endpoint, as every SPA calls it.
 *
 * 🔴 It lives under `shared/license/` — a DIRECTORY that exists only in
 * user/web — because that is the shape the alias fence understands: master/web
 * and the trial composer each redirect `@/shared/license/*` here, and
 * `shared-alias-parity.test.ts` checks that both of them do. A single-FILE alias
 * would look to that fence like the whole of `shared/api/` had been redirected,
 * and it would start comparing files that were never meant to be dual-resolved.
 *
 * # Why the path is relative, in all four deployment quadrants
 *
 * `GET /v1/license/identity` is served by the LICENSED control plane, which is
 * not always the origin this bundle was loaded from — so the obvious design is a
 * discriminator that picks a base URL. It is not needed, and adding one would be
 * a fifth thing to keep in sync:
 *
 * | quadrant                      | who answers a relative /v1/license/identity   |
 * | ----------------------------- | --------------------------------------------- |
 * | Personal, logged out          | the local server — no such route → 404         |
 * | Personal, logged in (gateway) | forwarded to the team server (`/v1/` is a      |
 * |                               | team-owned prefix — gateway.go teamAPIPrefixes)|
 * | Production / Trial, direct    | this very origin                               |
 * | forwarded team page (gateway) | this origin, which the gateway forwards        |
 *
 * The 404 in the first row is not a failure to paper over — design D9 says a
 * Personal control plane mounts no licensing route at all, so its absence IS the
 * answer. 🔴 That is also why this file reads no `authMode`: the gateway
 * masquerades forwarded team pages as `local_bypass`, and a scope decision taken
 * from that signal is the exact mistake
 * `principles/gateway-local-bypass-masquerade.md` documents. Here there is no
 * scope decision left to get wrong.
 *
 * # Why bare axios rather than the shared httpClient
 *
 * 🔴 The endpoint is UNAUTHENTICATED by design — it is what an unauthenticated
 * sign-in page renders. It needs no bearer token and, more importantly, must not
 * inherit the shared client's 401 interceptor: this row is decoration, and a
 * decoration that can redirect the page to a session-expired screen is a
 * decoration that can throw somebody out of the form they were filling in.
 * `apiBaseUrl` still comes from the runtime config, so a deployment that serves
 * its API from another origin is still followed.
 */
import axios from 'axios';

import { runtimeConfig } from '@/app/config/runtime';

import {
  type LicenseIdentityDTO,
  type LicenseIdentityState,
  stateFromBody,
  stateFromFailure,
} from '@/shared/license/identity';

/**
 * Resolves which of the three licensed-identity states this deployment is in.
 *
 * 🚫 Never throws. This row sits on pages whose job is something else, and a
 * licence lookup must not be able to stop somebody signing in to fix the
 * licence. 旁路不能拖累主链路.
 */
export async function fetchLicenseIdentity(): Promise<LicenseIdentityState> {
  try {
    const { data } = await axios.get<LicenseIdentityDTO>(
      `${runtimeConfig.apiBaseUrl}/v1/license/identity`,
      // Short: nothing on the page waits for this, but a hung request would keep
      // the row in its "no answer yet" state indefinitely, which reads as if the
      // surface were missing.
      { timeout: 5_000 },
    );
    return stateFromBody(data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      return stateFromFailure(err.response?.status, err.message);
    }
    return stateFromFailure(undefined, err instanceof Error ? err.message : String(err));
  }
}
