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
 * Action cells (the ones containing buttons) should still stop
 * propagation on their own `<td onClick>` — this guard handles the
 * COMPLEMENT case (clicks on the data cells, which should normally
 * open the drawer EXCEPT when they're really text selections).
 *
 * Usage:
 *   const guard = makeRowClickProps(() => setSelected(k));
 *   <tr {...guard}>
 *
 * 2026-06-11 bug: workflow/CI/bugfix/2026-06-11-row-onclick-text-selection.md
 */
export interface RowClickGuardOptions {
  /** Px-distance between mousedown and mouseup that disqualifies the click as a drag. Default 4 (typical OS drag threshold). */
  dragThresholdPx?: number;
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
