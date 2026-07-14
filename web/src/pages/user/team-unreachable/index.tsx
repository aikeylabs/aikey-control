/**
 * Team Server Unreachable — in-shell degrade page.
 *
 * Rendered inside UserShell's content <Outlet /> (the sidebar/menu stays put)
 * when the Personal composing gateway can't reach the team server (B) for a
 * forwarded team page. The gateway serves the LOCAL app shell at the original
 * team URL and injects `window.__AIKEY_TEAM_DOWN__`; the Personal router's
 * catch-all renders this component so the user keeps the menu and can click
 * back to any healthy local page (design §187, refined 2026-07-04 —
 * "带菜单的 404/500"; gateway: serveTeamDownShell in
 * aikey-trial-server/internal/gateway/proxy.go).
 *
 * A plain refresh retries the team page: the URL is unchanged, so the gateway
 * forwards again the moment B recovers.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runtimeConfig } from '@/app/config/runtime';
import { copyText } from '@/shared/utils/clipboard';

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        copyText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="text-[10px] font-mono px-2 py-1 rounded border shrink-0"
      style={{
        color: copied ? '#4ade80' : 'var(--muted-foreground)',
        borderColor: copied ? 'rgba(74,222,128,0.3)' : 'var(--border)',
        backgroundColor: 'transparent',
      }}
    >
      {copied ? t('sessionExpired.copyButtonCopied') : t('sessionExpired.copyButton')}
    </button>
  );
}

// Copy variants keyed by the gateway's injected error code. The gateway serves
// this same shell for three distinct not-ready conditions (design 2026-07):
//   TEAM_UPSTREAM_UNREACHABLE — logged in, but the team server (B) is down.
//   TEAM_NOT_LOGGED_IN        — no team binding; user must `aikey login`.
//   LOCAL_VAULT_UNREADABLE    — local vault read failed (transient, e.g. lock).
// Each renders a code-specific heading / instruction / recovery command instead
// of the old silent redirect to /user/overview. Unknown codes fall back to the
// upstream-unreachable variant so the page is always meaningful.
const KNOWN_CODES = ['TEAM_UPSTREAM_UNREACHABLE', 'TEAM_NOT_LOGGED_IN', 'LOCAL_VAULT_UNREADABLE'];

export default function TeamUnreachablePage() {
  const { t } = useTranslation();
  // Error code carried by the gateway's injected flag (falls back to the
  // canonical code when absent so the page is still meaningful if opened
  // directly). Kept read-only — this is a display signal, not app config.
  const code = window.__AIKEY_TEAM_DOWN__?.code ?? 'TEAM_UPSTREAM_UNREACHABLE';
  const variant = KNOWN_CODES.includes(code) ? code : 'TEAM_UPSTREAM_UNREACHABLE';
  const vt = (key: string) => t(`teamUnreachable.variants.${variant}.${key}`);
  const setUrlCmd = vt('command');

  return (
    <div className="w-full max-w-xl mx-auto py-10">
      <div
        className="w-full rounded border p-8"
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--border)',
          boxShadow: '0 0 40px rgba(0,0,0,0.6)',
        }}
      >
        <div className="flex flex-col items-center mb-8">
          <span
            className="font-mono font-bold tracking-widest text-xl mb-2"
            style={{ color: 'var(--foreground)' }}
          >
            {runtimeConfig.branding.appName}
          </span>
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
            {vt('consoleSubheading')}
          </p>
        </div>

        <div
          className="w-full h-px mb-8"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--destructive), transparent)',
            opacity: 0.3,
          }}
        />

        {/* Status icon */}
        <div className="flex justify-center mb-6">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <svg className="w-7 h-7" fill="none" stroke="#f87171" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
              />
            </svg>
          </div>
        </div>

        <h2 className="text-center text-sm font-mono font-bold mb-3" style={{ color: 'var(--foreground)' }}>
          {vt('heading')}
        </h2>

        <p
          className="text-center text-xs font-mono mb-8"
          style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}
        >
          {vt('instruction')}
        </p>

        {/* Recovery command */}
        <div className="mb-6">
          <p className="text-xs font-mono mb-2" style={{ color: 'var(--muted-foreground)' }}>
            {vt('commandLabel')}
          </p>
          <div
            className="rounded border p-4 flex items-center justify-between gap-3"
            style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'var(--border)' }}
          >
            <code className="text-sm font-mono font-bold break-all" style={{ color: 'var(--primary)' }}>
              {setUrlCmd}
            </code>
            <CopyButton text={setUrlCmd} />
          </div>
        </div>

        {/* Retry + error code */}
        <div className="flex items-center justify-between gap-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
          <span>
            {t('teamUnreachable.errorCodeLabel')}{' '}
            <code
              className="px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
            >
              {code}
            </code>
          </span>
          <button
            onClick={() => window.location.reload()}
            className="font-mono px-3 py-1.5 rounded border shrink-0"
            style={{ color: 'var(--primary)', borderColor: 'var(--border)', backgroundColor: 'transparent' }}
          >
            {t('teamUnreachable.retryButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
