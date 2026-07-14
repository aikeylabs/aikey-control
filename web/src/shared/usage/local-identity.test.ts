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
