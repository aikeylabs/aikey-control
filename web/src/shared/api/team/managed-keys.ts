/**
 * Team-side managed keys client (Phase 3A).
 *
 * A's web fetches /accounts/me/all-keys cross-origin from the team
 * server (B) to render Team Keys inside the local vault page. Two
 * pre-flight reads happen against A's own local-server (same-origin,
 * no CORS needed):
 *   1. /system/team-url → which team server are we logged into
 *   2. /system/team-jwt → Bearer token for the team-side request
 *
 * Then the cross-origin call:
 *   GET ${team_url}/accounts/me/all-keys
 *     Authorization: Bearer <jwt>
 *
 * Errors collapse into typed states (TeamFetchError) so the caller
 * (zustand store + vault page banner) can switch on them without
 * parsing message strings.
 *
 * See roadmap update 20260511-vault-page-team-key-merged-display.md
 * §4 + §5 for the wire contract and data flow.
 */

import type { TeamVaultRecord } from '@/shared/types/team-vault';

const TEAM_URL_ENDPOINT = '/system/team-url';
const TEAM_JWT_ENDPOINT = '/system/team-jwt';
const FETCH_TIMEOUT_MS = 8000;

/** Distinct failure states surfaced by fetchTeamManagedKeys. The vault
 * page renders different UI per state (banner copy, retry vs re-login
 * prompt, etc.) so the categorization is part of the contract. */
export type TeamFetchError =
  | { kind: 'not-logged-in' }     // no team_url and/or no jwt — user hasn't run `aikey login`
  | { kind: 'unauth' }             // 401/403 from team — JWT expired or revoked
  | { kind: 'unreachable'; status?: number; detail?: string }
  | { kind: 'parse-error'; detail: string };

export interface TeamManagedKeysResponse {
  /** Records ready for vault-page consumption. */
  records: TeamVaultRecord[];
  /** Server-side fetched_at timestamp echoing back is not in B's wire
   * contract; we synthesize the time of THIS fetch for cache-freshness
   * banners. */
  fetched_at: string;
}

/** Read the team-server URL the local-server discovered from the CLI
 * vault. Same-origin GET; returns "" when not logged in. */
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

/** Read the team JWT from the local-server's vault-bridge endpoint.
 * Same-origin GET; the endpoint intentionally omits CORS headers so
 * cross-origin readers are blocked. Returns "" when not logged in. */
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

/** B's wire shape (subset we care about — see UserKeyDTO in
 * aikey-control-master/service/pkg/userapi/handlers.go). Tolerant
 * parser: missing optional fields just become defaults; unknown
 * fields are ignored. */
interface RawTeamKey {
  virtual_key_id: string;
  alias: string;
  protocol_type?: string;
  provider_code?: string;
  supported_providers?: string[];
  share_status?: string;
  effective_status?: string;
  key_status?: string;
  expires_at?: string;
}

function rawToTeamRecord(raw: RawTeamKey): TeamVaultRecord {
  // protocol_family priority: protocol_type (canonical) → provider_code
  // (legacy installs) → 'unknown' (defensive — always renderable).
  const protoFamily =
    (raw.protocol_type ||
      raw.provider_code ||
      'unknown'
    ).toLowerCase();
  const supported = Array.isArray(raw.supported_providers) && raw.supported_providers.length > 0
    ? raw.supported_providers
    : (raw.provider_code ? [raw.provider_code] : []);
  // share_status / effective_status: B-defined enums, but tolerate
  // unexpected values by mapping to safe defaults.
  const share = (raw.share_status === 'pending' || raw.share_status === 'claimed' || raw.share_status === 'revoked')
    ? raw.share_status
    : 'claimed';
  const effective = (raw.effective_status === 'active' || raw.effective_status === 'inactive')
    ? raw.effective_status
    : (raw.key_status === 'active' && share === 'claimed' ? 'active' : 'inactive');
  return {
    target: 'team',
    virtual_key_id: raw.virtual_key_id,
    alias: raw.alias,
    protocol_family: protoFamily,
    supported_providers: supported,
    share_status: share,
    effective_status: effective,
    expires_at: raw.expires_at,
  };
}

/**
 * Top-level entry: fetch the team-key list for the current user.
 *
 * Returns a TeamManagedKeysResponse on success, OR a TeamFetchError
 * the caller can switch on. Never throws. The error categorization
 * is the contract — UI maps each kind to a different surface (no
 * team area / re-login banner / unreachable banner / parse error).
 */
export async function fetchTeamManagedKeys(): Promise<
  TeamManagedKeysResponse | TeamFetchError
> {
  const [teamUrl, jwt] = await Promise.all([readTeamURL(), readTeamJWT()]);
  if (!teamUrl || !jwt) {
    return { kind: 'not-logged-in' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${teamUrl}/accounts/me/all-keys`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      signal: ctrl.signal,
      credentials: 'omit',
    });
  } catch (err) {
    return {
      kind: 'unreachable',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: 'unauth' };
  }
  if (!res.ok) {
    return { kind: 'unreachable', status: res.status };
  }

  let body: { keys?: RawTeamKey[] };
  try {
    body = (await res.json()) as { keys?: RawTeamKey[] };
  } catch (err) {
    return {
      kind: 'parse-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!Array.isArray(body.keys)) {
    return { kind: 'parse-error', detail: 'response missing keys[]' };
  }

  const records = body.keys
    .filter((k): k is RawTeamKey => !!k && typeof k.virtual_key_id === 'string' && typeof k.alias === 'string')
    .map(rawToTeamRecord);

  return {
    records,
    fetched_at: new Date().toISOString(),
  };
}

/** Helpers exported only for tests — DO NOT use in app code. */
export const __testInternals = { rawToTeamRecord };
