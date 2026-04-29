import React from 'react';
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

  /** Right-side actions slot */
  actions?: React.ReactNode;
}

export function FilterBar({
  statusOptions,
  statusValue,
  onStatusChange,
  statusPlaceholder = 'All',
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  actions,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      {onSearchChange !== undefined && (
        <div className="relative">
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
            className="pl-9 pr-3 py-1.5 text-xs w-52"
            placeholder={searchPlaceholder}
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}

      {/* Status select */}
      {statusOptions && onStatusChange && (
        <SearchableSelect
          options={[{ value: '', label: statusPlaceholder }, ...statusOptions]}
          value={statusValue ?? ''}
          onChange={onStatusChange}
          placeholder={statusPlaceholder}
          style={{ minWidth: 160 }}
        />
      )}

      {/* Right actions */}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
