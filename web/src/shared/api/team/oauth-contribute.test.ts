import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMyPoolAccounts, fetchRoutedCredential } from './oauth-contribute';

// routeFetch installs a fake global.fetch that dispatches by URL substring, so a
// test can stub the two-hop (/system/team-url + /system/team-jwt) then the
// cross-origin master call.
function routeFetch(routes: Record<string, { status?: number; json?: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const match = Object.keys(routes).find((k) => url.includes(k));
      const r = match ? routes[match] : { status: 404, json: {} };
      return {
        ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
        status: r.status ?? 200,
        json: async () => r.json ?? {},
      } as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchMyPoolAccounts', () => {
  it('returns not-logged-in when team url/jwt are absent', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: '' } },
      '/system/team-jwt': { json: { jwt: '' } },
    });
    expect(await fetchMyPoolAccounts()).toEqual({ kind: 'not-logged-in' });
  });

  it('maps a 401 from master to unauth', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'expired' } },
      '/accounts/me/oauth-member-tokens': { status: 401 },
    });
    expect(await fetchMyPoolAccounts()).toEqual({ kind: 'unauth' });
  });

  it('returns the logged-into history with the routed account flagged', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'JWT' } },
      '/accounts/me/oauth-member-tokens': {
        json: [
          { credential_id: 'c1', identity: 'a@x.com', status: 'logged_in', last_login_at: 100, expires_at: 0, is_routed: true },
          { credential_id: 'c2', identity: 'b@x.com', status: 'auth_failed', last_login_at: 50, expires_at: 0, is_routed: false },
        ],
      },
    });
    const res = await fetchMyPoolAccounts();
    expect(Array.isArray(res)).toBe(true);
    const list = res as any[];
    expect(list).toHaveLength(2);
    expect(list[0].is_routed).toBe(true);
    expect(list[1].is_routed).toBe(false);
  });

  it('not-logged-in propagates', async () => {
    routeFetch({ '/system/team-url': { json: {} }, '/system/team-jwt': { json: {} } });
    expect(await fetchMyPoolAccounts()).toEqual({ kind: 'not-logged-in' });
  });
});

describe('fetchRoutedCredential', () => {
  it('omitting credential_id lets the server resolve the routed account', async () => {
    let calledPath = '';
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'JWT' } },
      '/accounts/me/group-routed-credential': {
        json: { credential_id: 'c-routed', login_email: 'x@y.com', password: 's3cret' },
      },
    });
    // capture the URL to assert no ?credential_id when omitted
    const orig = globalThis.fetch as any;
    globalThis.fetch = ((url: string, init?: any) => {
      if (url.includes('group-routed-credential')) calledPath = url;
      return orig(url, init);
    }) as any;

    const res = await fetchRoutedCredential(); // no arg → server resolves
    expect(res).toEqual({ credential_id: 'c-routed', login_email: 'x@y.com', password: 's3cret' });
    expect(calledPath.includes('credential_id=')).toBe(false);
  });

  it('passing credential_id pulls that specific account (LOGIN_REQUIRED flow)', async () => {
    let calledPath = '';
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'JWT' } },
      '/accounts/me/group-routed-credential': {
        json: { credential_id: 'c1', login_email: 'x@y.com', password: 's' },
      },
    });
    const orig = globalThis.fetch as any;
    globalThis.fetch = ((url: string, init?: any) => {
      if (url.includes('group-routed-credential')) calledPath = url;
      return orig(url, init);
    }) as any;

    await fetchRoutedCredential('c1');
    expect(calledPath.includes('credential_id=c1')).toBe(true);
  });

  it('not-logged-in propagates', async () => {
    routeFetch({ '/system/team-url': { json: {} }, '/system/team-jwt': { json: {} } });
    expect(await fetchRoutedCredential()).toEqual({ kind: 'not-logged-in' });
  });
});
