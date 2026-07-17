// @ts-nocheck — vitest-only file using Node built-ins (fs / path / process.cwd).
// The project ships no @types/node dev dep, so the strict project-wide
// `tsc --noEmit` would reject these imports; vitest has the Node types ambient.
// Same pragma + rationale as UserShell.dual-edit.test.ts next door.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * i18n key-coverage fence (2026-07-17).
 *
 * WHY THIS EXISTS
 * ---------------
 * A `t('some.key')` whose key is absent from the catalog does NOT fail the
 * build: i18next falls back to rendering the key itself, so the page ships
 * showing literal `vault.desktopRestartHint` to the user. `tsc` sees a string
 * argument and is happy; `vite build` never resolves keys. The failure only
 * appears in a real browser — which is exactly why it kept reaching users.
 * (See 技术实现/阶段6-企业定制/20260530-web国际化 Phase 2 "关键教训（防退化）":
 * the extraction agent left the catalog empty while the pages were already
 * edited, and every automated check passed.)
 *
 * This file turns "open the page and look" into a test.
 *
 * WHAT IT CHECKS
 * --------------
 * R1 — self coverage: every statically-written key in a tree resolves in that
 *      tree's own en AND zh catalog.
 * R2 — composer coverage: master/web and the trial server both COMPOSE user
 *      pages out of the `aikey-control-web` file: dep, while their i18n init
 *      loads a DIFFERENT tree's locale JSON. A composed page therefore resolves
 *      against the composer's EFFECTIVE catalog: the tree its init loads, plus
 *      whatever it merges via i18n.addResourceBundle() in main.tsx. This rule
 *      asserts that effective catalog covers every key of every user page the
 *      composer mounts. It is what actually decides whether the browser shows
 *      Chinese or `vault.desktopRestartHint`.
 *
 *      Both facts this models are derived from source, not hard-coded, so the
 *      fence tracks reality: the mounted page list is parsed out of the router,
 *      and the merged bundles out of main.tsx. Delete the addResourceBundle
 *      lines from either composer and this rule goes red with the exact keys
 *      that would render raw.
 * R3 — en/zh parity: the two catalogs of a tree carry the same key set, so a
 *      language switch can't uncover a hole.
 *
 * Keys written as `t('k', 'Default')` are flagged too: they don't render raw,
 * but a zh UI then shows the English default next to translated siblings —
 * half-translated, which is the bug class 20260530 §盲区 calls out.
 *
 * NOT CHECKED (deliberate): dynamic keys — `t(`appShell.routes.${seg}`)` cannot
 * be resolved statically. Those call sites all pass a `defaultValue`, so a miss
 * degrades to English rather than to a raw key. The count is asserted instead,
 * so a new unguarded dynamic call site has to be looked at.
 */

const USER_WEB = path.resolve(process.cwd(), '.');
const MASTER_WEB = path.resolve(process.cwd(), '../../aikey-control-master/web');

// ── Catalog loading ───────────────────────────────────────────────────────

type Catalog = Set<string>;

function flatten(obj: unknown, prefix = '', out: Set<string> = new Set()): Set<string> {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

function catalog(root: string, lng: 'en' | 'zh'): Catalog {
  const p = path.join(root, `src/shared/i18n/locales/${lng}/common.json`);
  return flatten(JSON.parse(fs.readFileSync(p, 'utf-8')));
}

/** i18next resolves `t('k', {count})` against the plural forms of `k`. */
function resolves(cat: Catalog, key: string): boolean {
  if (cat.has(key)) return true;
  return ['_other', '_one', '_zero', '_many'].some((s) => cat.has(key + s));
}

// ── Key extraction ────────────────────────────────────────────────────────

// t('a.b') / t("a.b") / <Trans i18nKey="a.b">. Keys are dotted identifiers; the
// leading char must be a letter so `t(url)`-style variables never match.
const STATIC_KEY =
  /\bt\(\s*'([A-Za-z][\w.-]*)'|\bt\(\s*"([A-Za-z][\w.-]*)"|i18nKey=["']([A-Za-z][\w.-]*)["']/g;
const DYNAMIC_KEY = /\bt\(\s*`/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** key -> the files that use it (first one is enough for a readable failure). */
function keysIn(dir: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of sourceFiles(dir)) {
    const src = fs.readFileSync(f, 'utf-8');
    for (const m of src.matchAll(STATIC_KEY)) {
      const key = (m[1] ?? m[2] ?? m[3]) as string;
      const rel = path.relative(path.dirname(dir), f);
      const list = found.get(key);
      if (list) list.push(rel);
      else found.set(key, [rel]);
    }
  }
  return found;
}

function dynamicCallSites(dir: string): number {
  return sourceFiles(dir).reduce((n, f) => n + [...fs.readFileSync(f, 'utf-8').matchAll(DYNAMIC_KEY)].length, 0);
}

/** Render "key (first-using-file)" lines so a failure names the fix site. */
function report(missing: Map<string, string[]>): string[] {
  return [...missing].map(([k, files]) => `${k}  →  ${files[0]}`).sort();
}

function missingFrom(used: Map<string, string[]>, cat: Catalog): Map<string, string[]> {
  return new Map([...used].filter(([k]) => !resolves(cat, k)));
}

// ── R1: a tree's own keys resolve in its own catalogs ─────────────────────

describe('i18n key coverage — own catalog (R1)', () => {
  for (const [name, root] of [
    ['user/web', USER_WEB],
    ['master/web', MASTER_WEB],
  ] as const) {
    for (const lng of ['en', 'zh'] as const) {
      it(`${name}: every t() key resolves in ${lng}/common.json`, () => {
        const missing = missingFrom(keysIn(path.join(root, 'src')), catalog(root, lng));
        expect(report(missing), `dangling keys render literally in the browser`).toEqual([]);
      });
    }
  }
});

// ── R2: composers resolve user-page keys against their EFFECTIVE catalog ──

const TRIAL_WEB = path.resolve(process.cwd(), '../../aikey-trial-server/web');

/** package specifier → the web tree it resolves to (package.json `file:` deps). */
const PKG_TREE: Record<string, string> = {
  'aikey-control-web': USER_WEB,
  'aikey-control-master-web': MASTER_WEB,
};

type Composer = {
  name: string;
  mainTsx: string;
  /** Tree whose locale JSON the i18n side-effect init loads. */
  baseTree: string;
  /** Where the user-page imports live. */
  routerDir: string;
};

const COMPOSERS: Composer[] = [
  // Loads its own locales (`import './shared/i18n/i18n'`).
  { name: 'master/web', mainTsx: path.join(MASTER_WEB, 'src/main.tsx'), baseTree: MASTER_WEB, routerDir: path.join(MASTER_WEB, 'src/app/router') },
  // `@` aliases to master/web/src (aikey-trial-server/web/vite.config.ts), so
  // `import '@/shared/i18n/i18n'` loads MASTER's locales, not its own.
  { name: 'trial/web', mainTsx: path.join(TRIAL_WEB, 'src/main.tsx'), baseTree: MASTER_WEB, routerDir: path.join(TRIAL_WEB, 'src') },
];

/**
 * Which user pages a composer mounts. Auto-discovered, NOT a hand-kept
 * whitelist — a whitelist only protects the entries someone remembered to add,
 * so a newly mounted page would fall silently outside the fence. Two shapes:
 *   import X from 'aikey-control-web/pages/<page>'   → that one page
 *   import { buildUserRoutes } from 'aikey-control-web' → the whole user tree
 */
function mountedUserPages(routerDir: string): string[] | 'all' {
  const files = fs.existsSync(routerDir) ? sourceFiles(routerDir) : [];
  const pages = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf-8');
    if (/buildUserRoutes[^;]*from\s+'aikey-control-web'/s.test(src)) return 'all';
    for (const m of src.matchAll(/from\s+'aikey-control-web\/pages\/([\w-]+)'/g)) pages.add(m[1] as string);
  }
  return [...pages].sort();
}

/**
 * The catalog a composed page actually resolves against at runtime: the base
 * tree's locale JSON plus every bundle main.tsx merges into the same i18next
 * singleton. Parsed from source so the fence can't drift from the mechanism.
 */
function effectiveCatalog(c: Composer, lng: 'en' | 'zh'): Catalog {
  const eff = new Set(catalog(c.baseTree, lng));
  const src = fs.readFileSync(c.mainTsx, 'utf-8');
  // import <var> from '<pkg>/shared/i18n/locales/<lng>/common.json'
  const imports = new Map<string, { pkg: string; lng: string }>();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'([\w-]+)\/shared\/i18n\/locales\/(\w+)\/common\.json'/g)) {
    imports.set(m[1] as string, { pkg: m[2] as string, lng: m[3] as string });
  }
  // i18n.addResourceBundle('<lng>', 'common', <var>, …)
  for (const m of src.matchAll(/addResourceBundle\(\s*'(\w+)'\s*,\s*'common'\s*,\s*(\w+)/g)) {
    const [bundleLng, varName] = [m[1] as string, m[2] as string];
    const imp = imports.get(varName);
    if (!imp || bundleLng !== lng || imp.lng !== lng) continue;
    const tree = PKG_TREE[imp.pkg];
    if (tree) for (const k of catalog(tree, lng)) eff.add(k);
  }
  return eff;
}

function userPageKeys(pages: string[] | 'all'): Map<string, string[]> {
  const base = path.join(USER_WEB, 'src/pages/user');
  const dirs =
    pages === 'all'
      ? fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(base, e.name))
      : pages.map((p) => path.join(base, p)).filter((d) => fs.existsSync(d));
  const all = new Map<string, string[]>();
  for (const d of dirs) for (const [k, files] of keysIn(d)) all.set(k, files);
  return all;
}

describe('i18n key coverage — composers over user pages (R2)', () => {
  for (const c of COMPOSERS) {
    const mounted = mountedUserPages(c.routerDir);

    it(`${c.name}: discovers the user pages it mounts (fence must not go vacuous)`, () => {
      // If a refactor changes the import shape, `mounted` silently empties and
      // every assertion below passes vacuously. Assert it actually found some.
      expect(mounted === 'all' || mounted.length > 5, `no user-page imports found under ${c.routerDir}`).toBe(true);
    });

    for (const lng of ['en', 'zh'] as const) {
      it(`${c.name}: effective ${lng} catalog covers every mounted user page's keys`, () => {
        const missing = missingFrom(userPageKeys(mounted), effectiveCatalog(c, lng));
        expect(
          report(missing),
          `${c.name} mounts these user pages, but their keys resolve against neither its own ` +
            `locale JSON nor any bundle merged in ${path.relative(process.cwd(), c.mainTsx)} — so they ` +
            `render as raw keys in the browser. Fix at the composer seam (merge user's bundle via ` +
            `i18n.addResourceBundle), not by mirroring keys into another tree one at a time.`,
        ).toEqual([]);
      });
    }
  }
});

// ── R3: en/zh parity within a tree ────────────────────────────────────────

describe('i18n key coverage — en/zh parity (R3)', () => {
  for (const [name, root] of [
    ['user/web', USER_WEB],
    ['master/web', MASTER_WEB],
  ] as const) {
    it(`${name}: en and zh carry the same key set`, () => {
      const en = catalog(root, 'en');
      const zh = catalog(root, 'zh');
      expect([...en].filter((k) => !zh.has(k)).sort(), 'in en, missing from zh').toEqual([]);
      expect([...zh].filter((k) => !en.has(k)).sort(), 'in zh, missing from en').toEqual([]);
    });
  }
});

// ── Dynamic call sites: visible, so a new one gets a second look ──────────

describe('i18n dynamic t(`...`) call sites', () => {
  it('stay few and carry a defaultValue', () => {
    const total = dynamicCallSites(path.join(USER_WEB, 'src')) + dynamicCallSites(path.join(MASTER_WEB, 'src'));
    // Not a style rule — a budget. Dynamic keys are invisible to R1/R2, so each
    // new one is a hole in this fence and must be justified (today: breadcrumb
    // route labels + drawer tab labels, all with a defaultValue fallback).
    expect(total).toBeLessThanOrEqual(19);
  });
});
