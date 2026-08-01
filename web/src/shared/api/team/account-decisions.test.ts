import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAccountDecisions } from './account-decisions';

// Same two-hop harness as oauth-contribute.test.ts: stub /system/team-url +
// /system/team-jwt, then the cross-origin master call.
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

describe('fetchAccountDecisions', () => {
  it('returns not-logged-in when team url/jwt are absent', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: '' } },
      '/system/team-jwt': { json: { jwt: '' } },
    });
    expect(await fetchAccountDecisions()).toEqual({ kind: 'not-logged-in' });
  });

  it('maps a 401 from master to unauth', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'expired' } },
      '/accounts/me/account-decisions': { status: 401 },
    });
    expect(await fetchAccountDecisions()).toEqual({ kind: 'unauth' });
  });

  it('passes filters as query params and returns the normalized page', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'JWT' } },
      '/accounts/me/account-decisions': {
        json: {
          events: [
            {
              decision_id: 'dec-1',
              oauth_group_id: 'g1',
              group_alias: 'my-pool',
              account_id: 'cred-A',
              account_email: 'a@pool.test',
              decision_type: 'reassign',
              trigger: 'replaced',
              detail: '{"from":"cred-A","to":"cred-B","affected_seats":["s1"]}',
              auto_executed: true,
              created_at: 1000,
              affects_you: false,
              owned_pool: true,
              affected_seats: [{ seat_id: 's1', email: 'm@corp.test', you: false }],
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
          summary: { total: 1, auto_executed: 1, advisory: 0 },
        },
      },
    });
    const res = await fetchAccountDecisions({ scope: 'pools', decision: 'reassign', limit: 20, offset: 0 });
    expect('kind' in (res as object)).toBe(false);
    const page = res as Exclude<typeof res, { kind: string }>;
    expect(page.total).toBe(1);
    expect(page.events[0].decision_id).toBe('dec-1');
    expect(page.events[0].affected_seats?.[0].seat_id).toBe('s1');

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const masterCall = calls.find((u) => u.includes('/accounts/me/account-decisions'));
    expect(masterCall).toContain('scope=pools');
    expect(masterCall).toContain('decision=reassign');
    expect(masterCall).toContain('limit=20');
  });

  it('normalizes a null events body (older server / empty window)', async () => {
    routeFetch({
      '/system/team-url': { json: { team_url: 'https://m' } },
      '/system/team-jwt': { json: { jwt: 'JWT' } },
      '/accounts/me/account-decisions': { json: { events: null, total: 0 } },
    });
    const res = await fetchAccountDecisions();
    const page = res as { events: unknown[]; summary: { total: number } };
    expect(page.events).toEqual([]);
    expect(page.summary.total).toBe(0);
  });
});
