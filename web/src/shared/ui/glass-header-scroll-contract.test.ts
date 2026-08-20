// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The personal console's header is an overlay with `backdrop-filter`, so the
 * frosted effect only exists when page content physically scrolls BENEATH it
 * (2026-08-18 user decision A).
 *
 * Pages built as `h-full` with their own inner scroll region are the exception
 * the shell cannot handle alone: their scroller starts at the shell's padding
 * edge, 64px below the bar, so nothing ever passes under it and the header
 * renders as flat colour. `index.css` lifts such a page back under the bar via
 * `.user-pages .vault-page` and hands the offset back through
 * `.user-pages .vault-page-scroll`.
 *
 * That is a TWO-PART contract split across a stylesheet and a page: drop the
 * class in the page and the CSS silently does nothing — the page keeps working,
 * it just quietly loses the effect, with no error anywhere. Reported exactly
 * once already (/user/vault, /user/virtual-keys, /user/team-oauth showed no
 * glass after the shell change). This fence is the machine check that keeps the
 * two halves together.
 */
describe('🔴 glass header ↔ self-scrolling page contract', () => {
  const pagesDir = path.resolve(__dirname, '../../pages/user');

  const pagesOwningTheirScroller = fs
    .readdirSync(pagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pagesDir, d.name, 'index.tsx'))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ file: f, src: fs.readFileSync(f, 'utf8') }))
    // A page "owns its scroller" when its root is the full-height vault-page
    // shell — that is the shape the CSS rule targets.
    .filter(({ src }) => /className="vault-page[^"]*h-full/.test(src));

  it('finds the pages this contract is about (guards against a vacuous fence)', () => {
    expect(pagesOwningTheirScroller.length).toBeGreaterThanOrEqual(3);
  });

  it.each(pagesOwningTheirScroller.map(({ file, src }) => [path.relative(pagesDir, file), src]))(
    '%s marks its scroll region with vault-page-scroll',
    (_rel, src) => {
      expect(
        (src as string).includes('vault-page-scroll'),
        'this page owns its scroll region but does not declare it, so the header ' +
          'glass has nothing to blur on this page. Add `vault-page-scroll` to the ' +
          '`flex-1 overflow-y-auto` element (see .user-pages .vault-page-scroll in index.css).',
      ).toBe(true);
    },
  );

  it('index.css still carries both halves of the lift', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
    expect(css).toContain('.user-pages .vault-page {');
    expect(css).toContain('.user-pages .vault-page-scroll {');
    // The lift and the give-back must agree, or content lands under the bar.
    expect(css).toMatch(/\.user-pages \.vault-page \{[^}]*margin-top:\s*-4rem/);
    expect(css).toMatch(/\.user-pages \.vault-page-scroll \{[^}]*padding-top:\s*4rem/);
  });
});
