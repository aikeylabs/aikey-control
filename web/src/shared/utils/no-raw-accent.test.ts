// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FENCE: page code must not hardcode the ACCENT colours.
 *
 * # Why this exists — the sibling fence's stated exemption stopped being true
 *
 * `no-raw-neutral.test.ts` deliberately scoped itself to NEUTRALS and wrote down
 * why: "Chromatic literals (#4ade80 success, #60a5fa info) are ALSO meant to be
 * tokenized, but they degrade gracefully — a green stays readable on both
 * grounds." That reasoning is sound for a theme change that only moves
 * LIGHTNESS. It stops being sound the moment the theme changes HUE.
 *
 * 2026-09-05 the light theme's accent was re-cut from amber to violet. Every
 * hardcoded `#facc15` / `#ca8a04` then rendered an AMBER control inside a VIOLET
 * console: 399 of them across the two repos, including the seat bars on
 * /user/overview, the trend bars on /user/performance and — most visibly — an
 * amber glow filter around a violet brand chip, because the chip's stroke was
 * `var(--primary)` while its halo was a literal.
 *
 * "Degrades gracefully" was never a property of the colour. It was a property of
 * the kind of change being made. This fence removes the assumption.
 *
 * # Why the mapping is safe to enforce
 *
 * Each literal maps to the token whose DARK value is byte-identical to it:
 *
 *     #facc15  → var(--primary)      (or --primary-text in a `color:` context)
 *     #ca8a04  → var(--primary-dim)
 *     #eab308  → var(--btn-primary-bg)
 *     #fde047  → var(--link-hover)
 *     rgba(250,204,21,a) → rgba(var(--primary-rgb), a)
 *     rgba(202,138,4,a)  → rgba(var(--primary-dim-rgb), a)
 *     rgba(234,179,8,a)  → rgba(var(--btn-primary-border-rgb), a)
 *
 * Because the dark value is identical, migrating a call site is a NO-OP in dark
 * and only takes effect in light. That is what makes a baseline of 0 enforceable
 * without re-reviewing the dark console.
 *
 * 🔴 A `color:` context must use `--primary-text`, not `--primary`. Both are
 * #facc15 in dark, so picking wrong is invisible there — and in light
 * --primary-text is the tier sized for text.
 *
 * # Comments and var() fallbacks are excluded
 *
 * A hex inside a comment is prose; a hex inside `var(--x, #fallback)` is
 * unreachable while the token exists. Counting either inflates the baseline, and
 * a ratchet built on false positives hides real debt underneath it.
 */

const ACCENT_PATTERNS: Array<[RegExp, string]> = [
  [/#facc15\b/gi, 'var(--primary) — or var(--primary-text) in a `color:` context'],
  [/#eab308\b/gi, 'var(--btn-primary-bg)'],
  [/#ca8a04\b/gi, 'var(--primary-dim)'],
  [/#fde047\b/gi, 'var(--link-hover)'],
  [/rgba\(\s*250\s*,\s*204\s*,\s*21\s*,/gi, 'rgba(var(--primary-rgb), …)'],
  [/rgba\(\s*202\s*,\s*138\s*,\s*4\s*,/gi, 'rgba(var(--primary-dim-rgb), …)'],
  [/rgba\(\s*234\s*,\s*179\s*,\s*8\s*,/gi, 'rgba(var(--btn-primary-border-rgb), …)'],
  [/rgba\(\s*253\s*,\s*224\s*,\s*71\s*,/gi, 'rgba(var(--link-hover-rgb), …) — add the triplet first'],
];

/**
 * The CAUTION amber family — the console's SECOND warning ramp.
 *
 * These 167 literals were never a design decision; they were the amber ramp that
 * had lived beside the tokenised orange ramp (--warning #f97316 /
 * --warning-text #fb923c) for as long as there was only one palette, where a
 * literal and a token render identically. They carry "degraded but not broken"
 * states: seat `suspended`, access-token `no_login`, compliance `statusLocked`,
 * vault "this stage broke", trust-check `suspect`.
 *
 * 🔴 Resolved 2026-09-05 by NAMING the duplication rather than removing it.
 * Folding them into --warning would have been the cleaner token model, but it
 * repaints 167 call sites IN DARK (amber-500 → orange-500), and "dark does not
 * change" is the standing constraint. So --caution / --caution-text /
 * --caution-deep were added with dark values byte-identical to these literals,
 * which made every migration a no-op in dark. The alternative was put to the
 * decision-maker explicitly; this is the chosen branch, not an oversight.
 *
 *     #f59e0b            → var(--caution)
 *     #fbbf24            → var(--caution-text)
 *     #a16207            → var(--caution-deep)
 *     rgba(245,158,11,a) → rgba(var(--caution-rgb), a)
 *     rgba(251,191,36,a) → rgba(var(--caution-text-rgb), a)
 *
 * ⚠️ Known, deliberate leftover: vault/index.tsx has one `var(--warning,
 * #f59e0b)`. It reaches for the ORANGE ramp while its siblings are amber — a
 * pre-existing dark inconsistency. Repointing it at --caution would change dark,
 * so it is left alone and recorded here instead of being quietly "fixed".
 */
const CAUTION_PATTERNS: RegExp[] = [
  /#f59e0b\b/gi,
  /#fbbf24\b/gi,
  /#a16207\b/gi,
  /#854d0e\b/gi,
  /rgba\(\s*245\s*,\s*158\s*,\s*11\s*,/gi,
  /rgba\(\s*251\s*,\s*191\s*,\s*36\s*,/gi,
];

const SRC = path.resolve(process.cwd(), 'src');

/** This file's own path — see the skip in walk(). */
const __filename_compat = path.resolve(SRC, 'shared/utils/no-raw-accent.test.ts');

/**
 * Blank comments, preserving length and newlines so offsets and line numbers
 * survive.
 *
 * 🔴 This is a small state machine and not a regex, because two traps broke the
 * regex version and each broke it in the OPPOSITE direction. Both were found by
 * a mutation drill that failed to go red — the fence was silently vacuous.
 *
 *  1. `/*` INSIDE A LINE COMMENT is not a block-comment opener. A real line in
 *     pages/user/account/index.tsx reads `// ... for all /api/user/* surface).`
 *     A regex that scans for block comments first sees that `/*`, runs to the
 *     next `* /`, and blanks ~450 lines of LIVE CODE. Thirteen real literals hid
 *     under that hole and the fence reported a clean zero.
 *
 *  2. `/* ... * /` INSIDE A TEMPLATE LITERAL *is* a comment, because the
 *     template literals in this codebase hold CSS-in-JS (keys-page-css.ts,
 *     trust-check-css.ts, the styled blocks in import/index.tsx). Treating a
 *     template literal as one opaque string counts CSS comment PROSE as code —
 *     which reported thirteen phantom violations, all of them sentences like
 *     "dim amber (--primary-dim #ca8a04)".
 *
 * Getting either half wrong produces a confident, wrong number. Do not
 * "simplify" this back into a regex.
 */
function maskComments(source: string): string {
  const out = source.split('');
  const n = source.length;
  const CODE = 0, LINE = 1, BLOCK = 2, SQ = 3, DQ = 4, TPL = 5, TPL_BLOCK = 6;
  let st = CODE;
  let tplDepth = 0;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const nx = i + 1 < n ? source[i + 1] : '';
    if (st === CODE) {
      // `:` guard keeps `https://…` in JSX text from opening a comment.
      if (c === '/' && nx === '/' && (i === 0 || source[i - 1] !== ':')) {
        st = LINE; out[i] = ' '; out[i + 1] = ' '; i += 2; continue;
      }
      if (c === '/' && nx === '*') {
        st = BLOCK; out[i] = ' '; out[i + 1] = ' '; i += 2; continue;
      }
      if (c === "'") st = SQ;
      else if (c === '"') st = DQ;
      else if (c === '`') st = TPL;
    } else if (st === LINE) {
      if (c === '\n') st = CODE;
      else out[i] = ' ';
    } else if (st === BLOCK) {
      if (c === '*' && nx === '/') { out[i] = ' '; out[i + 1] = ' '; st = CODE; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
    } else if (st === SQ || st === DQ) {
      if (c === '\\') { i += 2; continue; }
      if ((st === SQ && c === "'") || (st === DQ && c === '"')) st = CODE;
    } else if (st === TPL) {
      if (c === '\\') { i += 2; continue; }
      if (c === '/' && nx === '*') { st = TPL_BLOCK; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === '`') st = CODE;
      else if (c === '$' && nx === '{') { tplDepth += 1; i += 2; continue; }
      else if (c === '}' && tplDepth > 0) tplDepth -= 1;
    } else if (st === TPL_BLOCK) {
      if (c === '*' && nx === '/') { out[i] = ' '; out[i + 1] = ' '; st = TPL; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
    }
    i += 1;
  }
  return out.join('');
}

/** True when the offset sits inside a `var(--token, …)` fallback. */
function inVarFallback(masked: string, at: number): boolean {
  return /var\(\s*--[\w-]+\s*,[^)]*$/.test(masked.slice(Math.max(0, at - 90), at));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      // 🔴 Skip THIS file. A fence that lists the literals it forbids will
      // otherwise match its own pattern table and report itself — which both
      // fails at zero and inflates the ratchet by exactly the number of
      // patterns it declares. Observed on the first run: 65 → 69.
      if (path.resolve(p) !== path.resolve(__filename_compat)) out.push(p);
    }
  }
  return out;
}

function findHits(patterns: RegExp[] | Array<[RegExp, string]>): string[] {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const masked = maskComments(source);
    for (const entry of patterns) {
      const [re, fix] = Array.isArray(entry) ? entry : [entry, null];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(masked)) !== null) {
        if (inVarFallback(masked, m.index)) continue;
        const line = masked.slice(0, m.index).split('\n').length;
        const rel = path.relative(process.cwd(), file);
        hits.push(fix ? `  ${rel}:${line}  ${m[0]}  → use ${fix}` : `  ${rel}:${line}  ${m[0]}`);
      }
    }
  }
  return hits;
}

describe('accent colours are tokenised', () => {
  it('no source file hardcodes an AiKey accent literal', () => {
    const hits = findHits(ACCENT_PATTERNS);
    expect(
      hits,
      hits.length === 0
        ? ''
        : [
            '',
            'A hardcoded accent literal renders AMBER in both themes. Since 2026-09-05',
            'the light theme accent is VIOLET, so this paints an amber control inside a',
            'violet console.',
            '',
            'Each token below has a dark value byte-identical to the literal it replaces,',
            'so the fix is a no-op in dark and only takes effect in light:',
            '',
            ...hits,
            '',
            'See workflow/CI/bugfix/20260905-personal-header-grey-in-light.md',
          ].join('\n'),
    ).toEqual([]);
  });

  it('no source file hardcodes a caution-amber literal', () => {
    const hits = findHits(CAUTION_PATTERNS);
    expect(
      hits,
      hits.length === 0
        ? ''
        : [
            '',
            'A hardcoded caution-amber literal does not follow the theme. The token',
            'family below has dark values byte-identical to these literals, so the fix',
            'is a no-op in dark:',
            '',
            '  #f59e0b            → var(--caution)',
            '  #fbbf24            → var(--caution-text)',
            '  #a16207            → var(--caution-deep)',
            '  rgba(245,158,11,a) → rgba(var(--caution-rgb), a)',
            '  rgba(251,191,36,a) → rgba(var(--caution-text-rgb), a)',
            '',
            ...hits,
          ].join('\n'),
    ).toEqual([]);
  });
});
