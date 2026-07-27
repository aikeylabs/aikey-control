/**
 * Behavioural regression tests for the PERSONAL-side (A) peer resolution adapter.
 *
 * Separate from the B-side file on purpose: the two adapters read different keys
 * with different semantics, so neither covers the other. Before 2026-07-26
 * neither had any runtime coverage at all — every "cross-app" test in the repo
 * is a source-scanning grep fence, so the suite could be fully green while the
 * function returned the wrong server.
 *
 * A side specifics, and why they differ from B:
 *  - peer = the TEAM server, which stays REMOTE even under a composing gateway
 *    (the gateway forwards team ROUTES on this origin, it does not move the team
 *    server here). So A must never collapse its peer to `location.origin`.
 *  - fallback = null, because A's caller uses null as the "is a team configured
 *    at all" signal that gates cross-app menu visibility. Inventing a default
 *    here would make team entries appear for users with no team.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const PEER_KEY = 'aikey-cross-app:team-base-url';
const OWN_KEY = 'aikey-cross-app:personal-base-url';
const GATEWAY_KEY = 'aikey-cross-app:team-gateway';
const LOCAL = 'http://127.0.0.1:8090';
const TEAM = 'http://127.0.0.1:3000';

function installStorage(seed: Record<string, string>, origin: string) {
  const store = new Map(Object.entries(seed));
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    clear: () => store.clear(),
  };
  (globalThis as Record<string, unknown>).window = { location: { origin } };
  return store;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

async function getOtherBaseUrl() {
  const mod = await import('./other-base-url');
  return mod.getOtherBaseUrl();
}

describe('A-side getOtherBaseUrl', () => {
  it('keeps the peer REMOTE under a gateway', async () => {
    // The mirror-image mistake of the B-side bug: if A collapsed its peer to
    // this origin, "is a team configured?" would become permanently true.
    installStorage({ [GATEWAY_KEY]: '1', [PEER_KEY]: TEAM }, LOCAL);
    expect(await getOtherBaseUrl()).toBe(TEAM);
  });

  it('returns null when no team is configured, so the menu stays hidden', async () => {
    installStorage({ [GATEWAY_KEY]: '1' }, LOCAL);
    expect(await getOtherBaseUrl(), 'null is the cross-app menu VISIBILITY signal — a fallback here would show team entries to users with no team').toBeNull();
  });

  it('heals the mirror poison: peer equal to this side own cached URL', async () => {
    // The observed production state was BOTH keys holding the team URL. A sees
    // peer === own and must drop its own (team) key so discovery can refill it.
    const store = installStorage({ [PEER_KEY]: TEAM, [OWN_KEY]: TEAM }, LOCAL);
    expect(await getOtherBaseUrl()).toBeNull();
    expect(store.has(PEER_KEY), 'poisoned peer key must be deleted so /system/team-url can repopulate it').toBe(false);
    expect(store.get(OWN_KEY), 'healing must not touch the other side\'s key').toBe(TEAM);
    expect(warn).toHaveBeenCalled();
  });

  it('rejects a peer pointing at this very origin', async () => {
    // Would mean "the team server is my own local-server" — impossible.
    installStorage({ [PEER_KEY]: LOCAL }, LOCAL);
    expect(await getOtherBaseUrl()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('passes a healthy cached team URL straight through', async () => {
    const store = installStorage({ [PEER_KEY]: TEAM }, LOCAL);
    expect(await getOtherBaseUrl()).toBe(TEAM);
    expect(store.get(PEER_KEY), 'a healthy value must not be disturbed').toBe(TEAM);
  });

  it('normalises a trailing slash', async () => {
    installStorage({ [PEER_KEY]: `${TEAM}/` }, LOCAL);
    expect(await getOtherBaseUrl()).toBe(TEAM);
  });

  it('ignores a malformed cached value instead of throwing', async () => {
    installStorage({ [PEER_KEY]: 'not-a-url' }, LOCAL);
    expect(await getOtherBaseUrl()).toBeNull();
  });

  it('survives localStorage being unavailable', async () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    (globalThis as Record<string, unknown>).window = { location: { origin: LOCAL } };
    expect(await getOtherBaseUrl()).toBeNull();
  });
});
