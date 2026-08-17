import { describe, expect, it } from 'vitest';

const source = await import('./index.tsx?raw').then((module) => module.default);

/**
 * Regression fence for the vault records-list error branch (2026-08-17).
 *
 * The list query (`listError`) renders its own inline error instead of going
 * through PageQueryErrors — that split is intentional and documented at the
 * `<PageQueryErrors sources={...} />` call site. What was NOT intentional is
 * what the inline branch rendered:
 *
 *     <EmptyState message={`${t('vault.loadFailed')}${(listError as Error).message}`} />
 *     →  "加载失败: Network Error"
 *
 * R2 of workflow/CI/requirements/2026-07-26-read-path-error-visibility.md
 * forbids exactly this shape — "禁止裸 err.message、禁止只写『加载失败』" — because
 * it gives the user no error code and no next step. The 2026-07-26 pass that
 * introduced R2 explicitly left the pre-existing inline branches alone
 * ("已有内联错误处理的地方保留不动"), so this one survived the rule that was
 * written to kill it. This fence is what makes the rule bite for this page.
 *
 * See workflow/CI/bugfix/20260817-vault-list-error-bare-message.md.
 */
describe('vault records-list error visibility (R2)', () => {
  it('renders the list error through parseApiError + ApiErrorDisplay', () => {
    expect(source).toContain("import { ApiErrorDisplay } from '@/shared/ui/ApiErrorDisplay';");
    expect(source).toContain("import { parseApiError } from '@/shared/utils/api-error';");
    expect(source).toContain('<ApiErrorDisplay error={parseApiError(listError)} />');
  });

  it('never renders a raw Error message or a bare "failed to load" label', () => {
    // Red-fence check: restore the old EmptyState line and either assertion fires.
    expect(source).not.toContain('(listError as Error).message');
    expect(source).not.toContain("t('vault.loadFailed')");
  });

  it('keeps the list error OUT of the PageQueryErrors aggregate (no double-report)', () => {
    // R6 dedupes by code inside the aggregate, but the aggregate and this
    // inline branch are separate surfaces — adding listError to both would
    // print the same failure twice on one page.
    expect(source).toContain('<PageQueryErrors sources={[vaultStatusError, rulesError]} />');
  });
});
