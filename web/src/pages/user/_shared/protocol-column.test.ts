import { describe, it, expect } from 'vitest';
import { protocolColumn } from './protocol-column';

describe('protocolColumn', () => {
  it('renders a single-protocol key unchanged, with no hint', () => {
    expect(protocolColumn(['anthropic'], 'anthropic', 'anthropic')).toEqual({
      primary: 'anthropic',
      extraCount: 0,
    });
  });

  it('collapses a two-protocol key to the group protocol + (+1)', () => {
    // The exact case from the reported screenshot: one VK bound to both an
    // anthropic and an openai credential, previously printed "anthropic, openai".
    expect(protocolColumn(['anthropic', 'openai'], 'openai', 'anthropic')).toEqual({
      primary: 'openai',
      extraCount: 1,
    });
  });

  it('leads with THIS row\'s group, not the key\'s first protocol', () => {
    // Regression guard: the openai row of an anthropic+openai key must not
    // announce itself as "anthropic".
    const { primary } = protocolColumn(['anthropic', 'openai'], 'openai', 'anthropic');
    expect(primary).toBe('openai');
  });

  it('counts every extra protocol beyond the primary', () => {
    expect(protocolColumn(['anthropic', 'openai', 'gemini'], 'anthropic', 'x')).toEqual({
      primary: 'anthropic',
      extraCount: 2,
    });
  });

  it('falls back to the first protocol when the group is not among them', () => {
    expect(protocolColumn(['anthropic', 'openai'], 'gemini', 'x')).toEqual({
      primary: 'anthropic',
      extraCount: 1,
    });
  });

  it('falls back to the provider name when there are no protocols at all', () => {
    // Legacy CLI payloads carry no bindings — must not render an empty cell.
    expect(protocolColumn([], 'anthropic', 'zhipu')).toEqual({
      primary: 'zhipu',
      extraCount: 0,
    });
  });

  it('ignores empty protocol entries rather than counting them as "more"', () => {
    expect(protocolColumn(['anthropic', ''], 'anthropic', 'x')).toEqual({
      primary: 'anthropic',
      extraCount: 0,
    });
  });
});
