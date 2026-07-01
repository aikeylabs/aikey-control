/**
 * Browser Profile Guide — /user/browser-profile-guide
 *
 * Standalone page (no sidebar shell), opened in a NEW TAB from the Team OAuth
 * sign-in panel. It explains WHY to use one isolated Chrome profile per team
 * account (multiple Claude logins in the same browser overwrite each other's
 * session) and HOW to make a one-click launcher on macOS via Automator.
 *
 * The shell recipe (mirrors the screenshot the user provided): an Automator
 * "Application" running a Run Shell Script that boots Chrome with its own
 * --user-data-dir, so each account gets a fully isolated cookie/session store.
 *
 * The screenshot lives in public/images/chrome-profile-automator.png. It is
 * optional — the page degrades gracefully (onError hides it) so the text guide
 * stands on its own if the asset isn't shipped.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@/shared/utils/clipboard';

const SHELL_SCRIPT = `mkdir -p /tmp/chrome/isolate_2
open -na "Google Chrome" --args \\
  --user-data-dir="/tmp/chrome/isolate_2"`;

export default function BrowserProfileGuidePage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [imgOk, setImgOk] = useState(true);

  const steps = [
    t('browserProfileGuide.step1'),
    t('browserProfileGuide.step2'),
    t('browserProfileGuide.step3'),
    t('browserProfileGuide.step4'),
    t('browserProfileGuide.step5'),
  ];

  function onCopy() {
    copyText(SHELL_SCRIPT)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: 'var(--background, #0f0f11)', color: 'var(--foreground, #f4f4f5)' }}
    >
      <div className="mx-auto px-6 py-10" style={{ maxWidth: 760 }}>
        {/* Header */}
        <h1
          className="font-bold tracking-wide"
          style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--display-foreground, #f4f4f5)' }}
        >
          {t('browserProfileGuide.title')}
        </h1>
        <p className="mt-3" style={{ fontSize: 14, color: 'var(--soft-foreground, #a1a1aa)', lineHeight: 1.7 }}>
          {t('browserProfileGuide.why')}
        </p>

        {/* Steps (macOS / Automator) */}
        <section
          className="mt-8 rounded-lg"
          style={{ background: 'var(--card, #18181b)', border: '1px solid var(--border, #27272a)', padding: 24 }}
        >
          <div
            className="text-[11px] font-mono uppercase tracking-wider mb-4"
            style={{ color: 'var(--muted-foreground, #71717a)' }}
          >
            {t('browserProfileGuide.macosHeading')}
          </div>
          <ol className="space-y-3" style={{ listStyle: 'none', padding: 0, counterReset: 'step' }}>
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3" style={{ fontSize: 14, lineHeight: 1.6 }}>
                <span
                  className="flex-shrink-0 flex items-center justify-center rounded-full font-mono"
                  style={{
                    width: 22,
                    height: 22,
                    fontSize: 12,
                    background: 'var(--surface-2, #27272a)',
                    color: 'var(--primary, #4ade80)',
                    border: '1px solid var(--border, #3f3f46)',
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ color: 'var(--foreground, #e4e4e7)' }}>{s}</span>
              </li>
            ))}
          </ol>

          {/* The shell script — copyable */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="text-[10px] font-mono uppercase tracking-wider"
                style={{ color: 'var(--muted-foreground, #71717a)' }}
              >
                {t('browserProfileGuide.scriptLabel')}
              </span>
              <button
                type="button"
                className="text-[11px] font-mono"
                style={{ color: copied ? '#4ade80' : 'var(--primary, #60a5fa)', cursor: 'pointer', background: 'none', border: 'none' }}
                onClick={onCopy}
              >
                {copied ? t('browserProfileGuide.copied') : t('browserProfileGuide.copy')}
              </button>
            </div>
            <pre
              className="rounded overflow-x-auto"
              style={{
                background: '#000',
                border: '1px solid var(--border, #27272a)',
                padding: '12px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
                lineHeight: 1.6,
                color: '#e4e4e7',
                margin: 0,
              }}
            >
              {SHELL_SCRIPT}
            </pre>
            <p className="mt-2" style={{ fontSize: 12, color: 'var(--muted-foreground, #a1a1aa)' }}>
              {t('browserProfileGuide.scriptNote')}
            </p>
          </div>

          {/* Screenshot (optional — hides if the asset isn't shipped) */}
          {imgOk && (
            <div className="mt-5">
              <img
                src="/images/chrome-profile-automator.png"
                alt={t('browserProfileGuide.imageAlt')}
                onError={() => setImgOk(false)}
                style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border, #27272a)' }}
              />
            </div>
          )}
        </section>

        <p className="mt-6" style={{ fontSize: 12.5, color: 'var(--muted-foreground, #a1a1aa)', lineHeight: 1.7 }}>
          {t('browserProfileGuide.platformNote')}
        </p>
      </div>
    </div>
  );
}
