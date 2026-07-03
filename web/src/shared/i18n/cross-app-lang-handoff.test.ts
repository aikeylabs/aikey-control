// @ts-nocheck — vitest-only file using Node built-ins (fs/path/process.cwd);
// the project doesn't ship @types/node, so the project-wide `tsc --noEmit`
// would reject these imports. vitest runs it fine. Same pragma rationale as
// UserShell.dual-edit.test.ts.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Cross-app language handoff fence (2026-07-02 bugfix).
 *
 * Bug: the Personal web (local-server origin) and the Team web (team server
 * origin) each cache the language pick in their OWN origin's localStorage
 * ('aikey-lang'). Cross-app menu items are hard <a href> jumps, so landing on
 * the other app re-detected the language from THAT origin's stale
 * localStorage / the browser default — the UI language flipped back and forth
 * on every Personal↔Team hop.
 *
 * Fix: cross-app links carry a one-shot `?lang=` param (buildCrossAppUrl),
 * the receiving i18n detects querystring FIRST, caches into its own
 * localStorage, then strips the param from the address bar.
 *
 * These tests pin the three pieces that re-break it independently:
 *   1. Both apps' i18n.ts detect 'querystring' first with lookupQuerystring
 *      'lang', and strip the param after init (else a stale URL param would
 *      override a later manual switch on refresh).
 *   2. cross-app-url.ts stays byte-identical between the two apps
 *      (dual-edit invariant, same as UserShell.tsx).
 *   3. No cross-app navigation is built by raw `${otherBaseUrl}${path}`
 *      concatenation — a NEW cross-app link added without buildCrossAppUrl
 *      would ship without the lang handoff and silently resurrect the
 *      flicker for that entry.
 *
 * See workflow/CI/bugfix/2026-07-02-cross-app-language-flicker.md.
 */

const APP_SRC = path.resolve(process.cwd(), 'src');
const MASTER_SRC = path.resolve(process.cwd(), '../../aikey-control-master/web/src');

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe('cross-app language handoff', () => {
  const sides = [
    { name: 'user/web', src: APP_SRC },
    { name: 'master/web', src: MASTER_SRC },
  ];

  it('i18n detection reads the querystring handoff first, on both sides', () => {
    for (const side of sides) {
      const i18nSrc = read(path.join(side.src, 'shared/i18n/i18n.ts'));
      expect(i18nSrc, `${side.name}: querystring must lead the detection order`).toMatch(
        /order:\s*\[\s*'querystring',\s*'localStorage',\s*'navigator'\s*\]/,
      );
      expect(i18nSrc, `${side.name}: lookupQuerystring must be 'lang'`).toMatch(
        /lookupQuerystring:\s*'lang'/,
      );
    }
  });

  it('i18n strips the one-shot ?lang param after init, on both sides', () => {
    for (const side of sides) {
      const i18nSrc = read(path.join(side.src, 'shared/i18n/i18n.ts'));
      expect(i18nSrc, `${side.name}: must delete the lang param`).toMatch(
        /searchParams\.delete\('lang'\)/,
      );
      expect(i18nSrc, `${side.name}: must rewrite the URL via replaceState`).toMatch(
        /history\.replaceState/,
      );
    }
  });

  it('cross-app-url.ts is byte-identical between the two apps (dual-edit)', () => {
    const a = read(path.join(APP_SRC, 'shared/cross-app-menu/cross-app-url.ts'));
    const b = read(path.join(MASTER_SRC, 'shared/cross-app-menu/cross-app-url.ts'));
    expect(a).toBe(b);
  });

  it('no raw ${otherBaseUrl} navigation concatenation outside buildCrossAppUrl', () => {
    // Tooltips (title=... opensLink/opensHref) may show the clean URL; only
    // NAVIGATION (href= / location.href=) must go through buildCrossAppUrl.
    const rawNav = /(?:href=\{|location\.href\s*=\s*)`\$\{otherBaseUrl/;
    const offenders: string[] = [];
    for (const side of sides) {
      for (const file of walk(side.src)) {
        if (rawNav.test(read(file))) offenders.push(`${side.name}:${path.relative(side.src, file)}`);
      }
    }
    expect(
      offenders,
      `raw \${otherBaseUrl} navigation found (use buildCrossAppUrl so the lang handoff isn't lost): ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
