// oauth-contribute.ts — team-scoped reads for the local contribute page (C11/RW9):
//   - list the member's logged-into-account history (fetchMyPoolAccounts)
//   - pull the routed account's admin-stored login credential (email + password)
//
// Both go to the remote master's /accounts/me/* surface via the shared two-hop
// team-fetch helper. The pool LOGIN flow itself goes through the local proxy relay
// (/api/user/oauth/pool/*, same-origin) — not here; this file is only the
// master-side reads the page renders.
import {
  teamGetJSON,
  teamPostJSON,
  type TeamFetchError,
  type TeamWriteError,
} from './team-fetch';

/** One group the employee has joined — the add-account dropdown source (R24).
 * Default group first (server-ordered). */
export interface MyOauthGroup {
  oauth_group_id: string;
  alias: string;
  is_default: boolean;
}

/** fetchMyGroups lists the groups the member has joined (add-account dropdown). */
export async function fetchMyGroups(): Promise<MyOauthGroup[] | TeamFetchError> {
  const res = await teamGetJSON<MyOauthGroup[]>('/accounts/me/oauth-groups');
  if (Array.isArray(res)) return res;
  if ('kind' in res) return res;
  return [];
}

/** addOauthAccount self-contributes an account (email+password) into a group the
 * caller belongs to (R24). NO OAuth here — the account is logged into later, on
 * demand, when the engine routes a member to it. Returns the created metadata OR a
 * TeamFetchError / TeamWriteError (the latter carries the server's precise reason:
 * disabled / not-a-member / missing field). */
export async function addOauthAccount(input: {
  provider_id: string;
  login_email: string;
  password: string;
  oauth_group_id: string;
}): Promise<{ credential_id: string } | TeamFetchError | TeamWriteError> {
  return teamPostJSON<{ credential_id: string }>('/accounts/me/oauth-accounts', input);
}

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
  /** the pool group this account belongs to (id + human-facing name). Display-only;
   * omitted for ungrouped accounts / older servers. Same source as the vault page's
   * group_alias. */
  oauth_group_id?: string;
  group_alias?: string;
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
