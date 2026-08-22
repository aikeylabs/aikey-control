// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 🔴 The `.page-under-header` contract: which pages may cancel the shell's
 * top padding, and when.
 *
 * ## The effect this exists for (2026-08-18 user decision A)
 *
 * The personal console's header is an overlay with `backdrop-filter`, so the
 * frosted effect only exists when page content physically scrolls BENEATH it.
 * Pages built as `h-full` with their own inner scroll region are the exception
 * the shell cannot handle alone: their scroller starts at the shell's padding
 * edge, 64px below the bar, so nothing ever passes under it and the header
 * renders as flat colour. `index.css` lifts such a page back under the bar and
 * hands the 64px back inside the page's own scroller.
 *
 * ## The two ways that lift went wrong (2026-08-22)
 *
 * The first version keyed off `.vault-page` alone. That class means two
 * different things in this codebase, and the rule caught both:
 *
 *  - `/user/access-tokens` wears `.vault-page` as a pure SKIN class (shared
 *    table / chip / drawer styles) and has NO inner scroller. It got lifted
 *    64px with nothing to hand the space back, so its page title sat behind
 *    the header — silently, for four days.
 *  - `/user/vault` got lifted ON TOP of the shell's DataFetchErrorBanner. The
 *    page is only at the padding edge while no banner renders; the moment a
 *    read failed, the banner appeared and the page was dragged over it. The
 *    user saw the error banner and the page's own error line printed through
 *    each other — illegible, at the exact moment something was already broken.
 *
 * So the rule now carries BOTH preconditions in its selector: an explicit
 * opt-in class (a skin class must not imply a layout contract) and
 * `:first-child` (nothing above me right now). This fence keeps them there,
 * and keeps pages on the correct side of the opt-in.
 *
 * None of this is visible to tsc, to `vite build`, or to any unit test — only
 * to an eye. The behavioural proof lives in the browser probe:
 * `make -f workflow/CI/Makefile e2e-error-banner-overlap`.
 *
 * See workflow/CI/bugfix/20260822-vault-page-pullup-covers-error-banner.md.
 */
describe('🔴 glass header ↔ self-scrolling page contract', () => {
  const pagesDir = path.resolve(__dirname, '../../pages/user');
  const cssPath = path.resolve(__dirname, '../../index.css');
  // Same anchor the other mirror fences use: vitest runs with cwd = web/.
  const masterCss = path.resolve(process.cwd(), '../../aikey-control-master/web/src/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const pages = fs
    .readdirSync(pagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pagesDir, d.name, 'index.tsx'))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ file: f, src: fs.readFileSync(f, 'utf8') }));

  // A page "owns its scroller" when its root is the full-height vault-page
  // shell — that is the shape the CSS rule targets.
  const pagesOwningTheirScroller = pages.filter(({ src }) =>
    /className="vault-page[^"]*h-full/.test(src),
  );

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
          '`flex-1 overflow-y-auto` element (see index.css).',
      ).toBe(true);
    },
  );

  it.each(pagesOwningTheirScroller.map(({ file, src }) => [path.relative(pagesDir, file), src]))(
    '%s opts into page-under-header',
    (_rel, src) => {
      expect(
        (src as string).includes('vault-page page-under-header'),
        'this page owns its scroller but never opts in, so it now starts 64px ' +
          'below the header and the glass has nothing to blur. Add ' +
          '`page-under-header` right after `vault-page` on the page root.',
      ).toBe(true);
    },
  );

  it('pages that only borrow the vault SKIN never opt in', () => {
    const wrong = pages
      .filter(({ src }) => src.includes('vault-page page-under-header'))
      .filter(({ src }) => !src.includes('vault-page-scroll'))
      .map(({ file }) => path.relative(pagesDir, file));
    expect(
      wrong,
      `${wrong.join(', ')}: opts into page-under-header but renders no ` +
        '.vault-page-scroll, so the 64px lift is never handed back and this ' +
        "page's own title ends up behind the header (the /user/access-tokens bug).",
    ).toEqual([]);
  });

  it('index.css gates the lift on BOTH preconditions', () => {
    expect(css).toContain('.user-pages .vault-page.page-under-header:first-child {');
    // The naked form is what broke two pages. It must not come back.
    expect(css).not.toContain('.user-pages .vault-page {');
    expect(css).not.toContain('.user-pages .vault-page-scroll {');
    expect(css).toMatch(
      /\.user-pages \.vault-page\.page-under-header:first-child \{[^}]*margin-top:\s*-4rem/,
    );
  });

  it('the lift and the give-back stay under the same condition', () => {
    // Separate them and a page that was NOT lifted keeps 4rem of padding,
    // opening a 64px hole at the top of its content.
    expect(css).toMatch(
      /\.user-pages \.vault-page\.page-under-header:first-child \.vault-page-scroll \{[^}]*padding-top:\s*4rem/,
    );
  });

  it('index.css stays byte-identical in the master mirror', () => {
    expect(fs.existsSync(masterCss), 'master mirror missing').toBe(true);
    expect(fs.readFileSync(masterCss, 'utf8')).toBe(css);
  });
});
