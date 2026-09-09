export type PoolAccountTone = 'danger' | 'warning' | 'muted';

export function poolAccountTone(status?: string): PoolAccountTone {
  if (status === 'window_exhausted' || status === 'auth_failed') return 'danger';
  if (status === 'window_protected' || status === 'rate_limited' || status === 'upstream_unavailable') return 'warning';
  return 'muted';
}

export function quotaPercent(value?: number): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function retryTimeState(retryAt?: number, nowMs = Date.now()): 'none' | 'future' | 'elapsed' {
  if (!retryAt || !Number.isFinite(retryAt)) return 'none';
  return retryAt * 1000 > nowMs ? 'future' : 'elapsed';
}

export function showRetryTime(routeStatus: string | undefined, retryState: 'none' | 'future' | 'elapsed'): boolean {
  return Boolean(routeStatus) && retryState !== 'none';
}

/** knownEpoch returns a usable unix-seconds epoch, or undefined.
 *
 * Absent / zero / non-finite are all the SAME thing here — "not observed" —
 * and must stay undefined rather than becoming a timestamp: window resets are
 * only learned when a request to the account came back carrying the upstream
 * reset header, so a freshly attached, never-routed, or aggregate-header-only
 * account legitimately has none. Rendering 0 would print 1970 and read as a
 * window that already reset.
 */
export function knownEpoch(value?: number): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/** ridesSharedFallback: this member is being served by the ADMIN's shared
 * credential, not by a token of his own.
 *
 * Why this is a named function and not an inline condition: "is he on the
 * fallback" gets re-derived at every place that wants to warn about it, and a
 * hand-rolled copy that forgets one of the three inputs silently warns nobody.
 * One exit, one place to fence.
 *
 * Only `logged_in` qualifies: a `needs_login` / `auth_failed` account already
 * tells the member to act, and stacking a second warning on it just adds noise.
 * An absent token_source (older server) is NOT treated as fallback — guessing
 * would nag members who are perfectly fine.
 *
 * spec: R-oauth-token-mint-6 三层失效独立可见（呈现腿）
 */
export function ridesSharedFallback(account: {
  credential_type?: string;
  login_status?: string;
  token_source?: string;
}): boolean {
  return (
    account.credential_type === 'oauth_account' &&
    account.login_status === 'logged_in' &&
    account.token_source === 'fallback'
  );
}

/** showsSessionRenewalLabel decides whether an auth_failed pool row renders the
 * SPECIFIC "Session Key exchange failed" label instead of the generic
 * "sign in again".
 *
 * Why a named predicate and not an inline condition: this is the one place the
 * page departs from the generic re-login label, and the decision has two hard
 * boundaries a hand-rolled `&&` keeps re-deriving wrong —
 *   - it fires ONLY for the server-named `session_renewal_rejected` cause; every
 *     other cause (refresh / usage-401 / give-up) and every older server that
 *     sends no reason fall back to generic — we never guess a cause; and
 *   - it is gated on `auth_failed`, so a `logged_in`/`revoked` row still
 *     carrying a stale verdict in `status_reason` cannot trip the specific label.
 *
 * spec: R-oauth-token-mint-6.S5 成员看得出 auth_failed 的原因
 */
export function showsSessionRenewalLabel(status?: string, statusReason?: string): boolean {
  return status === 'auth_failed' && statusReason === 'session_renewal_rejected';
}
