import React, { useRef, useEffect } from 'react';
import './Checkbox.css';

/**
 * Checkbox — themed replacement for browser-default `<input type="checkbox">`.
 *
 * # Why this component exists
 *
 * The master admin pages (orgs/seats, orgs/bindings, orgs/virtual-keys,
 * admin/quota, login) all spawn small browser-default checkboxes that
 * (1) read out of place against the amber/zinc dark theme,
 * (2) render at ~13px on most platforms which makes them awkward to
 *     hit on retina laptops + impossible on small touch screens,
 * (3) drift visually between Chrome/Safari/Firefox because each browser
 *     paints `accent-color` slightly differently.
 *
 * This component renders a 18×18px visual box wrapped in a label whose
 * padded click target is 28×28px (≈2× the visible square) so missed
 * clicks become rare. Hover / focus / disabled / indeterminate are all
 * styled to match the rest of the admin chrome (var(--primary),
 * var(--primary-dim), var(--border)).
 *
 * # Accessibility / form semantics
 *
 * The visual square is purely cosmetic — the actual checkbox is a
 * keyboard- and screen-reader-accessible native `<input type="checkbox">`
 * positioned absolutely with opacity 0 over the visual. That keeps:
 *   - Space / Enter toggling
 *   - Form submission semantics (no extra hidden inputs needed)
 *   - Browser autofill / a11y trees
 *   - aria-checked = mixed for indeterminate (the native input handles it)
 *
 * # API
 *
 *   <Checkbox checked={x} onChange={() => setX(!x)} />
 *   <Checkbox checked={partial} indeterminate={mixed} onChange={...} />
 *   <Checkbox checked={x} onChange={fn} label="启用合规过滤" />
 *   <Checkbox checked={x} onChange={fn} disabled />
 *
 * Use `label` (string) for the common inline-label case. For richer
 * label content (nested elements, badges), pass `children` instead —
 * it overrides `label` if both are present.
 *
 * # Why not a third-party component (Headless UI, Radix, etc.)
 *
 * The project's existing shared/ui (Badge, Button, PageHeader, etc.)
 * is hand-rolled to keep the dependency footprint small and the
 * styling 100% under our amber-theme tokens. A Checkbox primitive
 * is ~50 LoC and follows the same convention; pulling in a UI
 * library for one component would invert that ratio.
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Mixed-state visual; toggles aria-checked="mixed". */
  indeterminate?: boolean;
  /** Convenience label rendered to the right of the box. Overridden by `children`. */
  label?: React.ReactNode;
  /**
   * Stretch the label to fill its parent (commonly a table `<td>`), making
   * the whole cell a click target so missed clicks anywhere in the column
   * still toggle. Pairs naturally with stop-propagation on the same click:
   * see `onClick` documentation below.
   *
   * Without this, only the 28×28px padded square around the visual box is
   * clickable, which is hard to hit accurately in a tight selection
   * column ("点击复选框列, 都要能勾选上" — that user feedback gave us this
   * prop). Use on table-row select / select-all checkboxes; not needed for
   * inline form labels (where the surrounding label text is itself part of
   * the target anyway).
   */
  fillContainer?: boolean;
}

export function Checkbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  children,
  className,
  style,
  fillContainer = false,
  // Pull `onClick` out of inputProps and apply it to the LABEL (not the input).
  // Why: when a click on the visual square triggers the label → native input
  // synthesized click, the ORIGINAL click event has already bubbled label →
  // parent (e.g. table row) — so attaching stopPropagation to the input's
  // onClick is too late (the row's onClick has already fired and opened the
  // detail drawer). Hoisting onClick to the label catches the event at its
  // first React handler on the way up, before it reaches any wrapping td/row.
  // This is exactly the semantics callers want when they write
  // `onClick={e => e.stopPropagation()}` on a row-select checkbox.
  onClick,
  ...inputProps
}: CheckboxProps) {
  // The native input's `indeterminate` is JS-only (no HTML attribute), so we
  // sync it via ref on every render. Without this, an indeterminate header
  // checkbox would render as a checked tick after click + re-render unless
  // the parent toggles indeterminate=false at the same time.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const showCheck = !!checked && !indeterminate;
  const showDash = indeterminate;
  // Visual state — filled when checked OR indeterminate; transparent otherwise.
  // Border deepens to primary on filled and on hover (handled via :hover in JSX
  // style — we use inline pseudo-state via CSS-in-style isn't possible, so use
  // a wrapping className that toggles via state).
  const filled = showCheck || showDash;

  return (
    <label
      // Inline-flex by default — labelled / unlabelled both lay out
      // correctly. When `fillContainer`, the label uses absolute inset:0
      // positioning so it fills its parent's FULL height. `h-full` (height:
      // 100%) doesn't work inside `<td>` because table cells size to
      // their content, not their tr's actual rendered height — the row's
      // 50px height comes from the other cells, but the cb cell has no
      // intrinsic content to size to, so `h-full` resolves to the label's
      // own content height (~28px) and leaves a dead click strip
      // underneath. inset:0 sidesteps this by ignoring intrinsic height
      // entirely. Requires the parent to be `position: relative` — see
      // the table call sites (seats/bindings) where the td has padding:0
      // and we count on position:static promoting the absolute child to
      // the nearest non-static ancestor. We add position: relative via
      // inline style on the parent td at each call site.
      //
      // The 5px padding gives regular (non-fill) mode a ~28×28 click
      // target; in fillContainer mode the entire parent IS the target.
      // gap-2 separates box from label text without changing the click
      // target (the label remains the clickable surface).
      className={[
        fillContainer
          ? 'absolute inset-0 flex items-center justify-center'
          : 'inline-flex items-center gap-2',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className ?? '',
      ].join(' ')}
      style={{ padding: '5px', ...style }}
      onClick={onClick as React.MouseEventHandler<HTMLLabelElement> | undefined}
    >
      {/* Position container holds the native input + the visual square. */}
      <span className="relative inline-flex items-center justify-center" style={{ width: 18, height: 18 }}>
        <input
          ref={inputRef}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className="absolute inset-0 m-0 cursor-inherit opacity-0"
          style={{ width: 18, height: 18 }}
          aria-checked={indeterminate ? 'mixed' : checked ? 'true' : 'false'}
          {...inputProps}
        />
        {/* Visual square — drawn behind the input so click events still hit
            the native control (the input is transparent + on top). */}
        <span
          aria-hidden="true"
          className="ak-check-box"
          data-filled={filled || undefined}
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `1.5px solid ${filled ? 'var(--primary-dim)' : 'var(--border)'}`,
            background: filled ? 'var(--primary-dim)' : 'transparent',
            transition: 'background 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
            // Subtle inner highlight on filled state — same "chip face" treatment
            // the favicon-aligned sidebar AK mark uses, gives the filled box a
            // hint of depth instead of reading flat-yellow.
            boxShadow: filled
              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 0 0 0 rgba(250, 204, 21, 0)'
              : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {showCheck && (
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M3.5 8.5 L7 12 L13 5"
                fill="none"
                stroke="#fef3c7"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {showDash && (
            <span
              style={{
                display: 'block',
                width: 10,
                height: 2,
                borderRadius: 1,
                background: '#fef3c7',
              }}
            />
          )}
        </span>
      </span>
      {(children ?? label) != null && (
        <span className="text-xs font-mono select-none" style={{ color: 'var(--foreground)' }}>
          {children ?? label}
        </span>
      )}
    </label>
  );
}
