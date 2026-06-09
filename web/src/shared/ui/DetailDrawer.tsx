import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

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

  // Portal to document.body so the drawer escapes whatever page container
  // wraps the caller. Background story (2026-06-08 bugfix): the caller
  // pages (seats, bindings, provider-accounts, virtual-keys) wrap their
  // content in `.p-6.space-y-5`. Tailwind's `space-y-5` injects
  // `margin-top: 20px` on every non-first child — including the
  // `position: fixed` backdrop + drawer this component renders as a
  // fragment. The unintended `margin-top: 20px` pushed both the backdrop
  // and the drawer 20px below the viewport top, leaving a horizontal
  // strip uncovered above the overlay across every page that opens this
  // component. Rendering into document.body sidesteps the issue once and
  // for all (and survives any future caller-side spacing utilities).
  // SSR-safe: skip portal during prerender, where document is undefined.
  if (typeof document === 'undefined') return null;

  return createPortal(
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
    </>,
    document.body
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
