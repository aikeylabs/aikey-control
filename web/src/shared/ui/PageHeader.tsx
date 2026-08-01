import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /**
   * An affordance that sits ON the title — in practice an <InfoHint>, for copy
   * that belongs to the page as a whole rather than to any one control on it.
   *
   * 🔴 Rendered here, next to the title, and NOT folded into `actions`: the
   * right-hand group is where the page's primary button lives, and a hint parked
   * beside it reads as a second action. It also has to stay outside any
   * `overflow-hidden` card, or the bubble is clipped the moment it opens.
   */
  titleHint?: React.ReactNode;
}

export function PageHeader({ title, description, actions, titleHint }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1
          className="text-lg font-bold font-mono tracking-wide flex items-center gap-2"
          style={{ color: 'var(--foreground)' }}
        >
          {title}
          {titleHint}
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
