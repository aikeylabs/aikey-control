import { useState, useRef, useEffect, useMemo } from 'react';

export interface SelectOption {
  value: string;
  label: string;
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
  placeholder = 'Select...',
  className = '',
  style,
  disabled,
  allowCustom = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, search]);

  const selectedLabel = options.find(o => o.value === value)?.label;

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
    setHighlightIdx(0);
  }, [search]);

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
      setHighlightIdx(i => Math.min(i + 1, Math.max(0, maxIdx)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx < filtered.length && filtered[highlightIdx]) {
        onChange(filtered[highlightIdx].value);
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
          borderColor: 'var(--border)',
          color: selectedLabel ? 'var(--foreground)' : 'var(--muted-foreground)',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        }}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <svg className="w-3.5 h-3.5 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          {/* Search input */}
          <div className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              type="text"
              className="w-full px-2.5 py-1.5 text-xs rounded border outline-none"
              placeholder="Type to search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
            />
          </div>

          {/* Options list */}
          <div ref={listRef} className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && !canCustom ? (
              <div className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                No matches
              </div>
            ) : (
              filtered.map((opt, idx) => (
                <div
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className="px-3 py-1.5 text-sm cursor-pointer transition-colors"
                  style={{
                    backgroundColor: idx === highlightIdx ? 'var(--accent)' : opt.value === value ? 'rgba(255,255,255,0.04)' : 'transparent',
                    color: opt.value === value ? 'var(--accent-foreground, var(--foreground))' : 'var(--foreground)',
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  }}
                >
                  {opt.label}
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
