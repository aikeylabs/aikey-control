import { describe, it, expect } from 'vitest';

import { providerEmphasis } from './provider-emphasis';

/**
 * Fence for the drawer PROVIDER field's emphasis.
 *
 * Bug it guards (2026-07-22, damon spotted it in a screenshot: "why is
 * zhipu(GLM) greyed out?"): the field bolded whichever provider string equalled
 * `groupFamily`. Since 1f.8 that value carries the PROTOCOL, so the comparison
 * was provider-vs-protocol. It could only ever match on a homonym — Anthropic's
 * provider code happens to be spelled like the anthropic wire protocol — so
 * `anthropic(claude)` went bold by accident and EVERY other provider was greyed
 * with no input able to change it. The two bindings are peers; what ranks them
 * is the summary's fallback_role.
 *
 * The decisive case is `zhipu primary` below: under the old rule zhipu could
 * never be bold on an anthropic-protocol row. Note that the key damon was
 * looking at (anthropic primary) renders IDENTICALLY before and after — which
 * is exactly why this is a test and not a screenshot.
 */
const summary = (targets: { provider_code: string; fallback_role: string }[]) => ({
  virtual_key_id: 'vk', org_id: 'o', seat_id: 's', alias: 'a',
  current_revision: 'r', key_status: 'active', share_status: 'claimed',
  slots: [{
    protocol_type: 'anthropic',
    targets: targets.map((t, i) => ({
      binding_id: `b${i}`, provider_id: `p${i}`, base_url: '', priority: i + 1, ...t,
    })),
  }],
}) as never;

describe('providerEmphasis', () => {
  it('bolds the protocol PRIMARY, mutes the fallback', () => {
    const s = summary([
      { provider_code: 'anthropic', fallback_role: 'primary' },
      { provider_code: 'zhipu', fallback_role: 'fallback' },
    ]);
    expect(providerEmphasis('anthropic', 'anthropic', s)).toBe('primary');
    expect(providerEmphasis('zhipu', 'anthropic', s)).toBe('fallback');
  });

  it('bolds a NON-homonym primary — the case the old rule could never render', () => {
    // zhipu is primary on an anthropic-protocol row. The old rule compared
    // "zhipu" === "anthropic" and greyed it no matter what the routing said.
    const s = summary([
      { provider_code: 'zhipu', fallback_role: 'primary' },
      { provider_code: 'anthropic', fallback_role: 'fallback' },
    ]);
    expect(providerEmphasis('zhipu', 'anthropic', s)).toBe('primary');
    expect(providerEmphasis('anthropic', 'anthropic', s)).toBe('fallback');
  });

  it('emphasises nothing while the summary is unknown', () => {
    expect(providerEmphasis('zhipu', 'anthropic', null)).toBe('unknown');
    expect(providerEmphasis('zhipu', 'anthropic', undefined)).toBe('unknown');
    // server predates the contract / slot for another protocol only
    expect(providerEmphasis('zhipu', 'anthropic', summary([]))).toBe('unknown');
    expect(providerEmphasis('kimi', 'anthropic', summary([
      { provider_code: 'zhipu', fallback_role: 'primary' },
    ]))).toBe('unknown');
  });

  it('matches the slot by protocol, not by position', () => {
    const s = {
      slots: [
        { protocol_type: 'openai', targets: [{ binding_id: 'x', provider_id: 'x', provider_code: 'zhipu', base_url: '', priority: 1, fallback_role: 'primary' }] },
        { protocol_type: 'anthropic', targets: [{ binding_id: 'y', provider_id: 'y', provider_code: 'zhipu', base_url: '', priority: 2, fallback_role: 'fallback' }] },
      ],
    } as never;
    expect(providerEmphasis('zhipu', 'anthropic', s)).toBe('fallback');
    expect(providerEmphasis('zhipu', 'openai', s)).toBe('primary');
  });
});
