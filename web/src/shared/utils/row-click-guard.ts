import type React from 'react';

/**
 * makeRowClickProps — guard the "click a row to open a drawer" pattern
 * against the two interactions users actually try to do INSIDE the row
 * and don't want to trigger the drawer:
 *
 *  1. Selecting text (e.g. a long virtual_key_id for copy). A naive
 *     `<tr onClick>` fires on the mouseup that ends the drag-select,
 *     so the drawer opens the instant the user releases. Pre-fix it
 *     was literally impossible to select text inside a row without
 *     also popping the drawer overlay on top of the selection.
 *
 *  2. Single-click + drag, even without ending on a selection (the
 *     `getSelection()` check above only catches non-empty selections).
 *     We detect the drag by comparing mouseDown → mouseUp coordinates
 *     and aborting when the pointer moved more than `dragThresholdPx`.
 *
 *  3. Clicking a row ACTION. Buttons, links and the whole actions
 *     cell must never also open the drawer — the drawer would land
 *     on top of the action the user just took. See isRowClickExempt.
 *
 * Usage:
 *   const guard = makeRowClickProps(() => setSelected(k));
 *   <tr {...guard}>
 *   …
 *   <td data-row-actions>…buttons…</td>
 *
 * 2026-06-11 bug: workflow/CI/bugfix/2026-06-11-row-onclick-text-selection.md
 */
export interface RowClickGuardOptions {
  /** Px-distance between mousedown and mouseup that disqualifies the click as a drag. Default 4 (typical OS drag threshold). */
  dragThresholdPx?: number;
}

/**
 * Is this click target exempt from "clicking a row opens the drawer"?
 *
 * 🔴 THE single definition, shared by both consoles (2026-08-11 user request:
 * 「操作列点击，不要展开抽屉。所有页面都是一样，统一修改一下」).
 *
 * It used to be neither shared nor single. This helper's own doc told pages to
 * "stop propagation on their own <td onClick>", i.e. every page re-implemented
 * the rule by hand and a page that forgot simply popped the drawer over its own
 * action button; meanwhile the personal console had THREE different inline
 * `closest(...)` selector strings, so "click a row action" behaved differently
 * depending on which page you were on. A rule that each call site restates is a
 * rule that drifts.
 *
 * Three exemptions:
 *  - Interactive elements — the control handles its own click.
 *  - `[data-row-actions]` — the whole actions CELL, not just its buttons. The
 *    padding around a button is part of the actions column: clicking the gap
 *    between 「轮换」 and 「停用」 must not open the drawer either, and that gap
 *    is precisely what an element-only check misses.
 *  - `.row-actions` — the personal console's shared action-button container
 *    (KEYS_PAGE_CSS). Redundant wherever the cell is already marked, and that
 *    is the point: the marker is a thing a page author must remember, and this
 *    is the same rule expressed through something they cannot forget because
 *    the buttons need the class to be laid out at all.
 */
export function isRowClickExempt(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('button, input, textarea, select, a, [role="button"], [data-row-actions], .row-actions');
}

export function makeRowClickProps(
  onActivate: () => void,
  options: RowClickGuardOptions = {},
): Pick<React.HTMLAttributes<HTMLTableRowElement>, 'onMouseDown' | 'onClick'> {
  const { dragThresholdPx = 4 } = options;
  return {
    onMouseDown: (e) => {
      const el = e.currentTarget as HTMLTableRowElement;
      el.dataset.rowGuardMx = String(e.clientX);
      el.dataset.rowGuardMy = String(e.clientY);
    },
    onClick: (e) => {
      // Row actions / interactive controls — checked FIRST, because it is the
      // cheapest and the most common reason a click must not open the drawer.
      if (isRowClickExempt(e.target)) return;
      // Active text selection — let the user finish their copy, do not
      // steal focus into the drawer.
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
      if (sel && sel.toString().length > 0) return;
      // Drag detection — bail if the pointer moved more than the
      // threshold between down and up.
      const el = e.currentTarget as HTMLTableRowElement;
      const mx = Number(el.dataset.rowGuardMx ?? e.clientX);
      const my = Number(el.dataset.rowGuardMy ?? e.clientY);
      const dx = e.clientX - mx;
      const dy = e.clientY - my;
      if (Math.hypot(dx, dy) > dragThresholdPx) return;
      onActivate();
    },
  };
}
