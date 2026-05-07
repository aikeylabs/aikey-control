import React, { useEffect } from 'react';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DetailDrawer({ open, onClose, title, subtitle, children }: DetailDrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          backgroundColor: 'rgba(0,0,0,0.5)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-200"
        style={{
          width: 480,
          backgroundColor: 'var(--card)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-6 py-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h2 className="text-sm font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex-shrink-0 p-1 rounded transition-colors"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </>
  );
}

// ── Field helper ───────────────────────────────────────────────────────────

export function DrawerField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <p className="text-[10px] font-mono tracking-wider mb-1" style={{ color: 'var(--muted-foreground)' }}>
        {label}
      </p>
      <div className="text-sm font-mono" style={{ color: 'var(--foreground)' }}>
        {value ?? <span style={{ color: 'var(--muted-foreground)' }}>—</span>}
      </div>
    </div>
  );
}
