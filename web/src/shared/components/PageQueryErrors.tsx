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
 *
 * ## Why it also dedupes against the shell banner (2026-08-22)
 *
 * The two layers were drawing the SAME failure twice, stacked, at the top of
 * the same page: `▶ Error` from here, then "部分数据加载失败 · [CLIENT_ERROR]
 * Network Error" from the banner right under it. Reported as "报错的样式还是
 * 没改过来" — and it reads as broken UI rather than as two deliberate layers.
 *
 * The overlap is not a coincidence, it is structural: the banner is derived
 * from the shared QueryClient cache, so ANY error that reached this component
 * through a react-query `error` is, by construction, already in the banner. So
 * this block renders only what the banner CANNOT see — an error passed in from
 * something other than the shared cache (a manual fetch, a different client).
 * In practice that means it usually renders nothing, and that is the point:
 * the page shows one error surface, not two.
 *
 * 🔴 Precondition: the shell mounts <DataFetchErrorBanner />. If it ever stops,
 * the suppression here turns into silence — the exact 2026-07-26 disease. Fenced
 * by `page-query-errors-dedupe.test.ts`, which reads UserShell and fails if the
 * banner is no longer mounted.
 */
import { useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();

  // Codes the shell banner is already showing. Read straight from the cache
  // rather than through a registry the two components have to keep in sync:
  // the cache IS the banner's source of truth, so there is nothing to drift.
  // No subscription needed — this component only re-renders when the page
  // re-renders, which is exactly when one of `sources` changed state.
  const shown = new Set<string>();
  for (const q of queryClient.getQueryCache().getAll()) {
    if (q.state.status === 'error' && q.state.error) shown.add(parseApiError(q.state.error).code);
  }

  const errors = collectQueryErrors(sources).filter((e) => !shown.has(e.code));
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
