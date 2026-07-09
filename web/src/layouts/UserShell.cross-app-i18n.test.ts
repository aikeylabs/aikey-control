// @ts-nocheck — vitest-only file using Node built-ins (fs/path/process.cwd);
// the project doesn't ship @types/node, so the project-wide `tsc --noEmit`
// would reject these imports. vitest runs it fine. Same pragma rationale as
// UserShell.dual-edit.test.ts.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Cross-app menu i18n coverage fence (2026-06-29 bugfix).
 *
 * Bug: on the Team (B) side the sidebar showed "half Chinese, half English".
 * Cross-app rows are rendered from the OTHER side's menu, whose labels arrive
 * English-only over the wire (`CrossAppMenuEntry.label` — "Today English-only;
 * i18n hook is a follow-up"). UserShell localizes them at the render boundary by
 * mapping the entry's stable `id` → an i18n key via CROSS_APP_LABEL_I18N_KEY.
 * That map originally only covered `team-*` ids (the A-renders-B direction), so
 * on B side every `personal-*` cross-app row fell back to its raw English wire
 * label while the local rows were translated.
 *
 * These tests pin the invariant that re-broke it:
 *   1. Every cross-app menu entry id (OWN_PERSONAL_MENU + TEAM_MENU_FALLBACK)
 *      has a mapping in CROSS_APP_LABEL_I18N_KEY — so a NEW menu entry added
 *      without its i18n mapping fails CI instead of silently shipping English.
 *   2. Every mapped i18n key resolves to a real string in BOTH en and zh —
 *      so a typo'd / missing key (which i18next would fall back to en for) is
 *      caught.
 *
 * See workflow/CI/bugfix/2026-06-29-cross-app-menu-i18n-half-translated.md.
 */

const SRC = path.resolve(process.cwd(), 'src');
const SHELL = path.join(SRC, 'layouts/UserShell.tsx');
const OWN_MENU = path.join(SRC, 'shared/cross-app-menu/own-menu.ts');
const TEAM_FALLBACK = path.join(SRC, 'shared/cross-app-menu/team-menu-fallback.ts');
const EN = path.join(SRC, 'shared/i18n/locales/en/common.json');
const ZH = path.join(SRC, 'shared/i18n/locales/zh/common.json');

// The cross-app label map in UserShell.tsx is byte-shared (dual-edit) between
// this app and master/web, and it must localize entries from BOTH publishers:
// this app's OWN_PERSONAL_MENU (personal-*) AND master/web's OWN_TEAM_MENU
// (team-*, which carries entries this app's own-menu does NOT — e.g.
// team-oauth-contribute). Scanning only this app's own-menu was the blind spot
// that let team-oauth-contribute ship untranslated (2026-06-29 follow-up).
const MASTER_OWN_MENU = path.resolve(
  process.cwd(),
  '../../aikey-control-master/web/src/shared/cross-app-menu/own-menu.ts',
);

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

/** id → i18n key, extracted from the CROSS_APP_LABEL_I18N_KEY object literal. */
function extractLabelMap(src: string): Record<string, string> {
  const m = src.match(/const\s+CROSS_APP_LABEL_I18N_KEY[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) return {};
  const out: Record<string, string> = {};
  // 'id': 'namespace.key' — values carry a dot, so allow it in the value class.
  const re = /['"`]([\w-]+)['"`]\s*:\s*['"`]([\w.]+)['"`]/g;
  let e: RegExpExecArray | null;
  while ((e = re.exec(m[1]))) out[e[1]] = e[2];
  return out;
}

/** All `id: '...'` string literals declared in a cross-app menu module. */
function extractEntryIds(src: string): string[] {
  const ids: string[] = [];
  const re = /\bid:\s*['"`]([\w-]+)['"`]/g;
  let e: RegExpExecArray | null;
  while ((e = re.exec(src))) ids.push(e[1]);
  return ids;
}

/** Labels of navGroups items — the local-NavLink labels (and breadcrumb labels)
 *  that B renders via tNavLabel → NAV_LABEL_I18N_KEY → userShell.*. A teamOnly
 *  entry whose label isn't mapped here renders its raw English label on its own
 *  side (the symptom-2 class: page added to navGroups but its i18n forgotten). */
function extractNavLabels(src: string): string[] {
  const labels: string[] = [];
  // { path: '...', icon: ..., label: '...', ... } — navGroups items carry a path;
  // ROUTE_LABELS entries (slug: { label }) have no path, so they're excluded.
  const re = /\{\s*path:\s*['"`][^'"`]+['"`][^}]*?label:\s*['"`]([^'"`]+)['"`]/g;
  let e: RegExpExecArray | null;
  while ((e = re.exec(src))) labels.push(e[1]);
  return Array.from(new Set(labels));
}

/** NAV_LABEL_I18N_KEY map (English label → userShell.* sub-key). Keys may be
 *  quoted ('Team Keys') or bare (Overview), so the key class allows both. */
function extractNavLabelMap(src: string): Record<string, string> {
  const m = src.match(/const\s+NAV_LABEL_I18N_KEY[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) return {};
  const out: Record<string, string> = {};
  const re = /['"`]?([\w ]+?)['"`]?\s*:\s*['"`](nav[\w]+)['"`]/g;
  let e: RegExpExecArray | null;
  while ((e = re.exec(m[1]))) out[e[1].trim()] = e[2];
  return out;
}

/** Resolve a dotted i18n key ("userShell.navVault") against a parsed locale. */
function resolve(locale: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, locale);
}

describe('cross-app menu i18n coverage', () => {
  const labelMap = extractLabelMap(read(SHELL));
  const entryIds = Array.from(
    new Set([
      ...extractEntryIds(read(OWN_MENU)),
      ...extractEntryIds(read(MASTER_OWN_MENU)),
      ...extractEntryIds(read(TEAM_FALLBACK)),
    ]),
  );
  const en = JSON.parse(read(EN));
  const zh = JSON.parse(read(ZH));

  it('extracts a non-trivial map + entry id set (guards regex rot)', () => {
    expect(Object.keys(labelMap).length).toBeGreaterThan(8);
    expect(entryIds.length).toBeGreaterThan(8);
  });

  it('every cross-app entry id has an i18n mapping (no English fallback leak)', () => {
    const missing = entryIds.filter((id) => !(id in labelMap));
    expect(missing, `cross-app ids missing from CROSS_APP_LABEL_I18N_KEY: ${missing.join(', ')}`).toEqual([]);
  });

  it('every mapped i18n key resolves to a string in BOTH en and zh', () => {
    const broken: string[] = [];
    for (const [id, key] of Object.entries(labelMap)) {
      if (typeof resolve(en, key) !== 'string') broken.push(`en:${id}→${key}`);
      if (typeof resolve(zh, key) !== 'string') broken.push(`zh:${id}→${key}`);
    }
    expect(broken, `unresolved i18n keys: ${broken.join(', ')}`).toEqual([]);
  });

  // Symmetric guard (2026-06-29 symptom-2): a navGroups page added without its
  // NAV_LABEL_I18N_KEY mapping renders its raw English label on its own side
  // (B-local NavLink + breadcrumb both go through tNavLabel). This is the mirror
  // of the cross-app gap above — oauth-contribute had the cross-app side but no
  // navGroups side, and adding the navGroups entry needs its local i18n too.
  const navLabels = extractNavLabels(read(SHELL));
  const navLabelMap = extractNavLabelMap(read(SHELL));

  it('every navGroups label maps via NAV_LABEL_I18N_KEY to a key present in en+zh', () => {
    expect(navLabels.length, 'should find some navGroups labels').toBeGreaterThan(5);
    const broken: string[] = [];
    for (const label of navLabels) {
      const sub = navLabelMap[label];
      if (!sub) { broken.push(`unmapped:"${label}"`); continue; }
      const key = `userShell.${sub}`;
      if (typeof resolve(en, key) !== 'string') broken.push(`en:"${label}"→${key}`);
      if (typeof resolve(zh, key) !== 'string') broken.push(`zh:"${label}"→${key}`);
    }
    expect(broken, `navGroups labels without resolvable i18n: ${broken.join(', ')}`).toEqual([]);
  });
});

/**
 * Top-breadcrumb i18n coverage fence (2026-07-08 bugfix).
 *
 * Bug: the top-bar breadcrumb on /user/performance and /user/team-usage-ledger
 * showed the raw URL segment ("用户 / performance") instead of the localized
 * label. The breadcrumb resolves its label from ROUTE_LABELS keyed by URL
 * segment (useBreadcrumbTrail), then localizes via tNavLabel → NAV_LABEL_I18N_KEY.
 * These two segments (and apps/invites) were simply MISSING from ROUTE_LABELS,
 * so it fell back to `{ label: <segment> }`; tNavLabel can't map a lowercase
 * slug and returned it verbatim. The sidebar was fine (it reads navGroups, not
 * ROUTE_LABELS) which is why only the breadcrumb was half-translated.
 *
 * Invariant: every sidebar navGroups path has a ROUTE_LABELS entry whose label
 * maps through NAV_LABEL_I18N_KEY to a key present in BOTH en and zh — so a NEW
 * page added to navGroups without its ROUTE_LABELS/i18n fails CI instead of
 * silently shipping an English breadcrumb.
 *
 * See workflow/CI/bugfix/2026-07-08-breadcrumb-missing-i18n.md.
 */
describe('top-breadcrumb i18n coverage', () => {
  /** URL segments of navGroups items (path: '/user/<segment>'). */
  function extractNavPaths(src: string): string[] {
    const out: string[] = [];
    const re = /path:\s*['"`]\/user\/([\w-]+)['"`]/g;
    let e: RegExpExecArray | null;
    while ((e = re.exec(src))) out.push(e[1]);
    return Array.from(new Set(out));
  }

  /** ROUTE_LABELS: URL segment → English label. Keys may be quoted
   *  ('team-usage-ledger') or bare (performance). */
  function extractRouteLabels(src: string): Record<string, string> {
    const m = src.match(/const\s+ROUTE_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!m) return {};
    const out: Record<string, string> = {};
    const re = /['"`]?([\w-]+)['"`]?\s*:\s*\{\s*label:\s*['"`]([^'"`]+)['"`]/g;
    let e: RegExpExecArray | null;
    while ((e = re.exec(m[1]))) out[e[1]] = e[2];
    return out;
  }

  const shell = read(SHELL);
  const navPaths = extractNavPaths(shell);
  const routeLabels = extractRouteLabels(shell);
  const navLabelMap = extractNavLabelMap(shell);
  const en = JSON.parse(read(EN));
  const zh = JSON.parse(read(ZH));

  it('extracts non-trivial nav paths + route labels (guards regex rot)', () => {
    expect(navPaths.length).toBeGreaterThan(8);
    expect(Object.keys(routeLabels).length).toBeGreaterThan(8);
  });

  it('every sidebar path has a localizable breadcrumb label in en+zh', () => {
    const broken: string[] = [];
    for (const seg of navPaths) {
      const label = routeLabels[seg];
      if (!label) { broken.push(`no ROUTE_LABELS entry for "/user/${seg}"`); continue; }
      const sub = navLabelMap[label];
      if (!sub) { broken.push(`ROUTE_LABELS["${seg}"].label "${label}" unmapped in NAV_LABEL_I18N_KEY`); continue; }
      const key = `userShell.${sub}`;
      if (typeof resolve(en, key) !== 'string') broken.push(`en:${seg}→${key}`);
      if (typeof resolve(zh, key) !== 'string') broken.push(`zh:${seg}→${key}`);
    }
    expect(broken, `breadcrumb i18n gaps: ${broken.join(', ')}`).toEqual([]);
  });
});
