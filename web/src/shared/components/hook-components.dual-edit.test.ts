// @ts-nocheck — vitest-only test file using Node built-ins (fs / path /
// process.cwd). Same pragma rationale as layouts/UserShell.dual-edit.test.ts:
// the project doesn't ship @types/node, vitest has Node types ambient.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Dual-edit drift fence for the hook readiness UI (2026-07-10).
 *
 * The trial-edition composer (aikey-trial-server/web/vite.config.ts) and the
 * master build both resolve `@/shared/components/*` and `@/store` to
 * master/web/src — these paths are NOT vite-aliased to the canonical
 * aikey-control/web sources (unlike @/shared/api/user/*). So EVERY file under
 * shared/components (auto-discovered — see fencedComponents() below), plus:
 *
 *   - shared/utils/platform.ts   (transitively imported by the hook components)
 *   - store/index.ts             (hookBannerKind / readiness slice)
 *
 * MUST stay byte-equal in BOTH repos, or trial/production ships a stale copy —
 * or fails to build at all.
 *
 * Two real incidents this fences:
 *   - 2026-07-07: a Windows-parity update landed only in aikey-control/web;
 *     trial builds kept bundling the stale master copy until 2026-07-10.
 *     See workflow/sessions/cli-hook-web-use-chain-gaps.md.
 *   - 2026-07-13: DesktopConsentModal.tsx was added to aikey-control/web and
 *     imported by the vault page, but never mirrored → the master/production
 *     build broke (module not found). The old hand-maintained whitelist did not
 *     cover it, which is why the file set is now auto-discovered.
 *     See workflow/CI/bugfix/2026-07-13-desktop-consent-modal-dual-edit-gap.md.
 *
 * Unlike UserShell.dual-edit.test.ts (structural invariants, because that file
 * is edited daily and byte-equal would be noisy), these files change rarely
 * and must mirror EXACTLY — byte-equal is the right strictness here.
 *
 * 2026-08-17 — the mirror requirement is DERIVED, not assumed:
 *
 *   SessionKeyHelp.tsx landed in aikey-control/web and this fence demanded a
 *   master/web copy. But nothing would have read that copy: the master consumer
 *   (pages/master/orgs/oauth-groups/EditGroupDrawer.tsx) imports it by PACKAGE
 *   path — `aikey-control-web/shared/components/SessionKeyHelp.tsx`, resolved
 *   through the `file:../../aikey-control/web` dep and that package's
 *   `"./shared/*"` export map — and the user page imports it by RELATIVE path.
 *   Both specifiers land on aikey-control/web's file in every build. Copying it
 *   would satisfy the fence with a file no bundle reads, which this fence would
 *   then force us to keep in sync forever. Master even has its own fence
 *   (oauth-groups/session-key-login-surface.test.ts) asserting the package-path
 *   import — so the two fences were demanding opposite things for one file.
 *
 *   Root cause: the fence keyed off DIRECTORY MEMBERSHIP, but the real rule is
 *   the IMPORT SPECIFIER. Only `@/shared/components/<name>` resolves to
 *   master/web/src and therefore needs a mirror; package/relative specifiers are
 *   already single-sourced. So the set is now derived by scanning every repo for
 *   `@/shared/components/` usage:
 *
 *     imported via `@/` somewhere  →  master copy MUST exist, byte-equal
 *     never imported via `@/`      →  master copy MUST NOT exist (second truth)
 *
 *   Still auto-discovered, still no whitelist — and it self-corrects: rewrite
 *   SessionKeyHelp's import to `@/shared/components/SessionKeyHelp` and the file
 *   flips into the mirrored class, going red until a copy exists (which is the
 *   real failure — that specifier would break the master/trial build).
 */

const USER_WEB_SRC = path.resolve(process.cwd(), 'src');
const MASTER_WEB_SRC = path.resolve(process.cwd(), '../../aikey-control-master/web/src');
const TRIAL_WEB_SRC = path.resolve(process.cwd(), '../../aikey-trial-server/web/src');

/**
 * EVERY component under shared/components is fenced, discovered at run time —
 * NOT a hand-maintained list (2026-07-13).
 *
 * Why: the old list named 2 components explicitly, so a NEW file was unprotected
 * by default. That is exactly how DesktopConsentModal.tsx escaped: it landed in
 * aikey-control/web (commit 547d4b9) and was imported by the vault page, but was
 * never mirrored — and since `@/shared/components/*` resolves to master/web/src,
 * the master/production BUILD broke outright (module not found) while this fence
 * stayed green. A whitelist can only fence what someone remembered to add; an
 * auto-discovered list fences the invariant itself ("anything a user page can
 * import from here must exist byte-equal in master/web").
 *
 * Non-component files that share the same resolution rule stay listed below —
 * they live outside this directory so they cannot be auto-discovered from here.
 */
function fencedComponents(): string[] {
  const dir = path.join(USER_WEB_SRC, 'shared/components');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') || (f.endsWith('.ts') && !f.includes('.test.')))
    .map((f) => `shared/components/${f}`)
    .sort();
}

/** Every .ts/.tsx file under a source root, recursively. */
function sourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * Component names imported anywhere via the `@/shared/components/<name>`
 * specifier — the ONLY specifier that resolves to master/web/src under the
 * master and trial builds, and therefore the only one that needs a mirror.
 *
 * Deliberately scans test files too. Over-detecting is safe (it just demands a
 * mirror, the old behaviour); under-detecting would assert "master must NOT
 * have a copy" about a file master actually needs, so the bias must point this
 * way.
 *
 * The specifier must be QUOTED to count: prose that cites `@/shared/components/
 * Foo` in a comment is not a consumer, and this file's own header would
 * otherwise register as one.
 */
function aliasImportedComponents(): Set<string> {
  const names = new Set<string>();
  for (const root of [USER_WEB_SRC, MASTER_WEB_SRC, TRIAL_WEB_SRC]) {
    for (const file of sourceFiles(root)) {
      const src = fs.readFileSync(file, 'utf-8');
      for (const m of src.matchAll(/['"]@\/shared\/components\/([A-Za-z0-9_-]+)['"]/g)) {
        names.add(m[1]);
      }
    }
  }
  return names;
}

const ALIAS_IMPORTED = aliasImportedComponents();
const componentName = (rel: string) => path.basename(rel).replace(/\.(ts|tsx)$/, '');

/** Reached via `@/shared/components/*` → master/web resolves it locally. */
const MIRRORED_COMPONENTS = fencedComponents().filter((rel) =>
  ALIAS_IMPORTED.has(componentName(rel)),
);
/** Reached only by package/relative specifiers → already single-sourced. */
const SINGLE_SOURCED_COMPONENTS = fencedComponents().filter(
  (rel) => !ALIAS_IMPORTED.has(componentName(rel)),
);

const FENCED_FILES = [
  ...MIRRORED_COMPONENTS,
  'shared/utils/platform.ts',
  'store/index.ts',
];

describe('hook UI dual-edit drift (aikey-control/web ↔ aikey-control-master/web)', () => {
  it('auto-discovers the component set (guards against an empty/rotted glob)', () => {
    // If the readdir ever silently returns nothing, every byte-equal check below
    // would vacuously pass and the fence would be decorative.
    expect(fencedComponents().length).toBeGreaterThanOrEqual(3);
  });

  it('auto-discovers `@/shared/components/*` consumers (guards a rotted scan)', () => {
    // If the walk or the regex ever stops matching, every component would look
    // single-sourced and the byte-equal checks would silently disappear. This
    // keeps the classifier itself honest.
    expect(ALIAS_IMPORTED.size).toBeGreaterThanOrEqual(3);
  });

  for (const rel of SINGLE_SOURCED_COMPONENTS) {
    it(`${rel} stays single-sourced (no master/web copy)`, () => {
      // Nothing imports this via `@/shared/components/`, so every build already
      // resolves aikey-control/web's file. A master copy would be a second
      // source of truth that no bundle reads — dead on arrival and free to drift.
      const masterPath = path.join(MASTER_WEB_SRC, rel);
      expect(
        fs.existsSync(masterPath),
        `${rel} has no \`@/shared/components/\` consumer, so master/web resolves it ` +
          'from aikey-control/web via the package export map. Delete the master copy, ' +
          'or switch the consumers to `@/shared/components/` and mirror it properly — ' +
          'keeping both is two sources of truth',
      ).toBe(false);
    });
  }

  for (const rel of FENCED_FILES) {
    it(`${rel} is byte-equal in both repos`, () => {
      const userPath = path.join(USER_WEB_SRC, rel);
      const masterPath = path.join(MASTER_WEB_SRC, rel);
      expect(fs.existsSync(userPath), `${userPath} should exist`).toBe(true);
      expect(
        fs.existsSync(masterPath),
        `${masterPath} missing — copy the canonical file from aikey-control/web`,
      ).toBe(true);
      const userSrc = fs.readFileSync(userPath, 'utf-8');
      const masterSrc = fs.readFileSync(masterPath, 'utf-8');
      expect(
        masterSrc === userSrc,
        `${rel} differs between user/web (canonical) and master/web — ` +
          'mirror your edit to the other repo (trial bundles the master copy)',
      ).toBe(true);
    });
  }
});
