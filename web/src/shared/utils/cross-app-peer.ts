/**
 * Where is the OTHER side of the cross-app pair?
 *
 * Pure decision function shared by both bundles' `cross-app-menu/other-base-url.ts`.
 * Lives in `shared/utils/` on purpose: that directory is on the dual-edit
 * whitelist (`DRIFT_CHECK_PATHS`), so the two copies are mechanically kept
 * byte-identical. `cross-app-menu/` is NOT on that list and the two copies there
 * have already drifted — which is exactly how the bug below survived on one side
 * only. The side-specific parts (which storage key is "mine" vs "the peer's",
 * what the fallback is) stay in the adapters and are passed in.
 *
 * ## The bug this exists to make impossible (2026-07-26)
 *
 * Personal (A) and Team (B) each cache the OTHER side's base URL under an
 * absolutely-named key: `aikey-cross-app:team-base-url` holds the team server,
 * `aikey-cross-app:personal-base-url` holds the personal server. A reads the
 * team key, B reads the personal key. Correct as designed.
 *
 * B also carried a one-shot migration: "if the personal key is empty, copy the
 * team key into it". That was written on 2026-05-11, when A and B lived on
 * DIFFERENT origins and therefore had SEPARATE localStorage. On B's own origin,
 * a leftover `team-base-url` really did mean "the other side", so copying it
 * across was right.
 *
 * The 2026-07-03 composing gateway invalidated that premise: A and B are now
 * served from ONE origin and share ONE localStorage. On that shared store,
 * `team-base-url` is A's legitimate key holding the TEAM url. The forwarded B
 * page found its personal key empty, ran the migration, and permanently wrote
 * the TEAM url into `personal-base-url`. From then on B believed Personal lived
 * at the team server, cross-fetched there with no credentials, and every card
 * and chart on the forwarded Overview came back 401 / CORS-blocked — surfacing
 * to users as a silent "暂无数据".
 *
 * Measured before the fix: `/user/virtual-keys` → `/user/overview` produced
 * `401 http://127.0.0.1:3000/v1/usage/personal/*` and CORS-blocked
 * `/api/user/vault/*`. Correcting the poisoned key alone turned every request
 * same-origin and 200.
 *
 * ## The two rules that make it structurally impossible
 *
 * 1. **Under a composing gateway the peer IS this origin.** Not "probably", not
 *    "unless a cache says otherwise" — the gateway serves both sides from one
 *    origin by construction, so any stored absolute URL is at best redundant and
 *    at worst (as above) actively wrong. Stored values are not consulted at all.
 *    This is the same "use the explicit discriminator, never infer" discipline
 *    that `usageApiBase` / `teamGateway` already enforce for backend + identity.
 *
 * 2. **A peer URL may never be self-referential.** `peer === mine` and
 *    `peer === this origin` are both definitionally impossible for a two-sided
 *    pair. When observed, the value is poison: it is dropped AND deleted, so a
 *    browser that already stored a bad value heals itself on the next read
 *    rather than staying broken until someone clears site data by hand.
 */

export interface PeerResolutionInput {
  /** True when a composing gateway serves both sides from this origin. */
  gatewayActive: boolean;
  /**
   * Whether THIS side's peer is the one the gateway hosts locally.
   *
   * The pair is asymmetric and conflating the two sides is how the bug happened:
   *  - Team bundle (B): its peer is Personal, which IS the gateway host → true.
   *    Under a gateway the peer is literally this origin.
   *  - Personal bundle (A): its peer is the TEAM server, which stays remote even
   *    when the gateway forwards team ROUTES on this origin → false. A must also
   *    keep returning null when no team is configured, because its caller uses
   *    that as the "is there a team at all" visibility signal.
   */
  peerServedByThisOrigin: boolean;
  /** `window.location.origin` (no trailing slash). */
  currentOrigin: string;
  /** Cached value of the PEER side's key, if any. */
  storedPeer: string | null;
  /**
   * Cached value of THIS side's own key, if any. Only used to detect poison —
   * the peer can never equal it.
   */
  storedOwn: string | null;
  /**
   * Pre-2026-05-11 key this side used to read. Migrated forward ONLY when no
   * gateway is active: the migration's premise is per-origin isolation, which a
   * composing gateway removes.
   */
  storedLegacy?: string | null;
  /** Last resort when nothing usable is cached. Null = "unknown, hide the UI". */
  fallback: string | null;
}

export type PeerSource =
  | 'gateway-origin'   // rule 1
  | 'stored'
  | 'legacy-migrated'
  | 'fallback'
  | 'none';

export interface PeerResolution {
  /** Base URL of the other side, or null when genuinely unknown. */
  url: string | null;
  /** Which rule produced `url` — surfaced for logging and tests. */
  source: PeerSource;
  /** True when the peer key should be written with `url` (legacy migration). */
  persist: boolean;
  /** True when the stored peer value was poison and must be DELETED. */
  heal: boolean;
  /** Human-readable reason when something was rejected; for a WARN log. */
  rejected?: string;
}

const strip = (u: string) => u.trim().replace(/\/$/, '');

function usable(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const t = strip(raw);
  try {
    // eslint-disable-next-line no-new
    new URL(t);
    return t;
  } catch {
    return null;
  }
}

/**
 * Self-referential peers are impossible for a two-sided pair — see rule 2.
 *
 * `sameOriginIsValid` exists because the two halves of rule 2 have different
 * scopes, and conflating them deletes correct data: "peer === my own cached URL"
 * is always wrong, but "peer === this origin" is wrong ONLY without a gateway.
 * Under a composing gateway the peer legitimately IS this origin, so treating
 * that as poison would throw away the one correct value.
 */
function isPoison(
  peer: string,
  own: string | null,
  currentOrigin: string,
  sameOriginIsValid: boolean,
): string | null {
  if (own && strip(own) === peer) {
    return `peer equals this side's own base URL (${peer}) — one of the two cache keys was written with the wrong side`;
  }
  if (sameOriginIsValid) return null;
  try {
    if (new URL(peer).origin === strip(currentOrigin)) {
      return `peer resolves to this very origin (${peer}) outside a gateway — a side cannot be its own peer`;
    }
  } catch {
    /* unreachable: `usable` already parsed it */
  }
  return null;
}

export function resolveCrossAppPeer(input: PeerResolutionInput): PeerResolution {
  const { gatewayActive, peerServedByThisOrigin, currentOrigin, storedPeer, storedOwn, storedLegacy, fallback } = input;

  // Rule 1 — the gateway makes this a fact, not a guess. Deliberately BEFORE any
  // storage read: consulting the cache here is what produced the 401/CORS bug.
  if (gatewayActive && peerServedByThisOrigin) {
    const poisoned = usable(storedPeer);
    return {
      url: strip(currentOrigin),
      source: 'gateway-origin',
      persist: false,
      // Drop a poisoned leftover even though we no longer read it, so the bad
      // value cannot resurface through some other consumer.
      heal: !!(poisoned && isPoison(poisoned, storedOwn, currentOrigin, true)),
    };
  }

  const peer = usable(storedPeer);
  if (peer) {
    const bad = isPoison(peer, storedOwn, currentOrigin, false);
    if (!bad) return { url: peer, source: 'stored', persist: false, heal: false };
    // Poison: fall through to the fallback, and delete so we stop re-reading it.
    return { url: fallback ? strip(fallback) : null, source: fallback ? 'fallback' : 'none', persist: false, heal: true, rejected: bad };
  }

  // Legacy migration — only valid without a gateway (premise: separate origins).
  // Unreachable for a gateway-hosted peer: rule 1 returned above.
  const legacy = usable(storedLegacy);
  if (legacy) {
    const bad = isPoison(legacy, storedOwn, currentOrigin, false);
    if (!bad) return { url: legacy, source: 'legacy-migrated', persist: true, heal: false };
    return { url: fallback ? strip(fallback) : null, source: fallback ? 'fallback' : 'none', persist: false, heal: false, rejected: bad };
  }

  if (fallback) return { url: strip(fallback), source: 'fallback', persist: false, heal: false };
  return { url: null, source: 'none', persist: false, heal: false };
}
