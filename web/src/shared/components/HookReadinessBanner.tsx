/**
 * HookReadinessBanner — Hook coverage v1 §2.4 banner state machine.
 *
 * Shown in /user/vault and /user/virtual-keys when the most recent
 * vault mutation reports the active-state cross-shell sync hook is
 * not fully wired.
 *
 * State machine (matches plan §2.4 table):
 *   wired              → no banner (zero DOM)
 *   almost-ready       → "Run aikey hook install" CTA (Web-only flow case)
 *   shell-undetectable → "$SHELL is not zsh/bash" CTA with --shell hint
 *   disabled           → no banner (user opted out via AIKEY_NO_HOOK=1)
 *   io-error           → fs / permission failure, link to troubleshooting
 *
 * Dismissal lives in sessionStorage so it doesn't leak across browser
 * sessions — a user who never wires rc will see the banner again next
 * time they open Web. Persistent storage would let dismissal mask a
 * real ongoing problem.
 */
import { useEffect, useState } from 'react';
import { useHookReadinessStore, hookBannerKind } from '@/store';
import { copyText } from '@/shared/utils/clipboard';

const SESSION_DISMISS_KEY = 'aikey:hookReadinessBannerDismissed';

export function HookReadinessBanner() {
  const readiness = useHookReadinessStore((s) => s.readiness);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
  });

  // Re-read sessionStorage when the page is brought back to focus so a
  // user who dismisses + opens a new tab sees consistent behavior.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setDismissed(window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const kind = hookBannerKind(readiness);
  if (kind === 'wired' || kind === 'disabled' || dismissed) return null;

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    }
    setDismissed(true);
  };

  // Per-kind copy and CTA. Kept inline so the whole banner contract is
  // visible in one place — no jumping between files to read the strings.
  let title: string;
  let body: string;
  let cta: { label: string; command: string } | null = null;
  switch (kind) {
    case 'almost-ready':
      title = 'Almost ready — terminal auto-sync needs one more step';
      body =
        "Hook file installed but your shell rc isn't wired yet. Run the command below " +
        'once to enable auto-sync (it will prompt before modifying your ~/.zshrc).';
      cta = { label: 'Copy command', command: 'aikey hook install' };
      break;
    case 'shell-undetectable':
      title = "Trial server didn't expose a zsh/bash SHELL";
      body =
        'Hook file install was skipped because the service environment had no recognizable shell. ' +
        'Run the command below from your terminal to choose explicitly.';
      cta = { label: 'Copy command', command: 'aikey hook install --shell zsh' };
      break;
    case 'env-misconfigured':
      // Distinct from io-error because the remediation is "fix the
      // service env, then re-run", not "chmod ~/.aikey/". home_unset
      // typically means the trial service was launched without HOME
      // (containerized / systemd unit missing User= setup).
      title = "Trial server's $HOME isn't set";
      body =
        'Hook file install needs $HOME to know where to write. The Web bridge ran ' +
        'with no HOME — common in container / systemd contexts. Fix the service env ' +
        'and rerun, or install from a regular terminal session below.';
      cta = { label: 'Copy command', command: 'aikey hook install' };
      break;
    case 'io-error':
    default:
      title = 'Hook install ran into a filesystem error';
      body =
        'The Web bridge could not write ~/.aikey/hook.zsh. Check ~/.aikey/ permissions, then run the command below.';
      cta = { label: 'Copy command', command: 'aikey hook update' };
      break;
  }

  return (
    <div className="hook-readiness-banner">
      <div className="hook-readiness-content">
        <div className="hook-readiness-text">
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
        <div className="hook-readiness-actions">
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
          <button
            type="button"
            className="hook-readiness-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss banner"
          >
            Dismiss
          </button>
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
  background: var(--surface-warn, rgba(234, 179, 8, 0.08));
  color: var(--text);
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
