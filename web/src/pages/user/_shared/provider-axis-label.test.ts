import { describe, it, expect } from 'vitest';

import { providerAxisLabel } from './provider-axis-label';

/**
 * Fence test for the Team-keys page's single provider-axis label.
 *
 * Bug it guards (alpha.9, real-machine 2026-07-21): the table row rendered
 * `zhipu(GLM)` while the detail drawer, two inches away on the same screen,
 * rendered a bare `zhipu` — one axis, two renderings. Cause: the drawer read the
 * binding's `provider_display_alias`, which the master NEVER populates (it has no
 * brand registry, the alias is web-owned), and fell through to the raw code. The
 * row cell went through the registry; the drawer did not.
 *
 * The fix was convergence, not another lookup: both surfaces call this function.
 * So the assertion that matters here is the LAST one — same input, same output,
 * whichever surface asks.
 */
describe('providerAxisLabel', () => {
  it('appends the brand alias from the generated registry', () => {
    expect(providerAxisLabel('zhipu')).toBe('zhipu(GLM)');
    expect(providerAxisLabel('anthropic')).toBe('anthropic(claude)');
  });

  it('resolves a concrete provider code to its family before labelling', () => {
    // The drawer receives binding.provider (a brand code); the row cell can also
    // see a model-ish code. Both must land on the same family label.
    expect(providerAxisLabel('ZHIPU')).toBe('zhipu(GLM)');
    expect(providerAxisLabel('  zhipu  ')).toBe('zhipu(GLM)');
  });

  it('falls back to the bare family when the registry has no alias', () => {
    // No alias registered → label is the family alone, never `x()`.
    const label = providerAxisLabel('kimi');
    expect(label).not.toMatch(/\(\s*\)/);
    expect(label.startsWith('kimi')).toBe(true);
  });

  it('handles empty / nullish without throwing', () => {
    expect(providerAxisLabel('')).toBe('');
    expect(providerAxisLabel(null)).toBe('');
    expect(providerAxisLabel(undefined)).toBe('');
    expect(providerAxisLabel('   ')).toBe('');
  });

  it('is the SINGLE source both surfaces use (the alpha.9 divergence)', () => {
    // Row cell path and drawer META path now reduce to the same call, so a
    // provider can no longer render two ways on one screen.
    for (const code of ['zhipu', 'anthropic', 'openai', 'kimi']) {
      expect(providerAxisLabel(code)).toBe(providerAxisLabel(code.toUpperCase()));
    }
  });
});
