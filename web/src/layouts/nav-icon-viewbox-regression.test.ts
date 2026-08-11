// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-10: the Compliance Audit icon rendered as a ONE-ARMED balance, and had
// for weeks. Not a styling slip — a path bug invisible in the source:
//
//   lucide ships "scale" as SEVERAL <path> elements. Concatenated into a single
//   `d`, the second subpath's RELATIVE moveto (`m2 16`) stops meaning "(2,16)":
//   it chains off the previous subpath's start (16,16) and puts the left pan at
//   (18,32). A `0 0 24 24` viewBox clips everything past 24, so that pan was
//   simply never drawn.
//
// Why the other icon fences could not catch it: they compare the three shells to
// each other, and all three carried the same broken copy — three identical wrongs
// agree perfectly.
//
// WHAT THIS ASSERTS, and why it is not a geometry check: the first version of
// this fence evaluated every path's bounding box. Approximating curves by their
// control points and arcs by their radii over-reported, flagging 8 perfectly good
// glyphs; sampling them properly meant ~150 lines of Bézier/arc maths inside a
// unit test. A fence that cries wolf gets waved through, and a fence nobody can
// read gets deleted. So it pins the ROOT CAUSE instead, which is a one-line rule:
//
//   in a single `d`, every subpath after the first starts with an ABSOLUTE `M`.
//
// That is stronger than "stays inside the viewBox" for authored icons — it makes
// each subpath's coordinates mean what they say, independent of what precedes it.
// Zero exceptions in the codebase today (verified at authoring time).
//
// 能红: change any later `M` in a multi-subpath icon back to lowercase `m`.
// 2026-08-10: `shared/ui/nav-glyphs.tsx` became the single source for nav glyph
// data, so it is now where almost every path lives — scanning only the shells
// would leave the bulk of the console's glyphs unguarded. The shells stay in the
// list because master's AppShell still holds its icons inline, and because a
// future hand-rolled glyph must not escape by being added there.
const SHELLS = [
  'src/shared/ui/nav-glyphs.tsx',
  'src/layouts/UserShell.tsx',
  '../../aikey-control-master/web/src/layouts/UserShell.tsx',
  '../../aikey-control-master/web/src/layouts/AppShell.tsx',
];

/**
 * Every SVG path `d` in the file, across the three shapes the console uses:
 * `const ICON_* = '…'`, inline `d="…"`, and nav-glyphs registry entries
 * `'name': { d: ['…', '…'] }`.
 *
 * Each registry subpath is returned SEPARATELY, which is also why the registry
 * is immune to the bug below by construction: a relative `m` at the start of its
 * own `d` string is measured from the origin, because it is its own <path>.
 */
function glyphs(src: string): Array<[string, string]> {
  const registry = [...src.matchAll(/'([a-z0-9-]+)': \{ d: \[([^\]]+)\]/g)].flatMap((m) =>
    [...m[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(
      (p, i) => [`${m[1]}[${i}]`, p[1]] as [string, string]),
  );
  return [
    ...[...src.matchAll(/const (ICON_[A-Z0-9_]+)\s*=\s*\n?\s*'([^']{20,})'/g)]
      .map((m) => [m[1], m[2]] as [string, string]),
    ...[...src.matchAll(/\sd="([^"]{20,})"/g)]
      .map((m, i) => [`inline#${i + 1}`, m[1]] as [string, string]),
    ...registry,
  ];
}

describe('multi-subpath glyphs use absolute movetos', () => {
  for (const rel of SHELLS) {
    it(`${rel}: no subpath chains off the previous one`, () => {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
      const all = glyphs(src);
      expect(all.length, 'no glyphs found — the extraction regex went stale').toBeGreaterThan(0);

      const offenders = all.flatMap(([name, d]) => {
        // A relative moveto anywhere except position 0 of the string.
        const bad = [...d.matchAll(/(?<=.)\bm(?=[\s\d.-])/g)];
        return bad.length ? [`${name}: ${d.slice(0, 70)}…`] : [];
      });

      expect(offenders, 'a relative `m` after the first subpath is measured from the PREVIOUS '
        + 'subpath, not the origin — the glyph silently lands off-canvas and the viewBox clips '
        + 'it (2026-08-10: the balance lost its left pan to y=32). Use an absolute `M`, and if '
        + 'the following segments were implicit linetos, write them as explicit relative `l`.')
        .toEqual([]);
    });
  }
});
