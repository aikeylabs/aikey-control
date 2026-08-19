/**
 * Which pool accounts may be signed in with a Session Key, and which product's
 * Session Key that is.
 *
 * # Why this file exists at all (2026-08-18)
 *
 * `aikey-control-master` has imported `aikey-control-web/shared/session-key-capability.ts`
 * since commit 76195ac (2026-08-15, "Codex sessionKey account-pool login"), which
 * is merged into `origin/develop-v1.0.5`. The file it imports was never landed in
 * this repository — not on any local branch, not on any remote, and nothing
 * generates it. The consequence was not subtle: `npm run build` in
 * aikey-control-master/web has failed outright since that date, so the Production
 * SPA — and therefore every sealed cluster package that bundles it — could not be
 * built. It surfaced when a package was needed and one could not be produced.
 *
 * # 🔴 The proxy is the authority, and this file follows it
 *
 * `aikey-proxy/internal/supervisor/group_session_key_handler.go`
 * (`poolSessionKeyProviderSupported`) is what actually decides whether a Session
 * Key sign-in is accepted:
 *
 *     protocol must equal "anthropic"      — anything else is refused
 *     provider "anthropic"                 — accepted
 *     provider "mock"                      — accepted when it carries a resident token URL
 *     anything else                        — refused
 *
 * This module reproduces that rule and nothing more. It is a console affordance:
 * its only job is to avoid offering a button whose action the proxy will refuse.
 * 单一真相源 — when the proxy's rule changes, this follows it, never the reverse.
 *
 * # 🚫 The open disagreement this deliberately does NOT paper over
 *
 * `aikey-control-master/web/src/pages/master/orgs/oauth-groups/session-key-capability.test.ts`
 * asserts two things this module returns the opposite of:
 *
 *     supportsSessionKeyLogin('openai', 'openai_compatible') === true
 *     sessionKeyProviderKind('openai', 'openai_compatible')  === 'codex'
 *
 * The proxy refuses both — and its own test
 * (`group_login_handler_test.go`, "mock codex") asserts
 * `mock` + `openai_compatible` is **not** supported. So the two sides of the
 * shipped product contradict each other, and "Codex Session Key" is half-landed:
 * a console shim, a test and a consumer, with no implementation and no proxy
 * support behind them. The i18n block backing this feature
 * (`oauthGroups.sessionKeyLogin`) is Claude-only too — there is no Codex copy.
 *
 * 🔴 Those two assertions are therefore left RED on purpose. Making them pass
 * would put a Codex sign-in button in front of customers that the proxy answers
 * with `SESSION_KEY_PROVIDER_UNSUPPORTED` — a button that only ever produces an
 * error. Whoever owns that feature has to land the proxy half or drop the claim;
 * a red test is how that decision stays visible instead of being absorbed here.
 */

/**
 * Which product's Session Key a supported account takes.
 *
 * 🚫 `'codex'` is in the vocabulary and is never returned today. The consumer
 * (`EditGroupDrawer`) already types against it and the feature intends it, so
 * removing it would be a second, larger change to somebody else's in-flight
 * work. Keeping it in the type while the rule refuses it costs nothing and keeps
 * the intent legible.
 */
export type SessionKeyProviderKind = 'claude' | 'codex';

/** The one protocol the proxy accepts a Session Key exchange on. */
const SESSION_KEY_PROTOCOL = 'anthropic';

/** Matches the proxy's `strings.ToLower(strings.TrimSpace(...))` normalisation. */
function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Whether a Session Key sign-in may be offered for this provider/protocol pair.
 *
 * 🔴 An EMPTY protocol means "the operator has not chosen one yet", not "some
 * other protocol". The proxy never sees this case — it works from a resolved
 * login context where the protocol is always set — so treating empty as a
 * refusal would hide the control before the form is even filled in. Empty falls
 * through to the provider check; a non-empty protocol that is not `anthropic` is
 * refused exactly as the proxy refuses it.
 *
 * 🚫 The `mock` arm is deliberately more permissive than the proxy's, which also
 * requires a resident OAuth token URL. That URL is a property of the resolved
 * credential and is not available at this call site. Being more permissive here
 * is the safe direction: the console offers the control and the proxy makes the
 * real decision. The reverse — the console deciding a supported account is not
 * supported — would be unappealable from the UI.
 */
export function supportsSessionKeyLogin(providerCode: string, protocolType: string): boolean {
  const protocol = norm(protocolType);
  if (protocol !== '' && protocol !== SESSION_KEY_PROTOCOL) return false;

  switch (norm(providerCode)) {
    case 'anthropic':
      return true;
    case 'mock':
      return true;
    default:
      return false;
  }
}

/**
 * Which Session Key a supported account takes, or `null` when none may be used.
 *
 * 🔴 Derived from `supportsSessionKeyLogin` rather than re-deciding — "does this
 * account support it" and "which kind is it" must never be able to disagree, and
 * two independent switch statements over provider codes is precisely how they
 * would. The master test's phrasing says the same thing: "distinguishes Claude
 * and Codex copy **without duplicating provider rules**".
 *
 * `mock` maps to `'claude'` because the proxy routes it through the Anthropic
 * exchange path; it is a stand-in for that provider, not a product of its own.
 */
export function sessionKeyProviderKind(
  providerCode: string,
  protocolType: string,
): SessionKeyProviderKind | null {
  if (!supportsSessionKeyLogin(providerCode, protocolType)) return null;
  return 'claude';
}
