/**
 * HookReadinessBanner — Hook coverage v1 §2.4 banner state machine.
 *
 * Shown in /user/vault, /user/virtual-keys and /user/import when terminal
 * auto-sync (the shell hook) is not fully wired.
 *
 * State machine (see hookBannerKind in @/store):
 *   wired              → no banner (zero DOM)
 *   almost-ready       → NON-dismissible action banner (2026-07-10
 *                        escalation) — one click fixes it, and while it is
 *                        unfixed every key the user activates on the Web
 *                        silently never reaches their CLI. Uses the gold
 *                        "needs action" visual language of the vault/import
 *                        unlock banners (.unlock-banner.locked anchor).
 *   shell-undetectable → dismissible — can't be fixed from the browser
 *   env-misconfigured  → dismissible — service env problem
 *   io-error           → dismissible — fs/permission problem
 *   disabled           → no banner (user opted out via AIKEY_NO_HOOK=1)
 *
 * Readiness bootstrap (2026-07-10): on mount (and on tab re-focus, 30s
 * throttle) the banner asks GET /api/user/hook/status so the state
 * survives a page refresh — previously readiness only arrived on vault
 * mutation envelopes and a reload blanked the banner even though nothing
 * was wired. Probe failures degrade silently to the old behavior.
 *
 * Dismissal (for the dismissible kinds) lives in sessionStorage so it
 * doesn't leak across browser sessions.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useHookReadinessStore,
  hookBannerKind,
  bannerPolicy,
  probedReadinessIsAuthoritative,
} from '@/store';
import { hookApi } from '@/shared/api/user/hook';
import { pickHookReadiness } from '@/shared/api/user/vault';
import { copyText } from '@/shared/utils/clipboard';
import { isWindowsClient } from '@/shared/utils/platform';
import { isLocalEdition } from './HookWireRcModal';

const SESSION_DISMISS_KEY = 'aikey:hookReadinessBannerDismissed';

// Module-level probe throttle: the banner is mounted by three pages, and a
// per-component ref would re-probe on every navigation. 30s is enough to
// pick up "user ran `aikey hook install` in a terminal, then came back".
const PROBE_THROTTLE_MS = 30_000;
let lastProbeAt = 0;

async function probeStatusIntoStore(force = false) {
  if (!isLocalEdition()) return;
  const now = Date.now();
  if (!force && now - lastProbeAt < PROBE_THROTTLE_MS) return;
  lastProbeAt = now;
  try {
    const res = await hookApi.status();
    const r = pickHookReadiness(res);
    // Fresh-install pre-first-use state (file never rendered, no failure)
    // is NOT a failure — abstain instead of raising a false io-error
    // banner. See probedReadinessIsAuthoritative docs.
    if (!probedReadinessIsAuthoritative(r)) return;
    useHookReadinessStore.getState().setReadiness(r);
  } catch {
    // Read-only observability probe — a failure must not create noise of
    // its own. Fall back to mutation-envelope updates (pre-2026-07-10
    // behavior).
  }
}

interface HookReadinessBannerProps {
  /**
   * Optional callback to re-open the wire-rc modal. When provided and the
   * banner kind is `almost-ready`, the primary CTA becomes "Enable
   * auto-sync" → triggers this callback (which opens HookWireRcModal).
   * When omitted (e.g. on a Production deployment where the modal isn't
   * available), the CTA falls back to "Copy command" / `aikey hook install`.
   *
   * Hook coverage v1 update 2026-05-07.
   */
  onEnableClick?: () => void;
}

export function HookReadinessBanner({ onEnableClick }: HookReadinessBannerProps = {}) {
  const { t } = useTranslation();
  const readiness = useHookReadinessStore((s) => s.readiness);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
  });

  // Bootstrap probe: fill the store on first mount of a session so the
  // banner state survives page refresh (readiness is not persisted).
  useEffect(() => {
    if (useHookReadinessStore.getState().readiness === null) {
      void probeStatusIntoStore(true);
    }
  }, []);

  // Re-read sessionStorage + re-probe when the tab regains focus so a user
  // who fixes wiring in a terminal sees the banner clear without a manual
  // refresh (30s throttle inside the probe).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setDismissed(window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1');
        const current = hookBannerKind(useHookReadinessStore.getState().readiness);
        if (current !== 'wired' && current !== 'disabled') {
          void probeStatusIntoStore();
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const kind = hookBannerKind(readiness);
  const { dismissible } = bannerPolicy(kind);
  // Non-dismissible kinds ignore an earlier dismissal recorded while the
  // banner showed a dismissible kind — the escalation must win.
  if (kind === 'wired' || kind === 'disabled' || (dismissed && dismissible)) return null;

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    }
    setDismissed(true);
  };

  // Per-kind copy and CTA. Kept inline so the whole banner contract is
  // visible in one place — no jumping between files to read the strings.
  // Hook coverage v1 update 2026-05-07: when `onEnableClick` is wired up
  // (Personal + Trial editions only), the `almost-ready` CTA becomes an
  // in-place "Enable auto-sync" button that re-opens HookWireRcModal.
  let title: string;
  let body: string;
  // CTA is either a copy-command (text → clipboard) or a click-action
  // (re-open modal). Only one is set at a time.
  let cta: { label: string; command: string } | null = null;
  let ctaAction: { label: string; onClick: () => void } | null = null;
  // Platform-aware copy (parity audit 2026-07-07 P2-7): Windows users were
  // shown zsh paths + a `--shell zsh` fallback that fails verbatim on their
  // machine (the bridge actually writes $PROFILE + hook.ps1).
  const onWindows = isWindowsClient();
  const rcName = onWindows ? t('hookBanner.rcPowershell') : '~/.zshrc';
  switch (kind) {
    case 'almost-ready':
      // Consequence-oriented title (2026-07-10): "Almost ready" framed the
      // unwired state as safely postponable; the actual consequence is that
      // Web-activated keys never reach the CLI. Say that.
      title = t('hookBanner.almostReadyTitle');
      if (onEnableClick) {
        body = t('hookBanner.almostReadyBodyModal', { rcName });
        ctaAction = { label: t('hookBanner.enableCta'), onClick: onEnableClick };
      } else {
        body = t('hookBanner.almostReadyBodyCopy', { rcName });
        cta = { label: t('hookBanner.copyCommand'), command: 'aikey hook install' };
      }
      break;
    case 'shell-undetectable':
      title = t('hookBanner.shellUndetectableTitle');
      body = t('hookBanner.shellUndetectableBody');
      cta = {
        label: t('hookBanner.copyCommand'),
        command: onWindows ? 'aikey hook install --shell powershell' : 'aikey hook install --shell zsh',
      };
      break;
    case 'env-misconfigured':
      // Distinct from io-error because the remediation is "fix the
      // service env, then re-run", not "chmod ~/.aikey/". home_unset
      // typically means the trial service was launched without HOME
      // (containerized / systemd unit missing User= setup).
      title = t('hookBanner.envMisconfiguredTitle');
      body = t('hookBanner.envMisconfiguredBody');
      cta = { label: t('hookBanner.copyCommand'), command: 'aikey hook install' };
      break;
    case 'io-error':
    default:
      title = t('hookBanner.ioErrorTitle');
      body = t('hookBanner.ioErrorBody', { hookFile: onWindows ? 'hook.ps1' : 'hook.zsh' });
      cta = { label: t('hookBanner.copyCommand'), command: 'aikey hook update' };
      break;
  }

  return (
    <div className={`hook-readiness-banner${dismissible ? '' : ' hook-readiness-action'}`}>
      <div className="hook-readiness-content">
        <div className="hook-readiness-text">
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
        <div className="hook-readiness-actions">
          {ctaAction && (
            <button
              type="button"
              className="hook-readiness-cta"
              onClick={ctaAction.onClick}
            >
              {ctaAction.label}
            </button>
          )}
          {cta && (
            <button
              type="button"
              className="hook-readiness-cta"
              onClick={() => copyText(cta!.command)}
              title={cta.command}
            >
              {cta.label}
            </button>
          )}
          {dismissible && (
            <button
              type="button"
              className="hook-readiness-dismiss"
              onClick={handleDismiss}
              aria-label={t('hookBanner.dismissAria')}
            >
              {t('hookBanner.dismiss')}
            </button>
          )}
        </div>
      </div>
      <style>{HOOK_READINESS_CSS}</style>
    </div>
  );
}

const HOOK_READINESS_CSS = `
.hook-readiness-banner {
  margin: 0 0 12px 0;
  padding: 10px 14px;
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  background: var(--surface-warn, rgba(var(--btn-primary-border-rgb), 0.08));
  color: var(--text);
}
/* almost-ready escalation (2026-07-10): reuse the gold "needs action"
   language of .unlock-banner.locked (keys-page-css.ts) — gradient +
   primary inset rail — instead of inventing a new alarm style. Gold, not
   red: unwired auto-sync is a gated state, not a failure. */
.hook-readiness-banner.hook-readiness-action {
  background: linear-gradient(90deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.02) 100%);
  border: 1px solid rgba(var(--primary-rgb), 0.35);
  box-shadow: inset 3px 0 0 0 var(--primary);
}
.hook-readiness-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.hook-readiness-text strong {
  font-size: 13px;
  display: block;
  margin-bottom: 4px;
}
.hook-readiness-text p {
  font-size: 12px;
  margin: 0;
  color: var(--text-dim, #888);
}
.hook-readiness-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.hook-readiness-cta {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--surface, #fff);
  background: var(--primary);
  border: 1px solid var(--primary);
  border-radius: 3px;
  cursor: pointer;
  font-family: monospace;
}
.hook-readiness-cta:hover {
  opacity: 0.9;
}
.hook-readiness-dismiss {
  padding: 6px 10px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-dim);
  cursor: pointer;
}
.hook-readiness-dismiss:hover {
  color: var(--text);
}
`;
