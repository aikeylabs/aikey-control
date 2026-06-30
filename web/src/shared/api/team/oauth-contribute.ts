// oauth-contribute.ts — team-scoped reads for the local contribute page (C11/RW9):
//   - list the org's OAuth accounts (admin-added + employee-contributed)
//   - pull the routed account's admin-stored login credential (email + password)
//
// Both go to the remote master's /accounts/me/* surface via the shared two-hop
// team-fetch helper. The pool LOGIN flow itself goes through the local proxy relay
// (/api/user/oauth/pool/*, same-origin) — not here; this file is only the
// master-side reads the page renders.
import { teamGetJSON, type TeamFetchError } from './team-fetch';

/** One OAuth account as the master's /accounts/me/oauth-accounts returns it. */
export interface TeamOAuthAccount {
  credential_id: string;
  provider_id?: string;
  external_id?: string;
  display_identity?: string;
  token_expires_at?: number;
  /** true when an admin has attached it to a seat group. */
  assigned?: boolean;
}

/** The routed account's admin-stored login credential (RW7 pull). */
export interface RoutedCredential {
  login_email: string;
  /** Decrypted password — shown only behind an explicit eye-reveal (D7). */
  password: string;
}

/** fetchTeamOAuthAccounts lists the caller's visible OAuth accounts on master. */
export async function fetchTeamOAuthAccounts(): Promise<TeamOAuthAccount[] | TeamFetchError> {
  const res = await teamGetJSON<TeamOAuthAccount[]>('/accounts/me/oauth-accounts');
  if (Array.isArray(res)) return res;
  if ('kind' in res) return res;
  // Defensive: a non-array, non-error body → treat as empty list.
  return [];
}

/**
 * fetchRoutedCredential pulls the login email + password for ONE account
 * (RW7, minimal exposure). credentialID is the account the proxy told the member
 * to log into. Returns ErrNotProvisioned-shaped 404 as an 'unreachable' error
 * (the page maps it to "admin hasn't set a password yet").
 */
export async function fetchRoutedCredential(
  credentialID: string,
): Promise<RoutedCredential | TeamFetchError> {
  return teamGetJSON<RoutedCredential>(
    `/accounts/me/group-routed-credential?credential_id=${encodeURIComponent(credentialID)}`,
  );
}
