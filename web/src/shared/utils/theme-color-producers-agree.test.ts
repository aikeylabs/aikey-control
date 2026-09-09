// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FENCE: every producer of `theme-color` agrees with `--background`.
 *
 * # Why this exists
 *
 * `<meta name="theme-color">` cannot take a `var()`. So the colour of the
 * browser/OS chrome around the page — the mobile address bar, the PWA title bar
 * — is a REAL HEX, hand-copied from `--background`, in THREE places:
 *
 *   1. `src/shared/utils/theme.ts`  THEME_COLOR, applied when the user picks
 *   2. `index.html`                 the boot script, applied before first paint
 *   3. `index.html`                 the media-keyed <meta> tags, the OS default
 *
 * A token has one definition; a hand-copied literal has as many as there are
 * copies, and they drift independently and silently. Measured 2026-09-05, after
 * two palette re-cuts: `--background` was `#f5f7fa`, while (1) and (2) still
 * said `#ecebe9` and (3) still said `#fcfaf7` — the warm value from a palette
 * that had been replaced twice. Nothing failed, because nothing compares them.
 * The address bar was simply painting a colour the page no longer used.
 *
 * 🔴 This is the same shape as the three defects of 2026-09-05 (grey header,
 * white scrim, missing aliases): a value with more than one producer, where
 * only one producer was maintained. The difference is that here the extra
 * producers are UNAVOIDABLE — a meta tag genuinely cannot read a CSS variable —
 * so the answer is not "remove the duplication" but "make the duplication
 * mechanically checked".
 *
 * # What is asserted
 *
 * `--background` on `:root` (dark) and under `[data-theme='light']` (light)
 * must equal the corresponding literal in all three producers.
 */

const WEB = process.cwd();
const CSS = path.resolve(WEB, 'src/index.css');
const THEME_TS = path.resolve(WEB, 'src/shared/utils/theme.ts');
const HTML = path.resolve(WEB, 'index.html');

/** `--background` inside the brace-balanced block that `selector` opens. */
function backgroundIn(css: string, selector: RegExp): string {
  const m = selector.exec(css);
  expect(m, `selector ${selector} not found in index.css`).not.toBeNull();
  let i = css.indexOf('{', m!.index);
  let depth = 1;
  let j = i + 1;
  while (depth > 0 && j < css.length) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}') depth -= 1;
    j += 1;
  }
  const body = css.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '');
  const hit = /--background\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(body);
  expect(hit, `--background not found under ${selector}`).not.toBeNull();
  return hit![1].toLowerCase();
}

describe('theme-color producers agree with --background', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  const ts = fs.readFileSync(THEME_TS, 'utf8');
  const html = fs.readFileSync(HTML, 'utf8');

  const darkBg = backgroundIn(css, /(?<![\w.\[-]):root\s*\{/);
  const lightBg = backgroundIn(css, /\[data-theme=['"]light['"]\]\s*\{/);

  it('THEME_COLOR in theme.ts matches', () => {
    const map = /const THEME_COLOR[\s\S]*?\{([\s\S]*?)\n\};/.exec(ts);
    expect(map, 'THEME_COLOR map not found in theme.ts').not.toBeNull();
    const body = map![1].replace(/\/\/[^\n]*/g, '');
    const light = /light\s*:\s*'(#[0-9a-fA-F]{3,8})'/.exec(body);
    const dark = /dark\s*:\s*'(#[0-9a-fA-F]{3,8})'/.exec(body);
    expect(light?.[1].toLowerCase(), 'THEME_COLOR.light drifted from --background').toBe(lightBg);
    expect(dark?.[1].toLowerCase(), 'THEME_COLOR.dark drifted from --background').toBe(darkBg);
  });

  it('the pre-paint boot script in index.html matches', () => {
    const boot = /theme === 'light' \? '(#[0-9a-fA-F]{3,8})' : '(#[0-9a-fA-F]{3,8})'/.exec(html);
    expect(boot, 'boot-script theme-color line not found in index.html').not.toBeNull();
    expect(boot![1].toLowerCase(), 'boot script light theme-color drifted').toBe(lightBg);
    expect(boot![2].toLowerCase(), 'boot script dark theme-color drifted').toBe(darkBg);
  });

  it('the media-keyed <meta> tags in index.html match', () => {
    const light = /<meta name="theme-color" content="(#[0-9a-fA-F]{3,8})" media="\(prefers-color-scheme: light\)"/.exec(html);
    const dark = /<meta name="theme-color" content="(#[0-9a-fA-F]{3,8})" media="\(prefers-color-scheme: dark\)"/.exec(html);
    expect(light, 'light media-keyed theme-color meta not found').not.toBeNull();
    expect(dark, 'dark media-keyed theme-color meta not found').not.toBeNull();
    expect(light![1].toLowerCase(), 'light <meta> theme-color drifted').toBe(lightBg);
    expect(dark![1].toLowerCase(), 'dark <meta> theme-color drifted').toBe(darkBg);
  });
});
