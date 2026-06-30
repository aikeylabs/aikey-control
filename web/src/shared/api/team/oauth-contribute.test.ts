import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRoutedCredential, fetchTeamOAuthAccounts } from './oauth-contribute';

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

describe('fetchTeamOAuthAccounts', () => {
  it('returns the account list when logged in', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://master.example.com' } },
      '/system/team-jwt': { json: { jwt: 'JWT123' } },
      '/accounts/me/oauth-accounts': {
        json: [{ credential_id: 'c1', display_identity: 'a@b.com', assigned: true }],
      },
    });
    const res = await fetchTeamOAuthAccounts();
    expect(Array.isArray(res)).toBe(true);
    expect((res as any)[0].credential_id).toBe('c1');
  });

  it('returns not-logged-in when team url/jwt are absent', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: '' } },
      '/system/team-jwt': { json: { jwt: '' } },
    });
    const res = await fetchTeamOAuthAccounts();
    expect(res).toEqual({ kind: 'not-logged-in' });
  });

  it('maps a 401 from master to unauth', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'expired' } },
      '/accounts/me/oauth-accounts': { status: 401 },
    });
    const res = await fetchTeamOAuthAccounts();
    expect(res).toEqual({ kind: 'unauth' });
  });
});

describe('fetchRoutedCredential', () => {
  it('returns the login email + password for the routed account', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'JWT' } },
      '/accounts/me/group-routed-credential': { json: { login_email: 'x@y.com', password: 's3cret' } },
    });
    const res = await fetchRoutedCredential('c1');
    expect(res).toEqual({ login_email: 'x@y.com', password: 's3cret' });
  });

  it('not-logged-in propagates', async () => {
    routeFetch({ '/system/team-url': { json: {} }, '/system/team-jwt': { json: {} } });
    expect(await fetchRoutedCredential('c1')).toEqual({ kind: 'not-logged-in' });
  });
});
