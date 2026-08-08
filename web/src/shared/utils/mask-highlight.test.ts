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
import { describe, it, expect } from 'vitest';

import { splitMaskSegments, isMaskToken } from './mask-highlight';

/** The tokens a segment list marked as masked, in order. */
function maskedTokens(text: string): string[] {
  return splitMaskSegments(text).filter((s) => s.masked).map((s) => s.text);
}

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
