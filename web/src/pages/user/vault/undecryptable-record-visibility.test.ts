// @ts-nocheck — vitest-only test file using Node built-ins (fs / path /
// process.cwd). Same pragma rationale as unlock-popover-wiring.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fence for the 2026-08-01 bugfix: a vault entry whose ciphertext cannot be
 * decrypted with the current master key must stay VISIBLE and DELETABLE.
 *
 * The bug: `list_personal_with_masked` dropped such rows, so the same vault
 * showed fewer keys after unlocking than while locked — the key silently
 * disappeared from this page and the user had no way to see or remove it.
 * The CLI now returns them with status 'undecryptable'; this file pins the
 * rendering contract that makes that useful.
 *
 * Why a source fence and not a render test: the web test setup is
 * deliberately DOM-less (vitest node env, no jsdom/testing-library) and the
 * behavior lives in a 7k-line page component — same rationale as
 * unlock-popover-wiring.test.ts.
 */
const pageSrc = readFileSync(
  join(process.cwd(), 'src/pages/user/vault/index.tsx'),
  'utf-8',
);
const apiSrc = readFileSync(
  join(process.cwd(), 'src/shared/api/user/vault.ts'),
  'utf-8',
);
const enSrc = JSON.parse(
  readFileSync(join(process.cwd(), 'src/shared/i18n/locales/en/common.json'), 'utf-8'),
);
const zhSrc = JSON.parse(
  readFileSync(join(process.cwd(), 'src/shared/i18n/locales/zh/common.json'), 'utf-8'),
);

describe('undecryptable vault records', () => {
  it('the API type admits the status instead of hard-coding active', () => {
    expect(apiSrc).toMatch(/status:\s*'active'\s*\|\s*'undecryptable';/);
    expect(apiSrc).toMatch(/error_code\?:\s*string;/);
  });

  it('every status renderer has an explicit branch (not the bare-uppercase fallback)', () => {
    // Row chip, drawer head chip, drawer status field — three call sites.
    const branches = pageSrc.match(/r\.status === 'undecryptable'/g) ?? [];
    expect(branches.length).toBeGreaterThanOrEqual(3);
    expect(pageSrc).toContain("t('vault.statusUndecryptable')");
    expect(pageSrc).toContain("t('vault.undecryptableTitle')");
  });

  it('Use is hidden and Rename disabled — neither action can fix the row', () => {
    expect(pageSrc).toMatch(/if \(r\.status === 'undecryptable'\) return null;/);
    expect(pageSrc).toMatch(/disabled=\{props\.locked \|\| r\.status === 'undecryptable'\}/);
  });

  it('Delete stays reachable — it is the only way to clear the entry', () => {
    // The delete button must be gated by lock state ALONE. If a refactor ever
    // adds `|| r.status === 'undecryptable'` here, the user is left with a row
    // they can neither use nor remove.
    const deleteBtn = pageSrc.match(
      /onClick=\{props\.onBeginDelete\}\s*\n\s*disabled=\{([^}]*)\}/,
    );
    expect(deleteBtn, 'delete button wiring not found — did the markup change?').toBeTruthy();
    expect(deleteBtn[1].trim()).toBe('props.locked');
  });

  it('the drawer offers the command that actually fixes it', () => {
    // `aikey get` fails on these rows for the same reason the list did.
    expect(pageSrc).toMatch(/`aikey update \$\{r\.alias\}`/);
    expect(pageSrc).toContain("t('vault.undecryptableFixHint')");
  });

  it('copy exists in both locales', () => {
    for (const key of [
      'statusUndecryptable',
      'undecryptableTitle',
      'undecryptableFixHint',
      'undecryptableSecret',
    ]) {
      expect(enSrc.vault[key], `en vault.${key}`).toBeTruthy();
      expect(zhSrc.vault[key], `zh vault.${key}`).toBeTruthy();
    }
  });
});
