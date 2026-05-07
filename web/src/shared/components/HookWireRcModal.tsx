/**
 * HookWireRcModal — Web-modal "Allow" path for shell-hook rc wiring.
 *
 * Pops automatically on the first vault mutation in this browser session
 * that returns hook_rc_wired=false (mounted by the same pages as
 * <HookReadinessBanner>). Also re-openable from the banner CTA.
 *
 * Design contract: 20260507-web-hook-rc-modal-自动注入.md
 *   - Shows a plain-text preview of the 3 lines that will be appended
 *     to ~/.zshrc / ~/.bashrc so the user has full informed consent
 *   - Includes the manual command `aikey hook install` as an inline
 *     fallback for users who would rather run it from a terminal
 *   - Allow → POST /api/user/hook/install → setReadiness({rcWired:true})
 *   - Not now → markModalShown() + close (banner remains as fallback)
 *   - On error: stays open with the failure reason inline; user can
 *     retry, copy the manual command, or dismiss
 *
 * Edition: only mounted on local-user / trial-full editions (the page
 * handlers gate by `window.__AIKEY_CONFIG__.authMode === 'local_bypass'`
 * before calling `openModal`). Production never reaches this component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { hookApi } from '@/shared/api/user/hook';
import { pickHookReadiness, type HookReadiness } from '@/shared/api/user/vault';
import { useHookReadinessStore } from '@/store';
import { copyText } from '@/shared/utils/clipboard';

interface HookWireRcModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Edition probe: only Personal local-server and Trial-full single-binary
 * setups inject `__AIKEY_CONFIG__.authMode === 'local_bypass'` (see
 * aikey-trial-server/web/embed.go). Production (multi-tenant cloud) ships
 * the SPA without this script tag, so the predicate is false there.
 *
 * The page handlers gate `useHookWireRcModalAutoOpen` on this so the modal
 * never auto-pops on a Production deployment — even if the dist somehow
 * carried hook code over from a shared bundle. Belt-and-suspenders for the
 * server-side edition guard in aikey-control-master/.../router.go.
 */
function isLocalEdition(): boolean {
  if (typeof window === 'undefined') return false;
  // Use a loose access — the script tag is injected only for local modes.
  const cfg = (window as unknown as { __AIKEY_CONFIG__?: { authMode?: string } })
    .__AIKEY_CONFIG__;
  return cfg?.authMode === 'local_bypass';
}

/**
 * Page-side composable: returns `{open, openIfNeeded, openManually, close}`.
 *
 * `openIfNeeded(readiness, eligible)` opens the modal exactly once per
 * session when ALL of the following hold:
 *   - `eligible === true`        — the caller's mutation is a "user explicitly
 *                                  set this as active" event (e.g. add of a
 *                                  first-of-its-protocol key, `aikey use`).
 *                                  Bulk loading (import) and removal (delete)
 *                                  pass `false` so the modal doesn't auto-pop
 *                                  in the middle of a "loading my collection"
 *                                  workflow. The user can still hit the
 *                                  banner CTA to open the modal manually.
 *   - readiness ↦ "almost ready"  — file installed + rc not wired + no
 *                                  failure reason
 *   - `isLocalEdition()`         — Personal / Trial only
 *   - !`modalShownThisSession`   — at most one auto-pop per session
 *
 * Pages call `openIfNeeded(pickHookReadiness(res), eligible)` in mutation
 * onSuccess right after `setReadiness(...)`. Eligibility maps to the
 * mutation kind:
 *   - vault add  → true    — first-key onboarding path
 *   - vault use  → true    — explicit "set as active" click
 *   - vault delete → false — user is removing, not adding
 *   - virtual-keys use → true
 *   - import confirm → false — bulk load, may import keys user doesn't
 *                              want active yet
 *
 * Pages also pass `openManually` as the banner's `onEnableClick` so the
 * banner CTA becomes a re-opener regardless of eligibility.
 *
 * Per 20260507-web-hook-rc-modal-自动注入.md update X2.
 */
export function useHookWireRcModal() {
  const [open, setOpen] = useState(false);
  const modalShownThisSession = useHookReadinessStore((s) => s.modalShownThisSession);

  const openIfNeeded = useCallback(
    (r: HookReadiness, eligible: boolean) => {
      if (!eligible) return;
      if (modalShownThisSession) return;
      if (!isLocalEdition()) return;
      if (!r.fileInstalled) return;
      if (r.rcWired) return;
      if (r.failureReason) return;
      setOpen(true);
    },
    [modalShownThisSession],
  );

  const close = useCallback(() => setOpen(false), []);
  // Manual re-open (banner CTA path) — bypasses eligibility check because
  // it's the user's explicit click.
  const openManually = useCallback(() => setOpen(true), []);

  return { open, openIfNeeded, openManually, close };
}

const MARKER_BLOCK = `# aikey shell hook v3 begin
[[ -f ~/.aikey/hook.zsh ]] && source ~/.aikey/hook.zsh
# aikey shell hook v3 end`;
const MANUAL_COMMAND = 'aikey hook install';

export function HookWireRcModal({ open, onClose }: HookWireRcModalProps) {
  const setReadiness = useHookReadinessStore((s) => s.setReadiness);
  const markModalShown = useHookReadinessStore((s) => s.markModalShown);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset transient state every time the dialog opens. Otherwise an old
  // error message would flash for one frame the next time we open it.
  useEffect(() => {
    if (open) {
      setBusy(false);
      setErrorMsg(null);
      setCopied(false);
    }
  }, [open]);

  // Esc dismisses (treated same as "Not now").
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleNotNow();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleAllow = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await hookApi.install();
      // Feed the same readiness fields back into the shared store so
      // <HookReadinessBanner> updates immediately (and any other page
      // visiting later in this session shows the post-wire state).
      setReadiness(pickHookReadiness(res));
      markModalShown();
      if (res.hook_rc_wired) {
        onClose();
      } else {
        // Bridge returned without an exception but rc wiring still
        // didn't complete — surface the reason inline so the user can
        // pick a remediation (manual command, retry, or close).
        const reason = res.hook_failure_reason ?? 'unknown';
        setErrorMsg(`Server reported '${reason}' — wiring did not complete.`);
      }
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown error';
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleNotNow = () => {
    markModalShown();
    onClose();
  };

  const handleCopyManual = async () => {
    try {
      await copyText(MANUAL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* best-effort */
    }
  };

  const previewLines = useMemo(() => MARKER_BLOCK.split('\n'), []);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={handleNotNow}
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded border p-6"
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hook-wire-modal-title"
      >
        {/* Title */}
        <h3
          id="hook-wire-modal-title"
          className="text-sm font-mono font-bold tracking-wider mb-2"
          style={{ color: 'var(--foreground)' }}
        >
          Enable terminal auto-sync?
        </h3>
        <p className="text-xs font-mono leading-relaxed mb-4" style={{ color: 'var(--muted-foreground)' }}>
          Adding 3 lines to your shell rc lets every new terminal pick up key
          changes (Add / Use / Delete) automatically — no manual{' '}
          <code className="font-mono">source</code> needed.
        </p>

        {/* Diff preview */}
        <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--muted-foreground)' }}>
          Will append to ~/.zshrc:
        </p>
        <pre
          className="font-mono text-xs leading-relaxed p-3 rounded border mb-4 whitespace-pre-wrap"
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderColor: 'var(--border)',
            color: 'var(--foreground)',
          }}
        >
          {previewLines.join('\n')}
        </pre>

        {/* Manual fallback */}
        <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--muted-foreground)' }}>
          Or run manually in any terminal:
        </p>
        <div
          className="flex items-center gap-2 p-2 rounded border mb-4"
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderColor: 'var(--border)',
          }}
        >
          <code
            className="font-mono text-xs flex-1 truncate"
            style={{ color: 'var(--foreground)' }}
          >
            $ {MANUAL_COMMAND}
          </code>
          <button
            type="button"
            onClick={handleCopyManual}
            className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded border"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--muted-foreground)',
              backgroundColor: 'transparent',
            }}
            title={MANUAL_COMMAND}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Inline error (optional) */}
        {errorMsg && (
          <div
            className="p-2 rounded border mb-4 text-xs font-mono"
            style={{
              borderColor: 'rgba(239,68,68,0.4)',
              backgroundColor: 'rgba(239,68,68,0.08)',
              color: '#ef4444',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-end mt-2">
          <button
            type="button"
            onClick={handleNotNow}
            disabled={busy}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            Not now
          </button>
          <button
            type="button"
            onClick={handleAllow}
            disabled={busy}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors disabled:opacity-40"
            style={{
              backgroundColor: 'rgba(34,197,94,0.12)',
              borderColor: 'rgba(34,197,94,0.4)',
              color: '#22c55e',
            }}
          >
            {busy ? 'Wiring...' : 'Allow'}
          </button>
        </div>
      </div>
    </>
  );
}
