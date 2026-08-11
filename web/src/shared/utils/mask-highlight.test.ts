/**
 * Fence for the compliance mask-token highlighting
 * (技术方案 20260808-AI合规检测-占位符还原与全类型脱敏 §3.6 / §7 "改格式导致审计高亮失效").
 *
 * The regression this exists to catch: the placeholder format changed from
 * `[地址#1(已隐藏)]` to `{{ADDR_1}}` in P1. The old regex matched only the
 * bracket/star families, so every NEW audit snippet would have rendered with no
 * highlight at all — and, since a snippet without highlight still renders fine,
 * nothing else in the stack would have gone red.
 *
 * Both directions matter:
 *   - new format highlights (otherwise the feature ships blind)
 *   - old formats KEEP highlighting (historical rows must not regress)
 */
import type { ReactElement } from 'react';
import { describe, it, expect } from 'vitest';

import {
  splitMaskSegments,
  isMaskToken,
  renderMaskedSnippet,
  resolveWireLabelFocus,
  type SnippetFocus,
  type WireLabelledFinding,
} from './mask-highlight';

/** The tokens a segment list marked as masked, in order. */
function maskedTokens(text: string): string[] {
  return splitMaskSegments(text).filter((s) => s.masked).map((s) => s.text);
}

/**
 * Inspects the rendered spans WITHOUT a DOM — the project's vitest runs with no
 * jsdom (see shared/ui/route-error-boundary.test.tsx), and React elements carry
 * everything these assertions need in `props`.
 */
type Span = ReactElement<{ children: string; style?: { color?: string } }>;
function spans(text: string, focus?: SnippetFocus | null) {
  return (renderMaskedSnippet(text, focus) as unknown as Span[]).map((s) => ({
    text: s.props.children,
    highlighted: s.props.style?.color === 'var(--primary-dim)',
  }));
}
/** Exactly the string the reader sees, tokens substituted and all. */
const onScreen = (text: string, focus?: SnippetFocus | null) =>
  spans(text, focus).map((s) => s.text).join('');
/** The tokens drawn in amber, in order. */
const amber = (text: string, focus?: SnippetFocus | null) =>
  spans(text, focus).filter((s) => s.highlighted).map((s) => s.text);

describe('mask-highlight — restorable placeholders ({{…}}, P1 2026-08-08)', () => {
  it('highlights the numbered form the proxy forwards', () => {
    expect(maskedTokens('请寄到 {{ADDR_1}} 谢谢')).toEqual(['{{ADDR_1}}']);
  });

  it('highlights the numberless form the detector writes', () => {
    expect(maskedTokens('请寄到 {{ADDR}} 谢谢')).toEqual(['{{ADDR}}']);
  });

  it('is entity-agnostic — no short code is hard-coded in the frontend', () => {
    // Every code in the planner's shipped table (defaultLabelCodes) plus a
    // hypothetical future one: the pattern must not need a frontend edit when
    // the detector adds an entity.
    const codes = [
      'ADDR', 'IDCARD', 'PHONE', 'BANKCARD', 'EMAIL', 'JWT', 'PASSWD',
      'DETAX', 'FIPID', 'PLPESEL', 'SEPNR', 'TRNID',
      'SOMEFUTUREENTITY9',
    ];
    for (const code of codes) {
      expect(isMaskToken(`{{${code}}}`)).toBe(true);
      expect(isMaskToken(`{{${code}_7}}`)).toBe(true);
    }
  });

  it('highlights every placeholder in a multi-entity snippet', () => {
    expect(maskedTokens('{{ADDR_1}} 手机 {{PHONE_2}} 身份证 {{IDCARD_3}}'))
      .toEqual(['{{ADDR_1}}', '{{PHONE_2}}', '{{IDCARD_3}}']);
  });

  it('does not highlight template interpolation quoted from user code', () => {
    // Handlebars/Jinja in a prompt is not a redaction — see the module comment.
    expect(maskedTokens('render("{{name}}", {{ user.id }})')).toEqual([]);
  });
});

describe('mask-highlight — legacy formats keep highlighting (no regression)', () => {
  it('keeps the star marker', () => {
    expect(maskedTokens('联系 ***PHONE*** 即可')).toEqual(['***PHONE***']);
  });

  it('keeps the bracket markers of non-restorable entities', () => {
    expect(maskedTokens('口令是 [password-redacted]')).toEqual(['[password-redacted]']);
    expect(maskedTokens('命中 [违规话术] 规则')).toEqual(['[违规话术]']);
    expect(maskedTokens('兜底 [redacted] 标记')).toEqual(['[redacted]']);
  });

  it('keeps the pre-2026-08-08 address label found in historical rows', () => {
    expect(maskedTokens('请寄到 [地址#1(已隐藏)] 谢谢')).toEqual(['[地址#1(已隐藏)]']);
  });

  it('highlights old and new formats side by side (upgrade window)', () => {
    expect(maskedTokens('{{ADDR_1}} 和 [地址#2(已隐藏)] 和 ***PHONE***'))
      .toEqual(['{{ADDR_1}}', '[地址#2(已隐藏)]', '***PHONE***']);
  });
});

describe('mask-highlight — segmentation', () => {
  it('preserves the surrounding text verbatim and in order', () => {
    const segs = splitMaskSegments('a{{ADDR_1}}b');
    expect(segs).toEqual([
      { text: 'a', masked: false },
      { text: '{{ADDR_1}}', masked: true },
      { text: 'b', masked: false },
    ]);
  });

  it('returns nothing for an empty snippet', () => {
    expect(splitMaskSegments('')).toEqual([]);
  });

  it('leaves a snippet with no tokens as one plain segment', () => {
    expect(splitMaskSegments('nothing masked here')).toEqual([
      { text: 'nothing masked here', masked: false },
    ]);
  });

  it('is stateless across calls (no leaked regex lastIndex)', () => {
    // A `g` flag on the anchored tester would make every OTHER call miss.
    for (let i = 0; i < 4; i++) expect(isMaskToken('{{ADDR_1}}')).toBe(true);
  });
});

/**
 * ── 发出形态 in the snippet (2026-08-11) ─────────────────────────────────────
 *
 * 用户: 「编号直接在脱敏片段里显示，不要单独一行」+「多片段，只有当前片段用黄色，
 * 其他用默认颜色即可」.
 *
 * The whole difficulty is CORRESPONDENCE. A finding card's snippet is a WINDOW
 * around the match, so it routinely contains other findings' placeholders, and
 * the detector writes them all numberless. One card carries exactly ONE number
 * (its `wire_label`). Putting that number on the wrong token is worse than
 * printing no number at all: the reader would conclude 张先生's phone left as
 * `{{PHONE_2}}` when it left as `{{PHONE_1}}`.
 *
 * THE LOAD-BEARING RULE: the highlighted token is THIS finding's own — never
 * "the first one", never "any one of them".
 *
 * 能红 for that rule: make `resolveWireLabelFocus` return `occurrence: 0`
 * unconditionally, or make `renderMaskedSnippet` spotlight the first mask token
 * it finds. The 命中2 cases below then fail with the number on 张先生's token.
 *
 * The fixtures are the real 2026-08-11 rows (event 13a4df63…, two findings whose
 * windows overlap), reduced to the two fields the resolver reads.
 */
const HIT_1: WireLabelledFinding = {
  redacted_snippet: '请核对两位[redacted]人：张先生 {{PHONE}}，李女士 {{PHONE}}，哪个是主号？',
  wire_label: '{{PHONE_1}}',
};
const HIT_2: WireLabelledFinding = {
  redacted_snippet: '[redacted]人：张先生 {{PHONE}}，李女士 {{PHONE}}，哪个是主号？',
  wire_label: '{{PHONE_2}}',
};
const EVENT = [HIT_1, HIT_2];

describe('mask-highlight — 🔴 the highlighted token is THIS finding\'s own', () => {
  it('命中1 numbers 张先生 (the FIRST token), not 李女士', () => {
    const focus = resolveWireLabelFocus(HIT_1, EVENT);
    expect(focus).toEqual({ token: '{{PHONE}}', occurrence: 0, label: '{{PHONE_1}}' });
    expect(onScreen(HIT_1.redacted_snippet!, focus))
      .toBe('请核对两位[redacted]人：张先生 {{PHONE_1}}，李女士 {{PHONE}}，哪个是主号？');
  });

  it('命中2 numbers 李女士 (the SECOND token), not 张先生', () => {
    const focus = resolveWireLabelFocus(HIT_2, EVENT);
    expect(focus).toEqual({ token: '{{PHONE}}', occurrence: 1, label: '{{PHONE_2}}' });
    // 🔴 If the implementation spotlights "the first placeholder", this line
    // reads 「张先生 {{PHONE_2}}」 — the 张冠李戴 the whole rule exists to stop.
    expect(onScreen(HIT_2.redacted_snippet!, focus))
      .toBe('[redacted]人：张先生 {{PHONE}}，李女士 {{PHONE_2}}，哪个是主号？');
  });

  it('amber is on exactly one token per card — the neighbours go plain', () => {
    expect(amber(HIT_1.redacted_snippet!, resolveWireLabelFocus(HIT_1, EVENT))).toEqual(['{{PHONE_1}}']);
    expect(amber(HIT_2.redacted_snippet!, resolveWireLabelFocus(HIT_2, EVENT))).toEqual(['{{PHONE_2}}']);
  });

  it('leaves every other character of the snippet untouched', () => {
    // Display-only: 方案 L keeps `redacted_snippet` byte-identical, so the ONLY
    // difference on screen is the focal token gaining its number.
    for (const hit of EVENT) {
      const before = onScreen(hit.redacted_snippet!);
      const after = onScreen(hit.redacted_snippet!, resolveWireLabelFocus(hit, EVENT));
      expect(after.replace(/\{\{PHONE_\d\}\}/, '{{PHONE}}')).toBe(before);
    }
  });

  it('a single same-code token needs no group at all', () => {
    const solo: WireLabelledFinding = { redacted_snippet: '手机 {{PHONE}} 谢谢', wire_label: '{{PHONE_3}}' };
    expect(resolveWireLabelFocus(solo, [solo])).toEqual({ token: '{{PHONE}}', occurrence: 0, label: '{{PHONE_3}}' });
    expect(onScreen(solo.redacted_snippet!, resolveWireLabelFocus(solo, [solo]))).toBe('手机 {{PHONE_3}} 谢谢');
  });

  it('picks the right token when the window holds several ENTITY types', () => {
    // Only same-code tokens are counted, so an address between the phones must
    // not shift the phone rank.
    const a: WireLabelledFinding = { redacted_snippet: '{{PHONE}} 住 {{ADDR}} 备用 {{PHONE}}', wire_label: '{{PHONE_1}}' };
    const b: WireLabelledFinding = { redacted_snippet: '{{PHONE}} 住 {{ADDR}} 备用 {{PHONE}}', wire_label: '{{PHONE_2}}' };
    const addr: WireLabelledFinding = { redacted_snippet: '{{PHONE}} 住 {{ADDR}} 备用 {{PHONE}}', wire_label: '{{ADDR_1}}' };
    const ev = [a, b, addr];
    expect(onScreen(a.redacted_snippet!, resolveWireLabelFocus(a, ev))).toBe('{{PHONE_1}} 住 {{ADDR}} 备用 {{PHONE}}');
    expect(onScreen(b.redacted_snippet!, resolveWireLabelFocus(b, ev))).toBe('{{PHONE}} 住 {{ADDR}} 备用 {{PHONE_2}}');
    expect(onScreen(addr.redacted_snippet!, resolveWireLabelFocus(addr, ev))).toBe('{{PHONE}} 住 {{ADDR_1}} 备用 {{PHONE}}');
  });

  it('reads a code that ends in a digit without eating its sequence number', () => {
    const f: WireLabelledFinding = { redacted_snippet: 'x {{ID2}} y', wire_label: '{{ID2_4}}' };
    expect(resolveWireLabelFocus(f, [f])).toEqual({ token: '{{ID2}}', occurrence: 0, label: '{{ID2_4}}' });
  });
});

describe('mask-highlight — 🔴 unresolvable degrades to the plain snippet', () => {
  /** The pre-feature rendering: every mask token amber, text verbatim. */
  const asBefore = (snippet: string) => {
    expect(onScreen(snippet, resolveWireLabelFocus({ redacted_snippet: snippet }, []))).toBe(snippet);
  };

  it('no wire_label at all (Personal lane, audit-only, capped, degrade, old rows)', () => {
    const f: WireLabelledFinding = { redacted_snippet: '张先生 {{PHONE}}，李女士 {{PHONE}}' };
    expect(resolveWireLabelFocus(f, [f])).toBeNull();
    asBefore(f.redacted_snippet!);
    // 🔴 And nothing EXTRA is drawn: same span count, same tokens, as if the
    // feature did not exist. (「把没有值误读成版本太旧」 — 2026-08-10 bugfix.)
    expect(spans(f.redacted_snippet!, null)).toEqual(spans(f.redacted_snippet!));
    expect(amber(f.redacted_snippet!, null)).toEqual(['{{PHONE}}', '{{PHONE}}']);
  });

  it('an unlabelled sibling in the window (the group cannot be trusted)', () => {
    const labelled: WireLabelledFinding = { redacted_snippet: '{{PHONE}} 和 {{PHONE}}', wire_label: '{{PHONE_1}}' };
    const unlabelled: WireLabelledFinding = { redacted_snippet: '{{PHONE}} 和 {{PHONE}}' };
    expect(resolveWireLabelFocus(labelled, [labelled, unlabelled])).toBeNull();
  });

  it('a window that sees only PART of the group (ranks would shift)', () => {
    // Three phones in the request; the third one's window shows two of them, so
    // "which two" is unknowable from the text — degrade rather than guess.
    const g = [
      { redacted_snippet: '{{PHONE}} {{PHONE}} {{PHONE}}', wire_label: '{{PHONE_1}}' },
      { redacted_snippet: '{{PHONE}} {{PHONE}} {{PHONE}}', wire_label: '{{PHONE_2}}' },
      { redacted_snippet: '{{PHONE}} {{PHONE}}', wire_label: '{{PHONE_3}}' },
    ];
    for (const f of g) expect(resolveWireLabelFocus(f, g)).toBeNull();
  });

  it('non-consecutive numbering (a sibling of the group is missing)', () => {
    const g = [
      { redacted_snippet: '{{PHONE}} {{PHONE}}', wire_label: '{{PHONE_1}}' },
      { redacted_snippet: '{{PHONE}} {{PHONE}}', wire_label: '{{PHONE_3}}' },
    ];
    // Numbers 1 and 3 with two tokens in view: the tokens could be (1,2) or
    // (2,3) — 张冠李戴 territory.
    for (const f of g) expect(resolveWireLabelFocus(f, g)).toBeNull();
  });

  it('a numberless wire_label next to several tokens', () => {
    const f: WireLabelledFinding = { redacted_snippet: '{{PHONE}} 和 {{PHONE}}', wire_label: '{{PHONE}}' };
    expect(resolveWireLabelFocus(f, [f])).toBeNull();
  });

  it('a wire_label whose code is not in the snippet at all', () => {
    const f: WireLabelledFinding = { redacted_snippet: '住址 {{ADDR}}', wire_label: '{{PHONE_1}}' };
    expect(resolveWireLabelFocus(f, [f])).toBeNull();
  });

  it('a malformed wire_label', () => {
    for (const bad of ['', 'PHONE_1', '{{phone_1}}', '{{PHONE_1}', '***PHONE***']) {
      expect(resolveWireLabelFocus({ redacted_snippet: '{{PHONE}}', wire_label: bad }, [])).toBeNull();
    }
  });

  it('the eye is open, so the RAW text is on screen and there is no token to point at', () => {
    // The self-view swaps in `context_snippet` behind the eye; a focus computed
    // from the masked form must not latch onto anything there.
    const raw = '张先生 13800138000，李女士 13900139000';
    const focus: SnippetFocus = { token: '{{PHONE}}', occurrence: 1, label: '{{PHONE_2}}' };
    expect(onScreen(raw, focus)).toBe(raw);
    expect(amber(raw, focus)).toEqual([]);
  });

  it('never falls back to spotlighting "the first token" when the focus misses', () => {
    // 🔴 The degrade path must widen (all amber), never narrow onto a guess.
    const snippet = '{{PHONE}} 和 {{PHONE}}';
    const missing: SnippetFocus = { token: '{{PHONE}}', occurrence: 5, label: '{{PHONE_6}}' };
    expect(onScreen(snippet, missing)).toBe(snippet);
    expect(amber(snippet, missing)).toEqual(['{{PHONE}}', '{{PHONE}}']);
  });
});
