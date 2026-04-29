/**
 * Master-not-available page — renders on /master/* in Personal (user-only) builds.
 *
 * Why this file exists:
 *   The full build registers /master/login, /master/dashboard, /master/orgs/...
 *   Those routes are absent in the user-only bundle (buildMasterRoutes() → []).
 *   `aikey master` on a Personal install still opens the browser at
 *   http://127.0.0.1:8090/master/dashboard — without this catch-all route the
 *   SPA hits react-router's "Unexpected Application Error! 404 Not Found".
 *   We register a single `/master/*` route in user-only mode that renders this
 *   page so the user gets a clear upgrade-path explanation instead.
 *
 * Why on the web layer (not CLI):
 *   CLI behaviour stays identical across editions — one less branch in the
 *   binary, and the guidance is shown in the same surface (browser) the user
 *   was already directed to. CLI upgrade to re-route on edition would break
 *   `aikey master --url https://team.server/` pointing at a remote Team host.
 */
import { useLocation, Link } from 'react-router-dom';
import { useState } from 'react';
import { runtimeConfig } from '@/app/config/runtime';
import { copyText } from '@/shared/utils/clipboard';

// Why inlined here (not in runtime config): this is the only page that uses
// the address, and the value is stable — pulling it through runtime.ts would
// add surface area for no benefit. Swap here when the inbox changes.
const TEAM_CONTACT_EMAIL = 'invite@aikeylabs.com';

function CopyButton({ text }: { text: string }) {
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
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export default function MasterNotAvailablePage() {
  const location = useLocation();
  // Strip leading slash for cleaner display: "/master/dashboard" → "master/dashboard"
  const requestedPath = location.pathname.replace(/^\//, '');

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <div
        className="w-full max-w-xl rounded border p-8"
        style={{
          backgroundColor: 'var(--card)',
          borderColor: 'var(--border)',
          boxShadow: '0 0 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <span
            className="font-mono font-bold tracking-widest text-xl mb-2"
            style={{ color: 'var(--foreground)' }}
          >
            {runtimeConfig.branding.appName}
          </span>
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
            Admin Console — Team Edition Required
          </p>
        </div>

        {/* Separator (amber accent for info-level, not destructive red) */}
        <div
          className="w-full h-px mb-8"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(250, 204, 21,0.7), transparent)',
            opacity: 0.6,
          }}
        />

        {/* Warning icon (amber circle) */}
        <div className="flex justify-center mb-6">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: 'rgba(250, 204, 21,0.1)',
              border: '1px solid rgba(250, 204, 21,0.35)',
            }}
          >
            <svg className="w-7 h-7" fill="none" stroke="#ca8a04" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <h2 className="text-center text-sm font-mono font-bold mb-3" style={{ color: 'var(--foreground)' }}>
          This page requires the Team Edition
        </h2>

        {/* Body copy — kept deliberately short (one line). */}
        <p className="text-center text-xs font-mono mb-6" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          <code
            className="px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
          >
            /{requestedPath}
          </code>{' '}
          is part of the Admin Console, available only in the Team Edition.
        </p>

        {/* Contact CTA — email is the primary upgrade path. */}
        <div className="mb-8">
          <p className="text-xs font-mono mb-3 text-center" style={{ color: 'var(--muted-foreground)' }}>
            Request access:
          </p>
          <div
            className="rounded border p-4 flex items-center justify-between gap-3"
            style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'var(--border)' }}
          >
            <a
              href={`mailto:${TEAM_CONTACT_EMAIL}?subject=${encodeURIComponent(
                'Team Edition Access Request',
              )}`}
              className="text-sm font-mono font-bold underline-offset-2 hover:underline truncate"
              style={{ color: 'var(--primary)' }}
            >
              {TEAM_CONTACT_EMAIL}
            </a>
            <CopyButton text={TEAM_CONTACT_EMAIL} />
          </div>
        </div>

        {/* Fallback: link back to the user console */}
        <div className="text-center">
          <Link
            to="/user/overview"
            className="inline-block px-4 py-2 rounded border text-xs font-mono transition-colors"
            style={{
              color: 'var(--primary)',
              borderColor: 'var(--border)',
              backgroundColor: 'transparent',
            }}
          >
            → Return to User Console
          </Link>
        </div>
      </div>
    </div>
  );
}
