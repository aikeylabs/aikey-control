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
