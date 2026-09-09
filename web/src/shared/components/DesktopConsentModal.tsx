/**
 * DesktopConsentModal — consent dialog for the Claude Desktop takeover
 * (阶段7, 2026-07-13; plan §5.2, decisions D2/D3).
 *
 * Pops when a vault `use` on a claude credential returns
 * `desktop_switch.needs_consent = true` (the CLI funnel detected Claude
 * Desktop but has no standing consent and the web bridge is headless).
 *
 * Consent replay contract (方案B — no dedicated endpoint): the answer is
 * carried by RE-INVOKING the same `use` with `desktop_consent` +
 * `desktop_remember`. `use` is idempotent, so the replay's only effect is
 * the takeover itself (remembered answers are persisted CLI-side in
 * `~/.aikey/config/config.json`, the single consent truth source — the web
 * stores NOTHING locally, so CLI and web can never disagree).
 *
 *   - Confirm            → replay `use` with granted (+remember if checked)
 *   - Cancel + checked   → replay with denied + remember (never ask again;
 *                          undo path: `aikey desktop install`)
 *   - Cancel unchecked   → just close; next eligible use asks again (D3)
 *   - Esc                → same as Cancel unchecked
 *
 * Edition gating mirrors HookWireRcModal: only local editions auto-pop
 * (`isLocalEdition()`); production never reaches this.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vaultApi, type DesktopSwitch, type UseRequest } from '@/shared/api/user/vault';
import { ModalPortal } from '@/shared/ui/ModalShell';
import { isLocalEdition } from '@/shared/components/HookWireRcModal';

/** The `use` identity to replay the consent against. */
export interface DesktopConsentReplay {
  target: UseRequest['target'];
  id: string;
}

/**
 * Page-side composable. `openIfNeeded(res)` opens when the use response
 * carries `desktop_switch.needs_consent` on a local edition. The replay
 * identity is taken from the same response (canonical id, so alias inputs
 * replay correctly).
 */
export function useDesktopConsentModal() {
  const [replay, setReplay] = useState<DesktopConsentReplay | null>(null);

  const openIfNeeded = useCallback(
    (res: { target: UseRequest['target']; id: string; desktop_switch?: DesktopSwitch }) => {
      if (!isLocalEdition()) return;
      if (!res.desktop_switch?.needs_consent) return;
      setReplay({ target: res.target, id: res.id });
    },
    [],
  );

  const close = useCallback(() => setReplay(null), []);

  return { open: replay !== null, replay, openIfNeeded, close };
}

interface DesktopConsentModalProps {
  open: boolean;
  replay: DesktopConsentReplay | null;
  onClose: () => void;
  /**
   * Called with the replay's desktop_switch after a GRANTED replay
   * completes — the page toasts the restart hint off `restart_required`.
   * Not called for denied/cancel paths (nothing user-visible changed).
   */
  onGranted: (result: DesktopSwitch | undefined) => void;
}

export function DesktopConsentModal({ open, replay, onClose, onGranted }: DesktopConsentModalProps) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset transient state on every open (same rationale as HookWireRcModal).
  useEffect(() => {
    if (open) {
      setRemember(false);
      setBusy(false);
      setErrorMsg(null);
    }
  }, [open]);

  const replayUse = useCallback(
    async (consent: 'granted' | 'denied', rememberFlag: boolean) => {
      if (!replay) return;
      setBusy(true);
      setErrorMsg(null);
      try {
        const res = await vaultApi.use({
          target: replay.target,
          id: replay.id,
          desktop_consent: consent,
          desktop_remember: rememberFlag,
        });
        if (consent === 'granted') {
          onGranted(res.desktop_switch);
        }
        onClose();
      } catch (e) {
        // Denied replays only persist a pref — a failure there is not worth
        // blocking the dialog over; granted failures must stay visible.
        if (consent === 'granted') {
          setErrorMsg((e as Error).message ?? 'unknown error');
        } else {
          onClose();
        }
      } finally {
        setBusy(false);
      }
    },
    [replay, onClose, onGranted],
  );

  const handleCancel = useCallback(() => {
    if (busy) return;
    if (remember) {
      // "Never ask again" — persist CLI-side via the denied replay.
      void replayUse('denied', true);
    } else {
      onClose();
    }
  }, [busy, remember, replayUse, onClose]);

  // Esc dismisses (= Cancel-unchecked semantics regardless of checkbox —
  // an Esc is a reflex, not an informed "never").
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(var(--scrim-rgb), 0.2)' }}
        onClick={handleCancel}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded border p-6"
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--border)',
          boxShadow: '0 24px 64px rgba(var(--scrim-rgb), 0.7)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-consent-modal-title"
      >
        <h3
          id="desktop-consent-modal-title"
          className="text-sm font-mono font-bold tracking-wider mb-2"
          style={{ color: 'var(--foreground)' }}
        >
          {t('vault.desktopConsentTitle')}
        </h3>
        <p
          className="text-xs font-mono leading-relaxed mb-4"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {t('vault.desktopConsentBody')}
        </p>

        {errorMsg && (
          <div
            className="p-2 rounded border mb-4 text-xs font-mono"
            style={{
              borderColor: 'rgba(var(--destructive-rgb), 0.4)',
              backgroundColor: 'rgba(var(--destructive-rgb), 0.08)',
              color: '#ef4444',
            }}
          >
            {errorMsg}
          </div>
        )}

        <label
          className="flex items-center gap-2 mb-4 text-xs font-mono cursor-pointer select-none"
          style={{ color: 'var(--muted-foreground)' }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
          />
          {t('vault.desktopDontAskAgain')}
        </label>

        <div className="flex gap-3 justify-end mt-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            {t('vault.desktopConsentCancel')}
          </button>
          <button
            type="button"
            onClick={() => void replayUse('granted', remember)}
            disabled={busy}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors disabled:opacity-40"
            style={{
              backgroundColor: 'rgba(var(--success-rgb), 0.12)',
              borderColor: 'rgba(var(--success-rgb), 0.4)',
              color: '#22c55e',
            }}
          >
            {busy ? '…' : t('vault.desktopConsentConfirm')}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
