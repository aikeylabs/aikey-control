/**
 * User Login page — /user/login
 *
 * Entry paths:
 *  A. Direct visit — shows CLI login instructions
 *  B. Admin invite — /user/login?invite=<base64url_email>
 *  C. User referral — /user/login?ref=<account_id>
 *
 * The actual auth flow goes through `aikey login` (CLI OAuth device flow).
 * This page guides users to install the CLI and authenticate.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { runtimeConfig } from '@/app/config/runtime';
import { copyText } from '@/shared/utils/clipboard';

const REFERRER_KEY = 'aikey-referrer';
const REFERRER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function decodeBase64URL(encoded: string): string {
  try {
    let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return atob(b64);
  } catch {
    return '';
  }
}

export default function UserLoginPage() {
  const [params] = useSearchParams();
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);

  const inviteEmail = params.get('invite') ? decodeBase64URL(params.get('invite')!) : '';
  const referrerId = params.get('ref') ?? '';

  // Store referrer_id in localStorage (30-day TTL). Side-path: errors ignored.
  if (referrerId) {
    try {
      localStorage.setItem(REFERRER_KEY, JSON.stringify({
        id: referrerId,
        expires: Date.now() + REFERRER_TTL_MS,
      }));
    } catch { /* ignore */ }
  }

  const isInvite = !!(inviteEmail || referrerId);
  const controlUrl = `${window.location.protocol}//${window.location.host}`;
  const cliCommand = inviteEmail
    ? `aikey login --email ${inviteEmail} --control-url ${controlUrl}`
    : `aikey login --control-url ${controlUrl}`;

  return (
    <div
      className="w-full max-w-[480px] rounded-lg relative overflow-hidden"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
        boxShadow: '0 20px 40px -10px rgba(0,0,0,0.8), 0 0 30px rgba(250, 204, 21,0.03)',
      }}
    >
      {/* Top highlight */}
      <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.6 }} />

      {/* Header */}
      <div className="p-8 pb-6 text-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'rgba(255,255,255,0.01)' }}>
        <div className="flex items-center justify-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded flex items-center justify-center"
            style={{ border: '1px solid rgba(250, 204, 21,0.3)', backgroundColor: 'rgba(250, 204, 21,0.1)', boxShadow: '0 0 15px rgba(250, 204, 21,0.15)' }}
          >
            <KeyIcon />
          </div>
          <h1 className="text-xl font-mono font-bold tracking-[0.2em]" style={{ color: 'var(--foreground)' }}>
            AIKEY <span style={{ color: 'var(--primary)' }}>USER</span>
          </h1>
        </div>
        <p className="text-[10px] font-mono tracking-[0.15em]" style={{ color: 'var(--muted-foreground)' }}>
          Member Workspace Access
        </p>
      </div>

      {/* Content */}
      <div className="p-8 space-y-6">

        {/* Invite banner */}
        {inviteEmail && (
          <div
            className="p-4 rounded border flex items-start gap-3"
            style={{ backgroundColor: 'rgba(250, 204, 21,0.05)', borderColor: 'rgba(250, 204, 21,0.2)' }}
          >
            <div
              className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: 'rgba(250, 204, 21,0.1)', border: '1px solid rgba(250, 204, 21,0.3)' }}
            >
              <MailIcon />
            </div>
            <div>
              <div className="text-[10px] font-mono font-bold tracking-wider mb-1" style={{ color: 'var(--muted-foreground)' }}>
                You have been invited
              </div>
              <div className="text-sm font-mono font-bold" style={{ color: 'var(--primary)' }}>
                {inviteEmail}
              </div>
            </div>
          </div>
        )}

        {/* Referral banner */}
        {!inviteEmail && referrerId && (
          <div
            className="p-4 rounded border flex items-start gap-3"
            style={{ backgroundColor: 'rgba(74,222,128,0.05)', borderColor: 'rgba(74,222,128,0.2)' }}
          >
            <div
              className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' }}
            >
              <UserPlusIcon />
            </div>
            <div>
              <div className="text-[10px] font-mono font-bold tracking-wider mb-1" style={{ color: 'var(--muted-foreground)' }}>
                You've been referred
              </div>
              <div className="text-xs font-mono" style={{ color: '#4ade80' }}>
                A team member has shared AiKey with you
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Install CLI */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StepBadge n={1} />
            <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
              Install the CLI
            </h2>
          </div>
          <div
            className="rounded border p-3 flex items-center justify-between gap-2"
            style={{ backgroundColor: '#000', borderColor: 'var(--border)' }}
          >
            <code className="text-xs font-mono truncate" style={{ color: 'var(--primary)' }}>
              curl -fsSL https://github.com/aikeylabs/launch/releases/download/v1.0.1-alpha/local-install.sh | sh -s -- --version v1.0.1-alpha
            </code>
            <CopyBtn
              text="curl -fsSL https://github.com/aikeylabs/launch/releases/download/v1.0.1-alpha/local-install.sh | sh -s -- --version v1.0.1-alpha"
              copied={copiedInstall}
              onCopy={() => { setCopiedInstall(true); setTimeout(() => setCopiedInstall(false), 2000); }}
            />
          </div>
          <a
            href="/user/cli-guide"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono tracking-wider"
            style={{ color: 'var(--primary)' }}
          >
            <BookIcon />
            Full CLI Install Guide
            <ExternalIcon />
          </a>
        </div>

        {/* Step 2: Login */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StepBadge n={2} />
            <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
              Sign in
            </h2>
          </div>
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            {inviteEmail
              ? 'Run this command — your email will be pre-filled in the browser:'
              : 'Run this command in your terminal to authenticate:'}
          </p>
          <div
            className="rounded border p-3 flex items-center justify-between"
            style={{ backgroundColor: '#000', borderColor: 'var(--border)' }}
          >
            <code className="text-sm font-mono font-bold" style={{ color: 'var(--primary)' }}>
              {cliCommand}
            </code>
            <CopyBtn
              text={cliCommand}
              copied={copiedCmd}
              onCopy={() => { setCopiedCmd(true); setTimeout(() => setCopiedCmd(false), 2000); }}
            />
          </div>
        </div>

        {/* Step 3: Browse */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StepBadge n={3} />
            <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
              Open Console
            </h2>
          </div>
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            After login, run{' '}
            <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>aikey web</code>{' '}
            to open the console in your browser.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div
        className="px-8 py-3 flex justify-between items-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--border)' }}
      >
        <span className="text-[10px] font-mono tracking-[0.15em]" style={{ color: 'var(--muted-foreground)' }}>
          AiKey User Access
        </span>
        <a
          href="/user/cli-guide"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono tracking-[0.15em] flex items-center gap-1"
          style={{ color: 'var(--primary)', textDecoration: 'none' }}
        >
          <TerminalIcon />
          CLI Guide
        </a>
      </div>
    </div>
  );
}

/* ── Small components ── */

function StepBadge({ n }: { n: number }) {
  return (
    <div
      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0"
      style={{ backgroundColor: 'rgba(250, 204, 21,0.15)', color: 'var(--primary)', border: '1px solid rgba(250, 204, 21,0.3)' }}
    >
      {n}
    </div>
  );
}

function CopyBtn({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <button
      onClick={() => { copyText(text); onCopy(); }}
      className="text-[10px] font-mono px-2 py-0.5 rounded border flex-shrink-0 ml-2"
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

/* ── Icons ── */
function KeyIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>;
}
function MailIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>;
}
function UserPlusIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: '#4ade80' }}><path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" /></svg>;
}
function BookIcon() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>;
}
function ExternalIcon() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>;
}
function TerminalIcon() {
  return <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>;
}
