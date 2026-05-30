import React from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from './PageHeader';

interface Column {
  key: string;
  label: string;
}

interface PlaceholderPageProps {
  title: string;
  description?: string;
  columns?: Column[];
  todoNote?: string;
  actions?: React.ReactNode;
}

export function PlaceholderPage({
  title,
  description,
  columns,
  todoNote,
  actions,
}: PlaceholderPageProps) {
  const { t } = useTranslation();
  const defaultColumns: Column[] = [
    { key: 'id', label: t('placeholderPage.columnId') },
    { key: 'name', label: t('placeholderPage.columnName') },
    { key: 'status', label: t('placeholderPage.columnStatus') },
    { key: 'created_at', label: t('placeholderPage.columnCreatedAt') },
  ];
  const effectiveColumns = columns ?? defaultColumns;
  return (
    <div className="p-6 space-y-6">
      <PageHeader title={title} description={description} actions={actions} />

      {/* Phase notice */}
      <div
        className="border rounded p-4 flex items-start gap-3"
        style={{
          backgroundColor: 'rgba(250, 204, 21, 0.05)',
          borderColor: 'rgba(250, 204, 21, 0.2)',
        }}
      >
        <svg
          className="w-4 h-4 mt-0.5 flex-shrink-0"
          style={{ color: 'var(--primary)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div>
          <p className="text-xs font-mono font-bold" style={{ color: 'var(--primary)' }}>
            {t('placeholderPage.phaseNotice')}
          </p>
          {todoNote && (
            <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
              {todoNote}
            </p>
          )}
        </div>
      </div>

      {/* Empty table shell */}
      <div
        className="rounded border overflow-hidden"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-4 border-b flex items-center justify-between"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'rgba(0,0,0,0.2)',
          }}
        >
          <h2
            className="text-xs font-mono font-bold tracking-wider"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {title}
          </h2>
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded border"
            style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}
          >
            {t('placeholderPage.zeroRecords')}
          </span>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr>
                {effectiveColumns.map((col) => (
                  <th key={col.key} className="px-5 py-3">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={effectiveColumns.length}
                  className="px-5 py-12 text-center"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg
                      className="w-8 h-8 opacity-30"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                      />
                    </svg>
                    <span className="text-xs font-mono">{t('placeholderPage.noData')}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
