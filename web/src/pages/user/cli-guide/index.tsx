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
import { Trans, useTranslation } from 'react-i18next';
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
  { id: 'setup',          labelKey: 'cliGuide.tabSetup' },
  { id: 'paths',          labelKey: 'cliGuide.tabPaths' },
  { id: 'tools',          labelKey: 'cliGuide.tabTools' },
  { id: 'commands',       labelKey: 'cliGuide.tabCommands' },
  { id: 'outbound-proxy', labelKey: 'cliGuide.tabOutboundProxy' },
  { id: 'trouble',        labelKey: 'cliGuide.tabTrouble' },
] as const;

function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const { t } = useTranslation();
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
        {copied ? t('cliGuide.copied') : t('cliGuide.copy')}
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
  const { t } = useTranslation();
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
          <span style={{ color: PALETTE.faint, fontWeight: 500 }}>{t('cliGuide.brandSubtitle')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href="#commands"
            onClick={(e) => handleTabClick(e, 'commands')}
            style={topButtonStyle(false)}
          >
            {t('cliGuide.topbarCommands')}
          </a>
          <a
            href="#setup"
            onClick={(e) => handleTabClick(e, 'setup')}
            style={topButtonStyle(true)}
          >
            {t('cliGuide.topbarCheckSetup')}
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
              {t('cliGuide.introBadge')}
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
              {t('cliGuide.introTitle')}
            </h1>
            <p style={{ margin: '14px 0 0', maxWidth: 680, color: PALETTE.subtle, fontSize: 14, lineHeight: 1.58 }}>
              {t('cliGuide.introDesc')}
            </p>
          </div>
          <aside
            aria-label={t('cliGuide.statusAriaLabel')}
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
              {t('cliGuide.recommendedFirstCommand')}
            </div>
            <div style={{ marginTop: 8, color: PALETTE.success, fontFamily: MONO, fontSize: 18, fontWeight: 700 }}>
              aikey doctor
            </div>
          </aside>
        </section>

        {/* Tabs */}
        <nav
          aria-label={t('cliGuide.sectionsNavAriaLabel')}
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 18,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
        >
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <a
                key={tab.id}
                href={`#${tab.id}`}
                onClick={(e) => handleTabClick(e, tab.id)}
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
                {t(tab.labelKey)}
              </a>
            );
          })}
        </nav>

        {/* Stack */}
        <div style={{ display: 'grid', gap: 14 }}>
          <Section id="setup" title={t('cliGuide.setupTitle')} step={t('cliGuide.stepStep1')} note={t('cliGuide.setupNote')}>
            <CodeBlock code="aikey doctor" />
          </Section>

          <Section id="paths" title={t('cliGuide.pathsTitle')} step={t('cliGuide.stepStep2')} note={t('cliGuide.pathsNote')}>
            <div
              className="cli-guide-path-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 10,
              }}
            >
              <PathCard
                title={t('cliGuide.pathPersonalTitle')}
                blurb={t('cliGuide.pathPersonalBlurb')}
                code={'aikey add my-key --provider anthropic\naikey use my-key'}
              />
              <PathCard
                title={t('cliGuide.pathOAuthTitle')}
                blurb={t('cliGuide.pathOAuthBlurb')}
                code={'aikey auth login claude\naikey auth login codex\naikey auth login kimi_code'}
              />
              <PathCard
                title={t('cliGuide.pathTeamTitle')}
                blurb={t('cliGuide.pathTeamBlurb')}
                code={'aikey login --email you@example.com --control-url http://server:3000\naikey use'}
              />
            </div>
          </Section>

          <Section id="tools" title={t('cliGuide.toolsTitle')} step={t('cliGuide.stepStep3')} note={t('cliGuide.toolsNote')}>
            <CodeBlock code={'aikey hook install\n# open a NEW terminal, then:\nclaude\ncodex\nkimi'} />
          </Section>

          <Section id="commands" title={t('cliGuide.commandsTitle')} step={t('cliGuide.stepReference')} note={t('cliGuide.commandsNote')}>
            <div
              className="cli-guide-commands"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              <Command cmd="aikey list" desc={t('cliGuide.cmdListDesc')} />
              <Command cmd="aikey use" desc={t('cliGuide.cmdUseDesc')} />
              <Command cmd="aikey route" desc={t('cliGuide.cmdRouteDesc')} />
              <Command cmd="aikey whoami" desc={t('cliGuide.cmdWhoamiDesc')} />
              <Command cmd="aikey web vault" desc={t('cliGuide.cmdWebVaultDesc')} />
              <Command cmd="aikey test --all" desc={t('cliGuide.cmdTestDesc')} />
              <Command cmd="aikey env" desc={t('cliGuide.cmdEnvDesc')} />
              <Command cmd="aikey env set --" desc={t('cliGuide.cmdEnvSetDesc')} />
              <Command
                cmd="aikey service <action> <name>"
                desc={t('cliGuide.cmdServiceDesc')}
              />
            </div>
          </Section>

          <Section
            id="outbound-proxy"
            title={t('cliGuide.outboundTitle')}
            step={t('cliGuide.stepOptional')}
            note={t('cliGuide.outboundNote')}
          >
            <p style={{ margin: '0 0 10px', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.5 }}>
              {t('cliGuide.outboundTwoForms')}
            </p>
            <p style={{ margin: '0 0 6px', color: PALETTE.text, fontSize: 12, fontFamily: MONO }}>
              {t('cliGuide.outboundFormA')}
            </p>
            <CodeBlock
              code={
                'aikey env set -- http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890\n' +
                'aikey proxy restart   # required after editing proxy.env'
              }
            />
            <p style={{ margin: '14px 0 6px', color: PALETTE.text, fontSize: 12, fontFamily: MONO }}>
              {t('cliGuide.outboundFormB')}
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
              ⚠️ <strong>{t('cliGuide.outboundPitfallLabel')}</strong>{' '}
              <Trans
                i18nKey="cliGuide.outboundPitfallBody"
                components={[
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <em />,
                  <em />,
                ]}
              />
            </div>
            <p style={{ margin: '14px 0 0', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.55 }}>
              <Trans
                i18nKey="cliGuide.outboundFootnote"
                components={[
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <code style={{ fontFamily: MONO, fontSize: 11.5 }} />,
                  <strong />,
                ]}
              />
            </p>
          </Section>

          <Section id="trouble" title={t('cliGuide.troubleTitle')} step={t('cliGuide.stepFix')} note={t('cliGuide.troubleNote')}>
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
          <span>{t('cliGuide.footerTitle')}</span>
          <span>
            <a
              href="https://github.com/aikeylabs/launch/issues"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: PALETTE.faint, textDecoration: 'none' }}
            >
              {t('cliGuide.footerReportIssue')}
            </a>
            <span style={{ color: PALETTE.muted }}> · </span>
            <a
              href="https://aikeylabs.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: PALETTE.faint, textDecoration: 'none' }}
            >
              {t('cliGuide.footerMainSite')}
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
