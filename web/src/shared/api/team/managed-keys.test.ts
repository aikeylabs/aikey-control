import { describe, it, expect } from 'vitest';
import { __testInternals } from './managed-keys';
import type { TeamVaultRecord } from '../../types/team-vault';

const { rawToTeamRecord } = __testInternals;

describe('rawToTeamRecord', () => {
  it('canonical happy path: protocol_type → protocol_family lowercase', () => {
    const r = rawToTeamRecord({
      virtual_key_id: 'vk_1',
      alias: 'key-foo',
      protocol_type: 'Anthropic',
      supported_providers: ['anthropic'],
      share_status: 'claimed',
      effective_status: 'active',
    });
    expect(r).toMatchObject<Partial<TeamVaultRecord>>({
      target: 'team',
      virtual_key_id: 'vk_1',
      alias: 'key-foo',
      protocol_family: 'anthropic',
      supported_providers: ['anthropic'],
      share_status: 'claimed',
      effective_status: 'active',
    });
  });

  it('falls back to provider_code when protocol_type missing', () => {
    const r = rawToTeamRecord({
      virtual_key_id: 'vk_2',
      alias: 'k',
      provider_code: 'KIMI',
    });
    expect(r.protocol_family).toBe('kimi');
    // supported_providers defaults to [provider_code] when array missing
    expect(r.supported_providers).toEqual(['KIMI']);
  });

  it('defaults to "unknown" protocol_family when nothing identifies it', () => {
    const r = rawToTeamRecord({ virtual_key_id: 'vk_3', alias: 'k' });
    expect(r.protocol_family).toBe('unknown');
    expect(r.supported_providers).toEqual([]);
  });

  it('derives effective_status from key_status + share_status when missing', () => {
    // key_status=active + share_status=claimed → active
    expect(
      rawToTeamRecord({
        virtual_key_id: 'a',
        alias: 'x',
        key_status: 'active',
        share_status: 'claimed',
      }).effective_status,
    ).toBe('active');
    // key_status=revoked → inactive (claimed alone isn't enough)
    expect(
      rawToTeamRecord({
        virtual_key_id: 'a',
        alias: 'x',
        key_status: 'revoked',
        share_status: 'claimed',
      }).effective_status,
    ).toBe('inactive');
  });

  it('coerces unexpected share_status to "claimed" (defensive)', () => {
    // Future B-side schema additions shouldn't blow up A's parser.
    // RawTeamKey.share_status is typed as `string` (tolerant parser),
    // so this passes type-check directly — the assertion lives in the
    // expectation below, which proves the parser folds unknown values
    // back to the safe default.
    const r = rawToTeamRecord({
      virtual_key_id: 'a',
      alias: 'x',
      share_status: 'expired-future-value',
    });
    expect(r.share_status).toBe('claimed');
  });

  it('preserves expires_at when present, undefined when absent', () => {
    expect(
      rawToTeamRecord({ virtual_key_id: 'a', alias: 'x', expires_at: '2027-01-01T00:00:00Z' })
        .expires_at,
    ).toBe('2027-01-01T00:00:00Z');
    expect(
      rawToTeamRecord({ virtual_key_id: 'a', alias: 'x' }).expires_at,
    ).toBeUndefined();
  });

  it('always emits target="team" discriminator', () => {
    const r = rawToTeamRecord({ virtual_key_id: 'a', alias: 'x' });
    expect(r.target).toBe('team');
  });
});
