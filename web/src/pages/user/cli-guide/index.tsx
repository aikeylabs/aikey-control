/**
 * CLI Guide page — /user/cli-guide
 *
 * Standalone page (no sidebar shell) that opens in a new tab.
 * Shows install instructions + quickstart usage guide.
 */
import { useState } from 'react';
import { runtimeConfig } from '@/app/config/runtime';
import { copyText } from '@/shared/utils/clipboard';

function CopyBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="rounded border relative group"
      style={{ backgroundColor: '#000', borderColor: 'var(--border)' }}
    >
      {lang && (
        <div className="absolute top-2 left-3 text-[9px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}>
          {lang}
        </div>
      )}
      <button
        onClick={() => { copyText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-2 right-2 text-[10px] font-mono px-2 py-0.5 rounded border opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          color: copied ? '#4ade80' : 'var(--muted-foreground)',
          borderColor: copied ? 'rgba(74,222,128,0.3)' : 'var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre className="p-4 pt-6 overflow-x-auto text-sm font-mono leading-relaxed" style={{ color: 'var(--primary)' }}>
        {code}
      </pre>
    </div>
  );
}

function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-mono font-bold tracking-wider flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function CLIGuidePage() {
  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(250, 204, 21,0.03) 0%, transparent 40%)',
      }}
    >
      {/* Header bar */}
      <header
        className="sticky top-0 z-10 h-14 flex items-center justify-between px-6"
        style={{
          backgroundColor: 'var(--card)',
          borderBottom: '1px solid var(--border)',
          boxShadow: '0 1px 10px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-center gap-2 font-mono font-bold tracking-widest" style={{ color: 'var(--foreground)' }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
          <span>{runtimeConfig.branding.appName}</span>
          <span className="text-xs font-normal" style={{ color: 'var(--muted-foreground)' }}>/ CLI Guide</span>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">

        {/* Hero */}
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-mono font-bold tracking-wider" style={{ color: 'var(--foreground)' }}>
            AiKey <span style={{ color: 'var(--primary)' }}>Quickstart</span>
          </h1>
          <p className="text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
            Install the CLI, log in, and start using AI tools in under 2 minutes.
          </p>
        </div>

        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.2 }} />

        {/* Install */}
        <Section
          title="Install"
          icon={<DownloadIcon />}
        >
          <CopyBlock code="curl -fsSL https://github.com/aikeylabs/launch/releases/download/v1.0.1-alpha/local-install.sh | sh -s -- --version v1.0.1-alpha" lang="bash" />
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            Supports macOS, Linux, and Windows (WSL). The installer places the <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--muted)' }}>aikey</code> binary in <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--muted)' }}>~/.aikey/bin</code>.
          </p>
        </Section>

        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* Scenario 1: Personal Key (BYOK) */}
        <Section
          title="Use Your Own API Key"
          icon={<KeyIcon />}
        >
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            Add your API key to the local encrypted vault:
          </p>
          <CopyBlock code="aikey add my-key" lang="bash" />
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            Activate it for the current session:
          </p>
          <CopyBlock code="aikey use my-key" lang="bash" />
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            Then use your usual tools — the local proxy handles key injection:
          </p>
          <CopyBlock code={`claude              # Anthropic Claude CLI\nopenai              # OpenAI CLI\ncursor              # IDE / any SDK tool`} lang="bash" />
          <div
            className="rounded border p-3 text-xs font-mono flex items-start gap-2"
            style={{ backgroundColor: 'rgba(74,222,128,0.05)', borderColor: 'rgba(74,222,128,0.2)', color: '#4ade80' }}
          >
            <CheckIcon />
            <span>Keys are routed through a local proxy. Real credentials are never exposed.</span>
          </div>
        </Section>

        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* Scenario 2: Team Keys */}
        <Section
          title="Use Team Keys"
          icon={<UsersIcon />}
        >
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            Your team admin has created keys in the control panel. Log in and pick your assigned key.
          </p>
          <CopyBlock code={`aikey login          # Log in via browser authorization\naikey use            # Pick a key (arrow keys + Enter)`} lang="bash" />
        </Section>

        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* Scenario 3: CI */}
        <Section
          title="CI / Scripts (Non-Interactive)"
          icon={<TerminalIcon />}
        >
          <p className="text-xs font-mono" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            No shell hook needed. Works with GitHub Actions, cron jobs, etc.
          </p>
          <CopyBlock code="aikey run -- python eval.py" lang="bash" />
        </Section>

        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* Cheatsheet */}
        <Section
          title="Daily Commands"
          icon={<ListIcon />}
        >
          <CopyBlock code={`aikey list              # View all keys and secrets\naikey use               # Switch active key\naikey whoami            # Current identity + active key\naikey doctor            # One-click health check`} lang="bash" />
        </Section>

        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* Troubleshooting */}
        <Section
          title="Troubleshooting"
          icon={<WrenchIcon />}
        >
          <CopyBlock code={`aikey doctor            # Auto-check common issues\naikey proxy restart     # Restart if proxy is stuck\naikey key sync          # Force sync key status`} lang="bash" />
        </Section>

        {/* Footer */}
        <div className="pt-6 text-center text-[11px] font-mono" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}>
          {runtimeConfig.branding.appName} — CLI Guide
        </div>
      </div>
    </div>
  );
}

/* ── Icons ── */
function DownloadIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>;
}
function UsersIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>;
}
function KeyIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>;
}
function TerminalIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>;
}
function ListIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>;
}
function WrenchIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--primary)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.81 5.81a2.121 2.121 0 01-3-3l5.81-5.81M18.36 8.64a4.5 4.5 0 00-6.36 0l-3.53 3.53a4.5 4.5 0 000 6.36l.53.53a4.5 4.5 0 006.36 0l3.53-3.53a4.5 4.5 0 000-6.36l-.53-.53z" /></svg>;
}
function CheckIcon() {
  return <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
