/**
 * apiErrorMessage — normalize the two error envelope shapes this codebase emits.
 *
 * WHY THIS EXISTS (2026-07-24)
 *
 * Backends here do not agree on the shape of `error`:
 *
 *   aikey-proxy admin handlers   {"error": "invalid request body"}
 *   local-server relay fallbacks {"error": {"code": "PROXY_UNAVAILABLE",
 *                                          "message": "aikey-proxy is not
 *                                                      reachable. Run
 *                                                      `aikey proxy start`."}}
 *
 * Callers declared the field as `{ error?: string }`, which is a COMPILE-TIME
 * assertion only — nothing validates the runtime payload. So the object form fell
 * through `data.error ?? fallback` unchanged and React rendered it as the literal
 * string "[object Object]".
 *
 * The user-visible cost was not cosmetic: the relay's fallback carries the most
 * actionable diagnostics we have (proxy down + the exact command to fix it), and
 * that was precisely the branch being swallowed. A user whose proxy had stopped
 * saw "[object Object]" instead of "run `aikey proxy start`".
 *
 * Rather than force one shape on both backends (the proxy's flat string is right
 * for its scope; the relay's coded envelope is right for cross-service errors),
 * the client accepts both. That keeps this defensive at the boundary where the
 * mismatch actually lands.
 */

/** The coded envelope shape used by the local-server relay fallbacks. */
interface CodedError {
  code?: unknown;
  message?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Extract a human-readable message from an unknown `error` payload.
 *
 * @param raw      the `error` field straight off a parsed JSON body
 * @param fallback shown when `raw` carries nothing usable (e.g. `HTTP 502`)
 *
 * Never returns "[object Object]": an object without a usable `message` degrades
 * to `code` and then to the caller's fallback, so the user always gets something
 * actionable instead of a stringified object.
 */
export function apiErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') {
    const s = raw.trim();
    return s === '' ? fallback : s;
  }
  if (isRecord(raw)) {
    const e = raw as CodedError;
    if (typeof e.message === 'string' && e.message.trim() !== '') {
      const msg = e.message.trim();
      // Keep the code when present — it is the stable identifier users quote in
      // bug reports, while the message is prose that may be localized later.
      if (typeof e.code === 'string' && e.code.trim() !== '') {
        return `${msg} (${e.code.trim()})`;
      }
      return msg;
    }
    if (typeof e.code === 'string' && e.code.trim() !== '') {
      return e.code.trim();
    }
  }
  return fallback;
}

/**
 * PROXY_UNAVAILABLE is the relay's code when it cannot reach aikey-proxy at all.
 * Callers that front proxy-backed features use this to render a dedicated
 * "service is not running" state instead of a generic failure — the difference
 * between "your input is wrong" and "nothing is listening" matters for what the
 * user should do next.
 */
export const ERR_PROXY_UNAVAILABLE = 'PROXY_UNAVAILABLE';

/** True when a parsed `error` payload carries the PROXY_UNAVAILABLE code. */
export function isProxyUnavailable(raw: unknown): boolean {
  return isRecord(raw) && (raw as CodedError).code === ERR_PROXY_UNAVAILABLE;
}
