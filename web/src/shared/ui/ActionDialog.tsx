import React, { useEffect } from 'react';

interface ActionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  title: string;
  description?: string;
  /** Label for the destructive confirm button */
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
  /** If provided, user must type this value to confirm */
  requireInput?: string;
  inputValue?: string;
  onInputChange?: (v: string) => void;
  inputPlaceholder?: string;
}

export function ActionDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'danger',
  requireInput,
  inputValue = '',
  onInputChange,
  inputPlaceholder,
}: ActionDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const confirmDisabled = loading || (requireInput !== undefined && inputValue !== requireInput);
  const confirmColor = variant === 'danger' ? '#ef4444' : '#f59e0b';
  const confirmBg = variant === 'danger' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)';
  const confirmBorder = variant === 'danger' ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)';

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border p-6"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        {/* Icon + Title */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="flex-shrink-0 w-8 h-8 rounded flex items-center justify-center"
            style={{ backgroundColor: confirmBg, border: `1px solid ${confirmBorder}` }}
          >
            <svg className="w-4 h-4" style={{ color: confirmColor }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
              {title}
            </h3>
            {description && (
              <p className="text-xs font-mono mt-1.5 leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Optional confirmation input */}
        {requireInput !== undefined && (
          <div className="mb-4">
            <p className="text-[10px] font-mono mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Type <span className="font-bold" style={{ color: confirmColor }}>{requireInput}</span> to confirm
            </p>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm"
              placeholder={inputPlaceholder ?? requireInput}
              value={inputValue}
              onChange={(e) => onInputChange?.(e.target.value)}
            />
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-end mt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: confirmBg, borderColor: confirmBorder, color: confirmColor }}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
