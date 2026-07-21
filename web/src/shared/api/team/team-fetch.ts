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

/**
 * Result of reading one of the two local `/system/*` handshake endpoints.
 *
 * Why a discriminated union instead of a bare string (2026-07-12 bugfix):
 * both readers used to `catch { return '' }`, collapsing "the endpoint
 * answered, but the value is empty" (the user genuinely never ran
 * `aikey login`) into the same '' as "the request threw / timed out / 5xx"
 * (a TRANSPORT failure). teamGetJSON then reported BOTH as
 * `{ kind: 'not-logged-in' }`, so a network outage told the user to
 * "run aikey login" (wrong remedy) and silently suppressed the Vault
 * team banner, which returns null on not-logged-in by design. Keeping the
 * two apart lets callers render the right thing (see TeamFetchError).
 */
type LocalRead = { ok: true; value: string } | { ok: false; detail: string };

/** GET a local /system/* endpoint, keeping transport failure distinguishable
 *  from an empty (= not configured) value. */
async function readLocalSystemValue(
  endpoint: string,
  pick: (data: Record<string, unknown>) => string,
): Promise<LocalRead> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      credentials: 'omit',
    });
    // A non-2xx from the LOCAL server is a transport-class failure, not a
    // statement that the user isn't logged in — the local-server is supposed
    // to answer 200 with an empty value in that case.
    if (!res.ok) return { ok: false, detail: `${endpoint} HTTP ${res.status}` };
    const data = (await res.json()) as Record<string, unknown>;
    return { ok: true, value: pick(data) };
  } catch (e) {
    return { ok: false, detail: `${endpoint}: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

function readTeamURL(): Promise<LocalRead> {
  return readLocalSystemValue(TEAM_URL_ENDPOINT, (d) =>
    String(d.team_url || '').trim().replace(/\/$/, ''),
  );
}

function readTeamJWT(): Promise<LocalRead> {
  return readLocalSystemValue(TEAM_JWT_ENDPOINT, (d) => String(d.jwt || '').trim());
}

/**
 * resolveTeamHandshake performs the local two-hop prelude shared by
 * teamGetJSON / teamPostJSON: read team_url + jwt, and classify the outcome.
 * Returns the credentials, or the TeamFetchError to surface as-is.
 */
async function resolveTeamHandshake(): Promise<
  { ok: true; teamUrl: string; jwt: string } | { ok: false; err: TeamFetchError }
> {
  const [urlRead, jwtRead] = await Promise.all([readTeamURL(), readTeamJWT()]);
  // Transport failure on either local hop → unreachable, NOT not-logged-in.
  if (!urlRead.ok || !jwtRead.ok) {
    const detail = [!urlRead.ok ? urlRead.detail : '', !jwtRead.ok ? jwtRead.detail : '']
      .filter(Boolean)
      .join('; ');
    return { ok: false, err: { kind: 'unreachable', detail } };
  }
  // Endpoints answered, but there is no team configured / no session yet.
  if (!urlRead.value || !jwtRead.value) {
    return { ok: false, err: { kind: 'not-logged-in' } };
  }
  return { ok: true, teamUrl: urlRead.value, jwt: jwtRead.value };
}

/**
 * teamGetJSON GETs a team-scoped path on the remote master with the member's
 * JWT, returning the parsed JSON OR a typed TeamFetchError. `path` must start
 * with '/' (e.g. '/accounts/me/oauth-accounts').
 */
export async function teamGetJSON<T>(path: string): Promise<T | TeamFetchError> {
  const handshake = await resolveTeamHandshake();
  if (!handshake.ok) return handshake.err;
  const { teamUrl, jwt } = handshake;
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
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T | TeamFetchError | TeamWriteError> {
  return teamWriteJSON<T>('POST', path, body, timeoutMs);
}

/**
 * teamPutJSON PUTs `body` to a team-scoped path on the remote master (member JWT).
 * Same handshake + error classification as teamPostJSON — for idempotent
 * "set/replace" writes (member per-account egress override, exit-IP baseline;
 * 2026-07-19). `path` must start with '/'.
 */
export async function teamPutJSON<T>(
  path: string,
  body: unknown,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T | TeamFetchError | TeamWriteError> {
  return teamWriteJSON<T>('PUT', path, body, timeoutMs);
}

// teamWriteJSON is the shared POST/PUT body-write core (extracted 2026-07-19 so
// teamPostJSON and teamPutJSON share one handshake + error-classification path).
async function teamWriteJSON<T>(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T | TeamFetchError | TeamWriteError> {
  const handshake = await resolveTeamHandshake();
  if (!handshake.ok) return handshake.err;
  const { teamUrl, jwt } = handshake;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${teamUrl}${path}`, {
      method,
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

/**
 * teamDeleteJSON DELETEs a team-scoped path on the remote master with the
 * member's JWT. Same handshake + error classification as teamGetJSON/teamPostJSON.
 * Returns undefined on success (204/empty body tolerated), else a typed error.
 * `path` must start with '/'.
 */
export async function teamDeleteJSON(
  path: string,
): Promise<undefined | TeamFetchError | TeamWriteError> {
  const handshake = await resolveTeamHandshake();
  if (!handshake.ok) return handshake.err;
  const { teamUrl, jwt } = handshake;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${teamUrl}${path}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` },
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (res.ok) return undefined;
    if (res.status === 401 || res.status === 403) return { kind: 'unauth' };
    let code = `HTTP_${res.status}`;
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      if (data.error) code = data.error;
      if (data.message) message = data.message;
    } catch {
      /* non-JSON error body */
    }
    return { kind: 'domain', status: res.status, code, message };
  } catch (e) {
    return { kind: 'unreachable', detail: String(e) };
  } finally {
    clearTimeout(timer);
  }
}
