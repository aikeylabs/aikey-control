import { describe, it, expect } from 'vitest';
import { resolveCrossAppPeer } from './cross-app-peer';

const ORIGIN = 'http://127.0.0.1:8090';
const TEAM = 'http://127.0.0.1:3000';

/**
 * Regression fences for the cross-app peer resolution (2026-07-26).
 *
 * The bug: on the composing gateway both sides share one localStorage, and the
 * team bundle's one-shot migration copied `team-base-url` into
 * `personal-base-url` — so the forwarded Overview believed Personal lived at the
 * team server, cross-fetched there unauthenticated, and every chart came back
 * 401 / CORS-blocked as a silent "暂无数据".
 */
describe('resolveCrossAppPeer — gateway (rule 1)', () => {
  it('returns this origin and never consults storage', () => {
    // THE regression: a poisoned cache said the peer was the team server. Under
    // a gateway that value must not be reachable at all.
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: true,
      currentOrigin: ORIGIN,
      storedPeer: TEAM,      // poisoned
      storedOwn: TEAM,
      fallback: null,
    });
    expect(r.url).toBe(ORIGIN);
    expect(r.source).toBe('gateway-origin');
  });

  it('flags a poisoned leftover for deletion so the browser self-heals', () => {
    // Code-only fixes leave every already-installed browser broken; the value
    // must be actively removed, not just ignored.
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: true, currentOrigin: ORIGIN,
      storedPeer: TEAM, storedOwn: TEAM, fallback: null,
    });
    expect(r.heal).toBe(true);
  });

  it('leaves a legitimate cached value alone', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: true, currentOrigin: ORIGIN,
      storedPeer: TEAM, storedOwn: null, fallback: null,
    });
    expect(r.url).toBe(ORIGIN);
    expect(r.heal).toBe(false); // peer != own, and != this origin — not poison
  });

  it('does NOT treat "peer === this origin" as poison under a gateway', () => {
    // Under a gateway that is the CORRECT value. Deleting it (as an earlier
    // draft did) throws away the only right answer and re-breaks the page.
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: true, currentOrigin: ORIGIN,
      storedPeer: ORIGIN, storedOwn: TEAM, fallback: null,
    });
    expect(r.url).toBe(ORIGIN);
    expect(r.heal, 'a correct same-origin peer must survive under a gateway').toBe(false);
  });

  it('ignores the legacy key entirely under a gateway', () => {
    // The legacy migration's premise is per-origin isolation, which the gateway
    // removes. Running it here is what created the poison in the first place.
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: true, currentOrigin: ORIGIN,
      storedPeer: null, storedOwn: null, storedLegacy: TEAM, fallback: null,
    });
    expect(r.url).toBe(ORIGIN);
    expect(r.persist).toBe(false);
  });
});

describe('resolveCrossAppPeer — Personal side under a gateway (peer stays remote)', () => {
  it('does NOT collapse the peer to this origin', () => {
    // A's peer is the TEAM server, remote even when the gateway forwards team
    // routes here. Collapsing it would make "is a team configured?" always true.
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: TEAM, storedOwn: null, fallback: null,
    });
    expect(r).toMatchObject({ url: TEAM, source: 'stored' });
  });

  it('still reports null when no team is configured', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: null, storedOwn: null, fallback: null,
    });
    expect(r.url).toBeNull();
  });
});

describe('resolveCrossAppPeer — gateway re-poison loop (2026-07-27)', () => {
  it('keeps the discovery-backed peer and heals the OWN key instead', () => {
    // The shipped loop: a browser-cached pre-fix bundle re-wrote the own key
    // (personal-base-url=:3000); the first heal draft then deleted the CORRECT
    // peer, discovery rewrote it, the next read deleted it again — the sidebar
    // lost every team entry ("登录之后菜单少了").
    const r = resolveCrossAppPeer({
      gatewayActive: true, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: TEAM, storedOwn: TEAM, fallback: null,
    });
    expect(r.url, 'the peer must survive — it is discovery-backed').toBe(TEAM);
    expect(r.heal, 'must NOT delete the peer key').toBe(false);
    expect(r.healOwn, 'must delete the stale own key (the other bundle never persists it under a gateway)').toBe(true);
  });

  it('without a gateway, peer===own still rejects the peer (original rule 2)', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: TEAM, storedOwn: TEAM, fallback: null,
    });
    expect(r.url).toBeNull();
    expect(r.heal).toBe(true);
  });
});

describe('resolveCrossAppPeer — no gateway', () => {
  it('uses a valid cached peer', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: TEAM, storedOwn: null, fallback: null,
    });
    expect(r).toMatchObject({ url: TEAM, source: 'stored' });
  });

  it('rejects and heals a peer equal to this side own URL', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: TEAM, storedOwn: TEAM, fallback: null,
    });
    expect(r.url).toBeNull();
    expect(r.heal).toBe(true);
    expect(r.rejected).toMatch(/own base URL/);
  });

  it('rejects a self-referential peer (peer === this origin)', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: ORIGIN, storedOwn: null, fallback: null,
    });
    expect(r.url).toBeNull();
    expect(r.heal).toBe(true);
    expect(r.rejected).toMatch(/its own peer/);
  });

  it('falls back when the cached peer is poison', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: ORIGIN, storedOwn: null, fallback: TEAM,
    });
    expect(r).toMatchObject({ url: TEAM, source: 'fallback', heal: true });
  });

  it('migrates the legacy key forward and asks to persist it', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: TEAM,
      storedPeer: null, storedOwn: null, storedLegacy: ORIGIN, fallback: null,
    });
    expect(r).toMatchObject({ url: ORIGIN, source: 'legacy-migrated', persist: true });
  });

  it('refuses to migrate a self-referential legacy value', () => {
    // Direct visit to the team origin whose legacy key holds the team URL.
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: TEAM,
      storedPeer: null, storedOwn: null, storedLegacy: TEAM, fallback: null,
    });
    expect(r.url).toBeNull();
    expect(r.persist).toBe(false);
  });

  it('uses the fallback when nothing is cached, and null when there is none', () => {
    expect(resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: TEAM,
      storedPeer: null, storedOwn: null, fallback: ORIGIN,
    })).toMatchObject({ url: ORIGIN, source: 'fallback' });

    expect(resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: null, storedOwn: null, fallback: null,
    })).toMatchObject({ url: null, source: 'none' });
  });

  it('ignores malformed cached values instead of throwing', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: 'not a url', storedOwn: null, fallback: TEAM,
    });
    expect(r).toMatchObject({ url: TEAM, source: 'fallback' });
  });

  it('normalises trailing slashes so comparisons are stable', () => {
    const r = resolveCrossAppPeer({
      gatewayActive: false, peerServedByThisOrigin: false, currentOrigin: ORIGIN,
      storedPeer: `${TEAM}/`, storedOwn: null, fallback: null,
    });
    expect(r.url).toBe(TEAM);
  });
});
