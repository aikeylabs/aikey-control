/**
 * CLI Guide page — /user/cli-guide
 *
 * Standalone page (no sidebar shell) that opens in a new tab.
 *
 * 2026-08-18 redesign — implements superdesign draft 6bb3ba9a (user-approved).
 * TWO things changed together and both were asked for:
 *   1. Visual system now matches /user/app-guide: AK-chip topbar with a
 *      language toggle, sticky section strip, centred hero, numbered steps.
 *      (A first pass kept the 2026-05-22 skeleton and swapped only content —
 *      that was a deviation from the approved design and is what this file
 *      corrects.)
 *   2. Content is the EMPLOYEE handbook sourced from the public delivery docs
 *      (workflow/Docs/enterprise-delivery — 快速开始 §4 + 企业接入指南 employee
 *      forms + 术语解释 employee subset).
 *
 * Every information dimension of the 2026-05-22 page is retained: key paths →
 * Get a key, hook → the Install-hook strip, outbound proxy → Network (its two
 * forms and the NO_PROXY pitfall are carried over verbatim), commands,
 * troubleshooting.
 *
 * Theme: always-dark by design (no var(--…)/theme-token usage). Page bg +
 * colors come from the local PALETTE const below, matching app-guide.
 */
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { copyText } from '@/shared/utils/clipboard';
import { LanguageSwitcher } from '@/shared/components/LanguageSwitcher';

const PALETTE = {
  bg:      '#18181b',
  surface: '#202024',
  card:    '#27272a',
  muted:   '#3f3f46',
  border:  '#3f3f46',
  borderSoft:  'rgba(244, 244, 245, 0.085)',
  borderFaint: 'rgba(244, 244, 245, 0.04)',
  text:    '#f4f4f5',
  display: '#c8c4ba',
  subtle:  '#a1a1aa',
  faint:   '#71717a',
  primary: '#facc15',
  primaryDim: '#ca8a04',
  success: '#4ade80',
} as const;

const BG_ATMOSPHERE =
  `radial-gradient(circle at 78% -10%, rgba(250, 204, 21, 0.05), transparent 32rem), ` +
  `linear-gradient(180deg, rgba(255, 255, 255, 0.012) 0%, transparent 42rem), ` +
  PALETTE.bg;

const CARD_LIFT =
  '0 1px 0 rgba(255, 255, 255, 0.025) inset, 0 18px 50px rgba(0, 0, 0, 0.22)';
const SUB_CARD_LIFT =
  '0 1px 0 rgba(255, 255, 255, 0.02) inset, 0 6px 20px rgba(0, 0, 0, 0.14)';

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const SANS = '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DISPLAY = '"Space Grotesk", "Inter", ui-sans-serif, system-ui, sans-serif';

// Section order == tab order == the numbers rendered beside each section.
const TABS = [
  { id: 'setup',        no: '01', labelKey: 'cliGuide.tabSetup' },
  { id: 'how-it-works', no: '02', labelKey: 'cliGuide.tabHowItWorks' },
  { id: 'get-a-key',    no: '03', labelKey: 'cliGuide.tabGetKey' },
  { id: 'daily-use',    no: '04', labelKey: 'cliGuide.tabDailyUse' },
  { id: 'commands',     no: '05', labelKey: 'cliGuide.tabCommands' },
  { id: 'network',      no: '06', labelKey: 'cliGuide.tabNetwork' },
  { id: 'glossary',     no: '07', labelKey: 'cliGuide.tabGlossary' },
  { id: 'trouble',      no: '08', labelKey: 'cliGuide.tabTrouble' },
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
        background: 'rgba(22, 22, 26, 0.88)',
        boxShadow: 'inset 0 1px 0 rgba(0, 0, 0, 0.25)',
      }}
    >
      <span
        style={{
          position: 'absolute', top: 9, left: 12,
          color: PALETTE.faint, fontFamily: MONO, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase',
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
          position: 'absolute', top: 7, right: 7, minHeight: 25, padding: '0 9px',
          border: `1px solid ${copied ? 'rgba(74,222,128,0.4)' : PALETTE.borderSoft}`,
          borderRadius: 6, background: PALETTE.card,
          color: copied ? PALETTE.success : PALETTE.subtle,
          fontFamily: MONO, fontSize: 10, fontWeight: 700, cursor: 'pointer',
        }}
      >
        {copied ? t('cliGuide.copied') : t('cliGuide.copy')}
      </button>
      <pre
        style={{
          margin: 0, padding: '32px 14px 13px', overflowX: 'auto',
          color: PALETTE.primary, fontFamily: MONO, fontSize: 13,
          lineHeight: 1.6, whiteSpace: 'pre',
        }}
      >
        {code}
      </pre>
    </div>
  );
}

/**
 * One numbered section, per the draft: the step number and its mono label sit
 * in a narrow left rail, the content in a lifted card to the right. Collapses
 * to a single column under 820px (see the media query in the page body).
 */
function Section({
  id, no, kicker, title, note, children,
}: {
  id: string; no: string; kicker: string; title: string; note: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="cli-guide-section"
      style={{
        // 🔴 Grid with an explicit `minmax(0, 1fr)`, NOT `flex: 1`.
        // The section is itself an item of the page's outer grid, whose
        // `min-width: auto` makes the whole subtree size intrinsically — and
        // the code blocks' max-content (a 58-character PowerShell line) then
        // pushed this section 250px past the 1000px column, clipping content
        // off the right edge. `minmax(0, 1fr)` caps the content column at the
        // space actually available; `minWidth: 0` stops the section itself
        // from claiming a content-based minimum in the outer grid.
        display: 'grid',
        gridTemplateColumns: '46px minmax(0, 1fr)',
        gap: 28,
        minWidth: 0,
        scrollMarginTop: 132,
      }}
    >
      <div className="cli-guide-rail" style={{ paddingTop: 2 }}>
        <div style={{ color: PALETTE.primary, fontFamily: MONO, fontWeight: 700, fontSize: 20, opacity: 0.85 }}>
          {no}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em',
            textTransform: 'uppercase', color: PALETTE.subtle, marginBottom: 10,
          }}
        >
          {kicker}
        </div>
        <h2 style={{ margin: '0 0 6px', fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em' }}>
          {title}
        </h2>
        <p style={{ margin: '0 0 18px', color: PALETTE.subtle, fontSize: 13, lineHeight: 1.6 }}>{note}</p>
        <div
          style={{
            border: `1px solid ${PALETTE.borderSoft}`,
            borderRadius: 10,
            background: 'rgba(32, 32, 36, 0.86)',
            boxShadow: CARD_LIFT,
            padding: 18,
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

const subCard: React.CSSProperties = {
  padding: 12,
  border: `1px solid ${PALETTE.borderSoft}`,
  borderRadius: 9,
  background: PALETTE.surface,
  boxShadow: SUB_CARD_LIFT,
};

function PathCard({ title, blurb, code }: { title: string; blurb: string; code: string }) {
  return (
    <article style={subCard}>
      <strong style={{ display: 'block', marginBottom: 6, color: PALETTE.text, fontFamily: MONO, fontSize: 12 }}>
        {title}
      </strong>
      <p style={{ margin: '0 0 10px', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.45 }}>{blurb}</p>
      <CodeBlock code={code} />
    </article>
  );
}

function Command({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div style={{ ...subCard, padding: 10 }}>
      <code style={{ display: 'block', marginBottom: 4, color: PALETTE.primary, fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>
        {cmd}
      </code>
      <span style={{ color: PALETTE.subtle, fontSize: 11, lineHeight: 1.35 }}>{desc}</span>
    </div>
  );
}

// ModeCard: a PathCard without the code well — how-it-works explains the two
// access modes in words; there is nothing for the reader to run there.
function ModeCard({ title, body }: { title: string; body: string }) {
  return (
    <article style={{ ...subCard, padding: 14 }}>
      <strong
        style={{
          display: 'block', marginBottom: 6, color: PALETTE.primary, fontFamily: MONO,
          fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}
      >
        {title}
      </strong>
      <p style={{ margin: 0, color: PALETTE.subtle, fontSize: 12, lineHeight: 1.55 }}>{body}</p>
    </article>
  );
}

// Gloss: one glossary chip — term in amber mono, plain-words definition with
// its everyday metaphor (kept from 术语解释.md, which is the wording source).
function Gloss({ term, def }: { term: string; def: string }) {
  return (
    <div style={{ ...subCard, padding: 10 }}>
      <span
        style={{
          display: 'block', marginBottom: 4, color: PALETTE.primary, fontFamily: MONO,
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
        }}
      >
        {term}
      </span>
      <span style={{ color: PALETTE.subtle, fontSize: 11.5, lineHeight: 1.45 }}>{def}</span>
    </div>
  );
}

// Symptom: one troubleshooting row — the symptom in the reader's words, then
// the command that diagnoses or fixes it.
function Symptom({ q, a, code }: { q: string; a: string; code: string }) {
  return (
    <div style={{ ...subCard, padding: '10px 12px', display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <strong style={{ color: PALETTE.text, fontSize: 12, fontFamily: MONO, flex: '1 1 240px' }}>{q}</strong>
      <span style={{ color: PALETTE.subtle, fontSize: 12 }}>
        {a} <code style={{ color: PALETTE.primary, fontFamily: MONO, fontSize: 11.5 }}>{code}</code>
      </span>
    </div>
  );
}

// DailyCard: one everyday moment — label, the single command, and what to
// expect. Kept as a component so the four call sites stay static t() calls
// (see the note at the daily-use grid).
function DailyCard({ title, code, note }: { title: string; code: string; note: string }) {
  return (
    <div style={{ ...subCard, padding: 10 }}>
      <strong style={{ display: 'block', marginBottom: 6, color: PALETTE.text, fontFamily: MONO, fontSize: 12 }}>
        {title}
      </strong>
      <CodeBlock code={code} />
      <p style={{ margin: '8px 0 0', color: PALETTE.subtle, fontSize: 11.5, lineHeight: 1.45 }}>{note}</p>
    </div>
  );
}

export default function CLIGuidePage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === 'undefined') return TABS[0].id;
    const h = window.location.hash.slice(1);
    return TABS.some((tab) => tab.id === h) ? h : TABS[0].id;
  });

  // Scroll-spy: update the sticky strip while the reader scrolls. The band is
  // offset for the two stacked sticky bars (topbar 64 + strip ~44).
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const sections = TABS.map((tab) => document.getElementById(tab.id)).filter(Boolean) as HTMLElement[];
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

  const handleTabClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setActiveTab(id);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.history.replaceState) window.history.replaceState(null, '', `#${id}`);
  };

  const step = (id: string) => TABS.find((tab) => tab.id === id)!.no;

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
          (no shared CSS file pulled into the standalone bundle). */}
      <style>{`
        @media (max-width: 820px) {
          .cli-guide-two-col,
          .cli-guide-grid { grid-template-columns: 1fr !important; }
          .cli-guide-section {
            gap: 14px !important;
            grid-template-columns: 30px minmax(0, 1fr) !important;
          }
          .cli-guide-strip { overflow-x: auto; }
        }
      `}</style>

      {/* Topbar — same lockup as /user/app-guide */}
      <nav
        style={{
          height: 64, padding: '0 32px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', background: 'rgba(0,0,0,0.4)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          position: 'sticky', top: 0, zIndex: 50, backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 32, height: 32, borderRadius: 6, background: '#0c0c0e',
              border: `1px solid ${PALETTE.primaryDim}`, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, color: '#fef3c7',
            }}
          >
            AK
          </div>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, color: PALETTE.display }}>
            AiKey
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <a
            href="/user/app-guide"
            style={{
              fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              color: PALETTE.subtle, textDecoration: 'none',
            }}
          >
            {t('cliGuide.footerAppLink')}
          </a>
          <LanguageSwitcher />
        </div>
      </nav>

      {/* Sticky section strip */}
      <div
        className="cli-guide-strip"
        style={{
          position: 'sticky', top: 64, zIndex: 40,
          background: 'rgba(24, 24, 27, 0.8)', backdropFilter: 'blur(14px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '0 32px',
        }}
      >
        <nav
          aria-label={t('cliGuide.sectionsNavAriaLabel')}
          style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 26 }}
        >
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <a
                key={tab.id}
                href={`#${tab.id}`}
                onClick={(e) => handleTabClick(e, tab.id)}
                style={{
                  flex: '0 0 auto', padding: '14px 0',
                  borderBottom: `2px solid ${active ? PALETTE.primary : 'transparent'}`,
                  color: active ? PALETTE.primary : PALETTE.subtle,
                  fontFamily: MONO, fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  textDecoration: 'none', whiteSpace: 'nowrap',
                }}
              >
                {t(tab.labelKey)}
              </a>
            );
          })}
        </nav>
      </div>

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 96px' }}>
        {/* Hero */}
        <section style={{ textAlign: 'center', padding: '72px 0 64px' }}>
          <div
            style={{
              fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.15em',
              textTransform: 'uppercase', color: PALETTE.primary, marginBottom: 14,
            }}
          >
            {t('cliGuide.introBadge')}
          </div>
          <h1
            style={{
              margin: '0 0 18px', fontFamily: MONO, fontWeight: 700,
              fontSize: 'clamp(30px, 4vw, 42px)', lineHeight: 1.12, letterSpacing: '-0.03em',
            }}
          >
            {t('cliGuide.introTitle')}
          </h1>
          <p style={{ margin: '0 auto', maxWidth: 620, color: PALETTE.subtle, fontSize: 14.5, lineHeight: 1.65 }}>
            {t('cliGuide.introDesc')}
          </p>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 56 }}>
          <Section id="setup" no={step('setup')} kicker={t('cliGuide.tabSetup')} title={t('cliGuide.setupTitle')} note={t('cliGuide.setupNote')}>
            <div className="cli-guide-two-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <div>
                <p style={{ margin: '0 0 6px', color: PALETTE.text, fontSize: 12, fontFamily: MONO }}>
                  {t('cliGuide.setupMacLabel')}
                </p>
                <CodeBlock
                  code={
                    'tar -xzf aikey-personal_<version>_mac_linux_<stamp>.tar.gz\n' +
                    'cd aikey-personal_<version>_mac_linux\n' +
                    'sh local-install.sh --offline\n' +
                    'source ~/.zshrc   # or ~/.bashrc'
                  }
                />
              </div>
              <div>
                <p style={{ margin: '0 0 6px', color: PALETTE.text, fontSize: 12, fontFamily: MONO }}>
                  {t('cliGuide.setupWinLabel')}
                </p>
                <CodeBlock
                  lang="powershell"
                  code={
                    'Expand-Archive aikey-personal_<version>_windows_<stamp>.zip\n' +
                    'cd aikey-personal_<version>_windows\n' +
                    '.\\local-install.ps1 -Offline'
                  }
                />
              </div>
            </div>
            <p style={{ margin: '14px 0 0', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.5 }}>
              {t('cliGuide.setupOfflineNote')}{' '}
              <a href="/step-by-step/" style={{ color: PALETTE.primary, textDecoration: 'none' }}>
                {t('cliGuide.stepByStepLink')} →
              </a>
            </p>
          </Section>

          <Section id="how-it-works" no={step('how-it-works')} kicker={t('cliGuide.tabHowItWorks')} title={t('cliGuide.howTitle')} note={t('cliGuide.howNote')}>
            <p style={{ margin: '0 0 14px', color: PALETTE.subtle, fontSize: 12.5, lineHeight: 1.6 }}>
              {t('cliGuide.howIntro')}
            </p>
            <div className="cli-guide-two-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <ModeCard title={t('cliGuide.howLocalTitle')} body={t('cliGuide.howLocalBody')} />
              <ModeCard title={t('cliGuide.howClusterTitle')} body={t('cliGuide.howClusterBody')} />
            </div>
            <p
              style={{
                margin: '14px 0 0', color: PALETTE.faint, fontFamily: MONO, fontSize: 10.5,
                textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.6,
              }}
            >
              {t('cliGuide.howFootnote')}
            </p>
          </Section>

          <Section id="get-a-key" no={step('get-a-key')} kicker={t('cliGuide.tabGetKey')} title={t('cliGuide.getKeyTitle')} note={t('cliGuide.getKeyNote')}>
            <div className="cli-guide-two-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <article
                style={{
                  ...subCard,
                  position: 'relative',
                  border: '1px solid rgba(250, 204, 21, 0.45)',
                  boxShadow: `${SUB_CARD_LIFT}, 0 0 18px rgba(250, 204, 21, 0.05)`,
                }}
              >
                <span
                  style={{
                    position: 'absolute', top: -9, right: 12, padding: '1px 8px', borderRadius: 4,
                    background: PALETTE.primary, color: PALETTE.bg, fontFamily: MONO, fontSize: 9,
                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}
                >
                  {t('cliGuide.recommendedBadge')}
                </span>
                <strong style={{ display: 'block', marginBottom: 6, color: PALETTE.text, fontFamily: MONO, fontSize: 12 }}>
                  {t('cliGuide.pathTeamTitle')}
                </strong>
                <p style={{ margin: '0 0 10px', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.45 }}>
                  {t('cliGuide.pathTeamBlurb')}
                </p>
                <CodeBlock code={'aikey login --control-url http://<console>:3000\naikey use'} />
                <p style={{ margin: '10px 0 0', color: PALETTE.subtle, fontSize: 11.5, lineHeight: 1.5 }}>
                  {t('cliGuide.feishuNote')}
                </p>
              </article>
              <PathCard
                title={t('cliGuide.pathPersonalTitle')}
                blurb={t('cliGuide.pathPersonalBlurb')}
                code={
                  'aikey add my-key --provider anthropic\naikey use my-key\n' +
                  '# or a Claude / ChatGPT / Kimi subscription:\naikey auth login claude'
                }
              />
            </div>
            <div
              style={{
                marginTop: 14, padding: '10px 12px',
                border: '1px solid rgba(245, 158, 11, 0.28)', borderRadius: 7,
                background: 'rgba(245, 158, 11, 0.08)',
                boxShadow: 'inset 3px 0 0 rgba(245, 158, 11, 0.6)',
                color: PALETTE.text, fontSize: 12, lineHeight: 1.55,
              }}
            >
              ⚠️ <strong>{t('cliGuide.hookWarnLabel')}</strong> {t('cliGuide.hookWarnBody')}{' '}
              <code style={{ fontFamily: MONO, fontSize: 11.5 }}>aikey hook install</code>
            </div>
          </Section>

          <Section id="daily-use" no={step('daily-use')} kicker={t('cliGuide.tabDailyUse')} title={t('cliGuide.dailyTitle')} note={t('cliGuide.dailyNote')}>
            <div className="cli-guide-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <DailyCard title={t('cliGuide.daily1Title')} code="claude" note={t('cliGuide.daily1Note')} />
              <DailyCard title={t('cliGuide.daily2Title')} code="aikey use <other-key>" note={t('cliGuide.daily2Note')} />
              <DailyCard title={t('cliGuide.daily3Title')} code="aikey web" note={t('cliGuide.daily3Note')} />
              <DailyCard
                title={t('cliGuide.daily4Title')}
                code={'aikey activate <key>\naikey deactivate'}
                note={t('cliGuide.daily4Note')}
              />
            </div>
          </Section>

          <Section id="commands" no={step('commands')} kicker={t('cliGuide.tabCommands')} title={t('cliGuide.commandsTitle')} note={t('cliGuide.commandsNote')}>
            <div className="cli-guide-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <Command cmd="aikey list" desc={t('cliGuide.cmdListDesc')} />
              <Command cmd="aikey use" desc={t('cliGuide.cmdUseDesc')} />
              <Command cmd="aikey route" desc={t('cliGuide.cmdRouteDesc')} />
              <Command cmd="aikey whoami" desc={t('cliGuide.cmdWhoamiDesc')} />
              <Command cmd="aikey key sync" desc={t('cliGuide.cmdKeySyncDesc')} />
              <Command cmd="aikey doctor" desc={t('cliGuide.cmdDoctorDesc')} />
              <Command cmd="aikey web vault" desc={t('cliGuide.cmdWebVaultDesc')} />
              <Command cmd="aikey test --all" desc={t('cliGuide.cmdTestDesc')} />
              <Command cmd="aikey env" desc={t('cliGuide.cmdEnvDesc')} />
              <Command cmd="aikey env set --" desc={t('cliGuide.cmdEnvSetDesc')} />
              <Command cmd="aikey service <action> <name>" desc={t('cliGuide.cmdServiceDesc')} />
            </div>
          </Section>

          <Section id="network" no={step('network')} kicker={t('cliGuide.tabNetwork')} title={t('cliGuide.outboundTitle')} note={t('cliGuide.outboundNote')}>
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
            <p style={{ margin: '12px 0 0', color: PALETTE.subtle, fontSize: 12, lineHeight: 1.55 }}>
              {t('cliGuide.netDataPlaneNote')}
            </p>
          </Section>

          <Section id="glossary" no={step('glossary')} kicker={t('cliGuide.tabGlossary')} title={t('cliGuide.glossaryTitle')} note={t('cliGuide.glossaryNote')}>
            <div className="cli-guide-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <Gloss term={t('cliGuide.glossVkTerm')} def={t('cliGuide.glossVkDef')} />
              <Gloss term={t('cliGuide.glossVaultTerm')} def={t('cliGuide.glossVaultDef')} />
              <Gloss term={t('cliGuide.glossSeatTerm')} def={t('cliGuide.glossSeatDef')} />
              <Gloss term={t('cliGuide.glossOauthTerm')} def={t('cliGuide.glossOauthDef')} />
              <Gloss term={t('cliGuide.glossProviderTerm')} def={t('cliGuide.glossProviderDef')} />
              <Gloss term={t('cliGuide.glossSwitchLogTerm')} def={t('cliGuide.glossSwitchLogDef')} />
              <Gloss term={t('cliGuide.glossReceiptTerm')} def={t('cliGuide.glossReceiptDef')} />
            </div>
          </Section>

          <Section id="trouble" no={step('trouble')} kicker={t('cliGuide.tabTrouble')} title={t('cliGuide.troubleTitle')} note={t('cliGuide.troubleNote')}>
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <Symptom q={t('cliGuide.symptom1Q')} a={t('cliGuide.symptom1A')} code="aikey key sync" />
              <Symptom q={t('cliGuide.symptom2Q')} a={t('cliGuide.symptom2A')} code="aikey hook install" />
              <Symptom q={t('cliGuide.symptom3Q')} a={t('cliGuide.symptom3A')} code="aikey doctor && aikey test" />
            </div>
            <CodeBlock code={'aikey doctor\naikey logs\naikey proxy restart\naikey key sync'} />
          </Section>
        </div>

        {/* Footer */}
        <footer
          style={{
            marginTop: 72, paddingTop: 28, borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            color: PALETTE.faint, fontFamily: MONO, fontSize: 11,
          }}
        >
          <span>{t('cliGuide.footerTitle')}</span>
          <span>
            <a href="/user/app-guide" style={{ color: PALETTE.faint, textDecoration: 'none' }}>
              {t('cliGuide.footerAppLink')}
            </a>
            <span style={{ color: PALETTE.muted }}> · </span>
            <a href="/user/app-usage" style={{ color: PALETTE.faint, textDecoration: 'none' }}>
              {t('cliGuide.footerUsageLink')}
            </a>
            <span style={{ color: PALETTE.muted }}> · </span>
            <a href="/step-by-step/" style={{ color: PALETTE.faint, textDecoration: 'none' }}>
              {t('cliGuide.footerStepByStep')}
            </a>
            <span style={{ color: PALETTE.muted }}> · </span>
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
