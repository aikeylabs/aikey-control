import { describe, it, expect } from 'vitest';

import {
  bindingClientRoutes,
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
 * displayProtocolFamily maps the protocol to the `openai` Client Route so both
 * render in the Codex/OpenAI selection lane. Provider remains independent: Mock,
 * OpenAI and Zhipu can all speak openai_compatible without becoming each other.
 */
describe('displayProtocolFamily', () => {
  it('maps openai_compatible to the openai client route', () => {
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

  it('derives client routes only from binding.protocol', () => {
    expect(bindingClientRoutes(bindings, 'legacy-provider')).toEqual(['anthropic', 'openai']);
    expect(bindingClientRoutes([], 'openai_compatible')).toEqual(['openai']);
    expect(bindingClientRoutes([{ provider: 'mock' }])).toEqual([]);
  });

  it('keeps provider codes and aliases on the provider axis', () => {
    expect(bindingProviderCodes(bindings, 'anthropic')).toEqual(['mock']);
    expect(bindingProviderCodes(bindings, 'openai')).toEqual(['zhipu', 'mock']);
    expect(bindingProviderLabels(bindings, 'openai')).toEqual(['zhipu(GLM)', 'mock']);
  });
});
