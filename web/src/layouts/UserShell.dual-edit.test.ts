// @ts-nocheck — this is a vitest-only test file that uses Node built-ins
// (fs / path / process.cwd). The project doesn't ship @types/node as a
// dev dep, so the strict-mode `tsc --noEmit` over the whole src tree
// rejects the imports here. vitest runs this file fine because it has
// the Node types ambient. The nocheck pragma lets the project-wide tsc
// pass without forcing an @types/node install just for one test.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Dual-edit drift fence for UserShell.tsx (2026-06-04 P2).
 *
 * The trial-edition composer (aikey-trial-server/web/vite.config.ts)
 * aliases `@` to master/web/src, so user-side files (UserShell.tsx,
 * main.tsx, layouts) MUST stay byte-equivalent in BOTH repos:
 *   - aikey-control/web/src/layouts/UserShell.tsx          (canonical)
 *   - aikey-control-master/web/src/layouts/UserShell.tsx   (must mirror)
 *
 * When the two drift, trial bundle renders broken sidebars — see
 * workflow/CI/bugfix/20260603-trial-single-binary-detection-stale-cache.md
 * and the related "20260603-userShell-i18n-and-route-drift.md".
 *
 * This file pins 4 load-bearing structural invariants. We deliberately
 * DON'T require byte-identical text — that's too noisy in everyday
 * editing. Instead we extract the four key tables via regex and assert
 * deep-equal. A single missed dual-edit on any of them surfaces here
 * with a precise "X differs between user/web and master/web" message.
 */

const USER_WEB_SHELL = path.resolve(process.cwd(), 'src/layouts/UserShell.tsx');
const MASTER_WEB_SHELL = path.resolve(process.cwd(), '../../aikey-control-master/web/src/layouts/UserShell.tsx');

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

// ── Extractors ────────────────────────────────────────────────────────────

/**
 * Extract nav items from each navGroups[].items[] array.
 * Captures: path, label, personalOnly, teamOnly, crossAppPreferred.
 *
 * Robust to whitespace, prop ordering, and surrounding comments. We
 * intentionally DON'T capture `icon` (JSX element, not directly diffable
 * without parsing) — drifts in icon assignment are caught by manual
 * code review + the crossAppIconFor case set below.
 */
type NavItem = {
  path: string;
  label: string;
  personalOnly?: boolean;
  teamOnly?: boolean;
  crossAppPreferred?: boolean;
};
function extractNavItems(src: string): NavItem[] {
  const items: NavItem[] = [];
  // Match { path: '...', icon: ..., label: '...', ... }
  const itemRe = /\{\s*path:\s*['"`]([^'"`]+)['"`][^}]*?label:\s*['"`]([^'"`]+)['"`][^}]*?\}/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(src))) {
    const [block, p, label] = m;
    const item: NavItem = { path: p, label };
    if (/personalOnly:\s*true/.test(block)) item.personalOnly = true;
    if (/teamOnly:\s*true/.test(block)) item.teamOnly = true;
    if (/crossAppPreferred:\s*true/.test(block)) item.crossAppPreferred = true;
    items.push(item);
  }
  return items;
}

/**
 * Extract `crossAppIconFor` switch cases as `case 'name': → IconName`
 * pairs. Maps cross-app menu wire icon-name strings to React component
 * names. Drift here means a cross-app entry from the other side renders
 * as the default dim-dot instead of its proper glyph.
 */
function extractIconCases(src: string): Record<string, string> {
  const cases: Record<string, string> = {};
  const fn = src.match(/function\s+crossAppIconFor[\s\S]*?\n\s*\}\s*\n/);
  if (!fn) return cases;
  // case 'X': return <YIcon />;
  const caseRe = /case\s+['"`]([^'"`]+)['"`]\s*:\s*return\s+<(\w+)\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(fn[0]))) {
    cases[m[1]] = m[2];
  }
  // Special: `case 'user': case 'team-account': return <UserIcon />;`
  // (multiple cases sharing one return). Pick up bare `case 'X':` lines
  // with no return on the same line.
  const bareRe = /case\s+['"`]([^'"`]+)['"`]\s*:\s*(?!return)/g;
  while ((m = bareRe.exec(fn[0]))) {
    // Find the next return after this position
    const tail = fn[0].slice(m.index);
    const nextReturn = tail.match(/return\s+<(\w+)\s*\/>/);
    if (nextReturn && !cases[m[1]]) cases[m[1]] = nextReturn[1];
  }
  return cases;
}

/**
 * Extract a TS object literal of `'key': 'value'` pairs by variable name.
 * Used for both NAV_LABEL_I18N_KEY and ROUTE_LABELS (for ROUTE_LABELS we
 * just grab the `.label` field, ignoring `originName` which is a
 * deliberately-allowed-to-drift legacy compat field).
 */
function extractStringMap(src: string, varName: string): Record<string, string> {
  const re = new RegExp(`const\\s+${varName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = src.match(re);
  if (!m) return {};
  const body = m[1];
  const out: Record<string, string> = {};
  const entryRe = /['"`]?([\w-]+)['"`]?\s*:\s*['"`]([^'"`]+)['"`]/g;
  let e: RegExpExecArray | null;
  while ((e = entryRe.exec(body))) {
    // Skip nested object keys (label inside ROUTE_LABELS RouteMeta)
    // — we only want the FIRST-level keys. Heuristic: skip 'label' /
    // 'originName' / quoted-string field names that don't look like
    // route slugs.
    const k = e[1];
    if (k === 'label' || k === 'originName') continue;
    if (!out[k]) out[k] = e[2];
  }
  return out;
}

/**
 * For ROUTE_LABELS specifically: extract `routeSlug: { label: '...', ... }`
 * pairs, returning slug → label.
 */
function extractRouteLabels(src: string): Record<string, string> {
  const m = src.match(/const\s+ROUTE_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) return {};
  const out: Record<string, string> = {};
  // slug:   { label: 'Foo', originName: 'Bar' }
  const re = /['"`]?([\w-]+)['"`]?\s*:\s*\{\s*label:\s*['"`]([^'"`]+)['"`]/g;
  let e: RegExpExecArray | null;
  while ((e = re.exec(m[1]))) {
    out[e[1]] = e[2];
  }
  return out;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('UserShell.tsx dual-edit drift (aikey-control/web ↔ aikey-control-master/web)', () => {
  const userSrc = read(USER_WEB_SHELL);
  const masterSrc = read(MASTER_WEB_SHELL);

  it('navGroups items: every {path,label,personalOnly,teamOnly,crossAppPreferred} matches', () => {
    const userItems = extractNavItems(userSrc);
    const masterItems = extractNavItems(masterSrc);
    expect(userItems.length, 'should find some nav items in user/web').toBeGreaterThan(5);
    expect(masterItems).toEqual(userItems);
  });

  it('crossAppIconFor: every wire icon-name maps to the same React component', () => {
    const userCases = extractIconCases(userSrc);
    const masterCases = extractIconCases(masterSrc);
    expect(Object.keys(userCases).length, 'should find some icon cases').toBeGreaterThan(3);
    expect(masterCases).toEqual(userCases);
  });

  it('NAV_LABEL_I18N_KEY: every nav label maps to the same i18n key', () => {
    const userMap = extractStringMap(userSrc, 'NAV_LABEL_I18N_KEY');
    const masterMap = extractStringMap(masterSrc, 'NAV_LABEL_I18N_KEY');
    expect(Object.keys(userMap).length, 'should find some i18n nav-label mappings').toBeGreaterThan(5);
    expect(masterMap).toEqual(userMap);
  });

  it('ROUTE_LABELS: every route slug maps to the same display label', () => {
    const userMap = extractRouteLabels(userSrc);
    const masterMap = extractRouteLabels(masterSrc);
    expect(Object.keys(userMap).length, 'should find some route labels').toBeGreaterThan(3);
    expect(masterMap).toEqual(userMap);
  });

  // 2026-06-29: pin the cross-app label i18n map across both copies. A
  // missed dual-edit here re-introduces the "half Chinese, half English"
  // sidebar (cross-app rows fall back to their English wire label while
  // local rows are translated). See workflow/CI/bugfix/2026-06-29-
  // cross-app-menu-i18n-half-translated.md.
  it('CROSS_APP_LABEL_I18N_KEY: every cross-app id maps to the same i18n key', () => {
    const userMap = extractStringMap(userSrc, 'CROSS_APP_LABEL_I18N_KEY');
    const masterMap = extractStringMap(masterSrc, 'CROSS_APP_LABEL_I18N_KEY');
    expect(Object.keys(userMap).length, 'should find some cross-app label mappings').toBeGreaterThan(8);
    expect(masterMap).toEqual(userMap);
  });
});
