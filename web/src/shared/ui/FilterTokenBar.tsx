/**
 * FilterTokenBar — config-driven token filter input (20260729 usage-audit
 * flexible filters, design: roadmap20260320/技术实现/update/20260729-用量审计页自由筛选.md).
 *
 * ONE input hosts every filter dimension (user decision: no row of dropdowns).
 * The dropdown is a TWO-PANE command palette (superdesign 方向2, user-picked
 * 2026-07-29 over the earlier full-width single list which read as sparse and
 * messy): left pane lists dimensions, right pane previews the hovered/selected
 * dimension's values — one glance instead of a two-step list swap. Typing
 * without picking a dimension still value-first searches across ALL dimensions
 * ("anthro" → 「供应商: anthropic」), so the common case is one keystroke
 * shorter. Chips accumulate inline in the input; one token per dimension
 * (re-pick overwrites); dimensions AND-combine.
 *
 * The component is a pure V-layer control: the caller owns the dimension
 * registry (labels, option sources) and the token state (usually mirrored to
 * URL params for deep-linking). Visual spec anchors: card bg + border, 30px
 * mono rows, amber left rail for the active dimension, keyboard-hint footer —
 * all values from the Industrial Vault token set (no invented styles).
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
  /** 'dim' rows switch the palette onto that dimension; 'val' rows apply a token. */
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
  // activeKey = the dimension the right pane previews. `explicit` marks a
  // deliberate pick (click / Enter on a dim row): typed text then filters
  // WITHIN that dimension instead of value-first searching across all.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [explicit, setExplicit] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dimByKey = useMemo(() => new Map(dimensions.map((d) => [d.key, d])), [dimensions]);
  const previewKey = activeKey ?? dimensions[0]?.key ?? null;
  const previewDim = previewKey ? dimByKey.get(previewKey) : undefined;

  // Right-pane rows. Browse mode (no text, or an explicitly picked dimension):
  // the preview dimension's values. Search mode (text without an explicit
  // pick): value-first hits across every dimension, plus dimension-name hits.
  const suggestions = useMemo<Suggestion[]>(() => {
    const q = text.trim().toLowerCase();
    const matches = (s: string) => s.toLowerCase().includes(q);
    if (explicit || !q) {
      if (!previewDim) return [];
      const rows: Suggestion[] = previewDim.options
        .filter((o) => !q || matches(o.label) || matches(o.value))
        .map((o) => ({ kind: 'val', dimKey: previewDim.key, label: o.label, value: o.value }));
      const exact = previewDim.options.some((o) => o.value === text.trim());
      if (previewDim.freeText && text.trim() && !exact) {
        rows.push({ kind: 'val', dimKey: previewDim.key, label: t('filterTokenBar.useValue', { value: text.trim() }), value: text.trim() });
      }
      return rows;
    }
    const dimRows: Suggestion[] = dimensions
      .filter((d) => matches(d.label))
      .map((d) => ({ kind: 'dim', dimKey: d.key, label: `${d.label} ▸` }));
    const valRows: Suggestion[] = dimensions.flatMap((d) =>
      d.options
        .filter((o) => matches(o.label) || matches(o.value))
        .slice(0, VALUE_HITS_PER_DIMENSION)
        .map((o) => ({ kind: 'val' as const, dimKey: d.key, label: `${d.label}: ${o.label}`, value: o.value })),
    );
    return [...dimRows, ...valRows];
  }, [dimensions, previewDim, explicit, text, t]);

  useEffect(() => setHighlight(0), [text, activeKey, open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveKey(null);
        setExplicit(false);
        setText('');
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function selectDimension(key: string) {
    setActiveKey(key);
    setExplicit(true);
    setText('');
    inputRef.current?.focus();
  }

  function apply(s: Suggestion) {
    if (s.kind === 'dim') {
      selectDimension(s.dimKey);
      return;
    }
    // Same-dimension re-pick overwrites (MVP single-select per dimension).
    onChange([...tokens.filter((tk) => tk.key !== s.dimKey), { key: s.dimKey, value: s.value ?? '' }]);
    setActiveKey(null);
    setExplicit(false);
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
      if (explicit) {
        setExplicit(false);
        setActiveKey(null);
        setText('');
      } else {
        setOpen(false);
      }
    } else if (e.key === 'Backspace' && text === '') {
      if (explicit) {
        setExplicit(false);
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

  const explicitDim = explicit && activeKey ? dimByKey.get(activeKey) : undefined;
  const searchMode = !explicit && text.trim() !== '';

  return (
    // Width is the CALLER's decision (wrap in a sized container): a token bar
    // stretched across the whole page reads as oversized (user report
    // 2026-07-29), but the right cap depends on the page's toolbar.
    <div ref={rootRef} className="relative w-full min-w-64">
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
        {explicitDim && (
          <span className="text-xs font-mono px-1" style={{ color: 'var(--muted-foreground)' }}>
            {explicitDim.label}:
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
          placeholder={tokens.length === 0 && !explicitDim ? (placeholder ?? t('filterTokenBar.placeholder')) : ''}
          // `filter-token-input` is load-bearing, not cosmetic: index.css has
          // a global `input { background/border/radius !important }` rule that
          // overrides ANY inline/utility style and rendered this inner input
          // as a bright box-in-a-box (user report 2026-07-29). The class
          // out-specifies it to keep the input truly transparent/borderless.
          className="filter-token-input flex-1 min-w-28 bg-transparent outline-none text-xs font-mono py-0.5"
          style={{ color: 'var(--foreground)' }}
        />
      </div>
      {open && (
        <div
          className="absolute z-20 mt-1 w-[520px] max-w-full rounded border overflow-hidden flex flex-col"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}
        >
          <div className="flex" style={{ maxHeight: 300 }}>
            {/* Left pane: dimension list. Hover previews (browse mode only,
                so typing isn't disturbed); click commits the pick. Hidden in
                cross-dimension search mode — the grouped results carry the
                dimension names themselves. */}
            {!searchMode && (
              <div className="w-[180px] shrink-0 overflow-y-auto border-r py-1" style={{ borderColor: 'var(--border)' }}>
                {dimensions.map((d) => {
                  const active = d.key === previewKey;
                  return (
                    <button
                      key={d.key}
                      className="relative flex items-center justify-between w-full text-left px-3 h-[30px] text-[11px] font-mono"
                      style={{
                        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
                        backgroundColor: active ? 'rgba(250,204,21,0.08)' : 'transparent',
                      }}
                      onMouseEnter={() => {
                        if (!text) setActiveKey(d.key);
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectDimension(d.key);
                      }}
                    >
                      {active && <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ backgroundColor: 'var(--primary)' }} />}
                      <span>{d.label}</span>
                      <span className="text-[10px]">▸</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* Right pane: values of the preview dimension, or cross-dimension
                search hits when typing without an explicit pick. */}
            <div className="flex-1 min-w-0 flex flex-col">
              {!searchMode && previewDim && (
                <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    {/* Two honest states (2026-07-29 user report — the old
                        always-on "type to filter <dim>" promised in-dimension
                        filtering while typing actually cross-searched): typing
                        filters WITHIN the dimension only after an explicit
                        pick; before that it searches across all dimensions. */}
                    {explicit
                      ? t('filterTokenBar.valueSearchHint', { dim: previewDim.label })
                      : t('filterTokenBar.browseHint')}
                  </span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto py-1">
                {suggestions.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                    {t('filterTokenBar.noMatches')}
                  </div>
                ) : (
                  suggestions.map((s, i) => (
                    <button
                      key={`${s.kind}-${s.dimKey}-${s.value ?? ''}`}
                      className="block w-full text-left px-3 h-[30px] text-[11px] font-mono truncate"
                      style={{
                        color: s.kind === 'dim' ? 'var(--foreground)' : 'var(--soft-foreground)',
                        backgroundColor: i === highlight ? 'rgba(250,204,21,0.08)' : 'transparent',
                      }}
                      title={s.label}
                      onMouseEnter={() => setHighlight(i)}
                      // mousedown fires before the input's blur — onClick would
                      // race the outside-click close handler on some browsers.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        apply(s);
                      }}
                    >
                      {s.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
          {/* Keyboard-hint footer (spec: 30px bar, faint black tint) */}
          <div className="px-3 h-8 flex items-center border-t shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(0,0,0,0.1)' }}>
            <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('filterTokenBar.hints')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
