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

/**
 * The short, stable discriminator for an SSO member — e.g. `feishu:6ad2973d`.
 *
 * 🔴 Why a name alone is not an identity: `org_seats.alias` is the Feishu
 * display name, and display names collide. Two 李承熙 in one organization render
 * identically in the seat list, the group pickers and the account card, and an
 * administrator assigning a seat or revoking access cannot tell which person
 * they are acting on. That is a correctness problem, not a cosmetic one.
 *
 * The fragment comes from the account's synthetic handle, which is a digest of
 * (provider, subject) — so it is derived from the Feishu union_id, identical on
 * every login, and different for every member.
 *
 * 🚫 Deliberately NOT the raw union_id: that is a stable cross-application
 * identifier for a real person, and the whole point of hashing it into the
 * handle was to keep it out of the columns and screens an operator reads. Eight
 * hex characters disambiguate ~4 billion members — far more than any one
 * organization — without putting a personal identifier on screen.
 *
 * Returns '' for anything that is not one of our synthetic handles.
 */
export function memberDiscriminator(email: string | null | undefined): string {
  if (!isSyntheticIdentityEmail(email)) return '';
  const local = (email ?? '').trim().toLowerCase().split('@')[0]; // sso+<provider>.<digest>
  const [prefix, digest] = local.split('.');
  const provider = prefix?.replace(/^sso\+/, '') ?? '';
  if (!provider || !digest) return '';
  return `${provider}:${digest.slice(0, 8)}`;
}

/**
 * A one-line identity for slots that must be UNAMBIGUOUS — the account card,
 * seat lists, member pickers. Name plus discriminator for an SSO member, the
 * plain address for everyone else.
 *
 * Distinct from memberDisplayLabel on purpose: a greeting wants "Hi, 李承熙",
 * whereas "which 李承熙 am I revoking?" wants the discriminator too.
 */
export function memberIdentityLine(
  email: string | null | undefined,
  alias: string | null | undefined,
  fallback: string,
): string {
  const label = memberDisplayLabel(email, alias, '');
  const discriminator = memberDiscriminator(email);
  if (label && discriminator) return `${label} · ${discriminator}`;
  if (label) return label;
  return discriminator || fallback;
}
