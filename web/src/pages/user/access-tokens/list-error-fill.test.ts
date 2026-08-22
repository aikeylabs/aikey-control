import { describe, expect, it } from 'vitest';

const source = await import('./index.tsx?raw').then((m) => m.default);

/**
 * 🔴 The Access Token list-error row must FILL its cell and must not be a
 * second red block (2026-08-22).
 *
 * What it looked like before: a 231px red pill floating in the middle of a
 * 1180px table cell, while the shell's DataFetchErrorBanner was already
 * reporting the very same failure above it — in full width, with the error
 * code. Two loud red surfaces for one failure, and the smaller one carried
 * less information.
 *
 * R7 of workflow/CI/requirements/2026-07-26-read-path-error-visibility.md:
 * one failure gets ONE loud surface. What earns its place inside the table is
 * the thing the banner cannot offer — the retry, next to the content it
 * reloads. So this row keeps the action, fills the width, and stays calm.
 *
 * 能红: restore `inline-flex` (it stops filling), or put the destructive red
 * background/border back (it becomes the second loud block again).
 */
/**
 * Slice just the list-error branch. The page has OTHER red alerts on purpose —
 * a per-row inline error and a pool-load notice — and they are correctly scoped
 * to what they describe. A file-wide "no red" assertion would condemn them too,
 * so the fence reads the one block it is about.
 */
const LIST_ERROR_BLOCK = (() => {
  const start = source.indexOf('{isError && (');
  if (start < 0) return '';
  const end = source.indexOf('{agents && agents.length === 0 && (', start);
  return end > start ? source.slice(start, end) : source.slice(start, start + 1200);
})();

describe('access-token list error row', () => {
  it('the fence actually found the block (not passing vacuously)', () => {
    expect(LIST_ERROR_BLOCK).toContain("t('accessTokens.loadError')");
  });

  it('fills the cell instead of floating as a pill', () => {
    expect(LIST_ERROR_BLOCK).toContain('className="flex w-full items-center justify-center gap-3 rounded px-4 py-3"');
    expect(LIST_ERROR_BLOCK).not.toContain('inline-flex');
  });

  it('is not a second red block — the shell banner is the loud one', () => {
    expect(LIST_ERROR_BLOCK).not.toContain('239,68,68');
    expect(LIST_ERROR_BLOCK).not.toContain('#fca5a5');
  });

  it('keeps the retry — that is why this row exists at all', () => {
    expect(LIST_ERROR_BLOCK).toContain("onClick={() => void refetch()}>{t('accessTokens.retry')}");
  });
});
