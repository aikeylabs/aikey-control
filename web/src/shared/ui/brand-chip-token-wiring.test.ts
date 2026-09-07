// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 🔴 2026-09-07. The light theme defined --brand-chip-bg:#0052d9 and
// --brand-chip-fg:#ffffff — the correct Tencent-blue lockup, the same one the
// tray panel's `.mark` draws — and NOTHING READ THEM. BrandWordmark.tsx was
// hard-wired to --code-bg and --primary, which encode the DARK theme's intent
// (dark chip, amber glyph). In light that rendered a dark navy chip with blue
// letters on a white card: not the brand, and not what any token said it
// should be. Reported by the user as "this icon is not the tencent blue icon
// we used as well."
//
// Why a fence and not just a fix: a token with a correct value and no reader is
// indistinguishable, from inside the stylesheet, from a token nobody defined.
// Grepping index.css finds --brand-chip-bg and says "handled". Only the
// consumer side can tell you it is dead, and the consumer side is a different
// file in a different language. That asymmetry is what let this sit.
//
// 能红: change any of the three fills back to var(--primary) / var(--code-bg).
const R = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');

describe('brand chip reads its own tokens', () => {
  const SRC = R('src/shared/ui/BrandWordmark.tsx');
  const CSS = R('src/index.css');

  // Every --brand-chip-* the stylesheet defines must have a reader. Derived from
  // the CSS rather than hand-listed: a token added to the palette and never
  // wired is exactly the failure this exists to catch, and a hand-kept list
  // would not have it.
  const defined = [...new Set([...CSS.matchAll(/--brand-chip-([a-z-]+)\s*:/g)].map((m) => m[1]))];

  it('defines the chip tokens in the stylesheet at all', () => {
    expect(defined).toEqual(expect.arrayContaining(['bg', 'fg', 'border']));
  });

  for (const name of ['bg', 'fg', 'border']) {
    it(`BrandWordmark consumes --brand-chip-${name}`, () => {
      expect(
        SRC.includes(`var(--brand-chip-${name})`),
        `BrandWordmark.tsx never reads --brand-chip-${name}. The palette sets it per theme; ` +
          `if the component paints with --primary or --code-bg instead, the chip silently ` +
          `renders the DARK intent in the light theme.`,
      ).toBe(true);
    });
  }

  it('does not paint the chip with the dark theme\'s tokens', () => {
    const chip = SRC.slice(SRC.indexOf('Chip box'), SRC.indexOf('wordmark + accent i-dot'));
    for (const token of ['var(--code-bg)', 'var(--primary)']) {
      expect(
        chip.includes(token),
        `The chip block still paints with ${token}. Those encode the dark theme's intent ` +
          `(dark chip, amber glyph); the light theme needs the blue-fill/white-glyph lockup ` +
          `that --brand-chip-* already carries.`,
      ).toBe(false);
    }
  });
});
