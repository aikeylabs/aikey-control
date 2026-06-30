// oauth-contribute.ts — team-scoped reads for the local contribute page (C11/RW9):
//   - list the member's logged-into-account history (fetchMyPoolAccounts)
//   - pull the routed account's admin-stored login credential (email + password)
//
// Both go to the remote master's /accounts/me/* surface via the shared two-hop
// team-fetch helper. The pool LOGIN flow itself goes through the local proxy relay
// (/api/user/oauth/pool/*, same-origin) — not here; this file is only the
// master-side reads the page renders.
import { teamGetJSON, type TeamFetchError } from './team-fetch';

/** The routed account's admin-stored login credential (RW7 pull). */
export interface RoutedCredential {
  /** The account the server resolved as the caller's current route (echoed for
   * the page to label/log which account it's showing). */
  credential_id: string;
  login_email: string;
  /** Decrypted password — shown only behind an explicit eye-reveal (D7). */
  password: string;
}

/** One row of the member's logged-into-account HISTORY (contribute page list).
 * No password/token — the password is revealed only for the routed account via
 * fetchRoutedCredential. */
export interface MyPoolAccount {
  credential_id: string;
  /** admin-stored login email (display). */
  identity: string;
  /** logged_in | needs_login | auth_failed | revoked */
  status: string;
  last_login_at: number;
  expires_at: number;
  /** the account the allocation engine currently routes the member to — the page
   * highlights it; only it gets reveal-password + log-in. */
  is_routed: boolean;
}

/**
 * fetchMyPoolAccounts lists the accounts the member has logged into (their pool
 * history, retained even after routing moves on), with the currently-routed one
 * flagged. The contribute page renders this list (with search/filter) and only
 * lets the routed account reveal its password / re-log-in.
 */
export async function fetchMyPoolAccounts(): Promise<MyPoolAccount[] | TeamFetchError> {
  const res = await teamGetJSON<MyPoolAccount[]>('/accounts/me/oauth-member-tokens');
  if (Array.isArray(res)) return res;
  if ('kind' in res) return res;
  return [];
}

/**
 * fetchRoutedCredential pulls the login email + password for the member's routed
 * account (RW7, minimal exposure — only one account ever).
 *
 * - Omit credentialID (the contribute-page default): the SERVER resolves the
 *   caller's currently-routed account via the allocation engine and returns its
 *   {credential_id, login_email, password}. The page shows only that one account.
 * - Pass credentialID (the LOGIN_REQUIRED flow, where the proxy named a specific
 *   account): pull that one.
 *
 * A 404 maps to an 'unreachable' error the page reads as "no account to show
 * right now" (not routed to a pool account, or admin hasn't set a password yet).
 */
export async function fetchRoutedCredential(
  credentialID?: string,
): Promise<RoutedCredential | TeamFetchError> {
  const q = credentialID ? `?credential_id=${encodeURIComponent(credentialID)}` : '';
  return teamGetJSON<RoutedCredential>(`/accounts/me/group-routed-credential${q}`);
}
