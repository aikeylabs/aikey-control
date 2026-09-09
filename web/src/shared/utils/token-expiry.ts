/**
 * Provider access-token expiry — the presentation half shared by both consoles.
 *
 * # Why this exists (2026-09-02)
 *
 * A customer filled ONE Session Key, saw "登录成功", and shortly after both the
 * Control web and the client demanded re-login. Diagnosing it needed exactly one
 * number — how long the PROVIDER actually signed this token for — and that number
 * was **already on the wire and thrown away by both front ends**:
 *
 *   - Master:  `OAuthAccountDTO.token_expires_at` arrives, nothing renders it;
 *              `managedSessionKeyLogin()` even returns it at login and the drawer
 *              reads only `identity` from the result.
 *   - Member:  `MyPoolAccount.expires_at` arrives, the row renders only
 *              `last_login_at`.
 *
 * "7 天有效期" was an ASSUMPTION about ChatGPT, never a value we control — we store
 * whatever `exp` the provider's JWT carries. With no surface showing it, nobody
 * could tell a 7-day token from a 1-hour one, and the incident stayed unattributable.
 *
 * # Why the 24h threshold is not arbitrary
 *
 * 24h is the renewal pump's OWN preempt window (`tokenrefresh.preemptWindow`): a row
 * expiring inside it becomes a renewal candidate on the very next sweep. So "warn"
 * here means a real, checkable system state — *this token is about to be re-exchanged
 * upstream* — not a designer's guess at what feels urgent. Reading `warn` on a token
 * that was just issued is itself the diagnosis: the provider signed a short one.
 *
 * # Why it lives in shared/utils
 *
 * Both consoles must say the same thing about the same field. The trial composer
 * resolves `@/shared/*` to master/web, so the two copies must stay byte-identical —
 * enforced by `make -f workflow/CI/Makefile web-drift-check`.
 *
 * e2e: workflow/CI/test/e2e/cases/2026-09-01-登录成功后一会儿失效的自伤链路探索.md
 */

/** The pump's preempt window (tokenrefresh.preemptWindow = 24h), in seconds. */
export const TOKEN_RENEWAL_PREEMPT_WINDOW_SECONDS = 24 * 60 * 60;

export type TokenExpiryLevel =
  /** No expiry on the wire (never signed in, or an older server). */
  | 'unknown'
  /** Already past — the token cannot serve. */
  | 'expired'
  /** Inside the pump's preempt window: due to be re-exchanged upstream. */
  | 'due'
  /** Comfortably in the future. */
  | 'ok';

/** Largest unit that still reads as a comparable number; null when there is
 *  nothing to count (unknown / expired). */
export type TokenExpiryUnit = 'minutes' | 'hours' | 'days' | null;

export interface TokenExpiryView {
  level: TokenExpiryLevel;
  /** Whole seconds remaining; 0 for unknown/expired. */
  remainingSeconds: number;
  unit: TokenExpiryUnit;
  /** Count in `unit`; 0 when unit is null. */
  count: number;
}

/* ⚠️ This view deliberately carries NO i18n key. The cross-repository i18n fence
 * can only prove a key has a caller when the `t('…')` literal is statically
 * discoverable, so the rendering component must switch on `unit` and call t()
 * with literal keys — the same rule OAuthLoginStatusBadge's STATUS_LABEL follows. */

/**
 * Classify a provider token expiry.
 *
 * `expiresAtUnixSeconds` is the wire value verbatim (Unix SECONDS — both
 * `token_expires_at` and `expires_at` use seconds; the UI helpers take ms, hence
 * the ×1000 at the call sites). 0 / absent / non-finite ⇒ `unknown`, never a
 * fabricated date: an older server that omits the field must not render as
 * "expired", which would send an admin to re-login a perfectly healthy account.
 */
export function describeTokenExpiry(
  expiresAtUnixSeconds: number | undefined | null,
  nowMs: number = Date.now(),
): TokenExpiryView {
  const exp = Number(expiresAtUnixSeconds);
  if (!Number.isFinite(exp) || exp <= 0) {
    return { level: 'unknown', remainingSeconds: 0, unit: null, count: 0 };
  }
  const remaining = Math.floor(exp - nowMs / 1000);
  if (remaining <= 0) {
    return { level: 'expired', remainingSeconds: 0, unit: null, count: 0 };
  }
  const level: TokenExpiryLevel =
    remaining <= TOKEN_RENEWAL_PREEMPT_WINDOW_SECONDS ? 'due' : 'ok';

  // One unit, largest that still reads as a number the eye can compare — a token
  // is either "hours left" or "days left"; "6 天 3 小时" adds no decision value.
  const minutes = Math.floor(remaining / 60);
  if (minutes < 60) {
    return { level, remainingSeconds: remaining, unit: 'minutes', count: minutes };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { level, remainingSeconds: remaining, unit: 'hours', count: hours };
  }
  return { level, remainingSeconds: remaining, unit: 'days', count: Math.floor(hours / 24) };
}
