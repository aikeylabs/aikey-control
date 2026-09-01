import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  teamGetJSON,
  teamPostJSON,
  teamPutJSON,
  teamDeleteJSON,
  isTeamFetchError,
  isTeamWriteError,
} from './team-fetch';

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

describe('teamPostJSON — actionable domain errors', () => {
  it('preserves the master reason for a cross-group OAuth account conflict', async () => {
    const message =
      'This OAuth account already belongs to OAuth group "BoleadTechOffice" and was not added to "agent-pool-335923591-anthropic". Remove it from "BoleadTechOffice" first, then try again.';
    mockFetch({
      '/system/team-url': async () => jsonRes(OK_URL),
      '/system/team-jwt': async () => jsonRes(OK_JWT),
      'team.example': async () =>
        jsonRes(
          {
            error: 'BIZ_OAUTH_GROUP_CRED_IN_USE',
            message,
            current_group_alias: 'BoleadTechOffice',
            target_group_alias: 'agent-pool-335923591-anthropic',
          },
          409,
        ),
    });

    const res = await teamPostJSON('/accounts/me/oauth-accounts', {
      provider_id: 'anthropic',
      login_email: 'roman@example.test',
      password: 'not-logged',
      oauth_group_id: 'agent-group',
    });
    expect(isTeamWriteError(res)).toBe(true);
    if (!isTeamWriteError(res)) return;
    expect(res).toEqual({
      kind: 'domain',
      status: 409,
      code: 'BIZ_OAUTH_GROUP_CRED_IN_USE',
      message,
    });
    // AddAccountModal renders res.message directly. This exact assertion keeps
    // the two-hop helper from collapsing it to the generic add failure.
    expect(res.message).toContain('BoleadTechOffice');
    expect(res.message).toContain('agent-pool-335923591-anthropic');
  });
});

// ── composing-gateway: EVERY verb honours the capability (2026-08-31) ───────
//
// 🔴 Why this block exists, and why it enumerates verbs instead of testing the
// one function that was fixed. The backend has advertised `gateway:true` on
// /system/team-url since 2026-07-03 and managed-keys.ts consumed it — but this
// module, the SHARED helper meant to replace managed-keys' private copy, was
// written without it. Every page on this helper bypassed the local gateway:
// on the desktop app the Team OAuth page reported "暂时无法连接团队服务器"
// while Team Keys worked in the same window, and the member's team JWT was
// pulled into the browser that the gateway mode exists to keep it out of.
// Third same-shape defect that day (hook --yes fixed on one platform only;
// servability re-derived by one consumer) — a capability consumed by SOME
// exits of a concept is how it happens, so the fence walks ALL of them.
describe('composing gateway (gateway:true on /system/team-url)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type Seen = { url: string; auth: string | null };

  /** Capturing mock: gateway-mode local server + a recorder for team calls. */
  function gatewayFetch(seen: Seen[], jwtHits: { n: number }) {
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/system/team-url')) {
        return jsonRes({ team_url: 'http://team.example', gateway: true });
      }
      if (url.includes('/system/team-jwt')) {
        jwtHits.n += 1;
        return jsonRes({ jwt: 'must-never-be-read' });
      }
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      seen.push({ url, auth: headers.get('Authorization') });
      return jsonRes({ ok: true });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('GET / POST / PUT / DELETE all go same-origin with no token', async () => {
    const seen: Seen[] = [];
    const jwtHits = { n: 0 };
    gatewayFetch(seen, jwtHits);

    await teamGetJSON('/accounts/me/oauth-groups');
    await teamPostJSON('/accounts/me/oauth-accounts', {});
    await teamPutJSON('/accounts/me/oauth-accounts/x', {});
    await teamDeleteJSON('/accounts/me/oauth-accounts/x');

    expect(seen.map((s) => s.url)).toEqual([
      '/accounts/me/oauth-groups',
      '/accounts/me/oauth-accounts',
      '/accounts/me/oauth-accounts/x',
      '/accounts/me/oauth-accounts/x',
    ]);
    for (const s of seen) {
      // A cross-origin URL here = the verb bypassed the gateway = the desktop
      // failure; an Authorization header = the JWT leaked into the browser.
      expect(s.url.startsWith('http')).toBe(false);
      expect(s.auth).toBeNull();
    }
    // The security half: in gateway mode the token endpoint must not even be
    // consulted. Reading it "just in case" is how the JWT ends up in browser
    // memory for a mode whose whole point is that it never gets there.
    expect(jwtHits.n).toBe(0);
  });

  it('gateway with an EMPTY team_url is not-logged-in, not a free pass', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/system/team-url')) return jsonRes({ team_url: '', gateway: true });
        throw new Error(`unrouted fetch: ${url}`);
      }),
    );
    const out = await teamGetJSON('/accounts/me/oauth-groups');
    expect(isTeamFetchError(out) && out.kind === 'not-logged-in').toBe(true);
  });

  it('legacy servers (no gateway field) keep the original cross-origin hop', async () => {
    const seen: Seen[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/system/team-url')) return jsonRes(OK_URL);
        if (url.includes('/system/team-jwt')) return jsonRes(OK_JWT);
        const headers = new Headers(init?.headers as HeadersInit | undefined);
        seen.push({ url, auth: headers.get('Authorization') });
        return jsonRes({ ok: true });
      }),
    );
    await teamGetJSON('/accounts/me/oauth-groups');
    // Old wire behavior must survive byte for byte: absolute team URL + Bearer.
    // Breaking THIS while adding the gateway would trade one edition's outage
    // for another's.
    expect(seen).toEqual([
      { url: 'http://team.example/accounts/me/oauth-groups', auth: 'Bearer jwt-123' },
    ]);
  });
});
