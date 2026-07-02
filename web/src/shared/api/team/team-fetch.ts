// team-fetch.ts — shared "local web (8090) → remote team master" fetch helper.
//
// The local web is served same-origin by the local-server; the team master is
// remote. The proven pattern (see managed-keys.ts) is a two-hop:
//   1. same-origin GET /system/team-url + /system/team-jwt  (local-server reads
//      them from the CLI vault; the JWT endpoint omits CORS so only same-origin
//      can read it)
//   2. cross-origin GET {teamUrl}{path} with Authorization: Bearer {jwt}
//
// This module factors that pattern into a generic teamGetJSON so new team-scoped
// reads (oauth-contribute's account list + routed-credential pull) don't
// re-implement it.
//
// NOTE: managed-keys.ts predates this module and keeps its own private copies of
// readTeamURL/readTeamJWT — consolidating it onto this helper is a follow-up
// cleanup (kept separate now to avoid refactoring its tested path).

const TEAM_URL_ENDPOINT = '/system/team-url';
const TEAM_JWT_ENDPOINT = '/system/team-jwt';
const FETCH_TIMEOUT_MS = 8000;

/** Typed failure states so callers render precise UX (not a generic error). */
export type TeamFetchError =
  | { kind: 'not-logged-in' } // no team_url and/or no jwt — user hasn't run `aikey login`
  | { kind: 'unauth' } // 401/403 from team — JWT expired or revoked
  | { kind: 'unreachable'; status?: number; detail?: string }
  | { kind: 'parse-error'; detail: string };

/** isTeamFetchError narrows a teamGetJSON result. */
export function isTeamFetchError(v: unknown): v is TeamFetchError {
  return typeof v === 'object' && v !== null && 'kind' in v;
}

/** A domain error surfaced by a team write (POST) — the master's
 * {"error":code,"message":msg} envelope, plus the HTTP status. Distinct from
 * TeamFetchError so the write UI can show the server's precise reason (e.g.
 * OAUTH_GROUP_DISABLED / a missing-field message / a membership 403). */
export type TeamWriteError = { kind: 'domain'; status: number; code: string; message: string };

/** isTeamWriteError narrows a teamPostJSON result to its domain-error case. */
export function isTeamWriteError(v: unknown): v is TeamWriteError {
  return typeof v === 'object' && v !== null && (v as { kind?: string }).kind === 'domain';
}

async function readTeamURL(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TEAM_URL_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { team_url?: string };
    return (data.team_url || '').trim().replace(/\/$/, '');
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function readTeamJWT(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TEAM_JWT_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { jwt?: string };
    return (data.jwt || '').trim();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * teamGetJSON GETs a team-scoped path on the remote master with the member's
 * JWT, returning the parsed JSON OR a typed TeamFetchError. `path` must start
 * with '/' (e.g. '/accounts/me/oauth-accounts').
 */
export async function teamGetJSON<T>(path: string): Promise<T | TeamFetchError> {
  const [teamUrl, jwt] = await Promise.all([readTeamURL(), readTeamJWT()]);
  if (!teamUrl || !jwt) {
    return { kind: 'not-logged-in' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${teamUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` },
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (res.status === 401 || res.status === 403) {
      return { kind: 'unauth' };
    }
    if (!res.ok) {
      return { kind: 'unreachable', status: res.status };
    }
    try {
      return (await res.json()) as T;
    } catch (e) {
      return { kind: 'parse-error', detail: String(e) };
    }
  } catch (e) {
    return { kind: 'unreachable', detail: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * teamPostJSON POSTs `body` to a team-scoped path on the remote master with the
 * member's JWT. Returns the parsed success JSON, a TeamFetchError (transport /
 * not-logged-in), OR a TeamWriteError carrying the server's domain error envelope
 * (so the add-account UI can show the precise reason for a 4xx). `path` must start
 * with '/'.
 */
export async function teamPostJSON<T>(
  path: string,
  body: unknown,
): Promise<T | TeamFetchError | TeamWriteError> {
  const [teamUrl, jwt] = await Promise.all([readTeamURL(), readTeamJWT()]);
  if (!teamUrl || !jwt) {
    return { kind: 'not-logged-in' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${teamUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch (e) {
        return { kind: 'parse-error', detail: String(e) };
      }
    }
    // Non-2xx: surface the master's {error,message} domain envelope so the UI can
    // explain WHY (disabled / not a member / missing field), not just "failed".
    let code = `HTTP_${res.status}`;
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      if (data.error) code = data.error;
      if (data.message) message = data.message;
    } catch {
      /* keep the HTTP fallback */
    }
    return { kind: 'domain', status: res.status, code, message };
  } catch (e) {
    return { kind: 'unreachable', detail: String(e) };
  } finally {
    clearTimeout(timer);
  }
}
