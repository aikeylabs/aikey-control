// @ts-nocheck — vitest-only file using Node built-ins (fs/path); the project
// doesn't ship @types/node, so the project-wide `tsc --noEmit` would reject
// these imports. Same pragma rationale as the other source-scanning fences.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FilterTokenBar size scale + searchOnly fence (2026-08-11).
 *
 * Two invariants, both of which are one careless edit away from silently
 * breaking a page, and neither of which any existing test covers.
 *
 * ── 1. searchOnly must leave the BROWSE list but stay in the MATCH list ──
 *
 * `searchOnly` means "do not enumerate this dimension's values on screen, but
 * still find them when the user types". That is expressed as TWO derived lists:
 *
 *     listDims  = !keyword && !searchOnly   → left pane (browse)
 *     matchDims = !keyword                  → value-first search (find)
 *
 * The tempting simplification is to notice both filters start with `!keyword`
 * and collapse them back into one. Doing so makes every searchOnly dimension
 * unreachable: it is not listed AND not findable, so the page looks like it
 * simply lost a filter. On seats that would silently remove the only way to
 * find a member; on packs / control-events / quota it would remove the only
 * filter the page has.
 *
 * ── 2. the `lg` preset is the pre-size-scale geometry, to the pixel ──
 *
 * Five pages (usage-audit, bindings, virtual-keys, provider-accounts, seats)
 * never opted into a size and therefore render at `lg`. Those numbers are their
 * CURRENT appearance, not a default worth tuning — editing them restyles five
 * pages that nobody touched.
 *
 * 能红: collapse listDims/matchDims into one filter, or change an `lg` number,
 * and this test names it.
 */

const BAR = path.resolve(process.cwd(), 'src/shared/ui/FilterTokenBar.tsx');
const src = fs.readFileSync(BAR, 'utf-8');

describe('FilterTokenBar: searchOnly is browse-exclusion only', () => {
  it('listDims excludes searchOnly, matchDims does NOT', () => {
    // The browse list drops both flags…
    expect(src, 'listDims no longer excludes searchOnly — searchOnly values would be listed on screen')
      .toMatch(/const\s+listDims\s*=\s*useMemo\(\s*\(\)\s*=>\s*dimensions\.filter\(\(d\)\s*=>\s*!d\.keyword\s*&&\s*!d\.searchOnly\)/);
    // …the match list drops ONLY keyword. This is the half that gets lost.
    expect(src, 'matchDims now excludes searchOnly — those dimensions became unfindable, not just unlisted')
      .toMatch(/const\s+matchDims\s*=\s*useMemo\(\s*\(\)\s*=>\s*dimensions\.filter\(\(d\)\s*=>\s*!d\.keyword\)/);
    // …and they must stay two distinct names.
    expect(src.match(/const\s+listDims\s*=/g) ?? []).toHaveLength(1);
    expect(src.match(/const\s+matchDims\s*=/g) ?? []).toHaveLength(1);
  });

  it('value-first search enumerates matchDims, not listDims', () => {
    // The valRows flatMap is the ONE place a searchOnly dimension can surface.
    expect(src, 'valRows reads listDims — searchOnly dimensions can never be found')
      .toMatch(/const\s+valRows:\s*Suggestion\[\]\s*=\s*matchDims\.flatMap/);
    // Dimension-NAME rows stay browse-only: a 'dim' row opens a value list,
    // which is exactly what searchOnly must not offer.
    expect(src, "dimRows reads matchDims — a searchOnly dimension would offer a browsable '▸' row")
      .toMatch(/const\s+dimRows:\s*Suggestion\[\]\s*=\s*listDims\b/);
  });

  it('the left pane is skipped when nothing is browsable', () => {
    // Without the length guard an all-searchOnly page renders an empty rail
    // with a right border, which reads as a broken pane rather than as a
    // single-column dropdown.
    expect(src, 'empty-listDims guard is gone — all-searchOnly pages render an empty dimension rail')
      .toMatch(/!searchMode\s*&&\s*listDims\.length\s*>\s*0\s*&&/);
  });
});

describe('FilterTokenBar: size scale', () => {
  it("the 'lg' preset still carries the original hardcoded geometry", () => {
    // These five numbers ARE the appearance of the five pages that never opted
    // into a size. They came from the 2026-07-29 design and are not defaults.
    const lg = src.match(/lg:\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(lg, 'regex rot: the lg preset was not found').not.toBe('');
    for (const [field, value] of [
      ['width', 520],
      ['dimPaneWidth', 180],
      ['rowHeight', 30],
      ['maxBodyHeight', 300],
    ] as Array<[string, number]>) {
      expect(lg, `lg.${field} changed — this restyles usage-audit / bindings / virtual-keys / provider-accounts / seats, none of which asked for a size`)
        .toMatch(new RegExp(`${field}:\\s*${value}\\b`));
    }
  });

  it('the scale is monotonic: sm < md < lg on every metric', () => {
    // A preset that is smaller in width but taller in rows is not a "size", it
    // is a one-off restyle. Monotonicity is what makes `size` mean one thing.
    const read = (name: string): Record<string, number> => {
      const body = src.match(new RegExp(`${name}:\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      const out: Record<string, number> = {};
      for (const m of body.matchAll(/(\w+):\s*(\d+)/g)) out[m[1]] = Number(m[2]);
      return out;
    };
    const sm = read('sm'), md = read('md'), lg = read('lg');
    for (const field of ['width', 'dimPaneWidth', 'rowHeight', 'maxBodyHeight']) {
      expect(sm[field], `sm.${field} is not smaller than md.${field}`).toBeLessThan(md[field]);
      expect(md[field], `md.${field} is not smaller than lg.${field}`).toBeLessThan(lg[field]);
    }
  });

  it('HEIGHT is not part of the scale — one constant for every size', () => {
    // 🔴 The 2026-08-11 regression, fenced. `size` scaling height put three
    // different control heights across the console and misaligned the token bar
    // against its own row-mates on nine pages. A toolbar reads as one
    // horizontal line: 4px short looks broken, not smaller.
    //
    // 能红: add `barMinHeight` back to the presets, or apply spec.<anything> to
    // the bar's minHeight, and this fires.
    expect(src, 'a per-size height is back in the presets — cross-page filter rows will misalign again')
      .not.toMatch(/barMinHeight/);
    expect(src, 'FILTER_ROW_HEIGHT is gone — the canonical 38px filter-row height lost its single definition')
      .toMatch(/const\s+FILTER_ROW_HEIGHT\s*=\s*38\b/);
    // …and the bar must consume THAT, not a size-derived value.
    expect(src, "the bar's minHeight no longer reads FILTER_ROW_HEIGHT")
      .toMatch(/minHeight:\s*FILTER_ROW_HEIGHT/);
    expect(src, 'minHeight is being derived from the size spec again')
      .not.toMatch(/minHeight:\s*spec\./);
  });

  it('width drives BOTH the input and the popover from one number', () => {
    // The bug this replaced: the popover carried its own `w-[520px]` while each
    // page wrapped the input in a separate `w-[520px]`, so narrowing a page left
    // the popover hanging off the edge of its own input.
    // Scoped to className, not the whole file: the doc comments name the old
    // `w-[520px]` on purpose, to explain what this replaced.
    expect(src, 'a hardcoded w-[520px] className is back — input and popover width can drift apart again')
      .not.toMatch(/className="[^"]*w-\[520px\]/);
    expect(src.match(/width:\s*spec\.width/g) ?? [], 'width must come from spec in exactly two places (input + popover)')
      .toHaveLength(2);
  });
});
