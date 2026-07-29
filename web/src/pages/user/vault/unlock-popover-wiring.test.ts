// @ts-nocheck — vitest-only test file using Node built-ins (fs / path /
// process.cwd). Same pragma rationale as
// shared/components/hook-components.dual-edit.test.ts: the project doesn't
// ship @types/node, vitest has Node types ambient.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Wiring fence for the in-place unlock popover (2026-07-29 user request:
 * clicking Use on a locked vault must offer the Master Password right at
 * the button and resume the switch after unlock — not dead-end into a
 * disabled button + tooltip).
 *
 * Why a source fence and not a render test: the web test setup is
 * deliberately DOM-less (vitest node env, no jsdom/testing-library), and
 * the behavior lives in a 7k-line page component. These assertions pin the
 * three load-bearing wiring points that a refactor could silently undo;
 * interactive behavior is covered by the manual browser checklist in the
 * update doc (20260729-vault-use-inplace-unlock).
 */
const pageSrc = readFileSync(
  join(process.cwd(), 'src/pages/user/vault/index.tsx'),
  'utf-8',
);
const popoverSrc = readFileSync(
  join(process.cwd(), 'src/pages/user/_shared/UnlockPopover.tsx'),
  'utf-8',
);

describe('vault Use in-place unlock wiring', () => {
  it('row Use button is NOT disabled by lock state anymore (popover path instead)', () => {
    // The old dead-end: disabled={props.locked || !!props.switchPending}.
    // Locked must stay clickable so switchTo can open the popover.
    expect(pageSrc).not.toMatch(/disabled=\{props\.locked \|\| !!props\.switchPending\}/);
    expect(pageSrc).toContain("t('vault.useLockedClickTitle')");
  });

  it('page mounts UnlockPopover and resumes the interrupted switch after unlock', () => {
    expect(pageSrc).toMatch(/import \{ UnlockPopover \} from '\.\.\/_shared\/UnlockPopover'/);
    // The resume handoff: popover success stores pendingUse; the effect
    // re-runs switchTo only once `unlocked` is fresh.
    expect(pageSrc).toContain('setPendingUse');
    expect(pageSrc).toMatch(/if \(!unlocked \|\| !pendingUse\) return;/);
    // First-run vaults must keep the toast fallback (popover cannot init).
    expect(pageSrc).toMatch(/if \(initialized && anchorEl\)/);
  });

  it('popover unlocks via the shared vaultUnlock API and refreshes vault-status', () => {
    expect(popoverSrc).toContain('importApi.vaultUnlock');
    expect(popoverSrc).toContain("queryKey: ['vault-status']");
    // Session-wide semantics + resume hook are the component's contract.
    expect(popoverSrc).toContain('onUnlocked');
  });
});
