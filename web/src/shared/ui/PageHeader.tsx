import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1
          className="text-lg font-bold font-mono tracking-wide"
          style={{ color: 'var(--foreground)' }}
        >
          {title}
        </h1>
        {description && (
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
