import { describe, expect, it } from 'vitest';
import { sessionKeyProviderKind, supportsSessionKeyLogin } from './session-key-capability';

describe('Session Key provider capability', () => {
  it.each([
    ['anthropic', 'anthropic', 'claude'],
    ['anthropic', '', 'claude'],
    ['openai', 'openai_compatible', 'codex'],
    ['openai', '', 'codex'],
    ['mock', 'anthropic', 'claude'],
    ['mock', 'openai_compatible', 'codex'],
    ['mock', '', null],
    ['openai', 'anthropic', null],
    ['other', 'openai_compatible', null],
  ])('provider=%s protocol=%s -> %s', (provider, protocol, expected) => {
    expect(sessionKeyProviderKind(provider, protocol)).toBe(expected);
    expect(supportsSessionKeyLogin(provider, protocol)).toBe(expected !== null);
  });
});
