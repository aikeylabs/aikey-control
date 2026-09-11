// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A DRAWER PARKED OFF-CANVAS MUST NOT CAST A SHADOW INTO THE PAGE.
 *
 * # Why this exists (2026-09-11)
 *
 * `shared/ui/DetailDrawer.tsx` stays mounted while closed and is parked just
 * past the right edge with `translateX(100%)`. Its shadow — `-8px 0 32px`,
 * black at .6 — is cast to the LEFT, i.e. back into the viewport. So every page
 * that renders one showed a dark band down its right edge with no drawer open:
 * 3 Personal pages, 14 Master pages, and the desktop app (user-reported,
 * "there's a dark shadow on the right"). Measured in a browser on
 * /user/compliance: two closed drawers at left=1440 of a 1440px viewport, each
 * painting rgba(0,0,0,.6) inward.
 *
 * It shipped on 2026-05-07 and nobody saw it for four months because a black
 * shadow on a near-black ground is invisible; the light theme (2026-09-03)
 * exposed it. tsc, the build and every colour fence were green throughout —
 * the colour was legal, only the element's STATE was wrong.
 *
 * Bugfix: workflow/CI/bugfix/2026-09-11-closed-drawer-shadow-bleeds-into-page.md
 *
 * # What is checked
 *
 * An inline style that parks an element with `<flag> ? … : 'translateX(100%)'`
 * must condition its boxShadow on the same flag. CSS drawers that are only
 * MOUNTED when open (`<aside className="drawer" data-open="true">`) cannot bleed
 * and are out of scope.
 *
 * 能红: make DetailDrawer's boxShadow unconditional again, or add any inline
 * style that parks with translateX(100%) and casts a shadow regardless of state.
 */

const SRC = path.resolve(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

/** The `{{ … }}` object literal of a `style={{` starting at `at`, brace-aware. */
function styleObject(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

const PARKED = /(!?\w+)\s*\?\s*(['"`])[^'"`]*\2\s*:\s*(['"`])translateX\(100%\)\3/;

describe('a parked drawer casts no shadow into the page', () => {
  it('every element parked with translateX(100%) gates its boxShadow on the same flag', () => {
    const parked: string[] = [];
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/style=\{\{/g)) {
        const obj = styleObject(src, m.index! + 'style='.length);
        const p = PARKED.exec(obj);
        if (!p) continue;
        const where = `${path.relative(SRC, file)}:${src.slice(0, m.index).split('\n').length}`;
        parked.push(where);
        const flag = p[1].replace(/^!/, '');
        const shadow = /boxShadow\s*:\s*([^,\n]+(?:\n\s*[?:][^,\n]+)*)/.exec(obj);
        if (shadow && !new RegExp(`^!?${flag}\\s*\\?`).test(shadow[1].trim())) {
          offenders.push(`${where}  boxShadow: ${shadow[1].trim()}`);
        }
      }
    }

    // A scan that finds nothing to check proves nothing. DetailDrawer is the
    // reason this fence exists; if it stops matching, the fence went blind.
    expect(parked, 'no element parked with translateX(100%) was found — the scan no longer sees DetailDrawer').not.toEqual([]);

    expect(offenders, `These elements are parked just past the right edge while closed, but their
shadow is always on. A left-cast shadow on an off-canvas element paints INTO the
viewport — a dark band down the page's right edge with nothing open (invisible
on dark, glaring on light).

Gate it on the same flag: boxShadow: open ? '<shadow>' : 'none'

${offenders.join('\n')}
`).toEqual([]);
  });
});
