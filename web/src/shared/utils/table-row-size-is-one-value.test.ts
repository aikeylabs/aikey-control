// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * TABLE ROWS ARE ONE SIZE.
 *
 * # Why this exists (2026-09-08)
 *
 * A user reported that table rows looked a different size in the master console
 * than in the personal one. Counting every cell in both trees showed the report
 * was real but the cause was not the one it named: of 291 `<td>`, 165 carried
 * NO size class and inherited 14px from `table td` in index.css, while 108 had
 * opted into `text-xs` (12px). The split was ~50/50 in BOTH apps and in nearly
 * identical proportions (52/36 personal, 58/37 master), so it was never
 * master-vs-personal — it was page-vs-page, and the two apps only made it
 * visible because a user moved between them.
 *
 * The baseline is now 0.75rem, so a cell with no class and a cell with
 * `text-xs` agree. This fence stops the OTHER half from coming back: a page
 * that declares its own row size drifts away from every other page silently,
 * because nothing renders both pages side by side.
 *
 * # Why a scan and not a review checklist
 *
 * There is no shared Table component — 40 files hand-roll their own markup.
 * That is the root cause and it is not fixed here; until it is, "one size" can
 * only be enforced by reading all 40.
 *
 * # What is deliberately NOT a violation
 *
 * A `colSpan` cell is not a data row. It is an annotation stretched across the
 * table — "this department has nobody in it", a conservation warning — and
 * those are allowed to be quieter than the rows they comment on. They are
 * skipped structurally rather than listed, so a new one needs no maintenance.
 *
 * 能红: give any `<td>` or `<table>` a `text-sm` / `text-[13px]` / similar.
 */

const SRC = path.resolve(process.cwd(), 'src');

/**
 * Whole files whose table is NOT a data table.
 *
 * 🚫 Keep this to tables that are a different KIND of thing. "This page looks
 * better a bit smaller" is the drift the fence exists to catch, not an entry.
 */
const NON_DATA_TABLES: Array<{ file: string; why: string }> = [
  // Personal has no non-data tables today. The list is kept (rather than the
  // concept dropped) because master has one, and the two trees carry the same
  // fence on purpose — see the copy in aikey-control-master.
];

/** Only this. `text-xs` matches the `table td` baseline in index.css. */
const ALLOWED = 'text-xs';
const SIZE = /text-(?:sm|base|lg|xl|\[[0-9.]+(?:px|rem)\])/;
const TAG = /<(td|table)\b[^>]*?className="([^"]*)"[^>]*?>/gs;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

describe('table rows are one size', () => {
  it('no page declares its own table row size', () => {
    const exempt = new Set(NON_DATA_TABLES.map((e) => path.resolve(SRC, e.file)));
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      if (exempt.has(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(TAG)) {
        // An annotation stretched across the table is not a data row.
        if (m[0].includes('colSpan')) continue;
        const hit = SIZE.exec(m[2]);
        if (!hit) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${path.relative(SRC, file)}:${line}  <${m[1]}> ${hit[0]}`);
      }
    }

    expect(offenders, `These table cells set their own size instead of taking the
one baseline. Rows then differ page to page, which is exactly the report this
fence was written for — and nothing renders two pages side by side, so it is
invisible until a user moves between them.

Use "${ALLOWED}" (or no size class at all — the baseline already is 12px):

${offenders.join('\n')}
`).toEqual([]);
  });

  it('the baseline itself is still 12px', () => {
    const css = fs.readFileSync(path.resolve(SRC, 'index.css'), 'utf8');
    const rule = /table td \{([^}]*)\}/.exec(css);
    expect(rule, 'the `table td` rule is gone from index.css').not.toBeNull();
    expect(
      rule![1],
      `The row baseline moved. 165 of 291 cells have no size class and take
their size from here, so this value IS the row size for most of both consoles.
If it is meant to change, the fence's ALLOWED class has to change with it or
the two halves split again.`,
    ).toMatch(/font-size:\s*0\.75rem/);
  });

  /**
   * An exemption list rots in the SAFE-LOOKING direction: a file that is
   * renamed or deleted leaves an entry that silently exempts nothing, and the
   * list keeps its reassuring length while covering less every release.
   */
  it('every exemption still points at a real file', () => {
    for (const e of NON_DATA_TABLES) {
      expect(fs.existsSync(path.resolve(SRC, e.file)), `${e.file} is exempted (${e.why}) but does not exist`).toBe(true);
    }
  });
});
