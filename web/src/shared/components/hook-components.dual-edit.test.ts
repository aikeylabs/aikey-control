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
 */

const USER_WEB_SRC = path.resolve(process.cwd(), 'src');
const MASTER_WEB_SRC = path.resolve(process.cwd(), '../../aikey-control-master/web/src');

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

const FENCED_FILES = [
  ...fencedComponents(),
  'shared/utils/platform.ts',
  'store/index.ts',
];

describe('hook UI dual-edit drift (aikey-control/web ↔ aikey-control-master/web)', () => {
  it('auto-discovers the component set (guards against an empty/rotted glob)', () => {
    // If the readdir ever silently returns nothing, every byte-equal check below
    // would vacuously pass and the fence would be decorative.
    expect(fencedComponents().length).toBeGreaterThanOrEqual(3);
  });

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
