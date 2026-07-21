import { describe, it, expect } from 'vitest';
import { isLocalUsageScope } from './local-identity';
import type { RuntimeConfig } from '../../app/config/runtime';

// Four-quadrant fence for the usage-scope identity decision (2026-07-04).
// The bug: a gateway-forwarded TEAM page is authMode=local_bypass, so the old
// `authMode === 'local_bypass'` check made it query org_id=personal against the
// team server → empty team-usage-ledger. 能红: drop the `!teamGateway` gate and
// the "forwarded team page" case flips to true.
const base = (over: Partial<RuntimeConfig>): RuntimeConfig =>
  ({ authMode: 'jwt', ...over }) as RuntimeConfig;

describe('isLocalUsageScope — four deployment quadrants', () => {
  it('Personal local-server (local_bypass, no teamGateway) → LOCAL', () => {
    expect(isLocalUsageScope(base({ authMode: 'local_bypass' }))).toBe(true);
  });

  it('Trial single-binary (local_bypass, no teamGateway) → LOCAL', () => {
    // Same shape as Personal; unchanged by the fix.
    expect(isLocalUsageScope(base({ authMode: 'local_bypass' }))).toBe(true);
  });

  it('Gateway-forwarded TEAM page (local_bypass BUT teamGateway) → NOT local', () => {
    expect(
      isLocalUsageScope(base({ authMode: 'local_bypass', teamGateway: true })),
    ).toBe(false);
  });

  it('Direct team-server visit (jwt) → NOT local', () => {
    expect(isLocalUsageScope(base({ authMode: 'jwt' }))).toBe(false);
  });
});

// The seat-pending banner rides the same predicate, so the same four quadrants
// decide whether a member is told to go ask an administrator for a seat.
//
// 🔴 Found on Personal, 2026-07-21: `/accounts/me/seats` is a compatibility stub
// there and answers `200 null`. To the banner that is indistinguishable from a
// team server saying "you have no seat", so the first version told Personal
// users — who have no organizations, no administrators and no seats at all — to
// go and ask for one. Trial has the same stub and the same problem; only running
// it on Personal surfaced it.
//
// 能红: drop the `!isLocalUsageScope(runtimeConfig)` gate in SeatPendingBanner
// and the first two cases below flip to "banner shown".
describe('seat-pending banner visibility — same four quadrants', () => {
  const bannerShows = (cfg: RuntimeConfig) => !isLocalUsageScope(cfg);

  it('Personal → hidden (no seats exist in this edition)', () => {
    expect(bannerShows(base({ authMode: 'local_bypass' }))).toBe(false);
  });

  it('standalone Trial → hidden (same stub endpoint)', () => {
    expect(bannerShows(base({ authMode: 'local_bypass' }))).toBe(false);
  });

  it('gateway-forwarded TEAM page → SHOWN', () => {
    // 🚫 The reason not to gate on authMode alone: this quadrant is
    // local_bypass, and a raw authMode check would hide the notice from exactly
    // the members it exists for.
    expect(bannerShows(base({ authMode: 'local_bypass', teamGateway: true }))).toBe(true);
  });

  it('direct team-server visit → SHOWN', () => {
    expect(bannerShows(base({ authMode: 'jwt' }))).toBe(true);
  });
});
