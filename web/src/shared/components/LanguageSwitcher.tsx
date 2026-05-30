import React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui/Button';
import { SUPPORTED_LANGUAGES } from '../i18n/i18n';

/**
 * Phase 0 i18n language switcher.
 *
 * Compact EN/中 segmented control mounted in the UserShell header.
 * Reuses the shared `Button` atom (variant ghost/outline, size sm) so it
 * inherits the project's `.btn` theming rather than inventing new tokens.
 * The active locale is highlighted with the same yellow accent used by the
 * header's "Invite" button (var(--primary) + rgba(250,204,21,0.3) border).
 */
const LABELS: Record<(typeof SUPPORTED_LANGUAGES)[number], string> = {
  en: 'EN',
  zh: '中',
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';

  return (
    <div className="flex items-center gap-1" role="group">
      {SUPPORTED_LANGUAGES.map((lng) => {
        const active = current === lng;
        return (
          <Button
            key={lng}
            type="button"
            size="sm"
            variant={active ? 'outline' : 'ghost'}
            aria-pressed={active}
            onClick={() => i18n.changeLanguage(lng)}
            style={
              active
                ? { color: 'var(--primary)', borderColor: 'rgba(250,204,21,0.3)' }
                : undefined
            }
          >
            {LABELS[lng]}
          </Button>
        );
      })}
    </div>
  );
}
