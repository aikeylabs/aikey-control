// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { maskComments } from './source-scan-mask';

/**
 * FENCE: a full-screen overlay may not be painted with a SURFACE token.
 *
 * # Why this exists
 *
 * User report, 2026-09-05: "why opening right side details, the left side is all
 * white on the light theme". Opening any detail drawer covered the entire page
 * in opaque white.
 *
 * `DetailDrawer`'s backdrop was:
 *
 *     <div className="fixed inset-0" style={{ backgroundColor: 'var(--overlay-sink)' }} />
 *
 * `--overlay-sink` is `rgba(0,0,0,0.2)` in dark — a correct 20% scrim — and
 * `#ffffff` in light. The light value is right for what that token is FOR
 * there: sink overlays tint table headers and card strips, and light-mode
 * tables are pure white, so the token resolves to a deliberate no-op. Used as a
 * `fixed inset-0` backdrop, that same no-op becomes "paint the whole page
 * white".
 *
 * # The general shape
 *
 * A colour token carries a ROLE, and the role is what decides its light value.
 * Surface tokens answer "what colour is this panel"; scrim tokens answer "how
 * much do I darken everything behind this dialog". Those two answers diverge the
 * moment a second palette exists — in dark they were both "a dark translucent
 * thing" and the mix-up was invisible for as long as there was one palette.
 *
 * 🔴 The discriminator is `position: fixed` + `inset: 0`, NOT the alpha value. A
 * previous pass tried to classify by alpha (>= 0.4 means scrim) and misfiled six
 * genuine BACKGROUNDS as overlays while missing a real scrim that used a low
 * alpha. Geometry is the only reliable signal.
 *
 * # The fix is always the same one line
 *
 *     var(--overlay-sink)  →  rgba(var(--scrim-rgb), 0.2)
 *
 * `--scrim-rgb` is `0, 0, 0` in BOTH themes, deliberately: a modal backdrop
 * darkens in light mode too. At alpha 0.2 that is byte-identical to the dark
 * value being replaced, so the fix is a no-op in dark.
 *
 * Spec: roadmap20260320/技术实现/update/20260905-控制台浅色主题改冷色调靛紫强调.md
 */

/** Tokens that describe a SURFACE. None of them may paint a full-screen overlay. */
const SURFACE_TOKENS = [
  '--overlay-sink',
  '--overlay-sink-strong',
  '--overlay-faint',
  '--overlay-hover',
  '--overlay-raise',
  '--overlay-active',
  '--card',
  '--background',
  '--canvas',
  '--surface-sunken',
  '--surface-raised',
  '--surface-inset',
  '--input-well',
];

const BG_ASSIGN = new RegExp(
  `background(?:Color)?\\s*:\\s*'?(?:var\\((${SURFACE_TOKENS.map((t) => t.replace(/-/g, '\\-')).join('|')})\\)|rgba\\(var\\(--sink-rgb\\)[^)]*\\))`,
  'g',
);

/**
 * 🔴 The geometry must be on the SAME ELEMENT as the background, not merely
 * nearby. A first version used a 6-line lookback and produced eight false
 * positives, every one of them the same shape: a transparent `fixed inset-0`
 * backdrop immediately followed by the DIALOG PANEL, whose own background is
 * legitimately `var(--card)`. The panel is `fixed left-1/2 top-1/2` — fixed but
 * not inset-0 — so line proximity, not the rule, was doing the accusing.
 *
 * So the window is the enclosing JSX opening tag (`<div … >`), or, when the
 * match is not inside one, the enclosing CSS rule body for the CSS-in-JS
 * template literals.
 */

const SRC = path.resolve(process.cwd(), 'src');
const SELF = path.resolve(SRC, 'shared/utils/no-surface-token-as-scrim.test.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name) && path.resolve(p) !== SELF) {
      out.push(p);
    }
  }
  return out;
}

/** `fixed` + `inset-0` (Tailwind) or `position: fixed` + `inset: 0` (CSS-in-JS). */

/** Text of the JSX opening tag enclosing `at`, or null when `at` is not inside one. */
function enclosingTag(masked: string, at: number): string | null {
  for (let i = at - 1; i >= 0 && at - i < 4000; i -= 1) {
    const c = masked[i];
    if (c === '>') {
      const prev = masked[i - 1];
      // `=>`, `->` and `>=` are not tag terminators.
      if (prev !== '=' && prev !== '-' && masked[i + 1] !== '=') return null;
      continue;
    }
    if (c === '<' && /[A-Za-z]/.test(masked[i + 1] ?? '')) return masked.slice(i, at);
  }
  return null;
}

/** Text of the enclosing CSS rule body — used for the CSS-in-JS template literals. */
function enclosingRule(masked: string, at: number): string {
  for (let i = at - 1; i >= 0 && at - i < 4000; i -= 1) {
    if (masked[i] === '{' && masked[i - 1] !== '$' && masked[i - 1] !== '{' && masked[i + 1] !== '{') {
      return masked.slice(i, at);
    }
  }
  return '';
}

function isFullScreenOverlay(window: string): boolean {
  const fixed = /\bfixed\b/.test(window) || /position\s*:\s*fixed/.test(window);
  const inset = /\binset-0\b/.test(window) || /inset\s*:\s*0/.test(window);
  if (!fixed || !inset) return false;
  // 🔴 The size check is load-bearing. `position: fixed; inset: 0; margin: auto;
  // width: min(640px, …); height: fit-content` is the standard trick for
  // CENTRING a dialog box — that is a panel, not an overlay, and var(--card) is
  // correct on it. vault/index.tsx uses exactly that for its connectivity-test
  // dialog. Without this clause the fence accuses a correct centring idiom.
  const sized =
    /\b(?:width|height|maxWidth|maxHeight|max-width|max-height)\s*:/.test(window) ||
    /\bmargin\s*:\s*auto/.test(window) ||
    /\b(?:w-|h-|max-w-|max-h-|m-auto|mx-auto|my-auto)/.test(window);
  return !sized;
}

describe('full-screen overlays use a scrim token', () => {
  it('no fixed inset-0 element is painted with a surface token', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const masked = maskComments(fs.readFileSync(file, 'utf8'));
      BG_ASSIGN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = BG_ASSIGN.exec(masked)) !== null) {
        const tag = enclosingTag(masked, m.index);
        const window = tag ?? enclosingRule(masked, m.index);
        if (!isFullScreenOverlay(window)) continue;
        const line = masked.slice(0, m.index).split('\n').length;
        offenders.push(`  ${path.relative(process.cwd(), file)}:${line}  ${m[0].trim()}`);
      }
    }
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            '',
            'A `fixed inset-0` overlay is painted with a SURFACE token. Surface tokens',
            'resolve to an opaque light colour in the light theme, so this covers the',
            'whole page instead of dimming it — the 2026-09-05 "left side is all white"',
            'report.',
            '',
            'Use the scrim instead (byte-identical in dark at alpha 0.2):',
            '',
            '    backgroundColor: \'rgba(var(--scrim-rgb), 0.2)\'',
            '',
            ...offenders,
            '',
            'See workflow/CI/bugfix/20260905-detail-drawer-scrim-paints-page-white.md',
          ].join('\n'),
    ).toEqual([]);
  });
});
