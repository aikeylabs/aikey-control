/**
 * Settings page — /user/settings
 *
 * Phase 4G (2026-06-01): consolidates the three "account-level" actions
 * the Web Console previously had no first-class surface for:
 *
 *   1. Control URL — read current vault platform_account.control_url +
 *      let the user POST a new one. "Test connectivity" first hits
 *      /system/team-url/probe so the user can't save an unreachable URL
 *      and lock themselves out of the team server (recovery = open a
 *      terminal and run `aikey account set-url` — possible but bad UX).
 *
 *   2. Master Password — intentionally NOT changeable here. The vault
 *      re-key path is too risky to expose over HTTP localhost cleartext
 *      (G-2 review concern) and the CLI's `aikey change-password` has a
 *      well-tested atomic rollback the Web side would have to duplicate.
 *      We surface the CLI command with a copy-to-clipboard affordance
 *      so the user knows EXACTLY what to type.
 *
 *   3. Sign out — clears vault session via /system/logout (which under
 *      the hood subprocesses to `aikey logout --json`) then redirects to
 *      the login screen. The previous sidebar-bottom logout button was a
 *      front-end-only `clearAuth()` that left the vault row intact —
 *      reopening the SPA would silently re-authenticate. This page is
 *      now the single source of truth for "sign out".
 *
 * Layout (V1 from .superdesign/design_iterations/personal_settings_v1.html):
 * single column, three cards stacked vertically, max-width 720px centered.
 * No horizontal dividers between cards — 24px vertical gap only.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { appsApi } from '../../../shared/api/user/apps';
import { importApi } from '../../../shared/api/user/import';

// Slug of the Stage-6 compliance fast-layer detector (proxy filter child).
// Source of truth: aikey-cli/src/commands_app/install.rs TRUSTED_APPS +
// launch/manifests/ai-compliance-detector.manifest.json. The toggle below
// flips this app's filter_stages (NULL = off, ["pre_forward"] = on).
const COMPLIANCE_SLUG = 'ai-compliance-detector';
const COMPLIANCE_INSTALL_CMD = 'aikey app install ai-compliance-detector';

type ProbeStatus =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok'; status: number; elapsedMs: number }
  | { kind: 'fail'; message: string };

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok' }
  | { kind: 'fail'; message: string };

type LogoutStatus =
  | { kind: 'idle' }
  | { kind: 'signing-out' }
  | { kind: 'fail'; message: string };

// Compliance toggle load state. We deliberately distinguish "not-installed"
// from "ready+off": filter-status collapses both to enabled=false (the
// proxy treats a missing row and a NULL filter_stages identically), but the
// user needs different guidance — install the detector vs. flip the switch.
// Registration is detected via the apps list (slug present = installed).
type ComplianceState =
  | { kind: 'loading' }
  | { kind: 'not-installed' }
  | { kind: 'ready'; enabled: boolean }
  | { kind: 'error'; message: string };

type ComplianceSave =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'applied' }
  | { kind: 'locked' }
  | { kind: 'fail'; message: string };

// Returns the control URL to display in Settings. Prefers the logged-in
// vault value (`team_url`); falls back to `configured_url` — the config.json
// URL `aikey account set-url` saves even when the user hasn't run
// `aikey login` yet. Without the fallback, a not-logged-in user who saves a
// URL here would see it vanish on reload (the save only reached config.json,
// not the vault). `team_url` keeps its "logged into a team" meaning for the
// sidebar cross-app menu; only this page reads the configured fallback.
async function fetchCurrentTeamURL(): Promise<string> {
  const res = await fetch('/system/team-url', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  if (!res.ok) return '';
  try {
    const data = (await res.json()) as { team_url?: string; configured_url?: string };
    const teamUrl = (data.team_url ?? '').trim();
    if (teamUrl) return teamUrl;
    return (data.configured_url ?? '').trim();
  } catch {
    return '';
  }
}

async function probeTeamURL(url: string): Promise<ProbeStatus> {
  try {
    const res = await fetch('/system/team-url/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as {
      reachable?: boolean;
      status?: number;
      elapsed_ms?: number;
      error?: string;
    };
    if (!res.ok) {
      return { kind: 'fail', message: data.error ?? `HTTP ${res.status}` };
    }
    if (data.reachable) {
      return {
        kind: 'ok',
        status: data.status ?? 200,
        elapsedMs: data.elapsed_ms ?? 0,
      };
    }
    return { kind: 'fail', message: data.error ?? 'unreachable' };
  } catch (err) {
    return { kind: 'fail', message: String(err) };
  }
}

async function saveTeamURL(url: string): Promise<SaveStatus> {
  try {
    const res = await fetch('/system/team-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (res.ok && data.ok) return { kind: 'ok' };
    return { kind: 'fail', message: data.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { kind: 'fail', message: String(err) };
  }
}

async function postLogout(): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch('/system/logout', { method: 'POST' });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, message: data.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // ── Current Account state ──────────────────────────────────────────
  // We surface the logged-in email at the top of Settings so users can
  // confirm WHICH account this control panel belongs to before they touch
  // dangerous actions (change URL, change password, logout). Read from
  // /accounts/me — same endpoint the sidebar identity chip uses, so the
  // two stay in lockstep. Empty/local-bypass auth (`local@aikey.local`,
  // `personal-local`) renders as "(not logged in)" rather than the
  // placeholder string, which would confuse a real Trial / Production
  // user who saw the local-only stub leak in.
  const [currentEmail, setCurrentEmail] = useState<string>('');
  const [emailCopied, setEmailCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/accounts/me', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { email?: string };
        const email = (data.email ?? '').trim();
        if (cancelled) return;
        // Filter the local-bypass placeholder. The local-server returns
        // `local@aikey.local` when no JWT is attached; that's a Personal-
        // edition sentinel, not a real user — don't expose it as if it
        // were the user's account.
        if (email && email !== 'local@aikey.local') {
          setCurrentEmail(email);
        }
      } catch {
        /* network blip — leave empty; UI shows "not logged in" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Control URL state ──────────────────────────────────────────────
  const [currentURL, setCurrentURL] = useState<string>('');
  const [urlInput, setUrlInput] = useState<string>('');
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>({ kind: 'idle' });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });

  // Fetch current URL on mount so the input is pre-populated with whatever
  // `aikey login --control-url` (or a previous Web Settings save) put there.
  useEffect(() => {
    fetchCurrentTeamURL().then((u) => {
      setCurrentURL(u);
      setUrlInput(u);
    });
  }, []);

  // Reset probe + save status whenever the user edits the input — a stale
  // probe from a previous URL must not enable Save for a new URL.
  function onUrlChange(next: string) {
    setUrlInput(next);
    setProbeStatus({ kind: 'idle' });
    setSaveStatus({ kind: 'idle' });
  }

  async function onTestConnectivity() {
    setProbeStatus({ kind: 'probing' });
    setSaveStatus({ kind: 'idle' });
    const result = await probeTeamURL(urlInput.trim());
    setProbeStatus(result);
  }

  async function onSave() {
    if (probeStatus.kind !== 'ok') return;
    setSaveStatus({ kind: 'saving' });
    const result = await saveTeamURL(urlInput.trim());
    setSaveStatus(result);
    if (result.kind === 'ok') {
      setCurrentURL(urlInput.trim());
      // Light invalidation: clear the cross-app team-url cache so the
      // sidebar picks up the new value on the next render. The
      // visibilitychange listener will also pick this up automatically
      // when the tab refocuses; clearing here makes the change feel
      // immediate after Save.
      try {
        window.localStorage.removeItem('aikey-cross-app:team-base-url');
        window.localStorage.removeItem('aikey-cross-app-menu:team');
      } catch {
        /* localStorage disabled — non-fatal */
      }
    }
  }

  const saveDisabled = probeStatus.kind !== 'ok' || saveStatus.kind === 'saving';
  const urlChanged = urlInput.trim() !== currentURL.trim();

  // ── Current Account box content (depends on Control URL) ───────────
  // When logged into a team, the box shows the user's email (copy = email).
  // When NOT logged in but a Control URL has been configured below, it shows
  // the exact `aikey login` command — pre-filled with that URL — so the user
  // can copy it straight into a terminal to finish signing in. We bind to the
  // committed `currentURL` (not the live input) so the command always points
  // at a saved URL rather than a half-typed / unverified one.
  const loginCmd = currentURL.trim() ? `aikey login --control-url=${currentURL.trim()}` : '';
  const showLoginCmd = !currentEmail && loginCmd !== '';
  const accountLabel = showLoginCmd
    ? t('settings.account.loginCmdLabel')
    : t('settings.account.emailLabel');
  const accountValue = currentEmail || (showLoginCmd ? loginCmd : t('settings.account.notLoggedIn'));
  const accountCopyText = currentEmail || (showLoginCmd ? loginCmd : '');
  async function onCopyAccount() {
    if (!accountCopyText) return;
    try {
      await navigator.clipboard.writeText(accountCopyText);
      setEmailCopied(true);
      window.setTimeout(() => setEmailCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still select + copy from the input */
    }
  }

  // ── Master Password copy state ─────────────────────────────────────
  const masterPwCmd = 'aikey change-password';
  const [copied, setCopied] = useState(false);
  async function onCopyMasterPwCmd() {
    try {
      await navigator.clipboard.writeText(masterPwCmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore; user can manually copy */
    }
  }

  // ── Compliance detection toggle state ──────────────────────────────
  const [compliance, setCompliance] = useState<ComplianceState>({ kind: 'loading' });
  const [complianceSave, setComplianceSave] = useState<ComplianceSave>({ kind: 'idle' });
  const [complianceCmdCopied, setComplianceCmdCopied] = useState(false);
  // Sub-toggle: whether the local self-view records "allow" (clean-scan) events
  // (default off, save space). Tracked separately from the on/off state.
  const [recordAllow, setRecordAllow] = useState(false);
  const [recordAllowSave, setRecordAllowSave] = useState<ComplianceSave>({ kind: 'idle' });
  // Inline unlock branch — mirrors apps/AddAppModal + SwitchKeyModal: when a
  // filter-set hits I_VAULT_LOCKED we don't dead-end on a message, we reveal a
  // password field + unlock the same vault session (POST /api/user/vault/unlock
  // via importApi.vaultUnlock), then auto-retry the pending toggle. pendingEnable
  // remembers which way the user meant to flip so the retry is transparent.
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [pendingEnable, setPendingEnable] = useState<boolean | null>(null);

  // On mount: first check whether the detector is registered (apps list,
  // a no-unlock metadata read), then read its on/off state. Skipping the
  // list check would make a "not installed" device look like "off", and
  // toggling on would fail with "app not registered".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await appsApi.list();
        const registered = list.apps.some((a) => a.slug === COMPLIANCE_SLUG);
        if (!registered) {
          if (!cancelled) setCompliance({ kind: 'not-installed' });
          return;
        }
        const status = await appsApi.filterStatus(COMPLIANCE_SLUG);
        if (!cancelled) {
          setCompliance({ kind: 'ready', enabled: status.enabled });
          setRecordAllow(status.record_allow ?? false);
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (!cancelled) setCompliance({ kind: 'error', message: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggleCompliance(next: boolean) {
    if (compliance.kind !== 'ready' || complianceSave.kind === 'saving') return;
    setComplianceSave({ kind: 'saving' });
    try {
      const res = await appsApi.filterSet(COMPLIANCE_SLUG, next);
      setCompliance({ kind: 'ready', enabled: res.enabled });
      setComplianceSave({ kind: 'applied' });
    } catch (err) {
      const e = err as Error & { code?: string };
      // Vault locked → reveal the inline unlock branch and remember which
      // way the user meant to flip, so unlocking auto-retries. The toggle
      // stays at its previous value (we never optimistically flipped it),
      // so no visual rollback needed.
      if (e.code === 'I_VAULT_LOCKED' || e.code === 'I_VAULT_NO_SESSION') {
        setPendingEnable(next);
        setUnlockError(null);
        setComplianceSave({ kind: 'locked' });
      } else {
        setComplianceSave({ kind: 'fail', message: e.message ?? 'failed' });
      }
    }
  }

  // Sub-toggle: record "allow" (clean-scan) events. Default off. On locked we
  // show a hint (the main toggle's inline unlock covers the common unlock case);
  // toggling settings normally happens in an already-unlocked session.
  async function onToggleRecordAllow(next: boolean) {
    if (compliance.kind !== 'ready' || recordAllowSave.kind === 'saving') return;
    setRecordAllowSave({ kind: 'saving' });
    try {
      const res = await appsApi.filterRecordAllow(COMPLIANCE_SLUG, next);
      setRecordAllow(res.record_allow);
      setRecordAllowSave({ kind: 'applied' });
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'I_VAULT_LOCKED' || e.code === 'I_VAULT_NO_SESSION') {
        setRecordAllowSave({ kind: 'locked' });
      } else {
        setRecordAllowSave({ kind: 'fail', message: e.message ?? 'failed' });
      }
    }
  }

  // Unlock the vault session (same endpoint the apps modals use), then
  // transparently retry the toggle the user originally clicked.
  async function onUnlockAndRetry() {
    if (!unlockPassword || unlockBusy) return;
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const res = await importApi.vaultUnlock({ password: unlockPassword });
      if (res.status === 'ok' && res.unlocked) {
        setUnlockPassword('');
        const target = pendingEnable;
        setPendingEnable(null);
        setComplianceSave({ kind: 'idle' });
        if (target !== null) await onToggleCompliance(target);
      } else {
        setUnlockError(res.error_message ?? 'unlock failed');
      }
    } catch (err) {
      setUnlockError((err as Error)?.message ?? 'unlock failed');
    } finally {
      setUnlockBusy(false);
    }
  }

  async function onCopyComplianceCmd() {
    try {
      await navigator.clipboard.writeText(COMPLIANCE_INSTALL_CMD);
      setComplianceCmdCopied(true);
      window.setTimeout(() => setComplianceCmdCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore; user can manually copy */
    }
  }

  // ── Sign out state ─────────────────────────────────────────────────
  const [logoutStatus, setLogoutStatus] = useState<LogoutStatus>({ kind: 'idle' });
  async function onSignOut() {
    setLogoutStatus({ kind: 'signing-out' });
    const result = await postLogout();
    if (result.ok) {
      // Also clear any front-end auth state by wiping the local
      // ZUSTAND-persisted auth. Then hard-navigate so any cached
      // queries are dropped.
      try {
        window.localStorage.removeItem('aikey:user-auth');
        Object.keys(window.localStorage)
          .filter((k) => k.startsWith('aikey-cross-app'))
          .forEach((k) => window.localStorage.removeItem(k));
      } catch {
        /* non-fatal */
      }
      navigate('/user/login', { replace: true });
      return;
    }
    setLogoutStatus({ kind: 'fail', message: result.message ?? 'sign out failed' });
  }

  return (
    <div className="px-8 py-8">
      <div className="mx-auto" style={{ maxWidth: 720 }}>
        {/* Title block */}
        <h1
          className="mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--display-foreground)',
            letterSpacing: '-0.02em',
          }}
        >
          {t('settings.title')}
        </h1>
        <p
          className="mb-8"
          style={{
            fontSize: 14,
            color: 'var(--muted-foreground)',
          }}
        >
          {t('settings.subtitle')}
        </p>

        {/* ── Card 0: Current Account ─────────────────────────────────
            Surface the logged-in email at the top so users can confirm
            which account this control panel belongs to before touching
            any destructive setting below. Read-only display + one-tap
            copy — no save action — keeps this card light and lets the
            "real" settings cards below do the heavy lifting. */}
        <section
          className="rounded-md"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h2
            className="mb-3"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--display-foreground)',
            }}
          >
            {t('settings.account.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--soft-foreground)', marginBottom: 14 }}>
            {t('settings.account.description')}
          </p>
          <label
            className="block mb-1"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted-foreground)',
            }}
          >
            {accountLabel}
          </label>
          {/* Read-only "input" + copy chip mirrors the visual language
              of the Control URL card just below — same height, same
              border, same monospace bg — so the two cards read as a
              consistent identity-strip rather than two unrelated
              widgets. The actual control is a plain input[readOnly]
              (not a <span>) so the user can still triple-click +
              Cmd-C as a copy fallback when navigator.clipboard is
              blocked (e.g. http on a non-loopback IP). */}
          <div className="flex gap-2 items-stretch">
            <input
              type="text"
              value={accountValue}
              readOnly
              spellCheck={false}
              className="flex-1"
              style={{
                background: '#000000',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: accountCopyText ? 'var(--foreground)' : 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                padding: '10px 12px',
              }}
            />
            <button
              type="button"
              onClick={onCopyAccount}
              disabled={!accountCopyText}
              title={t('settings.account.copyTooltip')}
              aria-label={t('settings.account.copyTooltip')}
              className="px-4 rounded-md"
              style={{
                background: emailCopied ? 'var(--primary)' : 'transparent',
                border: '1px solid var(--border)',
                color: emailCopied ? 'var(--primary-foreground)' : 'var(--foreground)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                cursor: accountCopyText ? 'pointer' : 'not-allowed',
                opacity: accountCopyText ? 1 : 0.5,
                transition: 'background 120ms ease, color 120ms ease',
                whiteSpace: 'nowrap',
              }}
            >
              {emailCopied ? t('settings.account.copied') : t('settings.account.copy')}
            </button>
          </div>
          {showLoginCmd && (
            <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 8 }}>
              {t('settings.account.loginCmdHint')}
            </p>
          )}
        </section>

        {/* ── Card 1: Control URL ───────────────────────────────────── */}
        <section
          className="rounded-md"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h2
            className="mb-3"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--display-foreground)',
            }}
          >
            {t('settings.controlUrl.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--soft-foreground)', marginBottom: 14 }}>
            {t('settings.controlUrl.description')}
          </p>

          <label
            className="block mb-1"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--muted-foreground)',
            }}
          >
            {t('settings.controlUrl.endpointLabel')}
          </label>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="http://192.168.1.10:3000"
            spellCheck={false}
            className="w-full mb-2"
            style={{
              background: '#000000',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '10px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--foreground)',
              outline: 'none',
            }}
          />

          {/* Probe / save status line — single source of truth for what
              the user should expect when they click Save. */}
          <div style={{ minHeight: 18, marginBottom: 14, fontSize: 12 }}>
            {probeStatus.kind === 'idle' && saveStatus.kind === 'idle' && (
              <span style={{ color: 'var(--muted-foreground)' }}>
                {urlChanged
                  ? t('settings.controlUrl.statusReadyToTest')
                  : t('settings.controlUrl.statusUnchanged')}
              </span>
            )}
            {probeStatus.kind === 'probing' && (
              <span style={{ color: 'var(--muted-foreground)' }}>
                {t('settings.controlUrl.statusProbing')}
              </span>
            )}
            {probeStatus.kind === 'ok' && saveStatus.kind === 'idle' && (
              <span style={{ color: '#4ade80' }}>
                {t('settings.controlUrl.statusReachable', {
                  status: probeStatus.status,
                  ms: probeStatus.elapsedMs,
                })}
              </span>
            )}
            {probeStatus.kind === 'fail' && (
              <span style={{ color: '#ef4444' }}>
                {t('settings.controlUrl.statusFail', { msg: probeStatus.message })}
              </span>
            )}
            {saveStatus.kind === 'saving' && (
              <span style={{ color: 'var(--muted-foreground)' }}>
                {t('settings.controlUrl.statusSaving')}
              </span>
            )}
            {saveStatus.kind === 'ok' && (
              <span style={{ color: '#4ade80' }}>
                {t('settings.controlUrl.statusSaved')}
              </span>
            )}
            {saveStatus.kind === 'fail' && (
              <span style={{ color: '#ef4444' }}>
                {t('settings.controlUrl.statusSaveFail', { msg: saveStatus.message })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost text-xs px-4 py-1.5"
              onClick={onTestConnectivity}
              disabled={!urlInput.trim() || probeStatus.kind === 'probing'}
            >
              {t('settings.controlUrl.testButton')}
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs px-4 py-1.5"
              onClick={onSave}
              disabled={saveDisabled}
              title={
                probeStatus.kind === 'ok'
                  ? undefined
                  : t('settings.controlUrl.saveDisabledHint')
              }
            >
              {t('settings.controlUrl.saveButton')}
            </button>
          </div>
        </section>

        {/* ── Card 2: AI Compliance Detection ───────────────────────── */}
        <section
          className="rounded-md"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h2
            className="mb-3"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--display-foreground)',
            }}
          >
            {t('settings.compliance.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--soft-foreground)', marginBottom: 14 }}>
            {t('settings.compliance.description')}
          </p>

          {compliance.kind === 'loading' && (
            <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
              {t('settings.compliance.statusLoading')}
            </p>
          )}

          {compliance.kind === 'error' && (
            <p style={{ fontSize: 13, color: '#ef4444' }}>
              {t('settings.compliance.statusFail', { msg: compliance.message })}
            </p>
          )}

          {compliance.kind === 'not-installed' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--soft-foreground)', marginBottom: 12 }}>
                {t('settings.compliance.notInstalledDesc')}
              </p>
              <div
                className="flex items-center justify-between"
                style={{
                  background: '#000000',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  color: 'var(--primary)',
                }}
              >
                <span>{COMPLIANCE_INSTALL_CMD}</span>
                <button
                  type="button"
                  onClick={onCopyComplianceCmd}
                  className="ml-3"
                  aria-label={t('settings.compliance.copy')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: complianceCmdCopied ? '#4ade80' : 'var(--muted-foreground)',
                    fontSize: 13,
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  {complianceCmdCopied
                    ? t('settings.compliance.copied')
                    : t('settings.compliance.copy')}
                </button>
              </div>
            </div>
          )}

          {compliance.kind === 'ready' && (
            <div>
              {/* Toggle row: label on the left, switch on the right. The
                  switch is a button styled as an iOS-style track+knob so
                  it works without a checkbox-input dependency. */}
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 14, color: 'var(--foreground)' }}>
                  {t('settings.compliance.toggleLabel')}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={compliance.enabled}
                  aria-label={t('settings.compliance.toggleLabel')}
                  disabled={complianceSave.kind === 'saving'}
                  onClick={() => onToggleCompliance(!compliance.enabled)}
                  style={{
                    position: 'relative',
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    border: 'none',
                    background: compliance.enabled ? '#4ade80' : 'var(--border)',
                    cursor: complianceSave.kind === 'saving' ? 'wait' : 'pointer',
                    transition: 'background 0.15s ease',
                    flexShrink: 0,
                    opacity: complianceSave.kind === 'saving' ? 0.7 : 1,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: compliance.enabled ? 22 : 2,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: '#ffffff',
                      transition: 'left 0.15s ease',
                    }}
                  />
                </button>
              </div>

              {/* Status line — current state + last action result. */}
              <div style={{ minHeight: 18, fontSize: 12 }}>
                {complianceSave.kind === 'idle' && (
                  <span style={{ color: 'var(--muted-foreground)' }}>
                    {compliance.enabled
                      ? t('settings.compliance.statusOn')
                      : t('settings.compliance.statusOff')}
                  </span>
                )}
                {complianceSave.kind === 'saving' && (
                  <span style={{ color: 'var(--muted-foreground)' }}>
                    {t('settings.compliance.statusSaving')}
                  </span>
                )}
                {complianceSave.kind === 'applied' && (
                  <span style={{ color: '#4ade80' }}>
                    {t('settings.compliance.statusApplied')}
                  </span>
                )}
                {complianceSave.kind === 'locked' && (
                  <span style={{ color: '#f59e0b' }}>
                    {t('settings.compliance.statusLocked')}
                  </span>
                )}
                {complianceSave.kind === 'fail' && (
                  <span style={{ color: '#ef4444' }}>
                    {t('settings.compliance.statusFail', { msg: complianceSave.message })}
                  </span>
                )}
              </div>

              {/* Sub-toggle: record "allow" (clean-scan) events. Only relevant
                  while scanning is on. Default off (save space). */}
              {compliance.enabled && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--foreground)' }}>
                      {t('settings.compliance.recordAllowLabel')}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={recordAllow}
                      aria-label={t('settings.compliance.recordAllowLabel')}
                      disabled={recordAllowSave.kind === 'saving'}
                      onClick={() => onToggleRecordAllow(!recordAllow)}
                      style={{
                        position: 'relative',
                        width: 44,
                        height: 24,
                        borderRadius: 12,
                        border: 'none',
                        background: recordAllow ? '#4ade80' : 'var(--border)',
                        cursor: recordAllowSave.kind === 'saving' ? 'wait' : 'pointer',
                        transition: 'background 0.15s ease',
                        flexShrink: 0,
                        opacity: recordAllowSave.kind === 'saving' ? 0.7 : 1,
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: recordAllow ? 22 : 2,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: '#ffffff',
                          transition: 'left 0.15s ease',
                        }}
                      />
                    </button>
                  </div>
                  <div style={{ minHeight: 16, fontSize: 11 }}>
                    {recordAllowSave.kind === 'idle' && (
                      <span style={{ color: 'var(--muted-foreground)' }}>
                        {t('settings.compliance.recordAllowHint')}
                      </span>
                    )}
                    {recordAllowSave.kind === 'saving' && (
                      <span style={{ color: 'var(--muted-foreground)' }}>
                        {t('settings.compliance.statusSaving')}
                      </span>
                    )}
                    {recordAllowSave.kind === 'applied' && (
                      <span style={{ color: '#4ade80' }}>{t('settings.compliance.statusApplied')}</span>
                    )}
                    {recordAllowSave.kind === 'locked' && (
                      <span style={{ color: '#f59e0b' }}>{t('settings.compliance.statusLocked')}</span>
                    )}
                    {recordAllowSave.kind === 'fail' && (
                      <span style={{ color: '#ef4444' }}>
                        {t('settings.compliance.statusFail', { msg: recordAllowSave.message })}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Inline unlock branch — only when locked. Mirrors the apps
                  modals' unlock UX: password field + button, retry on success. */}
              {complianceSave.kind === 'locked' && (
                <div style={{ marginTop: 10 }}>
                  <p style={{ fontSize: 12, color: 'var(--soft-foreground)', marginBottom: 8 }}>
                    {t('settings.compliance.unlockPrompt')}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onUnlockAndRetry();
                      }}
                      placeholder={t('settings.compliance.unlockPlaceholder')}
                      autoComplete="current-password"
                      className="flex-1"
                      style={{
                        background: '#000000',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        color: 'var(--foreground)',
                        outline: 'none',
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary text-xs px-4 py-1.5"
                      onClick={onUnlockAndRetry}
                      disabled={!unlockPassword || unlockBusy}
                    >
                      {unlockBusy
                        ? t('settings.compliance.unlockBusy')
                        : t('settings.compliance.unlockButton')}
                    </button>
                  </div>
                  {unlockError && (
                    <p style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>
                      {t('settings.compliance.statusFail', { msg: unlockError })}
                    </p>
                  )}
                </div>
              )}

            </div>
          )}
        </section>

        {/* ── Card 3: Master Password (CLI-only) ────────────────────── */}
        <section
          className="rounded-md"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h2
            className="mb-3"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--display-foreground)',
            }}
          >
            {t('settings.masterPassword.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--soft-foreground)', marginBottom: 14 }}>
            {t('settings.masterPassword.description')}
          </p>
          <div
            className="flex items-center justify-between"
            style={{
              background: '#000000',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '10px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--primary)',
            }}
          >
            <span>{masterPwCmd}</span>
            <button
              type="button"
              onClick={onCopyMasterPwCmd}
              className="ml-3"
              title={t('settings.masterPassword.copyTooltip')}
              aria-label={t('settings.masterPassword.copyTooltip')}
              style={{
                background: 'transparent',
                border: 'none',
                color: copied ? '#4ade80' : 'var(--muted-foreground)',
                fontSize: 13,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              {copied
                ? t('settings.masterPassword.copied')
                : t('settings.masterPassword.copy')}
            </button>
          </div>
        </section>

        {/* ── Card 4: Sign out ──────────────────────────────────────── */}
        <section
          className="rounded-md"
          style={{
            background: 'var(--card)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            padding: 24,
          }}
        >
          <h2
            className="mb-3"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--display-foreground)',
            }}
          >
            {t('settings.signOut.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--soft-foreground)', marginBottom: 14 }}>
            {t('settings.signOut.description')}
          </p>
          {logoutStatus.kind === 'fail' && (
            <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
              {t('settings.signOut.failPrefix', { msg: logoutStatus.message })}
            </p>
          )}
          <button
            type="button"
            onClick={onSignOut}
            disabled={logoutStatus.kind === 'signing-out'}
            className="text-xs px-4 py-1.5 rounded"
            style={{
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              letterSpacing: '0.05em',
              cursor: logoutStatus.kind === 'signing-out' ? 'wait' : 'pointer',
              opacity: logoutStatus.kind === 'signing-out' ? 0.7 : 1,
            }}
          >
            {logoutStatus.kind === 'signing-out'
              ? t('settings.signOut.signingOut')
              : t('settings.signOut.button')}
          </button>
        </section>
      </div>
    </div>
  );
}
