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
 * aikey-control/web sources (unlike @/shared/api/user/*). So the files below
 * MUST stay byte-equal in BOTH repos or trial/production ships a stale copy:
 *
 *   - shared/components/HookReadinessBanner.tsx
 *   - shared/components/HookWireRcModal.tsx
 *   - shared/utils/platform.ts   (transitively imported by both components)
 *   - store/index.ts             (hookBannerKind / readiness slice)
 *
 * Real incident this fences: the 2026-07-07 Windows-parity update landed only
 * in aikey-control/web; trial builds kept bundling the stale master copy until
 * 2026-07-10. See workflow/sessions/cli-hook-web-use-chain-gaps.md.
 *
 * Unlike UserShell.dual-edit.test.ts (structural invariants, because that file
 * is edited daily and byte-equal would be noisy), these files change rarely
 * and must mirror EXACTLY — byte-equal is the right strictness here.
 */

const FENCED_FILES = [
  'shared/components/HookReadinessBanner.tsx',
  'shared/components/HookWireRcModal.tsx',
  'shared/utils/platform.ts',
  'store/index.ts',
];

const USER_WEB_SRC = path.resolve(process.cwd(), 'src');
const MASTER_WEB_SRC = path.resolve(process.cwd(), '../../aikey-control-master/web/src');

describe('hook UI dual-edit drift (aikey-control/web ↔ aikey-control-master/web)', () => {
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
