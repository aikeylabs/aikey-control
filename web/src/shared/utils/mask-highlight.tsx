/**
 * Mask-token highlighting for compliance audit snippets.
 *
 * SINGLE SOURCE for the three pages that render a detector-produced snippet:
 *   - master  /master/compliance/audit   (drawer findings)
 *   - master  /master/compliance/triage  (drawer findings)
 *   - user    /user/compliance           (table cell + drawer; reused verbatim
 *                                         by master's /user/compliance wrapper)
 *
 * WHY a shared module: the three pages carried three byte-identical copies of
 * the regex. The 2026-08-08 placeholder-format change (`[地址#1(已隐藏)]` →
 * `{{ADDR_1}}`) had to be applied in all three or the new tokens would silently
 * lose their highlight on whichever page was missed — 技术方案 §3.6 lists that
 * as an observability regression, so the pattern now lives in one place.
 *
 * ⚠️ dual-edit: `@/shared/utils/*` is NOT vite-aliased across the two web trees,
 * so this file must exist byte-identical in BOTH `aikey-control/web` and
 * `aikey-control-master/web` (guarded by `make -f workflow/CI/Makefile
 * web-drift-check`, whitelist entry `src/shared/utils`).
 *
 * ── What counts as a mask token ──────────────────────────────────────────────
 *
 * 1. Restorable placeholders (P1 2026-08-08, 占位符还原与全类型脱敏 §3.1).
 *    Grammar mirrors the detector planner (ai-compliance-detector/internal/
 *    compliance/planner/planner.go): `{{` + code + `}}` written by the detector,
 *    renumbered by the proxy into `{{` + code + `_` + N + `}}`. Codes are
 *    `[A-Z0-9]+` by planner contract (`_` is excluded there precisely so the
 *    numbered grammar stays unambiguous), and this pattern deliberately does NOT
 *    hard-code the entity short codes — the table grows with every new maskable
 *    entity and a frontend copy of it would rot.
 *
 *    Why uppercase-only rather than a permissive `{{...}}`: audit snippets often
 *    quote user source code, and Handlebars/Jinja interpolations there
 *    (`{{name}}`, `{{ user.id }}`) are NOT redactions. Requiring the planner's
 *    exact shape keeps template code in a prompt from lighting up as if it had
 *    been masked. Known limitation: an operator who overrides `mask_labels` with
 *    a lowercase custom token loses the highlight (the value is still masked —
 *    this is display only).
 *
 * 2. Legacy / non-restorable markers, kept for BACKWARD COMPATIBILITY:
 *    - `***PHONE***`, `***18***`   — planner star markers
 *    - `[password-redacted]`, `[prompt-injection]`, `[违规话术]`, `[redacted]`
 *      — the `nonRestorableMasks` family, still emitted today for entities that
 *      have no restorable label
 *    - `[地址#1(已隐藏)]`           — the pre-2026-08-08 address label, still
 *      present in every historical audit row
 *    Dropping these would blank the highlight on all existing records.
 */
import React from 'react';

/** One alternation branch per token family — see the module comment. */
const MASK_TOKEN_SOURCE = [
  '\\{\\{[A-Z0-9]+(?:_\\d+)?\\}\\}', // {{ADDR}} / {{ADDR_1}}  (restorable, 2026-08-08)
  '\\*\\*\\*[^*\\s]{1,20}\\*\\*\\*', // ***PHONE***            (legacy star marker)
  '\\[[^\\]\\n]{1,24}\\]',           // [password-redacted] / [地址#1(已隐藏)]
].join('|');

/** Capturing + global: `String.split` keeps the tokens as their own segments. */
const MASK_SPLIT = new RegExp(`(${MASK_TOKEN_SOURCE})`, 'g');
/** Anchored, non-global (no `lastIndex` state to reset between `.test` calls). */
const MASK_TEST = new RegExp(`^(?:${MASK_TOKEN_SOURCE})$`);

export interface MaskSegment {
  text: string;
  /** true → this segment is a redaction token and should be highlighted. */
  masked: boolean;
}

/**
 * Splits a snippet into alternating plain / mask-token segments.
 *
 * Pure and DOM-free on purpose: it is the unit under test
 * (`mask-highlight.test.ts`), so the "does the new placeholder format still
 * highlight" fence does not need a renderer.
 */
export function splitMaskSegments(text: string): MaskSegment[] {
  return text
    .split(MASK_SPLIT)
    .filter((p) => p !== '')
    .map((part) => ({ text: part, masked: MASK_TEST.test(part) }));
}

/** True when the whole string is a single mask token. Exported for tests. */
export function isMaskToken(part: string): boolean {
  return MASK_TEST.test(part);
}

/**
 * Renders a snippet with its mask tokens highlighted.
 *
 * Colour note (2026-06-06, carried over from the Personal page): dimmed from
 * `var(--primary)` #facc15 → `var(--primary-dim)` #ca8a04 and bg 0.12 → 0.08.
 * An audit table renders ~15 rows × 2 markers = 30+ amber patches at once; at
 * yellow-400/12% they summed into a 刺眼 speckle that outshouted the page's real
 * CTAs. yellow-600 still reads as "masked token" without competing with them.
 */
export function renderMaskedSnippet(text: string): React.ReactNode {
  return splitMaskSegments(text).map((seg, i) =>
    seg.masked ? (
      <span
        key={i}
        className="font-bold"
        style={{
          color: 'var(--primary-dim)',
          backgroundColor: 'rgba(202,138,4,0.08)',
          borderRadius: 2,
          padding: '0 2px',
        }}
      >
        {seg.text}
      </span>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}
