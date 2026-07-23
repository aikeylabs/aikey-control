import { describe, expect, it } from 'vitest';

import { normalizeProtocol, protocolsOf } from './protocol-axis';

describe('normalizeProtocol', () => {
  it('leaves a real protocol code alone', () => {
    expect(normalizeProtocol('anthropic')).toBe('anthropic');
    expect(normalizeProtocol('  OpenAI_Compatible ')).toBe('openai_compatible');
  });

  // The regression this module exists for: the Team Keys page ran binding
  // protocols through displayProtocolFamily, which folds openai_compatible to
  // the PROVIDER name `openai` — so the PROTOCOL column said `openai` while
  // `aikey list` said `openai_compatible` for the very same key.
  it('does NOT fold openai_compatible to the openai provider', () => {
    expect(normalizeProtocol('openai_compatible')).toBe('openai_compatible');
    expect(normalizeProtocol('openai_compatible')).not.toBe('openai');
  });

  it('is empty-safe', () => {
    expect(normalizeProtocol(null)).toBe('');
    expect(normalizeProtocol(undefined)).toBe('');
    expect(normalizeProtocol('   ')).toBe('');
  });
});

describe('protocolsOf', () => {
  it('returns every protocol a multi-protocol VK speaks, in binding order', () => {
    // one provider (zhipu) carrying two protocols — the case the page used to
    // render exactly once, under whichever protocol the VK-level scalar held
    expect(
      protocolsOf([{ protocol: 'anthropic' }, { protocol: 'openai_compatible' }]),
    ).toEqual(['anthropic', 'openai_compatible']);
  });

  it('preserves binding order rather than sorting — that is what keeps the "+N more" head in sync with aikey list', () => {
    expect(
      protocolsOf([{ protocol: 'openai_compatible' }, { protocol: 'anthropic' }]),
    ).toEqual(['openai_compatible', 'anthropic']);
  });

  it('de-duplicates two providers bound under one protocol', () => {
    expect(
      protocolsOf([{ protocol: 'anthropic' }, { protocol: 'anthropic' }]),
    ).toEqual(['anthropic']);
  });

  it('falls back to the legacy scalar only when bindings are absent', () => {
    expect(protocolsOf([], 'anthropic')).toEqual(['anthropic']);
    expect(protocolsOf(null, 'anthropic')).toEqual(['anthropic']);
    // present bindings always win over the legacy hint
    expect(protocolsOf([{ protocol: 'openai_compatible' }], 'anthropic')).toEqual([
      'openai_compatible',
    ]);
  });

  it('falls back again to the caller-supplied family, then to empty', () => {
    expect(protocolsOf([], '', 'anthropic')).toEqual(['anthropic']);
    expect(protocolsOf([], '', '')).toEqual([]);
  });

  it('skips blank binding protocols', () => {
    expect(protocolsOf([{ protocol: '' }, { protocol: 'anthropic' }])).toEqual([
      'anthropic',
    ]);
  });
});
