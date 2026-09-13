import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance, type i18n as I18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import type { ReactNode } from 'react';
import enCommon from '@/shared/i18n/locales/en/common.json';
import zhCommon from '@/shared/i18n/locales/zh/common.json';
import {
  LEVEL_BADGE_VARIANTS,
  LevelBadge,
  levelBadgeVariant,
  type LevelLabels,
} from './level-badge';

/**
 * Fences for the ONE sensitivity-level badge (R-compliance-grading-7.S1,
 * 4.S1 · task 4.6).
 *
 * WHY A SHARED COMPONENT AT ALL
 * -----------------------------
 * The partner implementation this feature merges from hand-copied its L1–L5
 * colour chain into EIGHT files, and two of the eight ended up drawing L4 and
 * L5 the same (research-合作方设计深读与融合设计.md §230). Nothing went red:
 * every copy compiled, every copy rendered, and the only symptom was that the
 * two highest grades became indistinguishable on screen — in a console whose
 * whole job is to tell an auditor how sensitive the leaked text was.
 *
 * So this component is the single exit, and the assertions below are what
 * "single exit" has to mean in practice:
 *
 *   1. The five colours are pairwise DISTINCT. Same shape, same reason, as
 *      COMPLIANCE_ACTION_BADGE_VARIANT's distinctness fence next door.
 *   2. Absent level renders NOTHING — not a guess, not a placeholder chip.
 *   3. The customer's word for a level comes from the backend `labels`
 *      document, never from this tree.
 *
 * 🔴 Rule 3 is the load-bearing one. `labels` is the customer's own naming
 * ({"4":"商密"}); a different customer calls L4 something else entirely. Any
 * name written down here is wrong for everyone but the one org it was copied
 * from, and it is wrong SILENTLY — the badge still renders, it just lies.
 * level-action-literal.test.ts (aikey-control-master/web) is the source scan
 * that keeps such a literal out of the whole web surface; this file pins the
 * behaviour that makes the scan enforceable.
 *
 * No DOM: the project's vitest runs without jsdom, so these render through
 * react-dom/server. That is a REAL render of the real component — "0 nodes"
 * is an empty markup string, which is exactly the observable 4.A7 asks for.
 */

function withCopy(lng: 'zh' | 'en'): I18n {
  const i18n = createInstance();
  // The REAL shipped catalogues, not a hand-written stub: the assertion below
  // is about the bytes a user sees, so a stub would only test itself.
  i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    resources: { en: { common: enCommon }, zh: { common: zhCommon } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return i18n;
}

function render(lng: 'zh' | 'en', node: ReactNode): string {
  return renderToStaticMarkup(<I18nextProvider i18n={withCopy(lng)}>{node}</I18nextProvider>);
}

const LABELS: LevelLabels = { '1': '公开', '2': '内部', '3': '敏感', '4': '商密', '5': '国密' };

describe('LevelBadge — absent level claims nothing', () => {
  // 4.A7: GIVEN `level` 缺省 WHEN 渲染 <LevelBadge> THEN 0 个节点.
  //
  // An older detector does not report a grade at all. Drawing "L1" or "—" for
  // that case is the 2026-08-10 「blames old detector」 defect shape: the
  // console states, about data it never received, something the reader will
  // act on. Nothing is the honest render.
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('renders zero nodes when level is %s', (_name, level) => {
    expect(render('zh', <LevelBadge level={level as undefined} labels={LABELS} />)).toBe('');
  });

  it('renders zero nodes when level is absent even with no labels at all', () => {
    expect(render('zh', <LevelBadge level={undefined} />)).toBe('');
  });
});

describe('LevelBadge — the name comes from the backend document', () => {
  // 4.A7: labels["4"]="商密" THEN 文案「敏感等级 L4·商密」.
  it('renders 敏感等级 L4·商密 for labels["4"]="商密"', () => {
    const html = render('zh', <LevelBadge level={4} labels={LABELS} />);
    expect(html).toContain('敏感等级 L4·商密');
  });

  it('uses whatever the customer called it — the component owns no vocabulary', () => {
    // Same level, a different org's document. A component with the name baked
    // in would still print 商密 here, and nothing else in the tree would notice.
    const html = render('zh', <LevelBadge level={4} labels={{ '4': 'PROPRIETARY-α' }} />);
    expect(html).toContain('L4·PROPRIETARY-α');
    expect(html).not.toContain('商密');
  });

  it('states the level without a name when the document has none for it', () => {
    // Master's intake nils out a level that is not a key in `labels`
    // (service/internal/compliance/intake_level.go), so this is defence in
    // depth rather than an expected path — but if it ever arrives, the level
    // is a fact we were given and the name is not. Print the fact, drop the
    // rest; do NOT invent a name and do NOT swallow the level.
    const html = render('zh', <LevelBadge level={4} labels={{}} />);
    expect(html).toContain('敏感等级 L4');
    expect(html).not.toContain('·');
  });

  it('translates only the prefix — the label is the customer\'s own bytes', () => {
    const html = render('en', <LevelBadge level={4} labels={LABELS} />);
    expect(html).toContain('L4·商密');
    expect(html).not.toContain('敏感等级');
  });
});

describe('LevelBadge — colour is a function of the ordinal, and one map only', () => {
  // The partner defect, verbatim: L4 and L5 drawn the same. Pairwise
  // distinctness is the only assertion that can see it.
  it('gives L1–L5 five pairwise-distinct variants', () => {
    const variants = [1, 2, 3, 4, 5].map(levelBadgeVariant);
    expect(new Set(variants).size, `two grades share a colour: ${variants.join(', ')}`).toBe(5);
  });

  it('exposes the map as one table, not a chain of branches', () => {
    // Anti-vacuity for the source scan in level-action-literal.test.ts: that
    // fence proves "no SECOND map exists" and needs the first one to be here,
    // under this name, to have something to be the exception to.
    expect(Object.keys(LEVEL_BADGE_VARIANTS).sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('clamps out-of-range levels to the ends instead of rendering unstyled', () => {
    // The document is defined over L1–L5 (proposal.md 名词字典). A server one
    // version ahead is not a reason to drop the chip on the floor.
    expect(levelBadgeVariant(9)).toBe(levelBadgeVariant(5));
    expect(levelBadgeVariant(0)).toBe(levelBadgeVariant(1));
  });
});

describe('LevelBadge — its own slot, never the password-tier chip', () => {
  // R-compliance-grading-7.S1「密码档徽标文案不变；等级徽标另占位」. The two
  // are different concepts that both got called 「级」 (proposal.md 拍板点 24):
  // password tier = how much the DETECTOR was allowed to infer; sensitivity
  // level = how secret the DATA is. Sharing one chip would let a reader read
  // 「高级级」 as 「高敏感等级」.
  it('renders exactly one self-contained element and none of the password-tier copy', () => {
    const html = render('zh', <LevelBadge level={4} labels={LABELS} />);
    expect(html.match(/<span/g) ?? []).toHaveLength(1);
    for (const key of [
      'compliancePage.passwordTier.advancedBadge',
      'compliancePage.passwordTier.basicBadge',
      'compliancePage.passwordTier.rowLabel',
    ]) {
      const copy = (zhCommon as Record<string, any>).compliancePage.passwordTier[
        key.split('.').pop() as string
      ];
      expect(typeof copy, `${key} must exist for this assertion to mean anything`).toBe('string');
      expect(html).not.toContain(copy);
    }
  });
});
