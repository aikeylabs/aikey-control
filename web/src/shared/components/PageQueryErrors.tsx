/**
 * PageQueryErrors — one aggregated, precise error block per page.
 *
 * The page-level half of the 2026-07-26 silent-failure project. The global
 * DataFetchErrorBanner (UserShell) guarantees NO failure is ever silent; this
 * block is the per-page layer that says it precisely, next to the content it
 * affects, using the same ApiErrorDisplay (code + message + actionable
 * suggestion) the master console already renders for its admin pages.
 *
 * Usage — pass every query's `error` on the page, in one place:
 *
 *     <PageQueryErrors sources={[meQ.error, seatsQ.error, timelineQ.error]} />
 *
 * Nulls/undefined are fine (healthy queries), so call sites stay unconditional.
 *
 * Why ONE aggregated block instead of a marker inside every card: pages like
 * overview run 11 queries and usage-ledger 8 — sprinkling eleven error blocks
 * through a 1500-line JSX tree is a regression farm, and when a backend is down
 * they would all say the same thing eleven times. Errors are deduped by CODE
 * (one dead backend = many queries, one cause); the first three render in
 * compact click-to-expand form, the rest fold into a count.
 */
import { useTranslation } from 'react-i18next';

import { ApiErrorDisplay } from '@/shared/ui/ApiErrorDisplay';
import { parseApiError, type ApiError } from '@/shared/utils/api-error';

export function collectQueryErrors(sources: ReadonlyArray<unknown>): ApiError[] {
  const byCode = new Map<string, ApiError>();
  for (const e of sources) {
    if (!e) continue;
    const parsed = parseApiError(e);
    if (!byCode.has(parsed.code)) byCode.set(parsed.code, parsed);
  }
  return [...byCode.values()];
}

const MAX_SHOWN = 3;

export function PageQueryErrors({ sources }: { sources: ReadonlyArray<unknown> }) {
  const { t } = useTranslation();
  const errors = collectQueryErrors(sources);
  if (errors.length === 0) return null;

  return (
    <div className="mb-4 space-y-1" data-testid="page-query-errors">
      {errors.slice(0, MAX_SHOWN).map((e) => (
        <ApiErrorDisplay key={e.code} compact error={e} />
      ))}
      {errors.length > MAX_SHOWN && (
        <div className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
          {t('dataFetchError.more', { count: errors.length - MAX_SHOWN })}
        </div>
      )}
    </div>
  );
}
