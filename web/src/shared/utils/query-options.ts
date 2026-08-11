/**
 * Shared react-query option presets.
 *
 * ⚠️ DUAL-EDIT FILE — an identical copy lives in the other console's
 * `src/shared/utils/`. `shared/utils/` is inside the must-sync whitelist;
 * `make -f workflow/CI/Makefile web-drift-check` enforces byte equality.
 */

/**
 * For a candidate list inside a SHORT-LIVED dialog / drawer: always refetch
 * when it opens, never serve the app-wide 30-second cache.
 *
 * WHY (2026-08-11): the app sets `staleTime: 30_000` globally
 * (app/providers/index.tsx), which is right for a page that stays open. It is
 * wrong for a picker, because what a picker shows is not information — it is
 * the SET OF THINGS THE USER MAY DO, computed from relationship state that
 * another surface can change at any moment.
 *
 * The report that produced this: an operator removed an OAuth account from one
 * pool and immediately opened another pool's attach dialog, where that account
 * was still greyed out as "already in another pool". No request had been made;
 * the 30-second-old answer was served, and it was wrong about what the operator
 * was allowed to do.
 *
 * The alternative — have every mutation invalidate every picker's key — was
 * also done where it belongs (a long-lived list still needs it), but it cannot
 * be the picker's guarantee: it holds only as long as every FUTURE write path
 * remembers. Refetching on open costs one small request at the cheapest
 * possible moment and depends on nothing.
 *
 * Use it for pickers. Do NOT use it for page-level lists — there the global
 * staleTime is doing useful work.
 */
export const LIVE_PICKER_QUERY = {
  staleTime: 0,
  refetchOnMount: 'always',
} as const;
