/**
 * member-identity — what to call the person looking at the console.
 *
 * A member who signed in through an identity provider has no address of their
 * own in `global_accounts.email`. Feishu's email is optional, scope-gated and
 * usually absent, so the account column carries a SYNTHETIC HANDLE derived from
 * the provider subject (`sso+<provider>.<digest>@sso.local`). It exists to
 * satisfy NOT NULL UNIQUE and to key the member's seat — it is not an address,
 * nobody can send mail to it, and the member has never seen it.
 *
 * 🚫 So it must never be rendered. Showing it turns "signed in as 王楠" into
 * "signed in as sso+feishu.9f3c…@sso.local", which reads as a bug to the member
 * and leaks an internal key shape to anyone looking over their shoulder.
 *
 * The name to show instead is `org_seats.alias` — the single source of truth for
 * a person's name on the web (requirements 2026-07-10-member-sso-login R19),
 * filled from the provider's display name on every login.
 *
 * Mirrored in master/web (dual-edit; see workflow/CI Makefile DRIFT_CHECK_PATHS).
 */

/** The reserved, non-deliverable domain every synthetic handle lives under. */
const SYNTHETIC_IDENTITY_DOMAIN = '@sso.local';

/**
 * The local-bypass sentinels a box returns when nobody is authenticated to it.
 *
 * 🔴 These are not people. The console has more than one source of "me" — the
 * team session (same-origin, authenticated) and a deliberate cross-fetch of the
 * LOCAL machine used to scope vault/usage data — and the second one answers with
 * these. Rendering one as the signed-in member is how a Feishu member came to
 * see `local@aikey.local`, and before that a colleague's address, on their own
 * console (found on Production, 2026-07-21).
 *
 * Listing them here means the guarantee holds at the DISPLAY boundary: whatever
 * source a future edit plugs in, a sentinel can never come out the other side
 * looking like a person.
 */
const IDENTITY_SENTINELS = new Set(['local@aikey.local', 'local@localhost', 'personal-local', 'local-owner']);

/**
 * True when the address is one of our own internal placeholders rather than
 * something the member could receive mail at.
 *
 * Digital employees use their own placeholder domain and are covered by the
 * seat-identity rules; this predicate is about the SSO login handle.
 */
export function isSyntheticIdentityEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(SYNTHETIC_IDENTITY_DOMAIN);
}

/**
 * The label to show for the signed-in member.
 *
 * Order: the seat alias (the provider's display name) → a real address → a
 * neutral fallback. 🚫 A synthetic handle is never returned, at any position:
 * "no name yet" is better than a string the member cannot act on.
 */
export function memberDisplayLabel(
  email: string | null | undefined,
  alias: string | null | undefined,
  fallback: string,
): string {
  const name = alias?.trim();
  if (name) return name;
  const address = email?.trim();
  if (address && !isSyntheticIdentityEmail(address) && !IDENTITY_SENTINELS.has(address.toLowerCase())) {
    return address;
  }
  return fallback;
}
