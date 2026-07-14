import { describe, it, expect, vi, afterEach } from 'vitest';
import { teamGetJSON, isTeamFetchError } from './team-fetch';

/**
 * Transport-vs-not-logged-in classification fence (2026-07-12 bugfix).
 *
 * Bug: readTeamURL/readTeamJWT used to `catch { return '' }`, collapsing a
 * TRANSPORT failure on the local /system/* hop into the same '' as "the user
 * never ran `aikey login`". teamGetJSON then reported both as
 * `{ kind: 'not-logged-in' }`, so a network outage:
 *   - told the Team OAuth user to "run aikey login" (wrong remedy), and
 *   - SILENTLY suppressed the Vault team banner, which returns null on
 *     not-logged-in by design → a failure with no signal at all.
 *
 * These tests pin that the two causes stay distinguishable.
 */

const OK_URL = { team_url: 'http://team.example' };
const OK_JWT = { jwt: 'jwt-123' };

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Route each endpoint to a caller-supplied handler. */
function mockFetch(routes: Record<string, () => Promise<Response>>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [frag, handler] of Object.entries(routes)) {
      if (url.includes(frag)) return handler();
    }
    throw new Error(`unrouted fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('teamGetJSON — local handshake classification', () => {
  it('endpoints answer with EMPTY values → not-logged-in', async () => {
    mockFetch({
      '/system/team-url': async () => jsonRes({ team_url: '' }),
      '/system/team-jwt': async () => jsonRes({ jwt: '' }),
    });
    const res = await teamGetJSON('/whatever');
    expect(isTeamFetchError(res) && res.kind).toBe('not-logged-in');
  });

  it('team-jwt THROWS (network down) → unreachable, NOT not-logged-in', async () => {
    mockFetch({
      '/system/team-url': async () => jsonRes(OK_URL),
      '/system/team-jwt': async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const res = await teamGetJSON('/whatever');
    // The regression: this used to be 'not-logged-in' → "run aikey login".
    expect(isTeamFetchError(res) && res.kind).toBe('unreachable');
  });

  it('team-url THROWS (network down) → unreachable', async () => {
    mockFetch({
      '/system/team-url': async () => {
        throw new TypeError('Failed to fetch');
      },
      '/system/team-jwt': async () => jsonRes(OK_JWT),
    });
    const res = await teamGetJSON('/whatever');
    expect(isTeamFetchError(res) && res.kind).toBe('unreachable');
  });

  it('local endpoint 5xx → unreachable (local-server is meant to 200 + empty)', async () => {
    mockFetch({
      '/system/team-url': async () => jsonRes({}, 503),
      '/system/team-jwt': async () => jsonRes(OK_JWT),
    });
    const res = await teamGetJSON('/whatever');
    expect(isTeamFetchError(res) && res.kind).toBe('unreachable');
  });
});

describe('teamGetJSON — remote team hop (unchanged behaviour)', () => {
  it('handshake ok + team server DOWN → unreachable', async () => {
    mockFetch({
      '/system/team-url': async () => jsonRes(OK_URL),
      '/system/team-jwt': async () => jsonRes(OK_JWT),
      'team.example': async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const res = await teamGetJSON('/accounts/me/x');
    expect(isTeamFetchError(res) && res.kind).toBe('unreachable');
  });

  it('handshake ok + team server 401 → unauth (expired session, not a network fault)', async () => {
    mockFetch({
      '/system/team-url': async () => jsonRes(OK_URL),
      '/system/team-jwt': async () => jsonRes(OK_JWT),
      'team.example': async () => jsonRes({}, 401),
    });
    const res = await teamGetJSON('/accounts/me/x');
    expect(isTeamFetchError(res) && res.kind).toBe('unauth');
  });

  it('handshake ok + team server 200 → parsed payload passes through', async () => {
    mockFetch({
      '/system/team-url': async () => jsonRes(OK_URL),
      '/system/team-jwt': async () => jsonRes(OK_JWT),
      'team.example': async () => jsonRes([{ id: 'a' }]),
    });
    const res = await teamGetJSON<Array<{ id: string }>>('/accounts/me/x');
    expect(isTeamFetchError(res)).toBe(false);
    expect(res).toEqual([{ id: 'a' }]);
  });
});
