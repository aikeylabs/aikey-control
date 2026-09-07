// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 🔴 The brand chip must paint from --brand-chip-*, never from --code-bg /
// --primary. Those two encode the DARK theme's intent (dark chip, amber glyph);
// painting with them renders a dark navy chip with blue letters on a white card
// once the light theme re-cuts the accent to Tencent blue.
//
// Why a fence and not just the fix: a token with a correct value and no reader
// is indistinguishable, from inside index.css, from a token nobody defined.
// Grepping the stylesheet finds --brand-chip-bg and says "handled". Only the
// consumer side can tell you it is dead, and the consumer side is a different
// file in a different language.
//
// 🔴 TWO COMPONENTS DRAW A CHIP — BrandMark (a CSS-in-JS div) and BrandLockup
// (an SVG). An earlier cut of this fence sliced ONE of them by comment text and
// checked the tokens with `includes()` over the whole file. A drill proved that
// vacuous: reverting BrandMark's glyph to var(--primary) left BrandLockup's
// occurrence behind, `includes()` still found it, and the fence stayed GREEN on
// a real regression. Both bodies are now checked separately, and the glyph rule
// below is counted rather than searched, so one surviving correct call site
// cannot cover for a broken one.
const R = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const SRC = R('src/shared/ui/BrandWordmark.tsx');
const CSS = R('src/index.css');

/** Body of a top-level exported function, delimited structurally, not by prose. */
function bodyOf(name: string): string {
  const start = SRC.indexOf(`export function ${name}(`);
  expect(start, `BrandWordmark.tsx no longer exports ${name} — re-anchor this fence`).toBeGreaterThan(-1);
  const after = SRC.indexOf('\nexport ', start + 1);
  return SRC.slice(start, after === -1 ? SRC.length : after);
}

describe('brand chip reads its own tokens', () => {
  const defined = [...new Set([...CSS.matchAll(/--brand-chip-([a-z-]+)\s*:/g)].map((m) => m[1]))];

  it('defines the chip tokens in the stylesheet at all', () => {
    expect(defined).toEqual(expect.arrayContaining(['bg', 'fg', 'border']));
  });

  // Counted, not searched: every place the AK glyph is drawn must use the chip's
  // foreground token. This is the assertion the previous cut got wrong.
  it('paints EVERY AK glyph with --brand-chip-fg', () => {
    const uses = SRC.match(/d=\{BRAND_AK_PATH\}/g) ?? [];
    const correct = SRC.match(/d=\{BRAND_AK_PATH\}\s+fill="var\(--brand-chip-fg\)"/g) ?? [];
    expect(uses.length, 'no BRAND_AK_PATH call sites found — re-anchor this fence').toBeGreaterThan(1);
    expect(correct.length, `${uses.length} AK glyph(s) drawn but only ${correct.length} painted with ` +
      `--brand-chip-fg. A second, correct call site does NOT cover for a broken one.`).toBe(uses.length);
  });

  for (const name of ['BrandMark', 'BrandLockup']) {
    it(`${name} paints its chip from the brand tokens`, () => {
      const body = bodyOf(name);
      for (const t of ['--brand-chip-bg', '--brand-chip-border', '--brand-chip-fg']) {
        expect(body.includes(`var(${t})`), `${name} never reads ${t}`).toBe(true);
      }
    });

    it(`${name} does not paint its chip with the dark theme's tokens`, () => {
      // Scoped to the lines that actually PAINT the chip, for two reasons the
      // drills surfaced: --primary is legitimate in this file (the wordmark's
      // i-dot sits on the page ground, not on the chip), and the recorded
      // rationale comments NAME the forbidden token, so prose would trip its own
      // fence — the same reason `lint-no-runtime-goos` excludes comments.
      const body = stripComments(bodyOf(name));
      const painting = body
        .split('\n')
        .filter((l) => /\b(background|border|boxShadow|fill|stroke|floodColor)\s*[:=]/.test(l))
        .filter((l) => !/WORDMARK|TAGLINE/.test(l));
      expect(painting.length, `found no chip-painting lines in ${name} — re-anchor this fence`).toBeGreaterThan(2);
      for (const line of painting) {
        for (const bad of ['var(--code-bg)', 'var(--primary)', 'var(--primary-rgb)', '#facc15']) {
          expect(line.includes(bad), `${name} paints the chip with ${bad}:\n    ${line.trim()}\n` +
            `The chip must use --brand-chip-* so it re-cuts with the theme.`).toBe(false);
        }
      }
    });
  }
});

/** Blank out // and /* *\/ comments, keeping newlines so slices stay aligned. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}
