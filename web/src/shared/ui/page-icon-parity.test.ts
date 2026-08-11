// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-10: the page title and the sidebar entry for the SAME page could show
// different marks — /user/virtual-keys rendered <TeamKindIcon/> (a crowd) in the
// nav and hand-rolled <KeyRoundIcon/> (a key) in its own header. Nothing was
// broken in either place; they simply had no reason to agree.
//
// The fix was structural: both sides resolve a glyph NAME from shared registries
// (nav-glyphs.tsx for the drawing, page-icons.ts for the route→name mapping).
// This fence keeps that structure honest — the mapping is only as good as its
// agreement with the nav each shell actually renders.
//
// 能红: point a page-icons entry at a different glyph than its nav item uses.
const R = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');

const PAGE_ICONS = R('src/shared/ui/page-icons.ts');
const GLYPHS = R('src/shared/ui/nav-glyphs.tsx');
const USER_SHELL = R('src/layouts/UserShell.tsx');
const APP_SHELL = R('../../aikey-control-master/web/src/layouts/AppShell.tsx');

/** `function XIcon() { … <NavGlyph name="y" /> … }` in either shape. */
function componentGlyphs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/function (\w+Icon)\([^)]*\)\s*\{ return <NavGlyph name="([a-z0-9-]+)"/g)) {
    out[m[1]] = m[2];
  }
  for (const m of src.matchAll(/function (\w+Icon)\([^)]*\)\s*\{\n([\s\S]*?)\n\}/g)) {
    const g = /<NavGlyph name="([a-z0-9-]+)"/.exec(m[2]);
    if (g && !out[m[1]]) out[m[1]] = g[1];
  }
  return out;
}

function tableOf(name: string): Record<string, string> {
  const block = new RegExp(`const ${name}: Record<string, GlyphName> = \\{([\\s\\S]*?)\\n\\};`).exec(PAGE_ICONS);
  expect(block, `${name} not found in page-icons.ts`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const m of block![1].matchAll(/'([a-z0-9-]+)': '([a-z0-9-]+)'/g)) out[m[1]] = m[2];
  return out;
}

describe('a page title shows the same glyph as its menu entry', () => {
  it('every page-icons glyph name exists in the registry', () => {
    const known = new Set([...GLYPHS.matchAll(/^  '([a-z0-9-]+)': \{ d: \[/gm)].map((m) => m[1]));
    expect(known.size, 'no glyphs parsed — nav-glyphs.tsx shape changed').toBeGreaterThan(20);
    const unknown = [...Object.entries({ ...tableOf('USER_PAGE_GLYPH'), ...tableOf('MASTER_PAGE_GLYPH') })]
      .filter(([, g]) => !known.has(g))
      .map(([route, g]) => `${route} -> ${g}`);
    expect(unknown, 'page-icons points at glyphs the registry does not define — '
      + 'the page would render an empty tile').toEqual([]);
  });

  it('matches the member sidebar item for every /user route it also navigates', () => {
    const byComponent = componentGlyphs(USER_SHELL);
    const table = tableOf('USER_PAGE_GLYPH');
    const navPairs = [...USER_SHELL.matchAll(/path: '\/user\/([a-z-]+)',\s*icon: <(\w+Icon) \/>/g)];
    expect(navPairs.length, 'no nav items parsed — UserShell shape changed').toBeGreaterThan(8);

    const mismatches = navPairs.flatMap(([, route, comp]) => {
      const navGlyph = byComponent[comp];
      const pageGlyph = table[route];
      if (!navGlyph) return [`${route}: nav component ${comp} does not resolve to a registry glyph`];
      if (!pageGlyph) return [`${route}: in the sidebar but missing from USER_PAGE_GLYPH`];
      return navGlyph === pageGlyph ? [] : [`${route}: nav=${navGlyph} but page title=${pageGlyph}`];
    });
    expect(mismatches, 'the page header and the sidebar would draw different marks '
      + 'for the same page — the exact 2026-08-10 defect this table exists to prevent').toEqual([]);
  });

  it('matches the master sidebar item for every /master route it also navigates', () => {
    const byComponent = componentGlyphs(APP_SHELL);
    const table = tableOf('MASTER_PAGE_GLYPH');
    const mismatches: string[] = [];
    for (const m of APP_SHELL.matchAll(/<NavLink\b([\s\S]{0,900}?)<\/NavLink>/g)) {
      const to = /to=\{?[`"']([^`"']+)[`"']\}?/.exec(m[1]);
      const ic = /<(\w+Icon) \/>/.exec(m[1]);
      if (!to || !ic) continue;
      const route = to[1].replace(/\$\{[^}]*\}/g, 'ORG').replace(/\/$/, '').split('/').pop()!;
      const navGlyph = byComponent[ic[1]];
      if (!navGlyph) continue; // not every NavLink child is a registry glyph
      const pageGlyph = table[route];
      // A MISSING entry is reported, not skipped. The earlier version skipped
      // it, and that is exactly how /master/orgs/:id/virtual-keys shipped with
      // no title icon at all: the generator's regex required empty parens and
      // silently dropped <KeyIcon>, which takes a className. A fence that
      // tolerates absence cannot notice something never arrived.
      if (!pageGlyph) mismatches.push(`${route}: in the master sidebar but missing from MASTER_PAGE_GLYPH`);
      else if (navGlyph !== pageGlyph) mismatches.push(`${route}: nav=${navGlyph} but page title=${pageGlyph}`);
    }
    expect(mismatches, 'master page headers would draw a different mark than the sidebar, '
      + 'or no mark at all').toEqual([]);
  });
});
