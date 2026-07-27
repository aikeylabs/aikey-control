/**
 * Pure decision logic behind <Pagination> — kept out of the component so it can
 * be unit-tested without a DOM. (This repo has no jsdom / testing-library stack;
 * every test is a pure-logic .ts test, so the logic worth fencing lives here and
 * the component stays a thin renderer.)
 *
 * Everything that used to be an ad-hoc judgement call at 13 call sites is decided
 * here, once:
 *   - is the bar visible at all?
 *   - page-number mode or cursor mode?
 *   - is prev / next enabled?
 *   - which page buttons show, and where do the ellipses go?
 *
 * See Pagination.tsx for the WHY of the two modes and the always-visible rule.
 */

export type PaginationInput = {
  page: number; // 1-indexed
  pageSize: number;
} & (
  | { total: number; hasNext?: never; count?: never }
  | { total?: undefined; hasNext: boolean; count: number }
);

export type PaginationModel =
  | { visible: false }
  | {
      visible: true;
      mode: 'pages';
      range: { start: number; end: number; total: number };
      pages: (number | '...')[];
      prevDisabled: boolean;
      nextDisabled: boolean;
    }
  | {
      visible: true;
      mode: 'cursor';
      page: number;
      prevDisabled: boolean;
      nextDisabled: boolean;
    };

export function paginationModel(input: PaginationInput): PaginationModel {
  const { page, pageSize } = input;

  // Cursor mode — total unknown (a pre-upgrade query-service still answering with
  // a bare array). Honest "第 N 页" + prev/next; `hasNext` is the only signal for
  // whether another page exists.
  if (input.total == null) {
    // Hide only a genuinely empty first page — the table renders its own empty
    // state there. Past page 1 the bar must stay so the reader can walk back.
    if (input.count === 0 && page <= 1) return { visible: false };
    return {
      visible: true,
      mode: 'cursor',
      page,
      prevDisabled: page <= 1,
      nextDisabled: !input.hasNext,
    };
  }

  const { total } = input;
  if (total === 0) return { visible: false };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    visible: true,
    mode: 'pages',
    range: {
      start: (page - 1) * pageSize + 1,
      end: Math.min(page * pageSize, total),
      total,
    },
    pages: pageWindow(page, totalPages),
    prevDisabled: page <= 1,
    // Exact, because we have a real total. The bug this replaces guessed
    // "there may be more" from `rowsOnThisPage >= pageSize`, which offered a
    // dead "next" whenever total was an exact multiple of pageSize.
    nextDisabled: page >= totalPages,
  };
}

/** First page, last page, and the current page ±1 — with '...' bridging any gap. */
export function pageWindow(page: number, totalPages: number): (number | '...')[] {
  return Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | '...')[]>((acc, p, idx, arr) => {
      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);
}
