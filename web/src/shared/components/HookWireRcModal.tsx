/**
 * HookWireRcModal — Web-modal "Allow" path for shell-hook rc wiring.
 *
 * Pops automatically on EVERY eligible vault mutation (use/add) that
 * returns hook_rc_wired=false (mounted by the same pages as
 * <HookReadinessBanner>). Also re-openable from the banner CTA.
 *
 * 2026-07-10 escalation (20260710-hook接线可见性升级.md): the previous
 * once-per-session auto-pop gate is gone. "Not now" only skips the current
 * occurrence — the next eligible use/add re-pops while rc stays unwired.
 * The eligible mutation is precisely the moment the user says "route this
 * key", which is exactly when unwired state makes the action meaningless,
 * so re-prompting there is targeted, not global nagging.
 *
 * Design contract: 20260507-web-hook-rc-modal-自动注入.md
 *   - Shows a plain-text preview of the lines that will be appended
 *     to the shell profile so the user has full informed consent
 *   - Includes the manual command `aikey hook install` as an inline
 *     fallback for users who would rather run it from a terminal
 *   - Allow → POST /api/user/hook/install → setReadiness({rcWired:true})
 *   - Not now → close (banner remains as fallback)
 *   - On error: stays open with the failure reason inline; user can
 *     retry, copy the manual command, or dismiss
 *
 * Edition: only mounted on local-user / trial-full editions (the page
 * handlers gate by `window.__AIKEY_CONFIG__.authMode === 'local_bypass'`
 * before calling `openModal`). Production never reaches this component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hookApi } from '@/shared/api/user/hook';
import { pickHookReadiness, type HookReadiness } from '@/shared/api/user/vault';
import { useHookReadinessStore } from '@/store';
import { copyText } from '@/shared/utils/clipboard';
import { isWindowsClient } from '@/shared/utils/platform';
import { ModalPortal } from '@/shared/ui/ModalShell';

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
export function isLocalEdition(): boolean {
  if (typeof window === 'undefined') return false;
  // Use a loose access — the script tag is injected only for local modes.
  const cfg = (window as unknown as { __AIKEY_CONFIG__?: { authMode?: string } })
    .__AIKEY_CONFIG__;
  return cfg?.authMode === 'local_bypass';
}

/**
 * Page-side composable: returns `{open, openIfNeeded, openManually, close}`.
 *
 * `openIfNeeded(readiness, eligible)` opens the modal when ALL of the
 * following hold (2026-07-10: the once-per-session gate was removed — it
 * re-pops on every eligible mutation while rc stays unwired):
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
 * Per 20260507-web-hook-rc-modal-自动注入.md update X2 +
 * 20260710-hook接线可见性升级.md.
 */
export function useHookWireRcModal() {
  const [open, setOpen] = useState(false);

  const openIfNeeded = useCallback((r: HookReadiness, eligible: boolean) => {
    if (!eligible) return;
    if (!isLocalEdition()) return;
    if (!r.fileInstalled) return;
    if (r.rcWired) return;
    if (r.failureReason) return;
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  // Manual re-open (banner CTA path) — bypasses eligibility check because
  // it's the user's explicit click.
  const openManually = useCallback(() => setOpen(true), []);

  return { open, openIfNeeded, openManually, close };
}

// Platform-specific previews (parity audit 2026-07-07 P2-7): showing the zsh
// block to a Windows user broke informed consent — the bridge actually writes
// the PowerShell $PROFILE block below (see aikey-cli
// shell_integration_windows.rs v3_rc_block_powershell; keep in sync).
const MARKER_BLOCK_UNIX = `# aikey shell hook v3 begin
[[ -f ~/.aikey/hook.zsh ]] && source ~/.aikey/hook.zsh
# aikey shell hook v3 end`;
const MARKER_BLOCK_WINDOWS = `# aikey shell hook v3 begin
$_aikeyBin = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.aikey\\bin' } else { Join-Path $env:HOME '.aikey/bin' }
if ((Test-Path $_aikeyBin) -and (($env:Path -split ';') -notcontains $_aikeyBin)) { $env:Path = "$_aikeyBin;$env:Path" }
$_aikeyHookFile = if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.aikey/hook.ps1' } else { Join-Path $env:HOME '.aikey/hook.ps1' }
if (Test-Path $_aikeyHookFile) { . $_aikeyHookFile }
Remove-Variable -Name _aikeyBin,_aikeyHookFile -Scope Local -ErrorAction SilentlyContinue
# aikey shell hook v3 end`;
const MANUAL_COMMAND = 'aikey hook install';

export function HookWireRcModal({ open, onClose }: HookWireRcModalProps) {
  const { t } = useTranslation();
  const setReadiness = useHookReadinessStore((s) => s.setReadiness);
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
      if (res.hook_rc_wired) {
        onClose();
      } else {
        // Bridge returned without an exception but rc wiring still
        // didn't complete — surface the reason inline so the user can
        // pick a remediation (manual command, retry, or close).
        const reason = res.hook_failure_reason ?? 'unknown';
        setErrorMsg(t('hookModal.serverReported', { reason }));
      }
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown error';
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  // "Not now" = skip this occurrence only. No session flag — the next
  // eligible use/add re-pops the modal while rc stays unwired (2026-07-10).
  const handleNotNow = () => {
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

  const onWindows = useMemo(() => isWindowsClient(), []);
  const previewLines = useMemo(
    () => (onWindows ? MARKER_BLOCK_WINDOWS : MARKER_BLOCK_UNIX).split('\n'),
    [onWindows],
  );

  if (!open) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(var(--scrim-rgb), 0.2)' }}
        onClick={handleNotNow}
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
        aria-labelledby="hook-wire-modal-title"
      >
        {/* Title */}
        <h3
          id="hook-wire-modal-title"
          className="text-sm font-mono font-bold tracking-wider mb-2"
          style={{ color: 'var(--foreground)' }}
        >
          {t('hookModal.title')}
        </h3>
        <p className="text-xs font-mono leading-relaxed mb-4" style={{ color: 'var(--muted-foreground)' }}>
          {t('hookModal.body')}
        </p>

        {/* Diff preview */}
        <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--muted-foreground)' }}>
          {onWindows ? t('hookModal.appendToPosh') : t('hookModal.appendToUnix')}
        </p>
        <pre
          className="font-mono text-xs leading-relaxed p-3 rounded border mb-4 whitespace-pre-wrap"
          style={{
            backgroundColor: 'rgba(var(--lift-rgb), 0.04)',
            borderColor: 'var(--border)',
            color: 'var(--foreground)',
          }}
        >
          {previewLines.join('\n')}
        </pre>

        {/* Manual fallback */}
        <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--muted-foreground)' }}>
          {t('hookModal.manualLabel')}
        </p>
        <div
          className="flex items-center gap-2 p-2 rounded border mb-4"
          style={{
            backgroundColor: 'rgba(var(--lift-rgb), 0.04)',
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
            {copied ? t('hookModal.copied') : t('hookModal.copy')}
          </button>
        </div>

        {/* Inline error (optional) */}
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

        {/* Buttons */}
        <div className="flex gap-3 justify-end mt-2">
          <button
            type="button"
            onClick={handleNotNow}
            disabled={busy}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            {t('hookModal.notNow')}
          </button>
          <button
            type="button"
            onClick={handleAllow}
            disabled={busy}
            className="px-4 py-2 text-xs font-mono font-bold tracking-wider rounded border transition-colors disabled:opacity-40"
            style={{
              backgroundColor: 'rgba(var(--success-rgb), 0.12)',
              borderColor: 'rgba(var(--success-rgb), 0.4)',
              color: '#22c55e',
            }}
          >
            {busy ? t('hookModal.wiring') : t('hookModal.allow')}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
