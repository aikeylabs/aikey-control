import { describe, it, expect } from 'vitest';

import {
  bindingProtocolFamilies,
  bindingProviderCodes,
  bindingProviderLabels,
  displayProtocolFamily,
} from './protocolFamily';

/**
 * Fence test for the shared protocol-family display normalization used by BOTH the
 * Vault page and the Team-keys page.
 *
 * Bug it guards (2026-07-06): two OAuth pools of the SAME provider rendered under
 * two different "协议" labels. A codex pool WITH a routed account resolved to the
 * account's provider_code → "openai"; the SAME kind of pool with NO routed account
 * fell back to the group VK's raw binding protocol_type → "openai_compatible".
 * displayProtocolFamily folds the protocol name to the provider so both render as
 * "openai" — a pool looks identical regardless of routed-account state, and the two
 * key pages stay consistent (single source).
 *
 * Constraint baked in: OAuth pools are anthropic / openai only (R34), so an
 * openai_compatible POOL is unambiguously openai. If a non-openai openai_compatible
 * provider ever becomes poolable, this mapping (and the test) must be revisited.
 */
describe('displayProtocolFamily', () => {
  it('folds the openai_compatible protocol to the openai provider family', () => {
    expect(displayProtocolFamily('openai_compatible')).toBe('openai');
    expect(displayProtocolFamily('  OpenAI_Compatible ')).toBe('openai');
  });

  it('passes other families through unchanged (anthropic pools must NOT move)', () => {
    expect(displayProtocolFamily('anthropic')).toBe('anthropic');
    expect(displayProtocolFamily('openai')).toBe('openai');
    expect(displayProtocolFamily('kimi')).toBe('kimi');
  });

  it('handles empty / nullish without throwing', () => {
    expect(displayProtocolFamily('')).toBe('');
    expect(displayProtocolFamily(null)).toBe('');
    expect(displayProtocolFamily(undefined)).toBe('');
  });
});

describe('two-axis binding presentation', () => {
  const bindings = [
    { protocol: 'anthropic', provider: 'mock', provider_display_alias: '' },
    { protocol: 'openai_compatible', provider: 'zhipu', provider_display_alias: 'GLM' },
    { protocol: 'openai_compatible', provider: 'mock', provider_display_alias: '' },
  ];

  it('derives protocol groups only from binding.protocol', () => {
    expect(bindingProtocolFamilies(bindings, 'legacy-provider')).toEqual(['anthropic', 'openai']);
    expect(bindingProtocolFamilies([], 'openai_compatible')).toEqual(['openai']);
    expect(bindingProtocolFamilies([{ provider: 'mock' }])).toEqual([]);
  });

  it('keeps provider codes and aliases on the provider axis', () => {
    expect(bindingProviderCodes(bindings, 'anthropic')).toEqual(['mock']);
    expect(bindingProviderCodes(bindings, 'openai')).toEqual(['zhipu', 'mock']);
    expect(bindingProviderLabels(bindings, 'openai')).toEqual(['zhipu(GLM)', 'mock']);
  });
});
