import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/Button';

/**
 * Single-button language switcher mounted in the UserShell header.
 *
 * Shows a globe icon + the CURRENT language label (中 / EN); clicking toggles
 * between the two supported locales (zh ⇄ en). The globe signals "language" so
 * the control reads as a language switch, and the tooltip names the language
 * you'll switch TO. (Replaced the earlier two-button EN/中 segmented control —
 * one button is cleaner in the header; see 2026-05-30 design decision.)
 *
 * Reuses the shared `Button` atom so it inherits the project's `.btn` theming.
 */
const LABELS: Record<string, string> = { en: 'EN', zh: '中' };
// Native name of the language a click will switch TO — used for the tooltip.
const TARGET_NATIVE: Record<string, string> = { en: 'English', zh: '中文' };

function GlobeIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'en').startsWith('zh') ? 'zh' : 'en';
  const next = current === 'zh' ? 'en' : 'zh';

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => i18n.changeLanguage(next)}
      title={TARGET_NATIVE[next]}
      aria-label={`Switch language to ${TARGET_NATIVE[next]}`}
      className="flex items-center gap-1.5"
    >
      <GlobeIcon />
      {LABELS[current]}
    </Button>
  );
}
