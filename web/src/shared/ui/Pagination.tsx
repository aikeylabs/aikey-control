import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  paginationModel,
  pageSizeOptions,
  readStoredPageSize,
  storePageSize,
  type PaginationInput,
} from './Pagination.model';

/**
 * Caller-side hook for the page-size selector (2026-07-29).
 *
 * Usage: `const [pageSize, setPageSize] = useStoredPageSize(20);` then pass
 * both to <Pagination pageSize={pageSize} onPageSize={setPageSize} …>. The
 * argument is the PAGE'S OWN default — it only applies until the user has
 * picked a size anywhere (one global preference, see Pagination.model.ts).
 *
 * Server-paged callers must also key their query on pageSize (it is the wire
 * `limit`); the component resets to page 1 on change, which resets the offset
 * through the caller's existing onPage conversion.
 */
export function useStoredPageSize(defaultSize: number): [number, (n: number) => void] {
  const [size, setSize] = useState<number>(() => readStoredPageSize(defaultSize));
  const set = useCallback((n: number) => {
    storePageSize(n);
    setSize(n);
  }, []);
  return [size, set];
}

/**
 * The canonical pagination bar — one component behind every paginated table
 * (master + user, client-sliced + server-paged).
 *
 * WHY it looks like this (2026-07-26): the console had grown FOUR pagination
 * implementations — this component, two copy-pasted inline blocks on the
 * compliance pages, a private `Pager` inside conversation-audit, and a
 * scoped-CSS `.ud-pager` on the user usage-detail page — plus five sets of i18n
 * keys saying the same thing. They disagreed on look, on whether a single page
 * still renders a bar, and on whether "next" could be clicked into the void.
 *
 * TWO MODES, chosen by whether the caller knows the TOTAL:
 *
 *  - `total` given → PAGE-NUMBER mode: "1–20 / 共 137" plus numbered buttons.
 *    This is the default and what every caller should reach for.
 *
 *  - `total` absent → CURSOR mode: "第 3 页" plus prev/next only, with `hasNext`
 *    driving the next button. Its ONLY purpose is a mixed-version window: in the
 *    Cluster / Production editions query-service and control-master are separate
 *    systemd units, so a deploy can briefly pair a new console with a
 *    query-service whose list endpoints still answer with a bare array (no
 *    total). Rendering an honest "第 N 页" beats inventing a page count.
 *    The union type makes `hasNext` REQUIRED here, so a caller cannot land in
 *    cursor mode and silently lose the next button.
 *
 * ALWAYS RENDERED WHEN THERE IS DATA — even on a single page (decision
 * 2026-07-26). A greyed-out bar tells the reader "this list is paginated and you
 * are looking at all of it"; a bar that disappears is indistinguishable from a
 * list that silently truncated. Only a genuinely empty result hides the bar,
 * because there the table already renders its own empty state and stacking
 * "0–0 / 共 0" under it is noise. This overrides the older `total <= pageSize`
 * early-return, which is why several tables now show a bar they used to hide.
 *
 * `page` is 1-INDEXED. Callers whose state is an `offset` convert at the
 * boundary: `page={Math.floor(offset / pageSize) + 1}` /
 * `onPage={(p) => setOffset((p - 1) * pageSize)}`.
 *
 * All visibility / mode / enablement decisions live in Pagination.model.ts so
 * they are unit-testable without a DOM; this file is the renderer.
 */
type PaginationProps = PaginationInput & {
  onPage: (p: number) => void;
  /** Present ⇒ render the per-page size selector. On change the component
   *  stores nothing itself — it calls this AND resets to page 1 (a density
   *  change re-anchors the window; keeping a stale page index would show an
   *  empty page past the new end). Pair with useStoredPageSize. */
  onPageSize?: (n: number) => void;
};

const BTN = 'px-2.5 py-1 text-[10px] font-mono rounded border disabled:opacity-30';
const BTN_STYLE = { borderColor: 'var(--border)', color: 'var(--muted-foreground)' } as const;

export function Pagination({ onPage, onPageSize, ...input }: PaginationProps) {
  const { t } = useTranslation();
  const m = paginationModel(input as PaginationInput);
  if (!m.visible) return null;

  return (
    <div className="flex items-center justify-between px-2 py-3">
      <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
        {m.mode === 'pages' ? t('pagination.range', m.range) : t('pagination.pageN', { n: m.page })}
      </span>
      <div className="flex items-center gap-1">
        {onPageSize && (
          <select
            value={input.pageSize}
            onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
            aria-label={t('pagination.perPageAria')}
            className="mr-2 px-1.5 py-1 text-[10px] font-mono rounded border cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)', backgroundColor: 'var(--card)' }}
          >
            {pageSizeOptions(input.pageSize).map((n) => (
              <option key={n} value={n}>{t('pagination.perPage', { n })}</option>
            ))}
          </select>
        )}
        <button disabled={m.prevDisabled} onClick={() => onPage(input.page - 1)} className={BTN} style={BTN_STYLE}>
          {t('pagination.prev')}
        </button>
        {m.mode === 'pages' &&
          m.pages.map((p, i) =>
            p === '...' ? (
              <span key={`dots-${i}`} className="px-1 text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>···</span>
            ) : (
              <button
                key={p}
                onClick={() => onPage(p)}
                className="w-7 h-7 text-[10px] font-mono rounded border"
                style={{
                  borderColor: input.page === p ? 'var(--primary)' : 'var(--border)',
                  color: input.page === p ? 'var(--primary)' : 'var(--muted-foreground)',
                  backgroundColor: input.page === p ? 'rgba(250,204,21,0.08)' : 'transparent',
                }}
              >
                {p}
              </button>
            )
          )}
        <button disabled={m.nextDisabled} onClick={() => onPage(input.page + 1)} className={BTN} style={BTN_STYLE}>
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}
