// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-11 user report: the Claude mark in list rows read as a loading
// spinner. It was not merely similar to one — it WAS one, geometrically:
//
//   'M12 3v4','M12 17v4','M3 12h4','M17 12h4', + four 45° diagonals
//   → eight EQUAL rays, EQUAL angular spacing, EMPTY centre
//
// That is the standard way a spinner is drawn, and the glyph sat at the left
// edge of list rows — exactly where a loading indicator would appear. Replaced
// with the official Claude mark (Simple Icons `claude`, CC0-1.0): many rays of
// unequal length, tapered, no rotational symmetry.
//
// RULE: the mark must stay the official one. A future "let me simplify this
// 1.8KB path" is how the spinner shape comes back — the property that makes the
// official mark safe (asymmetry) is exactly what a simplification destroys.
const MASTER = path.resolve(process.cwd(), 'src/shared/ui/ToolGlyph.tsx');
const PEER = path.resolve(process.cwd(), '../../aikey-control/web/src/shared/ui/ToolGlyph.tsx');
const PAGE_LOCAL = path.resolve(
  process.cwd(),
  '../../aikey-control/web/src/pages/user/_shared/tool-glyph.tsx',
);

/** The official mark's opening and closing subpath commands. */
const SI_CLAUDE_HEAD = 'm4.7144 15.9555 4.7174-2.6471';
const SI_CLAUDE_TAIL = '1.9064-1.3114Z';

function claudePaths(src: string): string[] {
  const block = /claude: \[([\s\S]*?)\],/.exec(src);
  expect(block, 'no `claude:` entry in TOOL_GLYPH — the table shape changed').toBeTruthy();
  return [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the Claude mark is the official one, not a spinner', () => {
  it('uses the Simple Icons path, unmodified at both ends', () => {
    // 能红: shorten or hand-edit the path.
    const paths = claudePaths(fs.readFileSync(MASTER, 'utf-8'));
    expect(paths.length, 'the official mark is ONE path; a multi-path claude entry means '
      + 'someone redrew it').toBe(1);
    expect(paths[0].startsWith(SI_CLAUDE_HEAD), 'the Claude path no longer begins like the '
      + 'Simple Icons mark — it was replaced or simplified').toBe(true);
    expect(paths[0].endsWith(SI_CLAUDE_TAIL), 'the Claude path no longer ends like the '
      + 'Simple Icons mark — it was truncated or redrawn').toBe(true);
    expect(paths[0].length, 'the path shrank sharply — a "simplified" Claude mark loses the '
      + 'asymmetry that keeps it from reading as a spinner').toBeGreaterThan(1500);
  });

  it('rejects the rotationally-symmetric ray drawing in any file', () => {
    // The specific shape that shipped, pinned so it cannot come back by
    // copy-paste from an old branch or a design doc.
    // 能红: paste the old eight-ray array back into any of the three files.
    const RAY = /'M12 3v4'|'M12 17v4'|'M3 12h4'|'M17 12h4'/;
    for (const [name, file] of [
      ['master ToolGlyph', MASTER],
      ['member ToolGlyph', PEER],
      ['member page-local tool-glyph', PAGE_LOCAL],
    ] as const) {
      expect(RAY.test(fs.readFileSync(file, 'utf-8')),
        `${name} contains the retired eight-ray starburst — eight equal rays at equal `
        + 'spacing around an empty centre is how a loading spinner is drawn').toBe(false);
    }
  });

  it('keeps the glyph data in ONE place', () => {
    // Before 2026-08-11 the table was duplicated into the page-local module, so
    // changing a mark meant editing three files and hoping. The page-local
    // module now re-exports; it must not grow its own copy back.
    const local = fs.readFileSync(PAGE_LOCAL, 'utf-8');
    expect(/export const TOOL_GLYPH/.test(local),
      'the page-local module declares its own TOOL_GLYPH again — re-export it from '
      + '@/shared/ui/ToolGlyph instead, or the next mark change silently applies to '
      + 'only some pages').toBe(false);
    expect(local, 'the page-local module no longer sources the shared table')
      .toContain("from '@/shared/ui/ToolGlyph'");
  });

  it('draws filled marks filled and stroked marks stroked', () => {
    // A filled path rendered with fill:none is invisible; a stroked one
    // rendered with fill:currentColor is a blob. Both fail silently.
    const src = fs.readFileSync(MASTER, 'utf-8');
    expect(src, 'FILLED_GLYPH must list claude — the official mark is a silhouette')
      .toMatch(/FILLED_GLYPH[^=]*=\s*new Set\(\['claude'\]\)/);
    expect(src, 'the renderer ignores FILLED_GLYPH').toMatch(/filled \? 'currentColor' : 'none'/);
  });
});
