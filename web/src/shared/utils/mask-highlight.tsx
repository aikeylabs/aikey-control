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
 *
 * ── Spotlight: which token is THIS finding's? (2026-08-11) ───────────────────
 *
 * A finding card shows one snippet, but the snippet is a WINDOW around the
 * match, so it routinely contains placeholders that belong to OTHER findings of
 * the same event:
 *
 *   finding #1  「…张先生 {{PHONE}}，李女士 {{PHONE}}…」  wire_label {{PHONE_1}}
 *   finding #2  「…张先生 {{PHONE}}，李女士 {{PHONE}}…」  wire_label {{PHONE_2}}
 *
 * `resolveWireLabelFocus` names the ONE token that is the card's own, and
 * `renderMaskedSnippet` then highlights only that one — printing it under the
 * number it was actually forwarded as — and drops the others to plain body text
 * (they are the neighbouring cards' business and get their amber there).
 * `redacted_snippet` itself stays byte-for-byte untouched: renumbering it would
 * drift every downstream tier-2 judgement built on that text (方案 L, update doc
 * 20260810-合规事件携带命中片段原文 §16.3). This is display only.
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
 * The ONE token in a snippet that belongs to the finding being rendered — see
 * the "Spotlight" section of the module comment. Produced by
 * `resolveWireLabelFocus`; never hand-built at a render site.
 */
export interface SnippetFocus {
  /** The numberless token as it appears in the snippet, e.g. `{{PHONE}}`. */
  token: string;
  /** 0-based index of the focal token among ITS OWN occurrences in the snippet. */
  occurrence: number;
  /** What to print in its place, e.g. `{{PHONE_1}}` — the `wire_label` verbatim. */
  label: string;
}

/** The two finding fields the resolver reads. Both console DTOs satisfy it. */
export interface WireLabelledFinding {
  redacted_snippet?: string;
  wire_label?: string;
}

/**
 * `{{CODE}}` or `{{CODE_7}}`. Unambiguous because the planner excludes `_` from
 * entity codes precisely so the numbered grammar stays parseable — `{{ID2_1}}`
 * is code `ID2`, sequence 1 (see MASK_TOKEN_SOURCE's note).
 */
const WIRE_LABEL_SHAPE = /^\{\{([A-Z0-9]+)(?:_(\d+))?\}\}$/;

interface ParsedWireLabel {
  code: string;
  /** null for the numberless form — a request where the code occurred once. */
  seq: number | null;
}

function parseWireLabel(label: string | undefined): ParsedWireLabel | null {
  const m = WIRE_LABEL_SHAPE.exec(label ?? '');
  if (!m) return null;
  return { code: m[1], seq: m[2] === undefined ? null : Number(m[2]) };
}

/** How many times `token` appears in `snippet` AS A MASK TOKEN. */
function countToken(snippet: string, token: string): number {
  return splitMaskSegments(snippet).filter((s) => s.masked && s.text === token).length;
}

/**
 * Answers 「which placeholder in this card's snippet is this card's own?」, or
 * null when it cannot be answered — and null means the snippet renders exactly
 * as it did before this feature existed. 🔴 A WRONG ANSWER IS WORSE THAN NONE:
 * it would tell the reader that 张先生's number went out as `{{PHONE_2}}`.
 *
 * WHY NOT OFFSETS. `start_offset`/`end_offset` look like the obvious key, and
 * they are the wrong one twice over: they are not on either console's finding
 * DTO at all (deliberately — pages/master/compliance/audit and
 * pages/user/compliance both carry fences forbidding them), and they are BYTE
 * offsets into one detector-side content piece, i.e. a different coordinate
 * system from any string the browser holds. Slicing with them produced
 * mid-rune mojibake that was silently in range on the 2026-08-10 live-chain
 * measurement (see the openFindingIds note in the audit page). So the answer is
 * derived from the placeholder grammar plus the proxy's numbering instead.
 *
 * THE TWO CASES IT ANSWERS, both provable:
 *   1. The snippet holds exactly ONE token of this code. The focal finding was
 *      masked (it has a wire_label) and the window is centred on its own match,
 *      so its token is certainly present — with only one candidate, that is it.
 *   2. The snippet holds m tokens of this code, and the event has exactly m
 *      labelled findings of that code, numbered consecutively, EVERY one of
 *      which sees exactly m tokens in its own snippet. That last clause is what
 *      makes it safe: it means every window contains the whole group, so the
 *      k-th token in any of those snippets is the group's k-th number. Rank
 *      then maps by subtraction.
 * Anything else (a partial overlap, an unlabelled sibling in the window, a
 * numberless label next to several tokens) returns null and degrades.
 */
export function resolveWireLabelFocus(
  finding: WireLabelledFinding,
  siblings: readonly WireLabelledFinding[],
): SnippetFocus | null {
  const label = finding.wire_label;
  const own = parseWireLabel(label);
  if (!label || !own) return null;

  const token = `{{${own.code}}}`;
  const occurrences = countToken(finding.redacted_snippet ?? '', token);
  if (occurrences === 0) return null;
  if (occurrences === 1) return { token, occurrence: 0, label };

  // Several same-code tokens in the window: only the group rule can tell them
  // apart, and it needs this finding's own number.
  if (own.seq === null) return null;

  const group: { seq: number; snippet: string }[] = [];
  for (const s of siblings) {
    const p = parseWireLabel(s.wire_label);
    if (p && p.code === own.code && p.seq !== null) {
      group.push({ seq: p.seq, snippet: s.redacted_snippet ?? '' });
    }
  }
  if (group.length !== occurrences) return null;

  const seqs = group.map((g) => g.seq);
  if (new Set(seqs).size !== occurrences) return null;
  const lo = Math.min(...seqs);
  if (Math.max(...seqs) - lo !== occurrences - 1) return null;
  if (own.seq < lo || own.seq > lo + occurrences - 1) return null;
  // Mutual containment: every member's window must see the whole group.
  if (group.some((g) => countToken(g.snippet, token) !== occurrences)) return null;

  return { token, occurrence: own.seq - lo, label };
}

/** Index of the focal segment in `segments`, or -1 when it is not there. */
function focusedSegmentIndex(segments: MaskSegment[], focus: SnippetFocus): number {
  let seen = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.masked || seg.text !== focus.token) continue;
    if (seen === focus.occurrence) return i;
    seen++;
  }
  return -1;
}

/**
 * Renders a snippet with its mask tokens highlighted.
 *
 * With a `focus` (from `resolveWireLabelFocus`) the render goes into SPOTLIGHT
 * mode: the focal token is highlighted and printed as `focus.label` — the
 * numbered form the value actually went out under — while every other mask
 * token falls back to the plain-segment branch, i.e. ordinary body text in the
 * container's own colour. No new style token: "not highlighted" is literally
 * the same span a non-mask segment gets.
 *
 * A focus that does not resolve against this text (no `focus`, too few
 * occurrences, or the caller is showing the RAW snippet behind the eye rather
 * than the masked one) degrades to the plain all-tokens-amber rendering. 🔴 It
 * must never fall back to spotlighting "the first one" — see
 * resolveWireLabelFocus.
 *
 * Colour note (2026-06-06, carried over from the Personal page): dimmed from
 * `var(--primary)` #facc15 → `var(--primary-dim)` #ca8a04 and bg 0.12 → 0.08.
 * An audit table renders ~15 rows × 2 markers = 30+ amber patches at once; at
 * yellow-400/12% they summed into a 刺眼 speckle that outshouted the page's real
 * CTAs. yellow-600 still reads as "masked token" without competing with them.
 */
export function renderMaskedSnippet(text: string, focus?: SnippetFocus | null): React.ReactNode {
  const segments = splitMaskSegments(text);
  const focalIndex = focus ? focusedSegmentIndex(segments, focus) : -1;
  const spotlight = focalIndex >= 0;
  return segments.map((seg, i) =>
    (spotlight ? i === focalIndex : seg.masked) ? (
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
        {spotlight ? focus!.label : seg.text}
      </span>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}

/**
 * ── THE SNIPPET BOX — one box, three consoles, two states ────────────────────
 *
 * 2026-08-11 用户:「显示原文的样式，需要也有背景框框，和 mask 后的保持一致性的样式」.
 *
 * WHAT THIS SOLVES. A finding card has exactly ONE text block, and the eye swaps
 * what is inside it: masked snippet ⇄ original text. Earlier passes treated the
 * expanded state as a different KIND of thing and gave it different chrome — a
 * second bordered panel below the snippet, then a frameless block standing in
 * the snippet's place. Both read as "something else appeared", when the intended
 * reading is "the same box, now showing the real values". The user's acceptance
 * test is literal: put the collapsed and expanded screenshots side by side and
 * the box outline must COINCIDE — only the text inside may differ.
 *
 * WHY IT LIVES HERE. The masked snippet is rendered by three surfaces that must
 * not drift: the Personal self-view, the team member self-view (which reuses the
 * Personal page and injects its own panel), and the admin audit drawer. This
 * module is already the shared source for the trio's mask highlighting ("one
 * regex, three pages"), so the box those spans sit in belongs beside it. Spelled
 * inline it was three copies, and the expanded state had drifted in all three.
 *
 * WHY A VARIANT ENUM AND NOT THREE CONSTANTS. The variants are not independent
 * styles — they are one style plus deltas, and the whole point is that the
 * deltas may not touch the outline. Deriving them from a single base is what
 * makes "the outline coincides" a property of the code rather than of three
 * literals someone has to keep equal by hand. Fenced by
 * aikey-control/web/src/pages/user/compliance/snippet-reveal.test.ts.
 *
 * 🔴 THE RAW MARKER IS INSET, AND THAT IS THE WHOLE POINT. Un-masked text still
 * earns a warm left edge — it is the console-wide "these are real values" cue.
 * Drawn as `borderLeft` (as it was) it replaces the box's own 1px left border
 * with 2px, so the outline shifts by a pixel and the text reflows: the two
 * states no longer line up, which is exactly what the user asked to fix. As an
 * INSET shadow it is painted inside the border box, so geometry is untouched —
 * the user named this resolution ("作为框内的一条左缘"). Same 2px and same
 * `--primary-dim` token as before; no new value.
 */
export const SNIPPET_BOX_CLASS =
  'text-[11px] font-mono mt-2 break-all whitespace-pre-wrap rounded px-2 py-1.5 leading-relaxed';

/**
 * `masked`  — the redacted snippet: the collapsed, default state.
 * `raw`     — the SAME box holding un-masked text (Personal lane's context_snippet).
 * `rawTurn` — the same box again, holding a whole conversation turn. A turn can
 *             run for pages and it sits INSIDE a finding card, so it is capped
 *             and scrolls internally; the cap changes what the box can grow to,
 *             never how it is drawn, so a short turn is pixel-identical to the
 *             masked state.
 */
export type SnippetBoxVariant = 'masked' | 'raw' | 'rawTurn';

export function snippetBoxStyle(variant: SnippetBoxVariant): React.CSSProperties {
  // The base is the ONLY place the box's geometry and fill are written down.
  const base: React.CSSProperties = {
    color: 'var(--foreground)',
    backgroundColor: 'rgba(0,0,0,0.28)',
    border: '1px solid var(--border)',
  };
  if (variant === 'masked') return base;
  const raw: React.CSSProperties = { ...base, boxShadow: 'inset 2px 0 0 var(--primary-dim)' };
  if (variant === 'raw') return raw;
  return { ...raw, maxHeight: 220, overflowY: 'auto' };
}
