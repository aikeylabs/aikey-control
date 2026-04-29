/**
 * Session Expired page — /user/session-expired
 *
 * Shown when the user's JWT token expires or is invalidated.
 * Guides the user with two recovery paths:
 *   1. `aikey web`  — if only the web session expired (CLI token still valid)
 *   2. `aikey login`   — if the CLI login token itself has expired
 */
import { useState } from 'react';
import { runtimeConfig } from '@/app/config/runtime';
import { copyText } from '@/shared/utils/clipboard';

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

function CommandBlock({ command, label }: { command: string; label: string }) {
  return (
    <div>
      <p className="text-xs font-mono mb-2" style={{ color: 'var(--muted-foreground)' }}>
        {label}
      </p>
      <div
        className="rounded border p-4 flex items-center justify-between gap-3"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'var(--border)' }}
      >
        <code className="text-sm font-mono font-bold" style={{ color: 'var(--primary)' }}>
          {command}
        </code>
        <CopyButton text={command} />
      </div>
    </div>
  );
}

export default function SessionExpiredPage() {
  return (
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
          User Console — Session Expired
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
      </div>

      <h2 className="text-center text-sm font-mono font-bold mb-3" style={{ color: 'var(--foreground)' }}>
        Your session has expired
      </h2>

      <p className="text-center text-xs font-mono mb-8" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
        Run one of the following commands in your terminal to continue:
      </p>

      {/* Two recovery paths */}
      <div className="space-y-4 mb-8">
        <CommandBlock
          command="aikey web"
          label="If only this page expired (most common):"
        />
        <CommandBlock
          command="aikey login"
          label="If the above doesn't work (login token expired):"
        />
      </div>

      {/* Help text */}
      <div className="space-y-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
        <p>
          <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
            aikey web
          </code>{' '}
          refreshes the web session token and re-opens this console.
        </p>
        <p>
          <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
            aikey login
          </code>{' '}
          re-authenticates your account when the CLI login has fully expired.
        </p>
      </div>
    </div>
  );
}
