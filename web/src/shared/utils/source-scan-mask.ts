/**
 * Comment masking for SOURCE-SCANNING FENCES (`no-raw-accent`,
 * `no-surface-token-as-scrim`). Blanks comments while preserving length and
 * newlines, so a match's offset still maps to the right line.
 *
 * 🔴 This is a state machine and not a regex, because two traps broke the regex
 * version and each broke it in the OPPOSITE direction. Both were found by a
 * mutation drill that failed to go red — the fence was silently vacuous, and a
 * vacuous fence is worse than no fence because it reads as proof.
 *
 *  1. `/*` INSIDE A LINE COMMENT is not a block-comment opener. A real line in
 *     pages/user/account/index.tsx reads `// … for all /api/user/* surface).`
 *     A regex that scans for block comments first sees that opener, runs to the
 *     next terminator, and blanks ~450 lines of LIVE CODE. Thirteen real
 *     literals hid under that hole while the fence reported a clean zero.
 *
 *  2. A BLOCK COMMENT INSIDE A TEMPLATE LITERAL *is* a comment, because the
 *     template literals in this codebase hold CSS-in-JS (keys-page-css.ts,
 *     trust-check-css.ts, the styled blocks in import/index.tsx). Treating a
 *     template literal as one opaque string counts CSS comment PROSE as code —
 *     thirteen phantom violations, all of them sentences like "dim amber
 *     (--primary-dim #ca8a04)".
 *
 * Getting either half wrong produces a confident, wrong number. Do not
 * "simplify" this back into a regex.
 */
export function maskComments(source: string): string {
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
      // The `:` guard keeps `https://…` in JSX text from opening a comment.
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

/** True when `at` sits inside a `var(--token, …)` fallback — unreachable while the token exists. */
export function inVarFallback(masked: string, at: number): boolean {
  return /var\(\s*--[\w-]+\s*,[^)]*$/.test(masked.slice(Math.max(0, at - 90), at));
}
