// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FENCE: page code must not hardcode NEUTRAL colours.
 *
 * # Why this exists
 *
 * 2026-09-03 added a light theme. The dark theme is unchanged, so nothing broke
 * — but the change exposed a class of defect that had been accumulating
 * invisibly for years.
 *
 * With a single immutable palette, writing `#18181b` and writing
 * `var(--background)` render IDENTICALLY. Nothing ever stopped the former, and
 * `theme_2.css` even documented the assumption ("Single dark theme only — no
 * light mode, no [data-theme] switch"). ~677 raw neutral literals across ~100
 * page files accumulated that way.
 *
 * The moment a second palette exists, every one of them is a bug — and it is a
 * bug that `tsc`, `vitest` and `vite build` are ALL structurally blind to,
 * because a colour is just a string. Measured on 2026-09-03: the /user/cli-guide
 * page rendered 207 elements with literal inline colours and ZERO with
 * token-based ones, so it stayed fully dark while every token around it had
 * correctly flipped to light.
 *
 * The worst offenders are not "wrong colour" but "disappears entirely":
 *   · rgba(255,255,255,.02)  row hover — invisible on a white card
 *   · rgba(0,0,0,.2)         table header — a dirty grey slab on white
 *   · amber glows            a smudge on a light ground
 * Each of those now has a token whose DARK value is byte-identical to the
 * literal it replaces, so migrating a page is a no-op in dark.
 *
 * # Why only neutrals
 *
 * Chromatic literals (#4ade80 success, #60a5fa info) are ALSO meant to be
 * tokenized, but they degrade gracefully — a green stays readable on both
 * grounds. Neutrals are the ones that make a page unusable. Scoping the fence
 * to what actually breaks keeps it honest and keeps it from being switched off.
 *
 * # Status: ENFORCING (baseline 0)
 *
 * The migration is done: P2–P6 took user/web from 366 to 0 and master/web from
 * 241 to 0. The baseline is now a hard zero, so ANY new hardcoded neutral in
 * pages/ fails the suite. Do not raise it — add the token instead; the token
 * list is in the error message below and in theme_3.css.
 *
 * Spec: roadmap20260320/技术实现/update/20260903-控制台新增浅色主题-深色不变.md
 * Tokens: roadmap20260320/技术实现/UI/resources/theme_3.css
 */

const ADVISORY = false;

/**
 * Ratchet, not a target. Measured 2026-09-03 by this fence against this repo's own
 * `src/pages`. It may only ever go DOWN. If a change makes this number grow,
 * that change added hardcoded neutrals to a page — use the tokens instead.
 */
const BASELINE = 0;

/**
 * 🔴 DETECTS LOW-CHROMA COLOURS, it does not match a list.
 *
 * The first version enumerated known neutrals (#18181b, #27272a, rgba(0,0,0,…)
 * …). That shape is unsound: on 2026-09-04 a grey slab shipped across the light
 * theme's vault page from `rgba(23,23,25,0.2) !important` — a near-black that
 * simply was not on the list, in a page-scoped CSS string, behind !important so
 * it beat the tokenised inline style. Eleven more such triplets were hiding with
 * it. An allowlist can only catch the neutrals someone already thought of.
 *
 * A colour is "neutral" here when its RGB channels are within 14 of each other
 * (grey/near-grey). Chromatic colours (a green, a blue) have a much wider
 * spread and are deliberately not matched — they degrade legibly across themes,
 * whereas a neutral inverts.
 */
function isNeutralRGB(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= 14;
}

function countNeutralLiterals(raw: string): number {
  let n = 0;
  // #rgb / #rrggbb
  for (const m of raw.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (isNeutralRGB(r, g, b)) n++;
  }
  // rgb() / rgba()
  for (const m of raw.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) {
    if (isNeutralRGB(+m[1], +m[2], +m[3])) n++;
  }
  return n;
}

/**
 * Exclusions, each learned from a false positive during the 2026-09-03 migration:
 *
 *  1. `var(--token, #fallback)` is NOT debt. The token always wins; the literal
 *     is unreachable unless someone deletes the token. 43 of these in user/web.
 *  2. Prose inside block comments. The first version skipped only lines STARTING
 *     with `*`, so continuation lines explaining why a colour was chosen
 *     ("--accent is #3f3f46 in this codebase") counted as violations.
 *     A comment cannot render.
 *
 * Both inflated the baseline, and a ratchet anchored to false positives lets
 * real debt hide underneath it.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(tsx?|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function countNeutrals(): { total: number; byFile: Array<[string, number]> } {
  // 🔴 SCOPE WIDENED 2026-09-03. This scanned only `pages/` and therefore missed
  // `shared/ui/BrandWordmark.tsx`, which hardcoded the wordmark fill to #ffffff
  // — invisible on the light sidebar. A shared component renders on EVERY page,
  // so it is the worst possible place for an unthemeable colour, and it was the
  // one place this fence could not see. Found by opening the light console in a
  // real browser, not by any automated check.
  const src = path.resolve(__dirname, '..', '..');
  const roots = ['pages', 'shared', 'layouts', 'features']
    .map((d) => path.join(src, d))
    .filter((d) => fs.existsSync(d));
  if (roots.length === 0) throw new Error(`fence cannot look: no source dirs under ${src}`);

  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const file of roots.flatMap((r) => walk(r))) {
    const src = fs.readFileSync(file, 'utf-8');
    let n = 0;
    let inBlockComment = false;
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      const opens = (raw.match(/\/\*/g) ?? []).length;
      const closes = (raw.match(/\*\//g) ?? []).length;
      const wasInComment = inBlockComment;
      if (opens > closes) inBlockComment = true;
      else if (closes > opens) inBlockComment = false;
      if (wasInComment || line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
      // Opt-out for literals that MUST stay literal. Today: the
      // <meta name="theme-color"> values in shared/utils/theme.ts — a meta tag
      // cannot take a var(). Mark the line `theme-literal-ok` and say why.
      if (raw.includes('theme-literal-ok')) continue;
      if (/var\(\s*--[a-z0-9-]+\s*,/i.test(raw)) continue;
      n += countNeutralLiterals(raw);
    }
    if (n > 0) {
      // `path.relative` off a resolved __dirname printed a 200-deep `../` chain
      // under vitest, which made the failure message unreadable. Slice on the
      // marker instead — it is the path the developer actually recognises.
      byFile.push([file.split('/web/src/')[1] ?? file, n]);
      total += n;
    }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe('pages do not hardcode neutral colours (they cannot theme)', () => {
  it('never grows past the recorded baseline', () => {
    const { total, byFile } = countNeutrals();

    if (total > BASELINE) {
      const worst = byFile
        .slice(0, 8)
        .map(([f, n]) => `    ${String(n).padStart(3)}  ${f}`)
        .join('\n');
      throw new Error(
        `Hardcoded neutral colours in src/ grew from ${BASELINE} to ${total}.\n\n` +
          `A raw neutral cannot follow the theme. rgba(255,255,255,.02) is INVISIBLE on a\n` +
          `white card; rgba(0,0,0,.2) is a dirty slab on one. Use the tokens instead —\n` +
          `their dark values are byte-identical to the literals, so switching is a no-op\n` +
          `in dark:\n\n` +
          `    #18181b            -> var(--background)\n` +
          `    #1f1f23            -> var(--surface-sunken)\n` +
          `    #27272a            -> var(--card) / var(--surface-raised)\n` +
          `    #3f3f46            -> var(--surface-inset) / var(--border)\n` +
          `    #a1a1aa            -> var(--muted-foreground)\n` +
          `    #0c0c0e            -> var(--code-bg)\n` +
          `    rgba(255,255,255,.02) -> var(--overlay-hover)\n` +
          `    rgba(255,255,255,.05) -> var(--overlay-active)\n` +
          `    rgba(0,0,0,.2)        -> var(--overlay-sink)\n\n` +
          `Worst files:\n${worst}\n\n` +
          `Full token list: roadmap20260320/技术实现/UI/resources/theme_3.css`,
      );
    }

    expect(total).toBeLessThanOrEqual(BASELINE);
  });

  it('reports progress so the baseline can be ratcheted down', () => {
    const { total } = countNeutrals();
    if (ADVISORY && total < BASELINE) {
      // Not a failure — a nudge. Leaving the baseline stale lets the debt creep
      // back up under a number nobody re-measured.
      console.warn(
        `\n  ✓ hardcoded neutrals now ${total} (baseline ${BASELINE}).` +
          `\n    Lower BASELINE in ${path.basename(__filename)} to lock the gain in.\n`,
      );
    }
    expect(total).toBeGreaterThanOrEqual(0);
  });
});
