import React from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableSelect } from './SearchableSelect';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  /** Status/type filter */
  statusOptions?: FilterOption[];
  statusValue?: string;
  onStatusChange?: (v: string) => void;
  statusPlaceholder?: string;

  /** Free-text search */
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;

  /** Extra filter controls, rendered LEFT-aligned right after the status
      select (e.g. a tag filter) — actions stays the right-side slot. */
  extraFilters?: React.ReactNode;

  /** Right-side actions slot */
  actions?: React.ReactNode;
}

export function FilterBar({
  statusOptions,
  statusValue,
  onStatusChange,
  statusPlaceholder,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  extraFilters,
  actions,
}: FilterBarProps) {
  const { t } = useTranslation();
  const resolvedStatusPlaceholder = statusPlaceholder ?? t('filterBar.all');
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('filterBar.searchPlaceholder');
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      {onSearchChange !== undefined && (
        <div className="relative">
          {/* Magnifier icon: part of the filter-control family look — the
              FilterTokenBar carries the same glyph (2026-07-29 user decision:
              add it there, not remove it here). */}
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: 'var(--muted-foreground)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            // 2026-06-11: pl-9 pr-3 py-2 text-sm (38px) — the canonical
            // master-nav filter-row height (SearchableSelect's intrinsic);
            // every input in a filter row should match.
            // `filter-search-input` (2026-07-29): pins background to
            // var(--card) so the box matches its row siblings (SearchableSelect
            // trigger, FilterTokenBar) — without it the global
            // `input { background: var(--muted) !important }` paints this one
            // control a tier lighter than every other filter-row control.
            className="filter-search-input pl-9 pr-3 py-2 text-sm w-52"
            placeholder={resolvedSearchPlaceholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}

      {/* Status select */}
      {statusOptions && onStatusChange && (
        <SearchableSelect
          options={[{ value: '', label: resolvedStatusPlaceholder }, ...statusOptions]}
          value={statusValue ?? ''}
          onChange={onStatusChange}
          placeholder={resolvedStatusPlaceholder}
          style={{ minWidth: 160 }}
        />
      )}

      {/* Extra left-aligned filters (after status) */}
      {extraFilters}

      {/* Right actions */}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
