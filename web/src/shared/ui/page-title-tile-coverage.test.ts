// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-10: /user/apps shipped with no title icon while every other page had
// one. The page renders its header in TWO branches — an empty state and the
// main list — and only the first was wrapped. tsc was happy, all tests passed,
// and the gap only showed up by loading the page in a browser.
//
// The shape recurs: any page with a loading / empty / error early-return repeats
// its header, and "I edited the header" quietly means "I edited one of them".
// This fence counts them instead of trusting that.
//
// RULE: within one page file, if any hand-rolled title row is wrapped in
// <PageTitleRow>, they all must be. (Pages that use <PageHeader> get the tile
// from the component and are not counted here.)
//
// 能红: unwrap one branch's <PageTitleRow> in a page that has two.
const WEBS = [
  { label: 'personal', root: 'src/pages' },
  { label: 'master', root: '../../aikey-control-master/web/src/pages' },
];

// Hand-rolled title rows.
//
// 🔴 Matched by ELEMENT, not by class string. The first version of this fence
// keyed off `className="text-lg font-bold font-mono tracking-wide` and so was
// blind to three pages the user then reported by hand on 2026-08-10:
// access-tokens and my-seats write the same classes in a different ORDER
// (`text-lg font-mono font-bold tracking-widest`), and trust-check styles its
// title through a CSS class (`tc-title`) with no Tailwind at all. A fence keyed
// to one spelling of a style can only see the pages that happened to be typed
// that way; <h1> is the thing every page actually has.
const TITLE_ROW = /<h1\b/g;

// Pages that legitimately show no tile. An entry here is a DECISION with a
// reason attached; the point of listing them is that a page cannot go
// tile-less by accident — which is exactly how access-tokens, my-seats and
// trust-check shipped without one and had to be reported by hand.
//
// 🔴 The five guide/settings pages below are a different archetype: a 24–42px
// display title in a centred column, not the 18px console header the tile was
// designed against. Whether they should carry one is a design call, not a
// defect — pending with the user as of 2026-08-10.
const TILE_EXEMPT: Record<string, string> = {
  'user/browser-profile-guide': 'hero guide page, 24px display title',
  'user/cli-guide': 'hero landing page, clamp(30px,4vw,42px) title',
  // Same standalone hero-landing pattern as cli-guide (superdesign draft
  // 9fb9c33b, 2026-08-18): centered clamp() title, no shell, no tile row.
  'user/app-guide': 'hero landing page, clamp(30px,4vw,42px) title',
  'user/app-usage': 'hero landing page, clamp() title (superdesign 25e14f3d)',
  'user/settings': 'centred settings column, 28px display title',
  'user/overview': 'its tile is the account avatar (user initial), not a glyph',
  'user/oauth-contribute': 'renders its own tile',
  'user/virtual-keys': 'renders its own tile — the reference layout',
  'master/settings': 'centred settings column, 24px display title',
  'master/cluster-health': '24px display title',
};

// Non-page <h1>s: headings inside a wizard step or modal that happen to use
// h1. Counted out explicitly rather than excluded by a cleverer regex, so a
// NEW h1 in these files still has to be accounted for.
const NON_PAGE_H1: Record<string, number> = {
  'user/vault': 2, // "Add credential · 1 of 2" / "Test and name · 2 of 2" drawer steps
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name === 'index.tsx') out.push(p);
  }
  return out;
}

describe('every branch of a page shows the title tile', () => {
  for (const { label, root } of WEBS) {
    it(`${label}: no page wraps only some of its title rows`, () => {
      const abs = path.resolve(process.cwd(), root);
      const files = walk(abs);
      expect(files.length, 'no pages found — the walk root moved').toBeGreaterThan(10);

      const partial: string[] = [];
      const missing: string[] = [];
      for (const file of files) {
        const src = fs.readFileSync(file, 'utf-8');
        const page = path.dirname(path.relative(abs, file));
        // Pages driven by <PageHeader> render no <h1> of their own — the
        // component does, and it already carries the tile.
        const handRolled = (src.match(TITLE_ROW) ?? []).length - (NON_PAGE_H1[page] ?? 0);
        if (handRolled <= 0) continue;
        // Three ways to carry the tile: PageTitleRow (tile + title block), a
        // bare PageTitleTile for a header whose own flex layout cannot take the
        // wrapper (trust-check), or PageTitleGlyph inside the page's own tile
        // (usage-detail keeps `.ud-icon`).
        const wrapped = (src.match(/<PageTitleRow>|<PageTitleTile\s*\/>|<PageTitleGlyph\b/g) ?? []).length;
        if (wrapped === 0) {
          // ABSENCE IS REPORTED, NOT SKIPPED. The previous version read zero as
          // "the page opted out" and moved on, so a page that simply never got
          // a tile was indistinguishable from one that declined it — the user
          // had to find /user/access-tokens, /user/trust-check and /user/vault
          // by opening them.
          if (!(page in TILE_EXEMPT)) missing.push(page);
          continue;
        }
        // Otherwise every branch must have one.
        if (wrapped < handRolled) {
          partial.push(`${page}: ${wrapped} of ${handRolled} title rows wrapped`);
        }
      }
      expect(missing, 'these pages show a title with no icon tile. Add <PageTitleRow> '
        + '(or <PageTitleTile> / <PageTitleGlyph> if the header has its own layout), or '
        + 'list the page in TILE_EXEMPT with the reason it declines one').toEqual([]);
      expect(partial, 'a page wraps its title in one branch but not another — the icon '
        + 'disappears on whichever state the reviewer did not open (2026-08-10: /user/apps '
        + 'had a tile in its empty state and none in the main list)').toEqual([]);
    });
  }
});
