import { describe, it, expect } from 'vitest';
import { paginationModel, pageWindow } from './Pagination.model';

/**
 * Fences for the unified pagination bar (2026-07-26). Four pagination
 * implementations collapsed into one component, so these lock the behaviours the
 * old copies disagreed about — plus the empty-page bug that motivated the work.
 */
describe('paginationModel — page-number mode', () => {
  it('disables next on the last page when total is an exact multiple of pageSize', () => {
    // THE BUG THIS REPLACES: conversation-audit inferred "there may be more" from
    // `rowsOnThisPage >= pageSize`, so with exactly 20/40/60 rows the "next"
    // button stayed live and clicking it landed on an empty page. With a real
    // total the boundary is exact.
    const m = paginationModel({ page: 1, pageSize: 20, total: 20 });
    expect(m.visible && m.mode === 'pages' && m.nextDisabled).toBe(true);

    const m2 = paginationModel({ page: 2, pageSize: 20, total: 40 });
    expect(m2.visible && m2.mode === 'pages' && m2.nextDisabled).toBe(true);

    // ...and still enabled when there genuinely is a next page.
    const m3 = paginationModel({ page: 1, pageSize: 20, total: 21 });
    expect(m3.visible && m3.mode === 'pages' && m3.nextDisabled).toBe(false);
  });

  it('stays visible on a single page with both buttons disabled', () => {
    // Decision 2026-07-26: a greyed bar says "paginated, and you see all of it".
    // A vanishing bar is indistinguishable from a silently truncated list. The
    // old `total <= pageSize` early-return is deliberately gone.
    const m = paginationModel({ page: 1, pageSize: 20, total: 12 });
    expect(m.visible).toBe(true);
    expect(m.visible && m.mode === 'pages' && m.prevDisabled).toBe(true);
    expect(m.visible && m.mode === 'pages' && m.nextDisabled).toBe(true);
  });

  it('hides only on a genuinely empty result', () => {
    // The table renders its own empty state; "0–0 / 共 0" underneath is noise.
    expect(paginationModel({ page: 1, pageSize: 20, total: 0 }).visible).toBe(false);
  });

  it('reports a 1-indexed human range clamped to total', () => {
    expect(paginationModel({ page: 1, pageSize: 20, total: 137 })).toMatchObject({
      range: { start: 1, end: 20, total: 137 },
    });
    // Last, partial page: end must clamp to total, not page * pageSize.
    expect(paginationModel({ page: 7, pageSize: 20, total: 137 })).toMatchObject({
      range: { start: 121, end: 137, total: 137 },
    });
  });

  it('disables prev on page 1 and enables it after', () => {
    const first = paginationModel({ page: 1, pageSize: 20, total: 137 });
    expect(first.visible && first.mode === 'pages' && first.prevDisabled).toBe(true);
    const second = paginationModel({ page: 2, pageSize: 20, total: 137 });
    expect(second.visible && second.mode === 'pages' && second.prevDisabled).toBe(false);
  });
});

describe('paginationModel — cursor mode (mixed-version fallback)', () => {
  it('uses hasNext instead of a computed page count', () => {
    // Reached only when the wire carried no total (pre-upgrade query-service).
    const m = paginationModel({ page: 3, pageSize: 20, hasNext: true, count: 20 });
    expect(m).toMatchObject({ visible: true, mode: 'cursor', page: 3, prevDisabled: false, nextDisabled: false });

    const last = paginationModel({ page: 3, pageSize: 20, hasNext: false, count: 5 });
    expect(last.visible && last.mode === 'cursor' && last.nextDisabled).toBe(true);
  });

  it('hides an empty first page but keeps the bar past page 1', () => {
    expect(paginationModel({ page: 1, pageSize: 20, hasNext: false, count: 0 }).visible).toBe(false);
    // Overshot past the end: the reader still needs a way back.
    expect(paginationModel({ page: 4, pageSize: 20, hasNext: false, count: 0 }).visible).toBe(true);
  });

  it('renders a single page with both buttons disabled, like page-number mode', () => {
    const m = paginationModel({ page: 1, pageSize: 20, hasNext: false, count: 12 });
    expect(m).toMatchObject({ visible: true, mode: 'cursor', prevDisabled: true, nextDisabled: true });
  });
});

describe('pageWindow', () => {
  it('lists every page when they all fit the window', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('bridges gaps with a single ellipsis on each side', () => {
    expect(pageWindow(5, 10)).toEqual([1, '...', 4, 5, 6, '...', 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, '...', 10]);
    expect(pageWindow(10, 10)).toEqual([1, '...', 9, 10]);
  });

  it('never emits an ellipsis standing in for a single page', () => {
    // page 3 of 5 → 1,2,3,4,5 with no gap to bridge.
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
