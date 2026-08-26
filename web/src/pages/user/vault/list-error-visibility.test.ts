import { describe, expect, it } from 'vitest';

const source = await import('./index.tsx?raw').then((module) => module.default);

/**
 * Regression fence for the vault records-list error branch.
 *
 * ## History — read this before "restoring" anything
 *
 * 2026-08-17: the branch rendered `加载失败: Network Error` — a bare
 * `err.message` with no code and no next step, which R2 of
 * workflow/CI/requirements/2026-07-26-read-path-error-visibility.md forbids.
 * The fix routed it through parseApiError + ApiErrorDisplay, and THIS FILE used
 * to assert that block existed inside the table.
 *
 * 2026-08-22: the user looked at the result and rejected the shape, not the
 * content — the same failure was being drawn three times on one screen (shell
 * banner, page aggregate, and this in-table block), which reads as broken UI.
 * Decision: 表格里不显示错误信息; the code + message + next step live in ONE
 * place, the aggregate at the top of the page. So the assertions inverted.
 *
 * ## What is fenced now
 *
 * 1. No error display inside the table. `ApiErrorDisplay` must not come back
 *    here, and neither may the older bare-message shapes R2 already banned.
 * 2. `listError` must still be REPORTED — it moved into the PageQueryErrors
 *    aggregate, it was not dropped. Deleting it there is the silent-failure
 *    regression 2026-07-26 exists to prevent.
 * 3. The table must not render the ordinary "vault is empty" panel while the
 *    read is broken. That is the exact disease — a dead backend masquerading
 *    as an account with no keys — so the empty panel stays gated on !listError
 *    and the error case renders the neutral `vault.listUnavailable` line.
 *
 * 能红: put `<ApiErrorDisplay error={parseApiError(listError)} />` back in the
 * table → assertion 1 fires. Drop `listError` from the aggregate → 2 fires.
 * Remove `!listError` from the empty-panel condition → 3 fires.
 *
 * See workflow/CI/bugfix/20260817-vault-list-error-bare-message.md and
 * workflow/CI/bugfix/20260822-vault-page-pullup-covers-error-banner.md.
 */
describe('vault records-list error visibility (R2)', () => {
  it('renders no error display inside the table', () => {
    expect(source).not.toContain('ApiErrorDisplay');
    expect(source).not.toContain('parseApiError');
    // The pre-2026-08-17 shapes R2 banned outright.
    expect(source).not.toContain('(listError as Error).message');
    expect(source).not.toContain("t('vault.loadFailed')");
  });

  it('still reports the list error — in the page aggregate, once', () => {
    expect(source).toContain('<PageQueryErrors sources={[vaultStatusError, rulesError, listError]} />');
  });

  it('never lets a failed read render as an empty vault', () => {
    expect(source).toContain("{listError && <EmptyState message={t('vault.listUnavailable')} />}");
    expect(source).toContain('!listLoading && !listError && records.length === 0');
  });
});
