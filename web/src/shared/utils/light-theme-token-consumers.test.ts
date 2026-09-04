// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FENCE: a theme-varying token may not be bypassed by its own dark literal
 * inside index.css.
 *
 * # Why this exists (bugfix 20260905-personal-header-grey-in-light.md)
 *
 * The 2026-09-03 light theme defined `--glass-top` / `--glass-bottom` in BOTH
 * `:root` (dark) and `[data-theme='light']`. But the single rule that consumes
 * them — `.user-pages .vault-header` — was never rewired and kept painting the
 * dark literals:
 *
 *     background: linear-gradient(180deg,
 *       rgba(39, 39, 42, 0.72) 0%, rgba(24, 24, 27, 0.55) 100%);
 *
 * In light that composites to rgb(99,100,102) → rgb(128,128,130): a grey slab
 * across the top of the Personal console. It shipped to staging and to the
 * Windows build and was reported by the user on 2026-09-05.
 *
 * # Why nothing caught it
 *
 * "Token defined, consumer never wired" is invisible to every existing check:
 *   · `tsc` / `vite build` — a colour is a string, both forms compile
 *   · `no-raw-neutral.test.ts` — scopes itself to `src/pages`, not to index.css
 *   · the contrast script — samples resolved solid colours; it does not look
 *     inside a `linear-gradient()`, and the token it WOULD have checked
 *     (`--glass-top`) had a perfectly correct light value
 * It is the mirror image of the already-known "`var(--x)` used but never
 * defined" trap: there the token is missing, here the consumer is.
 *
 * # What this asserts
 *
 * For every token whose `:root` value differs from its `[data-theme='light']`
 * value (i.e. it is genuinely theme-varying), the DARK value must not appear as
 * a literal in any declaration outside the two token blocks. If it does, that
 * declaration is frozen to dark and will not follow the theme.
 *
 * Tokens with identical values in both themes are deliberately exempt — e.g.
 * `--scrim-rgb: 0, 0, 0` is black in both, so a literal `rgba(0,0,0,…)` scrim is
 * not a theme bug.
 *
 * # Status: ENFORCING (baseline 0)
 *
 * Do not raise the baseline. The fix is always the same and is always one line:
 * replace the literal with `var(--the-token)`.
 *
 * Mutation drill (this fence has been proven able to fail): restore either
 * literal in `.user-pages .vault-header` and this suite goes red naming
 * `--glass-top` / `--glass-bottom`.
 */

const CSS_PATH = path.resolve(process.cwd(), 'src/index.css');

/** Strip block comments so prose that quotes a hex is not read as code. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Strip `var(--x, #fallback)` fallbacks — unreachable while the token exists. */
function stripVarFallbacks(css: string): string {
  return css.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, 'var(--x)');
}

/** `rgba( 39 , 39 , 42 , 0.72 )` and `#FACC15` → canonical comparable form. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/rgba?\(([^)]*)\)/g, (_m, inner) => {
      const parts = String(inner)
        .split(',')
        .map((p) => (p.startsWith('.') ? `0${p}` : p))
        .map((p) => (p.endsWith('.0') ? p.slice(0, -2) : p));
      return `rgb(${parts.join(',')})`;
    });
}

/** Extract `{ token: value }` from one brace-balanced block starting at `open`. */
function tokensIn(css: string, open: number): Record<string, string> {
  let depth = 1;
  let i = css.indexOf('{', open) + 1;
  const start = i;
  while (depth > 0 && i < css.length) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  const body = css.slice(start, i - 1);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return { ...out, __end: String(i) } as Record<string, string>;
}

describe('light theme: every theme-varying token is actually consumed', () => {
  it('index.css contains no declaration frozen to a dark token value', () => {
    const raw = fs.readFileSync(CSS_PATH, 'utf8');
    const css = stripVarFallbacks(stripComments(raw));

    const rootAt = css.search(/(?<![\w.\[-]):root\s*\{/);
    const lightAt = css.search(/\[data-theme=['"]light['"]\]\s*\{/);
    expect(rootAt, ':root block not found in index.css').toBeGreaterThan(-1);
    expect(lightAt, "[data-theme='light'] block not found in index.css").toBeGreaterThan(-1);

    const dark = tokensIn(css, rootAt);
    const light = tokensIn(css, lightAt);
    const lightEnd = Number(light.__end);
    const rootEnd = Number(dark.__end);
    delete dark.__end;
    delete light.__end;

    // Theme-varying tokens only: same value in both themes is not a theme bug.
    const varying: Array<{ token: string; darkValue: string }> = [];
    for (const [token, darkValue] of Object.entries(dark)) {
      const lightValue = light[token];
      if (!lightValue) continue;
      if (normalize(lightValue) === normalize(darkValue)) continue;
      // Only literal colours can be smuggled into a declaration.
      if (!/^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(darkValue.trim())) continue;
      varying.push({ token, darkValue: darkValue.trim() });
    }
    expect(varying.length, 'no theme-varying colour tokens found — parser broke').toBeGreaterThan(10);

    // Everything that is NOT one of the two token blocks.
    const rules =
      css.slice(0, Math.min(rootAt, lightAt)) +
      css.slice(rootEnd, lightAt > rootEnd ? lightAt : rootEnd) +
      css.slice(lightEnd);
    const rulesNorm = normalize(rules);

    const offenders: string[] = [];
    for (const { token, darkValue } of varying) {
      const needle = normalize(darkValue);
      // A bare 3/6-digit hex must not match a longer hex (e.g. #18181b vs #18181bcc).
      const pattern = needle.startsWith('#')
        ? new RegExp(`${needle}(?![0-9a-f])`, 'g')
        : new RegExp(needle.replace(/[()]/g, '\\$&'), 'g');
      if (pattern.test(rulesNorm)) {
        offenders.push(`  ${darkValue}  → use var(${token})`);
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            '',
            'A rule in index.css hardcodes the DARK value of a token that the light',
            'theme overrides. That declaration will NOT follow the theme — it is frozen',
            'to dark and will composite as a grey/dark slab on a light page.',
            '',
            'This is what shipped the 2026-09-05 grey Personal header. Fix is one line:',
            'replace the literal with the var() shown.',
            '',
            ...offenders,
            '',
            'See workflow/CI/bugfix/20260905-personal-header-grey-in-light.md',
          ].join('\n'),
    ).toEqual([]);
  });
});
