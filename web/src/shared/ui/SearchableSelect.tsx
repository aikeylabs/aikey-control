import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface SelectOption {
  value: string;
  label: string;
  /**
   * Optional second line rendered under `label` in the dropdown (e.g. a seat's
   * email under their name). The trigger / chip keeps showing `label` alone so
   * the closed control stays one line tall.
   */
  detail?: string;
  /**
   * Extra text the search should match but that isn't rendered (e.g. an id, or
   * an address a list deliberately hides). Defaults to label + detail + value.
   */
  searchText?: string;
  /**
   * Renders the option but refuses selection — for a choice the server would
   * reject anyway (2026-08-11: an OAuth account already held by another pool;
   * attaching it answers 409 BIZ_OAUTH_GROUP_CRED_IN_USE).
   *
   * 🔴 Shown-but-refused, not hidden, ON PURPOSE. Hiding leaves the operator
   * asking "where is my account?" with nothing on screen to answer them;
   * greying it out and stating the reason answers it. Callers should pair this
   * with `detail` (the reason) and sort disabled options last.
   */
  disabled?: boolean;
}

/** Everything a typed query may match: what's on screen plus the opt-in extras. */
export function optionHaystack(o: SelectOption): string {
  return `${o.label} ${o.detail ?? ''} ${o.searchText ?? ''} ${o.value}`.toLowerCase();
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  /**
   * When true (opt-in), a typed search that doesn't match any option
   * exactly gets a "+ Use custom: <typed>" row at the bottom of the
   * dropdown. Selecting it calls `onChange` with the typed value. The
   * value is passed through verbatim (no trim / lowercase) so the
   * caller can normalize if needed.
   *
   * Defaults to `false` so existing callers (master bindings, control-
   * events, provider-accounts) are unaffected.
   */
  allowCustom?: boolean;
  /**
   * Shown as the first row of the OPEN dropdown when nothing in it can be
   * picked — the list is empty, or every option is `disabled`.
   *
   * WHY IT LIVES IN THE DROPDOWN (2026-08-11): "there is nothing you can
   * choose" is discovered by opening the list and finding only greyed rows, so
   * the explanation has to be where the eye already is. A hint placed outside
   * the control is either covered by the panel (it opens downward) or simply
   * not where the operator is looking.
   *
   * The CALLER supplies the wording because only it knows the reason — the
   * component cannot tell "every account is already in another pool" from
   * "this provider has no accounts yet", and those need different advice.
   */
  noOptionsHint?: string;
}

/**
 * SearchableSelect — drop-in replacement for native <select> with fuzzy search.
 *
 * Renders an input-like trigger that opens a dropdown with a search field.
 * Keyboard: ArrowDown/Up to navigate, Enter to select, Escape to close.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  className = '',
  style,
  disabled,
  allowCustom = false,
  noOptionsHint,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  // Default placeholder is resolved here (not as a prop default) so it can
  // use the i18n `t()` hook; callers passing `placeholder` still override it.
  const resolvedPlaceholder = placeholder ?? t('searchableSelect.placeholder');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => optionHaystack(o).includes(q));
  }, [options, search]);

  // Keyboard navigation must skip what the mouse cannot click. Without this the
  // control contradicts itself: the row ignores a click but Enter selects it.
  const firstEnabledFrom = (start: number, step: 1 | -1): number => {
    for (let i = start; i >= 0 && i < filtered.length; i += step) {
      if (!filtered[i].disabled) return i;
    }
    return -1;
  };

  const selectedLabel = options.find(o => o.value === value)?.label;

  // `[].every()` is true, so this covers both "empty list" and "everything is
  // disabled" — the two ways a dropdown can offer nothing.
  const nothingSelectable = filtered.every((o) => o.disabled);

  // Custom-add row: show when `allowCustom` is on, the user has typed
  // something non-empty, and it doesn't exactly match any preset value
  // or label. Index is filtered.length (placed at the bottom of the list).
  const q = search.trim();
  const canCustom =
    allowCustom &&
    q.length > 0 &&
    !options.some(
      (o) =>
        o.value.toLowerCase() === q.toLowerCase() ||
        o.label.toLowerCase() === q.toLowerCase(),
    );

  useEffect(() => {
    // Land on the first SELECTABLE row, not row 0 — with disabled options
    // sorted last row 0 is normally fine, but an all-disabled result set must
    // not leave a highlight on something Enter would refuse.
    setHighlightIdx(Math.max(0, firstEnabledFrom(0, 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, options]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    const maxIdx = filtered.length + (canCustom ? 1 : 0) - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => {
        // The custom-add row (index === filtered.length) is always selectable.
        const next = firstEnabledFrom(i + 1, 1);
        if (next !== -1) return next;
        return canCustom ? filtered.length : Math.min(i, Math.max(0, maxIdx));
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => {
        const prev = firstEnabledFrom(Math.min(i, filtered.length) - 1, -1);
        return prev === -1 ? i : prev;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlightIdx];
      if (highlightIdx < filtered.length && opt) {
        // Refuse here too, not only on click — otherwise the keyboard path
        // can select what the pointer path rejects.
        if (opt.disabled) return;
        onChange(opt.value);
        setOpen(false);
      } else if (canCustom) {
        onChange(q);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function handleSelect(val: string) {
    onChange(val);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`} style={style}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className="w-full px-3 py-2 text-sm text-left rounded border flex items-center justify-between"
        style={{
          backgroundColor: 'var(--card)',
          // Amber border + ring when open, mirroring the global input:focus
          // treatment so the select and the search box read as one family.
          borderColor: open ? 'var(--primary)' : 'var(--border)',
          boxShadow: open ? '0 0 0 1px rgba(250, 204, 21, 0.2)' : 'none',
          transition: 'border-color 150ms ease, box-shadow 150ms ease',
          color: selectedLabel ? 'var(--foreground)' : 'var(--muted-foreground)',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        }}
      >
        <span className="truncate">{selectedLabel || resolvedPlaceholder}</span>
        <svg
          className="w-3.5 h-3.5 shrink-0 ml-2"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 w-full mt-1 rounded border shadow-lg"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--border)',
            boxShadow: '0 8px 32px rgba(var(--scrim-rgb), 0.5)',
          }}
        >
          {/* Search input */}
          <div className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              type="text"
              className="w-full px-2.5 py-1.5 text-xs rounded border outline-none"
              placeholder={t('searchableSelect.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                backgroundColor: 'rgba(var(--sink-rgb), 0.2)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
            />
          </div>

          {/* Nothing-to-pick hint — the dropdown's first row.
              🔴 Rendered OUTSIDE `listRef`'s container on purpose: the keyboard
              scroll-into-view reads `listRef.current.children[highlightIdx]`,
              so an extra child inside the list would shift every option's index
              by one and scroll to the wrong row. Visually it is still the first
              thing under the search box. */}
          {noOptionsHint && nothingSelectable && (
            <div
              className="px-3 py-2 text-[11px] font-mono leading-relaxed"
              style={{
                color: 'var(--primary-dim, var(--muted-foreground))',
                borderBottom: '1px solid var(--border)',
                backgroundColor: 'rgba(250,204,21,0.06)',
              }}
            >
              {noOptionsHint}
            </div>
          )}

          {/* Options list */}
          <div ref={listRef} className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && !canCustom && !(noOptionsHint && nothingSelectable) ? (
              <div className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {t('searchableSelect.noMatches')}
              </div>
            ) : (
              filtered.map((opt, idx) => (
                <div
                  key={opt.value}
                  onClick={() => !opt.disabled && handleSelect(opt.value)}
                  onMouseEnter={() => !opt.disabled && setHighlightIdx(idx)}
                  aria-disabled={opt.disabled || undefined}
                  className="px-3 py-1.5 text-sm transition-colors"
                  style={{
                    backgroundColor: opt.disabled
                      ? 'transparent'
                      : idx === highlightIdx ? 'var(--accent)' : opt.value === value ? 'rgba(var(--lift-rgb), 0.04)' : 'transparent',
                    color: opt.value === value ? 'var(--accent-foreground, var(--foreground))' : 'var(--foreground)',
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    // Dimmed rather than hidden; `not-allowed` says "this row is
                    // a real thing that cannot be picked", which a plain
                    // `default` cursor would not.
                    opacity: opt.disabled ? 0.45 : 1,
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {opt.label}
                  {opt.detail && (
                    <span className="block text-[10px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                      {opt.detail}
                    </span>
                  )}
                </div>
              ))
            )}
            {canCustom && (
              <div
                onClick={() => handleSelect(q)}
                onMouseEnter={() => setHighlightIdx(filtered.length)}
                className="px-3 py-1.5 text-sm cursor-pointer transition-colors flex items-center gap-1.5"
                style={{
                  backgroundColor:
                    highlightIdx === filtered.length ? 'var(--accent)' : 'transparent',
                  color: 'var(--muted-foreground)',
                  borderTop: '1px solid var(--border)',
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  fontSize: 12,
                }}
              >
                <span>{t('searchableSelect.useCustom')}</span>
                <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{q}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
