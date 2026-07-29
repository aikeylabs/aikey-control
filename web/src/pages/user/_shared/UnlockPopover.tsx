/**
 * UnlockPopover — in-place Master Password prompt anchored to the control
 * that needed an unlocked vault (2026-07-29 user request: clicking a locked
 * row's Use button should offer unlock right where the click happened,
 * instead of a tooltip pointing the user at the top banner — one less
 * round-trip, per 交互简洁性优先).
 *
 * Semantics: the password unlocks the WHOLE vault session — the same
 * POST /api/user/vault/unlock cookie + TTL the UnlockBanner and
 * VaultStatusPill establish — NOT a per-action grant. On success the
 * caller's `onUnlocked` fires so the interrupted action can resume
 * automatically (the caller owns the resume; this component only unlocks).
 *
 * Why pages/user/_shared and not shared/components: the vault page is
 * single-copy in user/web. Files in shared/components auto-enroll in the
 * byte-equal dual-edit fence (hook-components.dual-edit.test.ts) and would
 * force a master/web mirror with zero consumers there. Move it only when a
 * master-page consumer appears.
 *
 * Visuals follow VaultStatusPill's expanded unlock form (the established
 * lock-UX anchor): #facc15 is the reserved unlock-action color, card
 * background, mono text. Error copy rides the shared friendly-unlock
 * mapping inside importApi.vaultUnlock.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { importApi } from '@/shared/api/user/import';
import { DIALOG_LAYER, ModalPortal } from '@/shared/ui/ModalShell';

export interface UnlockPopoverAnchor {
  /** Viewport-space rect of the anchor control, captured at click time
   *  (getBoundingClientRect). Viewport coords match position:fixed. */
  left: number;
  top: number;
  width: number;
}

export interface UnlockPopoverProps {
  anchor: UnlockPopoverAnchor;
  onClose: () => void;
  /** Fires once the vault session is unlocked (cookie set, ['vault-status']
   *  invalidated). The caller resumes whatever action was interrupted. */
  onUnlocked: () => void;
}

export function UnlockPopover({ anchor, onClose, onUnlocked }: UnlockPopoverProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unlockMut = useMutation({
    mutationFn: importApi.vaultUnlock,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        // Flipping ['vault-status'] is enough for the list too: the vault
        // list rides a lock-scoped key (['vault-list', 'unlocked' | 'locked'])
        // so the key change itself forces a fresh fetch.
        qc.invalidateQueries({ queryKey: ['vault-status'] });
        onUnlocked();
      } else {
        setError(res.error_message || t('shared.unlockFailed'));
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Center on the anchor, clamped so a first/last-column button never pushes
  // the card off-viewport. 170px ≈ half the card's max width incl. padding.
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const centerX = Math.min(Math.max(anchor.left + anchor.width / 2, 170), viewportW - 170);

  return (
    <ModalPortal>
      {/* Transparent click-away layer — deliberately NOT dimmed: this is a
          lightweight in-place prompt, not a modal takeover. */}
      <div
        className="fixed inset-0"
        style={{ zIndex: DIALOG_LAYER.content }}
        onClick={onClose}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!password || unlockMut.isPending) return;
          setError(null);
          unlockMut.mutate({ password });
        }}
        className="fixed rounded border px-3 py-2.5"
        style={{
          zIndex: DIALOG_LAYER.content,
          left: centerX,
          top: anchor.top - 10,
          transform: 'translate(-50%, -100%)',
          background: 'var(--card)',
          borderColor: '#facc15',
          boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
        }}
      >
        <div
          className="text-[10px] font-mono uppercase tracking-wider mb-1.5"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {t('vault.useLockedTitle')}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('shared.masterPasswordPlaceholder')}
            className="bg-transparent outline-none text-[12px] font-mono px-1 py-0.5 w-44 rounded border"
            style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
            disabled={unlockMut.isPending}
            aria-label={t('shared.masterPasswordPlaceholder')}
          />
          <button
            type="submit"
            disabled={!password || unlockMut.isPending}
            // whitespace-nowrap + flex-shrink-0 (2026-07-29 fix): the fixed
            // w-44 input squeezed this flex sibling, wrapping zh "解锁" into
            // two stacked characters.
            className="rounded px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider disabled:opacity-50 whitespace-nowrap flex-shrink-0"
            style={{ background: '#facc15', color: '#18181b' }}
          >
            {unlockMut.isPending ? '…' : t('shared.unlock')}
          </button>
        </div>
        {error ? (
          <div
            className="text-[11px] font-mono mt-1.5"
            style={{ color: 'var(--destructive, #ef4444)', maxWidth: 260 }}
          >
            {error}
          </div>
        ) : null}
        {/* Anchor arrow: rotated square peeking from the card's bottom edge,
            pointing at the control that opened the prompt (原地 affordance). */}
        <div
          aria-hidden
          className="absolute"
          style={{
            left: '50%',
            bottom: -5,
            width: 8,
            height: 8,
            transform: 'translateX(-50%) rotate(45deg)',
            background: 'var(--card)',
            borderRight: '1px solid #facc15',
            borderBottom: '1px solid #facc15',
          }}
        />
      </form>
    </ModalPortal>
  );
}
