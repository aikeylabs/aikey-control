/**
 * Stale-token self-heal (2026-08-20).
 *
 * A 401 carrying the gateway's `x-aikey-team-token: rejected` marker is the
 * server naming the credential as the problem. Before this, local_bypass
 * /user 401s were deliberately left alone (no redirect, no cleanup) — correct
 * for a business 401, but it left a dead localStorage token in place forever,
 * and the console read 未登录 against a signed-in vault across reloads.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TEAM_TOKEN_REJECTED_HEADER } from './user/team-session';

// The suite runs in vitest's default NODE environment (the other tests here
// are pure functions, and a DOM dependency is not worth adding for two
// assertions). Stub only what the interceptor touches.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;
(globalThis as unknown as { window: unknown }).window = {
  location: { pathname: '/user/overview', href: '' },
};

vi.mock('@/app/config/runtime', () => ({
  runtimeConfig: { apiBaseUrl: '/api', authMode: 'local_bypass' },
}));
vi.mock('@/shared/i18n/i18n', () => ({ default: { resolvedLanguage: 'en', language: 'en' } }));

describe('http-client 401 handling', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears a rejected token so the next request goes out clean', async () => {
    const { httpClient: client } = await import('./http-client');
    localStorage.setItem('aikey-auth-user', JSON.stringify({ state: { token: 'stale' } }));

    const rejected = Object.assign(new Error('401'), {
      isAxiosError: true,
      config: { url: '/accounts/me' },
      response: { status: 401, headers: { [TEAM_TOKEN_REJECTED_HEADER]: 'rejected' }, data: {} },
    });
    const handler = (client.interceptors.response as unknown as {
      handlers: { rejected: (e: unknown) => Promise<unknown> }[];
    }).handlers[0].rejected;

    await expect(handler(rejected)).rejects.toBeTruthy();
    expect(localStorage.getItem('aikey-auth-user')).toBeNull();
  });

  it('leaves the token alone on a business 401 (no marker)', async () => {
    const { httpClient: client } = await import('./http-client');
    localStorage.setItem('aikey-auth-user', JSON.stringify({ state: { token: 'good' } }));

    const business = Object.assign(new Error('401'), {
      isAxiosError: true,
      config: { url: '/accounts/me/seats' },
      response: { status: 401, headers: {}, data: {} },
    });
    const handler = (client.interceptors.response as unknown as {
      handlers: { rejected: (e: unknown) => Promise<unknown> }[];
    }).handlers[0].rejected;

    await expect(handler(business)).rejects.toBeTruthy();
    expect(localStorage.getItem('aikey-auth-user')).not.toBeNull();
  });
});

/**
 * An API answer that is an HTML page is a FAILURE (2026-09-07).
 *
 * User report: "Unexpected Application Error! q.find is not a function
 * (In 'q.find(Y=>Y.alias)', 'q.find' is undefined)" — every visit to the
 * console's overview page.
 *
 * The chain, measured end to end on a real box: the personal local-server was
 * in gateway mode, so /accounts/* was forwarded to the configured console
 * origin; that origin is a static SPA host which answers EVERY path with
 * index.html and HTTP 200 (verified: even /health). axios leaves a text/html
 * body unparsed, so res.data was the HTML STRING, `res.data ?? []` passed it
 * through untouched (?? guards null/undefined, not a string), and the page
 * called .find() on it.
 *
 * The fence asserts the interceptor REJECTS rather than coerces: turning this
 * into an empty array would render a confidently empty page about a server
 * that never answered — the silent failure this codebase forbids.
 */
describe('http-client HTML-instead-of-JSON handling', () => {
  async function fulfilled() {
    const { httpClient: client } = await import('./http-client');
    return (client.interceptors.response as unknown as {
      handlers: { fulfilled: (r: unknown) => unknown }[];
    }).handlers[0].fulfilled;
  }

  it('rejects an HTML body served with 200 instead of passing it to the caller', async () => {
    const f = await fulfilled();
    const htmlRes = {
      status: 200,
      headers: { 'content-type': 'text/html;charset=utf-8' },
      data: '<!doctype html><html><head></head><body></body></html>',
      config: { baseURL: '', url: '/accounts/me/seats' },
    };
    await expect(Promise.resolve(f(htmlRes))).rejects.toThrow(/HTML page instead of API data/);
  });

  it('names the endpoint so the failure is diagnosable without a debugger', async () => {
    const f = await fulfilled();
    const htmlRes = {
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: '<!doctype html>',
      config: { baseURL: '', url: '/accounts/me/seats' },
    };
    await expect(Promise.resolve(f(htmlRes))).rejects.toThrow(/accounts\/me\/seats/);
  });

  it('does not coerce to an empty value — "wrong answer" is not "no data"', async () => {
    const f = await fulfilled();
    const htmlRes = {
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: '<!doctype html>',
      config: { baseURL: '', url: '/accounts/me/seats' },
    };
    const outcome = await Promise.resolve(f(htmlRes)).then(
      (v) => ({ kind: 'resolved' as const, v }),
      () => ({ kind: 'rejected' as const }),
    );
    // Resolving AT ALL is the failure here — an empty array would be the most
    // tempting value to return and the most misleading one to show.
    expect(outcome.kind).toBe('rejected');
  });

  it('lets a normal JSON response through untouched', async () => {
    const f = await fulfilled();
    const jsonRes = {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      data: [{ alias: 'a' }],
      config: { baseURL: '', url: '/accounts/me/seats' },
    };
    expect(await Promise.resolve(f(jsonRes))).toBe(jsonRes);
  });

  it('lets a response with no content-type through (204, and non-HTTP stubs in tests)', async () => {
    const f = await fulfilled();
    const res = { status: 204, headers: {}, data: '', config: { baseURL: '', url: '/x' } };
    expect(await Promise.resolve(f(res))).toBe(res);
  });
});
