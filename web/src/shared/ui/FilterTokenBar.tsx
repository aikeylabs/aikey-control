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
  /** Keyword fallback dimension (2026-07-29 rule 2): hidden from the left
   *  pane and from value-first search; when typed text matches NOTHING, the
   *  bar offers "fuzzy search "<text>"" which applies this dimension as a
   *  token. The PAGE implements the actual fuzzy row matching — the bar only
   *  carries the keyword. Stacks (AND) with the other dimension tokens. */
  keyword?: boolean;
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
  // Keyword dim is a fallback mechanism, not a browsable dimension — it stays
  // out of the left pane and out of value-first enumeration.
  const listDims = useMemo(() => dimensions.filter((d) => !d.keyword), [dimensions]);
  const keywordDim = useMemo(() => dimensions.find((d) => d.keyword), [dimensions]);
  const previewKey = activeKey ?? listDims[0]?.key ?? null;
  const previewDim = previewKey ? dimByKey.get(previewKey) : undefined;

  // paneText: the popover's OWN candidate-filter input (right-pane header —
  // 2026-07-29 refined ×4, user decision: the MAIN input keeps global
  // cross-dimension search; in-place candidate filtering lives in a dedicated
  // input inside the popover instead). Reset on dimension switch / close.
  const [paneText, setPaneText] = useState('');
  const paneInputRef = useRef<HTMLInputElement>(null);

  // Right-pane rows. Browse mode (no main-input text, or an explicitly picked
  // dimension): the preview dimension's values, narrowed by paneText (and by
  // the main text too when explicit). Search mode (main text without an
  // explicit pick): value-first hits across every dimension + dimension-name
  // hits + the fuzzy option pinned third.
  const suggestions = useMemo<Suggestion[]>(() => {
    const q = text.trim().toLowerCase();
    const matches = (s: string, qq: string) => s.toLowerCase().includes(qq);
    if (explicit || !q) {
      if (!previewDim) return [];
      // The dimension's CURRENT pick always stays listed (user rule
      // 2026-07-29 "他自身也需要保留"): server facets exclude their own
      // filter so alternatives+self normally all appear, but a pick can
      // vanish when OTHER active filters exclude it — pin it to the top.
      const current = tokens.find((tk) => tk.key === previewDim.key);
      const opts = current && !previewDim.options.some((o) => o.value === current.value)
        ? [{ value: current.value, label: current.value }, ...previewDim.options]
        : previewDim.options;
      const pq = paneText.trim().toLowerCase();
      const rows: Suggestion[] = opts
        .filter((o) => (!pq || matches(o.label, pq) || matches(o.value, pq)) && (!q || matches(o.label, q) || matches(o.value, q)))
        .map((o) => ({ kind: 'val', dimKey: previewDim.key, label: o.label, value: o.value }));
      const free = paneText.trim() || (explicit ? text.trim() : '');
      if (previewDim.freeText && free && !opts.some((o) => o.value === free)) {
        rows.push({ kind: 'val', dimKey: previewDim.key, label: t('filterTokenBar.useValue', { value: free }), value: free });
      }
      return rows;
    }
    const dimRows: Suggestion[] = listDims
      .filter((d) => matches(d.label, q))
      .map((d) => ({ kind: 'dim', dimKey: d.key, label: `${d.label} ▸` }));
    const valRows: Suggestion[] = listDims.flatMap((d) =>
      d.options
        .filter((o) => matches(o.label, q) || matches(o.value, q))
        .slice(0, VALUE_HITS_PER_DIMENSION)
        .map((o) => ({ kind: 'val' as const, dimKey: d.key, label: `${d.label}: ${o.label}`, value: o.value })),
    );
    const rows = [...dimRows, ...valRows];
    // Rule 2 (2026-07-29): the fuzzy-keyword option is ALWAYS offered while
    // typing in the MAIN input — pinned to the THIRD candidate slot (user
    // decision), or earlier/only when fewer rows matched.
    if (keywordDim && text.trim()) {
      const fuzzyRow: Suggestion = { kind: 'val', dimKey: keywordDim.key, label: t('filterTokenBar.fuzzyApply', { value: text.trim() }), value: text.trim() };
      rows.splice(Math.min(2, rows.length), 0, fuzzyRow);
    }
    return rows;
  }, [listDims, keywordDim, previewDim, explicit, text, paneText, tokens, t]);

  useEffect(() => setHighlight(0), [text, paneText, activeKey, open]);
  // Pane filter is scoped to one dimension — switching preview or closing
  // starts it clean.
  useEffect(() => setPaneText(''), [previewKey, open]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      // composedPath (not contains): a click inside the popover can hit a node
      // React swaps out during the same interaction (dimension switch
      // re-renders the pane) — `contains` on the post-swap DOM then reads it
      // as OUTSIDE and closes the popover (user report 2026-07-29: clicking a
      // second dimension auto-hid the panel). The dispatch-time event path is
      // immune to that. Closing is ONLY: outside click / Esc / close button.
      const path = e.composedPath();
      if (rootRef.current && !path.includes(rootRef.current)) {
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
    // Focus the pane's candidate-filter input (it renders on the next frame)
    // so "click a dimension → type to narrow its values" needs no extra click.
    requestAnimationFrame(() => paneInputRef.current?.focus());
  }

  function apply(s: Suggestion) {
    if (s.kind === 'dim') {
      selectDimension(s.dimKey);
      return;
    }
    // Same-dimension re-pick overwrites (MVP single-select per dimension).
    onChange([...tokens.filter((tk) => tk.key !== s.dimKey), { key: s.dimKey, value: s.value ?? '' }]);
    // Stay on the dimension just used (user report 2026-07-29: resetting to
    // null made the panel snap back to the FIRST dimension after every value
    // pick). The keyword dim is the exception — it has no left-pane row, so
    // previewing it would render an empty pane; fall back to browse there.
    setActiveKey(s.dimKey === keywordDim?.key ? null : s.dimKey);
    setExplicit(false);
    setText('');
    setPaneText('');
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

  // Pane-input keyboard handler: navigation/confirm/close only. Deliberately
  // NO Backspace branch — the main handler's "Backspace on empty removes the
  // last chip / exits the dimension" is a main-input affordance; from inside
  // the pane filter it read as "deleting here wipes the main box" (user
  // report 2026-07-29). Backspace here just edits the pane text.
  function onPaneKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestions[highlight];
      if (s) apply(s);
    } else if (e.key === 'Escape') {
      if (explicit) {
        setExplicit(false);
        setActiveKey(null);
      } else {
        setOpen(false);
      }
      inputRef.current?.focus();
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
        // min-h-[38px]: the canonical master filter-row height (SearchableSelect
        // intrinsic / FilterBar search input — see FilterBar.tsx 2026-06-11
        // rationale). Without it this bar sat at ~34px and read misaligned next
        // to sibling filter controls (user report 2026-07-29 ×2).
        className="flex items-center flex-wrap gap-1.5 px-2 py-1.5 min-h-[38px] rounded border cursor-text"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {/* Magnifier glyph — same icon/size/color as FilterBar's search input
            (2026-07-29 user decision: the filter family carries the icon).
            A flex child, not absolute-positioned, so chips flow after it. */}
        <svg
          className="w-3.5 h-3.5 shrink-0 ml-1 pointer-events-none"
          style={{ color: 'var(--muted-foreground)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        {tokens.map((tk) => (
          <span
            key={tk.key}
            className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded border whitespace-nowrap"
            style={{ borderColor: 'rgba(96,165,250,0.3)', color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.08)' }}
          >
            {/* Rule 1 (2026-07-29): clicking the chip body jumps straight to
                that dimension's value list so the pick can be adjusted in
                place (× still removes). Picking a new value overwrites. */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                selectDimension(tk.key);
                setOpen(true);
              }}
              className="hover:underline cursor-pointer"
              title={t('filterTokenBar.editToken')}
              style={{ color: '#60a5fa', background: 'transparent', border: 'none', padding: 0, font: 'inherit' }}
            >
              {tokenLabel(tk)}
            </button>
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
                so main-input typing isn't disturbed); click commits the pick.
                Hidden in cross-dimension search mode — the grouped results
                carry the dimension names themselves. */}
            {!searchMode && (
              <div className="w-[180px] shrink-0 overflow-y-auto border-r py-1" style={{ borderColor: 'var(--border)' }}>
                {listDims.map((d) => {
                  const active = d.key === previewKey;
                  return (
                    <button
                      key={d.key}
                      className="relative flex items-center justify-between w-full text-left px-3 h-[30px] text-[11px] font-mono"
                      style={{
                        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
                        backgroundColor: active ? 'rgba(250,204,21,0.08)' : 'transparent',
                      }}
                      // Hover previews only in pure browse mode: once a
                      // dimension is explicitly picked, moving the mouse over
                      // the pane must not silently re-scope it — switching
                      // then requires a click.
                      onMouseEnter={() => {
                        if (!text && !explicit) setActiveKey(d.key);
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
            {/* Right pane: values of the preview dimension (with the pane's
                own candidate-filter input in the header — 2026-07-29 user
                decision: in-place filtering lives HERE, the main input keeps
                global cross-dimension search), or cross-dimension hits when
                typing in the main input without an explicit pick. */}
            <div className="flex-1 min-w-0 flex flex-col">
              {!searchMode && previewDim && (
                <div className="px-3 py-1.5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                  <input
                    ref={paneInputRef}
                    type="text"
                    value={paneText}
                    onChange={(e) => setPaneText(e.target.value)}
                    onKeyDown={onPaneKeyDown}
                    placeholder={t('filterTokenBar.valueSearchHint', { dim: previewDim.label })}
                    className="filter-token-input w-full bg-transparent outline-none text-[11px] font-mono py-0.5"
                    style={{ color: 'var(--foreground)' }}
                  />
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
          {/* Footer: keyboard hints left, explicit close button right
              (2026-07-29 user request — closing is deliberate, not a side
              effect of clicking around inside the panel). */}
          <div className="px-3 h-8 flex items-center justify-between border-t shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(0,0,0,0.1)' }}>
            <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
              {t('filterTokenBar.hints')}
            </span>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                setActiveKey(null);
                setExplicit(false);
                setText('');
              }}
              className="text-[10px] font-mono px-2 py-0.5 rounded border"
              style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
            >
              {t('filterTokenBar.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
