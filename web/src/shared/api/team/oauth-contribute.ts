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
  teamPutJSON,
  type TeamFetchError,
  type TeamWriteError,
} from './team-fetch';

/** One group the employee has joined — the add-account dropdown source (R24).
 * Default group first (server-ordered). */
export interface MyOauthGroup {
  oauth_group_id: string;
  alias: string;
  is_default: boolean;
  /** R34 (2026-07-04): the pool's declared provider. The add-account modal filters
   * the group dropdown to the picked provider (前置防呆). "" for older servers →
   * the frontend shows all groups (the AttachAccount gate still enforces). */
  provider_code?: string;
  /** 2026-07-18 agent-pool owner access (additive): true for the caller's OWN
   * agent pools (listed by ownership — the parent seat is not a member row).
   * Owner pools also carry their full account composition so the page can render
   * "pre-login every account" (an unattended agent may be routed to any of them). */
  is_owner?: boolean;
  accounts?: OwnerPoolAccount[];
}

/** One account of the caller's OWN agent pool (owner view; no secrets). */
export interface OwnerPoolAccount {
  credential_id: string;
  identity: string;
  provider_code: string;
  enabled: boolean;
  /** logged_in | needs_login | auth_failed | revoked */
  login_status: string;
  /** whether this account exits through a configured egress line (own override
   * OR inherited group default, R46). Presence only — the raw URL never reaches
   * the member plane. Omitted by older servers → no chip. */
  has_egress?: boolean;
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
  /** provider code (anthropic | openai | …) — picks the sign-in flow (R34 codex
   * pools): claude = paste-code, codex = local-callback polling. Omitted by older
   * servers → the page falls back to the claude flow. */
  provider_code?: string;
  /** whether this account exits through a configured egress line (own override
   * OR inherited group default, R46). Presence only — the raw URL never reaches
   * the member plane. Omitted by older servers → no chip. */
  has_egress?: boolean;
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

/** Member per-account egress view (2026-07-19). Both pool types receive the
 * resolved effective config for the confirmed view/copy flow. egress_proxy_url
 * remains the account-own editor prefill and is returned only for owner pools. */
export interface MemberEgressView {
  is_owner: boolean;
  scope: 'inherited' | 'overridden';
  egress_proxy_url?: string; // owner pool only
  effective_egress_url?: string; // resolved own override ?? group default; both pool types
  has_effective_egress: boolean;
  last_exit_ip?: string;
}

export interface MemberEgressTestResult {
  ok: boolean;
  exit_ip?: string;
  latency_ms?: number;
  engine?: string;
  error?: string;
}

/** fetchAccountEgress reads one pool account's egress status + exit-IP baseline
 * (GET /accounts/me/oauth-accounts/{id}/egress). */
export function fetchAccountEgress(credentialID: string): Promise<MemberEgressView | TeamFetchError> {
  return teamGetJSON<MemberEgressView>(`/accounts/me/oauth-accounts/${encodeURIComponent(credentialID)}/egress`);
}

/** setAccountEgress sets (or clears with "") the account-level egress OVERRIDE —
 * never the group default (R46). Reaches the master's member-authz endpoint. */
export function setAccountEgress(credentialID: string, egressProxyURL: string) {
  return teamPutJSON<{ credential_id: string; scope: string; last_exit_ip?: string }>(
    `/accounts/me/oauth-accounts/${encodeURIComponent(credentialID)}/egress`,
    { egress_proxy_url: egressProxyURL },
    20_000,
  );
}

/** Test the exact unsaved modal draft through the control plane's production
 * egress engine. The save endpoint independently repeats this probe. */
export function testAccountEgress(credentialID: string, egressProxyURL: string) {
  return teamPostJSON<MemberEgressTestResult>(
    `/accounts/me/oauth-accounts/${encodeURIComponent(credentialID)}/egress/test`,
    { egress_proxy_url: egressProxyURL },
    20_000,
  );
}

/** saveAccountExitIP overwrites the exit-IP baseline for the login-IP self-check
 * (req 5: member first test after changing egress). */
export function saveAccountExitIP(credentialID: string, exitIP: string) {
  return teamPutJSON<{ credential_id: string; last_exit_ip: string }>(
    `/accounts/me/oauth-accounts/${encodeURIComponent(credentialID)}/exit-ip`,
    { exit_ip: exitIP },
  );
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
