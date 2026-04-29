import { useEffect, useMemo, useRef, useState } from 'react';

import type { SelectOption } from './SearchableSelect';

interface SearchableMultiSelectProps {
  options: SelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  /**
   * When true (default), a typed search that doesn't match any option
   * or already-picked value gets a "+ Use custom: <typed>" row at the
   * bottom of the dropdown. Selecting it appends the typed value to
   * `values` verbatim (caller normalizes if needed).
   */
  allowCustom?: boolean;
}

/**
 * SearchableMultiSelect — a token-bar trigger with a search + list
 * popover. Shares the visual language of {@link SearchableSelect} but
 * accumulates selections as removable chips instead of replacing the
 * single value.
 *
 * Design tokens used (all defined at `:root`, so drop-in works across
 * user + master pages):
 *   var(--card) / --border / --foreground / --muted-foreground /
 *   --primary / --accent
 *
 * Keyboard:
 *   - ArrowDown / ArrowUp navigate the dropdown
 *   - Enter appends the highlighted option (or the custom typed value)
 *   - Backspace on an empty search pops the last chip
 *   - Escape closes
 */
export function SearchableMultiSelect({
  options,
  values,
  onChange,
  placeholder = 'Add…',
  className = '',
  style,
  disabled,
  allowCustom = true,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filtered list excludes already-picked options so the dropdown only
  // shows things the user can newly add. The custom-add row is gated on
  // `allowCustom` + a non-empty, non-duplicate query.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return options.filter(
      (o) =>
        !values.includes(o.value) &&
        (!q ||
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q)),
    );
  }, [options, search, values]);

  const q = search.trim();
  const canCustom =
    allowCustom &&
    q.length > 0 &&
    !values.includes(q) &&
    !options.some(
      (o) =>
        o.value.toLowerCase() === q.toLowerCase() ||
        o.label.toLowerCase() === q.toLowerCase(),
    );

  useEffect(() => setHighlightIdx(0), [search]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Scroll highlighted item into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  function add(v: string) {
    const trimmed = v.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setSearch('');
  }
  function remove(v: string) {
    onChange(values.filter((x) => x !== v));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const maxIdx = filtered.length + (canCustom ? 1 : 0) - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, Math.max(0, maxIdx)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx < filtered.length) add(filtered[highlightIdx].value);
      else if (canCustom) add(q);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && search === '' && values.length > 0) {
      remove(values[values.length - 1]);
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`} style={style}>
      {/* Trigger — a chip bar. Clicking anywhere opens the popover; the
          "+" label is a hint only (the whole bar is the hit target). */}
      <div
        onClick={() => !disabled && setOpen(true)}
        className="w-full px-2 py-1.5 text-sm rounded border flex items-center flex-wrap gap-1.5 min-h-[34px]"
        style={{
          backgroundColor: 'var(--card)',
          borderColor: open ? 'var(--primary)' : 'var(--border)',
          boxShadow: open ? '0 0 0 2px rgba(250,204,21,0.15)' : undefined,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'text',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        }}
      >
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded"
            style={{
              padding: '2px 4px 2px 8px',
              background: 'rgba(250,204,21,0.1)',
              color: 'var(--primary)',
              border: '1px solid rgba(250,204,21,0.35)',
              fontSize: 11,
              letterSpacing: '0.04em',
            }}
          >
            <span>{v}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(v);
              }}
              className="inline-flex items-center justify-center rounded"
              style={{
                width: 16,
                height: 16,
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                opacity: 0.6,
                cursor: 'pointer',
              }}
              aria-label={`Remove ${v}`}
            >
              <svg
                className="w-2.5 h-2.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2.25}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <span
          className="inline-flex items-center gap-1"
          style={{
            padding: '2px 6px',
            color: 'var(--muted-foreground)',
            fontSize: 10.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {values.length === 0 ? placeholder : 'Add'}
        </span>
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute z-50 w-full mt-1 rounded border"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <div className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              type="text"
              className="w-full px-2.5 py-1.5 text-xs rounded border outline-none"
              placeholder="Type to search or add custom..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
            />
          </div>

          <div ref={listRef} className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && !canCustom ? (
              <div
                className="px-3 py-2 text-xs font-mono"
                style={{ color: 'var(--muted-foreground)' }}
              >
                {values.length === options.length
                  ? 'All presets picked — type a custom name to add.'
                  : 'No matches'}
              </div>
            ) : (
              filtered.map((opt, idx) => (
                <div
                  key={opt.value}
                  onClick={() => add(opt.value)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className="px-3 py-1.5 text-sm cursor-pointer transition-colors"
                  style={{
                    backgroundColor:
                      idx === highlightIdx ? 'var(--accent)' : 'transparent',
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  }}
                >
                  {opt.label}
                </div>
              ))
            )}
            {canCustom && (
              <div
                onClick={() => add(q)}
                onMouseEnter={() => setHighlightIdx(filtered.length)}
                className="px-3 py-1.5 text-sm cursor-pointer transition-colors flex items-center gap-1.5"
                style={{
                  backgroundColor:
                    highlightIdx === filtered.length ? 'var(--accent)' : 'transparent',
                  color: 'var(--muted-foreground)',
                  borderTop: filtered.length > 0 ? '1px solid var(--border)' : undefined,
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  fontSize: 12,
                }}
              >
                <span>+ Use custom:</span>
                <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{q}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
