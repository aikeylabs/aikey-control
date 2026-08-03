import { describe, it, expect } from 'vitest';

import { laneOrderIsDefined, providerCells } from './provider-order';

/**
 * Fence for the key list's PROVIDER cell.
 *
 * Bug it closes (damon, 2026-08-02, looking at a row that read
 * "openai(codex), zhipu(GLM), deepseek"): "there are 3 listed, how do I know
 * which provider the virtual key is currently using?" — the answer was in the
 * cell all along, because the server emits bindings `ORDER BY protocol_type,
 * priority ASC`, but a comma-separated list reads as a SET. The order was load-
 * bearing and invisible.
 *
 * 🔴 The interesting cases are the two where the honest answer is NOT "the first
 * one": a lane whose hops share a priority (no upstream is first), and a payload
 * from a server that never sent the order fields (nothing is known).
 */
const b = (
  provider: string,
  extra: Partial<{ protocol: string; priority: number; fallback_role: string; alias: string }> = {},
) => ({
  protocol: extra.protocol ?? 'anthropic',
  provider,
  provider_display_alias: extra.alias ?? '',
  priority: extra.priority,
  fallback_role: extra.fallback_role,
});

describe('providerCells', () => {
  it('names the primary and numbers the fallbacks behind it', () => {
    const cells = providerCells(
      [
        b('anthropic', { priority: 1, fallback_role: 'primary', alias: 'claude' }),
        b('zhipu', { priority: 2, fallback_role: 'fallback', alias: 'GLM' }),
        b('deepseek', { priority: 3, fallback_role: 'fallback' }),
      ],
      'anthropic',
    );
    expect(cells.map((c) => [c.label, c.role, c.fallbackIndex])).toEqual([
      ['anthropic(claude)', 'primary', 0],
      ['zhipu(GLM)', 'fallback', 1],
      ['deepseek', 'fallback', 2],
    ]);
    expect(laneOrderIsDefined(cells)).toBe(true);
  });

  it('🔴 two hops at ONE priority are tied — neither is called the primary', () => {
    // Reachable through the normal write path: AddBindingToVirtualKey defaults an
    // omitted priority to 1 and nothing rejects a second primary, so the runtime's
    // `ORDER BY priority ASC` ties and the database decides. Printing "primary" on
    // whichever row arrived first would answer a question that has no answer.
    const cells = providerCells(
      [
        b('anthropic', { priority: 1, fallback_role: 'primary' }),
        b('zhipu', { priority: 1, fallback_role: 'primary' }),
      ],
      'anthropic',
    );
    expect(cells.map((c) => c.role)).toEqual(['tied', 'tied']);
    expect(laneOrderIsDefined(cells)).toBe(false);
  });

  it('🔴 an OLDER SERVER without the order fields gets NO chips, not a made-up primary', () => {
    const cells = providerCells([b('anthropic'), b('zhipu')], 'anthropic');
    expect(cells.map((c) => c.role)).toEqual(['unknown', 'unknown']);
    // Still ordered as delivered — the labels are unchanged, only unlabelled.
    expect(cells.map((c) => c.label)).toEqual(['anthropic', 'zhipu']);
  });

  it('shows only the lane it was asked for', () => {
    // A multi-protocol VK renders one row per Client Route, and the row must not
    // list the other lane's providers — that is the bug the clientRoute argument
    // was added for in the first place.
    const bindings = [
      b('anthropic', { priority: 1, fallback_role: 'primary' }),
      b('openai', { protocol: 'openai_compatible', priority: 1, fallback_role: 'primary' }),
    ];
    expect(providerCells(bindings, 'anthropic').map((c) => c.label)).toEqual(['anthropic']);
    expect(providerCells(bindings, 'openai').map((c) => c.label)).toEqual(['openai']);
  });

  it('🚫 does not re-sort what the server sent', () => {
    // Re-sorting would quietly repair a payload that arrived out of order, and the
    // one thing this cell exists to show — the order actually in force — would go
    // back to being unverifiable from the screen.
    const cells = providerCells(
      [
        b('zhipu', { priority: 2, fallback_role: 'fallback' }),
        b('anthropic', { priority: 1, fallback_role: 'primary' }),
      ],
      'anthropic',
    );
    expect(cells.map((c) => c.label)).toEqual(['zhipu', 'anthropic']);
  });

  it('is empty for a payload with no bindings, so the cell can fall back', () => {
    expect(providerCells(undefined, 'anthropic')).toEqual([]);
    expect(providerCells([], 'anthropic')).toEqual([]);
  });
});
