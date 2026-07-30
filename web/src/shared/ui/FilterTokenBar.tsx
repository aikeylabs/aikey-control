/**
 * FilterTokenBar — config-driven token filter input (20260729 usage-audit
 * flexible filters, design: roadmap20260320/技术实现/update/20260729-用量审计页自由筛选.md).
 *
 * ONE input hosts every filter dimension (user decision: no row of dropdowns):
 *   click → dimension-type list → value list → token chip; repeat to AND-combine.
 * Typing without picking a type suggests matching VALUES across all dimensions
 * (value-first search: "anthro" → 「Provider: anthropic」), so the common case
 * is one keystroke shorter.
 *
 * The component is a pure V-layer control: the caller owns the dimension
 * registry (labels, option sources) and the token state (usually mirrored to
 * URL params for deep-linking). One dimension holds at most one token (MVP
 * single-select; re-picking overwrites). Chip visuals anchor to the
 * established dismissible filter chip (bindings/virtual-keys pages).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface FilterTokenOption {
  value: string;
  label: string;
}

export interface FilterTokenDimension {
  /** Stable id; call sites typically reuse it as the URL param name. */
  key: string;
  /** Display name, already translated by the caller. */
  label: string;
  /** Enumerable values. May be empty for a pure free-text dimension. */
  options: FilterTokenOption[];
  /** Allow an arbitrary typed value (Enter applies it), e.g. model names. */
  freeText?: boolean;
}

export interface FilterToken {
  key: string;
  value: string;
}

interface Suggestion {
  /** 'dim' rows switch the input into that dimension; 'val' rows apply a token. */
  kind: 'dim' | 'val';
  dimKey: string;
  label: string;
  value?: string; // for 'val'
}

const VALUE_HITS_PER_DIMENSION = 5;

interface FilterTokenBarProps {
  dimensions: FilterTokenDimension[];
  tokens: FilterToken[];
  onChange: (tokens: FilterToken[]) => void;
  placeholder?: string;
}

export function FilterTokenBar({ dimensions, tokens, onChange, placeholder }: FilterTokenBarProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dimByKey = useMemo(() => new Map(dimensions.map((d) => [d.key, d])), [dimensions]);
  const activeDim = activeKey ? dimByKey.get(activeKey) : undefined;

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = text.trim().toLowerCase();
    const matches = (s: string) => s.toLowerCase().includes(q);
    if (activeDim) {
      const rows: Suggestion[] = activeDim.options
        .filter((o) => !q || matches(o.label) || matches(o.value))
        .map((o) => ({ kind: 'val', dimKey: activeDim.key, label: o.label, value: o.value }));
      const exact = activeDim.options.some((o) => o.value === text.trim());
      if (activeDim.freeText && text.trim() && !exact) {
        rows.push({ kind: 'val', dimKey: activeDim.key, label: t('filterTokenBar.useValue', { value: text.trim() }), value: text.trim() });
      }
      return rows;
    }
    const dimRows: Suggestion[] = dimensions
      .filter((d) => !q || matches(d.label))
      .map((d) => ({ kind: 'dim', dimKey: d.key, label: d.label }));
    if (!q) return dimRows;
    // Value-first search: surface matching values across every dimension so a
    // recognizable value ("anthro", an email) needs no type-picking step.
    const valRows: Suggestion[] = dimensions.flatMap((d) =>
      d.options
        .filter((o) => matches(o.label) || matches(o.value))
        .slice(0, VALUE_HITS_PER_DIMENSION)
        .map((o) => ({ kind: 'val' as const, dimKey: d.key, label: `${d.label}: ${o.label}`, value: o.value })),
    );
    return [...dimRows, ...valRows];
  }, [dimensions, activeDim, text, t]);

  useEffect(() => setHighlight(0), [text, activeKey, open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveKey(null);
        setText('');
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function apply(s: Suggestion) {
    if (s.kind === 'dim') {
      setActiveKey(s.dimKey);
      setText('');
      inputRef.current?.focus();
      return;
    }
    // Same-dimension re-pick overwrites (MVP single-select per dimension).
    onChange([...tokens.filter((tk) => tk.key !== s.dimKey), { key: s.dimKey, value: s.value ?? '' }]);
    setActiveKey(null);
    setText('');
    inputRef.current?.focus();
  }

  function removeToken(key: string) {
    onChange(tokens.filter((tk) => tk.key !== key));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestions[highlight];
      if (open && s) apply(s);
    } else if (e.key === 'Escape') {
      if (activeKey) {
        setActiveKey(null);
        setText('');
      } else {
        setOpen(false);
      }
    } else if (e.key === 'Backspace' && text === '') {
      if (activeKey) {
        setActiveKey(null);
      } else if (tokens.length > 0) {
        removeToken(tokens[tokens.length - 1].key);
      }
    }
  }

  function tokenLabel(tk: FilterToken): string {
    const dim = dimByKey.get(tk.key);
    if (!dim) return `${tk.key}: ${tk.value}`;
    const opt = dim.options.find((o) => o.value === tk.value);
    return `${dim.label}: ${opt?.label ?? tk.value}`;
  }

  return (
    <div ref={rootRef} className="relative flex-1 min-w-64">
      <div
        className="flex items-center flex-wrap gap-1.5 px-2 py-1.5 rounded border cursor-text"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {tokens.map((tk) => (
          <span
            key={tk.key}
            className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded border whitespace-nowrap"
            style={{ borderColor: 'rgba(96,165,250,0.3)', color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.08)' }}
          >
            {tokenLabel(tk)}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeToken(tk.key);
              }}
              aria-label={t('filterTokenBar.remove')}
              className="leading-none"
              style={{ color: '#60a5fa' }}
            >
              ×
            </button>
          </span>
        ))}
        {activeDim && (
          <span className="text-xs font-mono px-1" style={{ color: 'var(--muted-foreground)' }}>
            {activeDim.label}:
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={tokens.length === 0 && !activeDim ? (placeholder ?? t('filterTokenBar.placeholder')) : ''}
          className="flex-1 min-w-28 bg-transparent outline-none text-xs font-mono py-0.5"
          style={{ color: 'var(--foreground)' }}
        />
      </div>
      {open && (
        <div
          className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded border shadow-lg"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
        >
          {suggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('filterTokenBar.noMatches')}
            </div>
          ) : (
            suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.dimKey}-${s.value ?? ''}`}
                className="block w-full text-left px-3 py-2 text-xs font-mono"
                style={{
                  color: s.kind === 'dim' ? 'var(--foreground)' : 'var(--muted-foreground)',
                  backgroundColor: i === highlight ? 'rgba(96,165,250,0.12)' : 'transparent',
                }}
                onMouseEnter={() => setHighlight(i)}
                // mousedown fires before the input's blur — onClick would race
                // the outside-click close handler on some browsers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  apply(s);
                }}
              >
                {s.kind === 'dim' ? `${s.label} ▸` : s.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
