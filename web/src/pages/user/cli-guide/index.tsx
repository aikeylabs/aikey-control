/**
 * CLI Guide page — /user/cli-guide
 *
 * Standalone page (no sidebar shell) that opens in a new tab.
 * Implements design `aikeylabs/.superdesign/design_iterations/
 * cli_guide_redesign_1_1.html` (2026-05-22 redesign).
 *
 * Deliberate drops vs the previous version (user-confirmed
 * "完全跟设计稿砍 7 个功能"):
 *   - Install / curl command — page assumes "Installed already"
 *   - `aikey quickstart` wizard hint
 *   - CI / Scripts section (`aikey run -- python eval.py`)
 *   - Daily Commands trimmed from 16 → 6 (no activate/deactivate/
 *     unuse/env/web/web usage/watch/update/delete/import/doctor)
 *   - `aikey import` in BYOK path
 *   - Team Keys placeholder + login-vs-auth-login explainer
 *   - OAuth provider per-provider descriptions
 *
 * Theme: always-dark by design (no var(--…)/theme-token usage).
 * Page bg + colors come from the local PALETTE const below.
 */
import { useEffect, useState } from 'react';
import { copyText } from '@/shared/utils/clipboard';

const PALETTE = {
  bg:      '#18181b',
  surface: '#202024',
  card:    '#27272a',
  muted:   '#3f3f46',
  border:  '#3f3f46',
  // v1 vault skin alignment (2026-05-23): the solid #3f3f46 borders read
  // too "wired-up" against the dark surfaces. Softer rgba borders + a
  // body-level amber atmosphere + card-lift shadow mirror the vault page
  // (see _shared/vault-page-skin.ts). Tokens kept here in PALETTE so they
  // stay co-located with the rest of the page's self-contained styling.
  borderSoft:  'rgba(244, 244, 245, 0.085)',
  borderFaint: 'rgba(244, 244, 245, 0.04)',
  text:    '#f4f4f5',
  subtle:  '#a1a1aa',
  faint:   '#71717a',
  primary: '#facc15',
  success: '#4ade80',
} as const;

const BG_ATMOSPHERE =
  `radial-gradient(circle at 78% -10%, rgba(250, 204, 21, 0.05), transparent 32rem), ` +
  `linear-gradient(180deg, rgba(255, 255, 255, 0.012) 0%, transparent 42rem), ` +
  PALETTE.bg;

const TOPBAR_GRADIENT =
  'linear-gradient(180deg, rgba(36, 36, 40, 0.92), rgba(23, 23, 25, 0.9))';

// Card lift — matches v1 .card box-shadow (inset top white highlight +
// outer 18px deep drop). Lets sections float above the body gradient.
const CARD_LIFT =
  '0 1px 0 rgba(255, 255, 255, 0.025) inset, 0 18px 50px rgba(0, 0, 0, 0.22)';
// Smaller lift for inner sub-cards (PathCard, Command, status aside).
const SUB_CARD_LIFT =
  '0 1px 0 rgba(255, 255, 255, 0.02) inset, 0 6px 20px rgba(0, 0, 0, 0.14)';

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const SANS = '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const TABS = [
  { id: 'setup',          label: 'Check setup' },
  { id: 'paths',          label: 'Choose key path' },
  { id: 'tools',          label: 'Use tools' },
  { id: 'commands',       label: 'Daily commands' },
  { id: 'outbound-proxy', label: 'Outbound proxy' },
  { id: 'trouble',        label: 'Troubleshooting' },
] as const;

function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 8,
        // Was '#09090b' (near-pure black) — too dark against the card's
        // rgba(32,32,36,0.86) surface; the contrast read as "punched-out
        // hole" rather than "recessed code well". Bumping to ~#16161a-ish
        // keeps a clear hierarchy (card > code-block) without the harsh
        // black step.
        background: 'rgba(22, 22, 26, 0.88)',
        boxShadow: 'inset 0 1px 0 rgba(0, 0, 0, 0.25)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 9,
          left: 12,
          color: PALETTE.faint,
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {lang}
      </span>
      <button
        type="button"
        onClick={() => {
          copyText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
        style={{
          position: 'absolute',
          top: 7,
          right: 7,
          minHeight: 25,
          padding: '0 9px',
          border: `1px solid ${copied ? 'rgba(74,222,128,0.4)' : PALETTE.borderSoft}`,
          borderRadius: 6,
          background: PALETTE.card,
          color: copied ? PALETTE.success : PALETTE.subtle,
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre
        style={{
          margin: 0,
          padding: '32px 14px 13px',
          overflowX: 'auto',
          color: PALETTE.primary,
          fontFamily: MONO,
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre',
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function Section({
  id,
  title,
  note,
  step,
  children,
}: {
  id: string;
  title: string;
  note: string;
  step: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 11,
        background: 'rgba(32, 32, 36, 0.86)',
        overflow: 'hidden',
        scrollMarginTop: 80,
        boxShadow: CARD_LIFT,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          padding: '15px 16px',
          borderBottom: `1px solid ${PALETTE.borderFaint}`,
          background: 'rgba(23, 23, 25, 0.2)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: PALETTE.text, fontFamily: MONO, fontSize: 15 }}>{title}</h2>
          <p style={{ margin: '5px 0 0', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.45 }}>{note}</p>
        </div>
        <span
          style={{
            color: PALETTE.faint,
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {step}
        </span>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function PathCard({ title, blurb, code }: { title: string; blurb: string; code: string }) {
  return (
    <article
      style={{
        padding: 12,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 9,
        background: PALETTE.surface,
        boxShadow: SUB_CARD_LIFT,
      }}
    >
      <strong
        style={{
          display: 'block',
          marginBottom: 6,
          color: PALETTE.text,
          fontFamily: MONO,
          fontSize: 12,
        }}
      >
        {title}
      </strong>
      <p style={{ margin: '0 0 10px', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.45 }}>{blurb}</p>
      <CodeBlock code={code} />
    </article>
  );
}

function Command({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div
      style={{
        padding: 10,
        border: `1px solid ${PALETTE.borderSoft}`,
        borderRadius: 9,
        background: PALETTE.surface,
        boxShadow: SUB_CARD_LIFT,
      }}
    >
      <code
        style={{
          display: 'block',
          marginBottom: 4,
          color: PALETTE.primary,
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {cmd}
      </code>
      <span style={{ color: PALETTE.subtle, fontSize: 11, lineHeight: 1.35 }}>{desc}</span>
    </div>
  );
}

export default function CLIGuidePage() {
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Initial state from URL hash if it matches a known tab; else first tab.
    if (typeof window === 'undefined') return TABS[0].id;
    const h = window.location.hash.slice(1);
    return TABS.some((t) => t.id === h) ? h : TABS[0].id;
  });

  // Scroll-spy: update active tab while user scrolls through sections.
  // Uses IntersectionObserver with a viewport band that activates a section
  // when its top is roughly in the upper third of the viewport — feels
  // natural for tab-anchored nav and avoids flicker between sections.
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const sections = TABS.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    if (!sections.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveTab(visible.target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75] },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  // Refs are only used by the tab click handler to scroll smoothly into view.
  // Native anchor jump would work too, but smooth-scroll polishes the feel.
  const handleTabClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setActiveTab(id);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Update URL hash without triggering hashchange-driven reset.
    if (window.history.replaceState) {
      window.history.replaceState(null, '', `#${id}`);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: BG_ATMOSPHERE,
        color: PALETTE.text,
        fontFamily: SANS,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* Responsive rules — inline so this page stays self-contained
          (no shared CSS file pulled into the standalone bundle).         */}
      <style>{`
        @media (max-width: 820px) {
          .cli-guide-intro,
          .cli-guide-path-grid,
          .cli-guide-commands { grid-template-columns: 1fr !important; }
          .cli-guide-topbar {
            align-items: flex-start !important;
            height: auto !important;
            min-height: 56px;
            padding: 14px !important;
            flex-direction: column !important;
          }
          .cli-guide-page {
            width: min(100vw - 24px, 940px) !important;
            padding-top: 26px !important;
          }
        }
      `}</style>

      {/* Topbar */}
      <header
        className="cli-guide-topbar"
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '0 22px',
          borderBottom: '1px solid rgba(250, 204, 21, 0.18)',
          background: TOPBAR_GRADIENT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>
          <span
            style={{
              width: 28,
              height: 28,
              display: 'inline-grid',
              placeItems: 'center',
              borderRadius: 7,
              background: 'rgba(250, 204, 21, 0.085)',
              border: '1px solid rgba(250, 204, 21, 0.22)',
              boxShadow: '0 0 14px rgba(250, 204, 21, 0.07)',
              color: PALETTE.primary,
              fontSize: 14,
            }}
          >
            ⌘
          </span>
          <span>AiKey</span>
          <span style={{ color: PALETTE.faint, fontWeight: 500 }}>/ CLI Guide</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href="#commands"
            onClick={(e) => handleTabClick(e, 'commands')}
            style={topButtonStyle(false)}
          >
            Commands
          </a>
          <a
            href="#setup"
            onClick={(e) => handleTabClick(e, 'setup')}
            style={topButtonStyle(true)}
          >
            Check setup
          </a>
        </div>
      </header>

      <main
        className="cli-guide-page"
        style={{
          width: 'min(940px, calc(100vw - 36px))',
          margin: '0 auto',
          padding: '42px 0 64px',
        }}
      >
        {/* Intro */}
        <section
          className="cli-guide-intro"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 240px',
            gap: 24,
            alignItems: 'end',
            marginBottom: 24,
          }}
        >
          <div>
            <p
              style={{
                margin: '0 0 12px',
                color: PALETTE.primary,
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              Installed already
            </p>
            <h1
              style={{
                margin: 0,
                maxWidth: 720,
                color: PALETTE.text,
                fontFamily: MONO,
                fontSize: 'clamp(30px, 4vw, 42px)',
                lineHeight: 1.08,
                letterSpacing: '-0.04em',
              }}
            >
              Finish setup and start using your AI tools.
            </h1>
            <p style={{ margin: '14px 0 0', maxWidth: 680, color: PALETTE.subtle, fontSize: 14, lineHeight: 1.58 }}>
              Check the local CLI, choose how AiKey should provide keys, then use Claude, Codex, Kimi, scripts, or third-party clients without exposing real provider keys.
            </p>
          </div>
          <aside
            aria-label="Current setup status"
            style={{
              padding: 14,
              border: `1px solid ${PALETTE.borderSoft}`,
              borderRadius: 10,
              background: PALETTE.surface,
              boxShadow: SUB_CARD_LIFT,
            }}
          >
            <div
              style={{
                color: PALETTE.subtle,
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Recommended first command
            </div>
            <div style={{ marginTop: 8, color: PALETTE.success, fontFamily: MONO, fontSize: 18, fontWeight: 700 }}>
              aikey doctor
            </div>
          </aside>
        </section>

        {/* Tabs */}
        <nav
          aria-label="Page sections"
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 18,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
        >
          {TABS.map((t) => {
            const active = t.id === activeTab;
            return (
              <a
                key={t.id}
                href={`#${t.id}`}
                onClick={(e) => handleTabClick(e, t.id)}
                style={{
                  flex: '0 0 auto',
                  padding: '8px 11px',
                  border: `1px solid ${active ? 'rgba(250,204,21,0.48)' : PALETTE.borderSoft}`,
                  borderRadius: 999,
                  color: active ? PALETTE.primary : PALETTE.subtle,
                  background: active ? 'rgba(250,204,21,0.08)' : PALETTE.surface,
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                {t.label}
              </a>
            );
          })}
        </nav>

        {/* Stack */}
        <div style={{ display: 'grid', gap: 14 }}>
          <Section id="setup" title="Check the local setup" step="Step 1" note="Confirm PATH, proxy, shell hook readiness, and vault state.">
            <CodeBlock code="aikey doctor" />
          </Section>

          <Section id="paths" title="Choose a key path" step="Step 2" note="Pick the one that matches how you want to use AiKey today.">
            <div
              className="cli-guide-path-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 10,
              }}
            >
              <PathCard
                title="Personal API key"
                blurb="Add your own provider key to the local encrypted vault."
                code={'aikey add my-key --provider anthropic\naikey use my-key'}
              />
              <PathCard
                title="Provider OAuth"
                blurb="Use Claude, ChatGPT, or Kimi account access without an API key."
                code={'aikey auth login claude\naikey auth login codex\naikey auth login kimi_code'}
              />
              <PathCard
                title="Team key"
                blurb="Log in to your team's control service and select an assigned key."
                code={'aikey login --email you@example.com --control-url http://server:3000\naikey use'}
              />
            </div>
          </Section>

          <Section id="tools" title="Use your tools" step="Step 3" note="Install the hook once, open a new terminal, then run your normal tools.">
            <CodeBlock code={'aikey hook install\n# open a NEW terminal, then:\nclaude\ncodex\nkimi'} />
          </Section>

          <Section id="commands" title="Daily commands" step="Reference" note="Small reference for common operations.">
            <div
              className="cli-guide-commands"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              <Command cmd="aikey list" desc="View all keys and OAuth accounts." />
              <Command cmd="aikey use" desc="Switch the global active key." />
              <Command cmd="aikey route" desc="Show base URL and API key for clients." />
              <Command cmd="aikey whoami" desc="Show identity and active key." />
              <Command cmd="aikey web vault" desc="Open the local Vault page." />
              <Command cmd="aikey test --all" desc="Test every key in the vault." />
              <Command cmd="aikey env" desc="Inspect proxy.env + active.env." />
              <Command cmd="aikey env set --" desc="Merge-write proxy.env (see Outbound proxy)." />
              <Command
                cmd="aikey service <action> <name>"
                desc="Actions: start, stop, restart. Names: trust-local, web, proxy."
              />
            </div>
          </Section>

          <Section
            id="outbound-proxy"
            title="Outbound proxy (VPN / corp network)"
            step="Optional"
            note="If GitHub or providers are unreachable without a VPN, point aikey-proxy at your local SOCKS / HTTP proxy via proxy.env."
          >
            <p style={{ margin: '0 0 10px', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.5 }}>
              Two forms are supported. Pick whichever you find easier to remember.
            </p>
            <p style={{ margin: '0 0 6px', color: PALETTE.text, fontSize: 12, fontFamily: MONO }}>
              A. Space-separated KEY=VALUE pairs (simplest):
            </p>
            <CodeBlock
              code={
                'aikey env set -- http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890\n' +
                'aikey proxy restart   # required after editing proxy.env'
              }
            />
            <p style={{ margin: '14px 0 6px', color: PALETTE.text, fontSize: 12, fontFamily: MONO }}>
              B. Paste a shell-export snippet — wrap the whole thing in single quotes:
            </p>
            <CodeBlock
              code={
                "aikey env set -- 'export https_proxy=http://127.0.0.1:7890; export http_proxy=http://127.0.0.1:7890; export all_proxy=socks5://127.0.0.1:7890'\n" +
                'aikey proxy restart'
              }
            />
            <div
              style={{
                marginTop: 14,
                padding: '10px 12px',
                border: '1px solid rgba(245, 158, 11, 0.28)',
                borderRadius: 7,
                background: 'rgba(245, 158, 11, 0.08)',
                boxShadow: 'inset 3px 0 0 rgba(245, 158, 11, 0.6)',
                color: PALETTE.text,
                fontSize: 12,
                lineHeight: 1.55,
              }}
            >
              ⚠️ <strong>Common pitfall:</strong> without the surrounding{' '}
              <code style={{ fontFamily: MONO, fontSize: 11.5 }}>&apos;...&apos;</code>{' '}
              your shell (zsh/bash) reads every <code style={{ fontFamily: MONO, fontSize: 11.5 }}>;</code>{' '}
              as a command separator. Only the first <code style={{ fontFamily: MONO, fontSize: 11.5 }}>export</code>{' '}
              reaches <code style={{ fontFamily: MONO, fontSize: 11.5 }}>aikey</code>; the rest run inside your
              current shell and never touch <code style={{ fontFamily: MONO, fontSize: 11.5 }}>proxy.env</code>.
              Diagnostic: run <code style={{ fontFamily: MONO, fontSize: 11.5 }}>aikey env</code> afterward —
              if the missing keys show up under <em>&quot;Shell env (inherited by proxy)&quot;</em> instead of{' '}
              <em>&quot;Proxy env&quot;</em>, that&apos;s what happened.
            </div>
            <p style={{ margin: '14px 0 0', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.55 }}>
              <code style={{ fontFamily: MONO, fontSize: 11.5 }}>aikey env set</code> only writes{' '}
              <code style={{ fontFamily: MONO, fontSize: 11.5 }}>~/.aikey/proxy.env</code> — it never touches{' '}
              <code style={{ fontFamily: MONO, fontSize: 11.5 }}>active.env</code>. It merges into the existing
              file (no full replace) and accepts plain{' '}
              <code style={{ fontFamily: MONO, fontSize: 11.5 }}>KEY=VAL</code> pairs, optional{' '}
              <code style={{ fontFamily: MONO, fontSize: 11.5 }}>export</code> prefix, and semicolon-separated
              input <strong>inside a quoted string</strong>.
            </p>
          </Section>

          <Section id="trouble" title="Troubleshooting" step="Fix" note="Use these when proxy, hook, vault, or sync state looks wrong.">
            <CodeBlock code={'aikey doctor\naikey logs\naikey proxy restart\naikey key sync'} />
          </Section>
        </div>

        {/* Footer */}
        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 20,
            color: PALETTE.faint,
            fontFamily: MONO,
            fontSize: 11,
          }}
        >
          <span>AiKey CLI Guide</span>
          <span>
            <a
              href="https://github.com/aikeylabs/launch/issues"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: PALETTE.faint, textDecoration: 'none' }}
            >
              Report an issue
            </a>
            <span style={{ color: PALETTE.muted }}> · </span>
            <a
              href="https://aikeylabs.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: PALETTE.faint, textDecoration: 'none' }}
            >
              Main site
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}

function topButtonStyle(primary: boolean): React.CSSProperties {
  return {
    minHeight: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 12px',
    border: `1px solid ${primary ? PALETTE.primary : PALETTE.borderSoft}`,
    borderRadius: 6,
    background: primary ? PALETTE.primary : PALETTE.surface,
    color: primary ? PALETTE.bg : PALETTE.text,
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 700,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  };
}
