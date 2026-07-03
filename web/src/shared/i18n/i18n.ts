import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from './locales/en/common.json';
import zhCommon from './locales/zh/common.json';

// Phase 0 i18n bootstrap. Default English; follow browser; remember manual choice.
// Detection order: querystring (cross-app handoff) -> localStorage (explicit
// user pick) -> navigator -> fallback 'en'.
export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { common: enCommon }, zh: { common: zhCommon } },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    nonExplicitSupportedLngs: true, // zh-CN / zh-TW collapse to 'zh'
    defaultNS: 'common',
    ns: ['common'],
    interpolation: { escapeValue: false },
    detection: {
      // 'querystring' comes first on purpose: the Personal web and the Team
      // web run on DIFFERENT origins, so the 'aikey-lang' localStorage entry
      // cannot follow the user across a cross-app hard-jump. Cross-app links
      // carry `?lang=` (see ../cross-app-menu/cross-app-url.ts); the detected
      // value is cached into THIS origin's localStorage, then the param is
      // stripped from the address bar right below.
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'aikey-lang',
      caches: ['localStorage'],
    },
  });

// One-shot cleanup of the `?lang=` cross-app handoff param (see detection
// order above). Without this, the user could switch language on this origin
// after landing and a later refresh would re-apply the stale URL param,
// flipping the language back — the exact flicker the handoff exists to fix
// (workflow/CI/bugfix/2026-07-02-cross-app-language-flicker.md).
try {
  const url = new URL(window.location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang');
    window.history.replaceState(window.history.state, '', url.toString());
  }
} catch {
  // URL/history unavailable (tests / non-browser env) — nothing to clean.
}

// Keep <html lang> in sync with the active i18n language.
//
// Why: the static index.html ships `lang="en"`. When the user switches to
// Chinese the document attribute must follow, otherwise screen readers,
// browser translation prompts, and `:lang()` CSS see the wrong language.
// We map any zh* variant (zh-CN / zh-TW) down to 'zh' and everything else
// to 'en' to match SUPPORTED_LANGUAGES — keep it simple rather than echoing
// the full BCP-47 tag.
function htmlLangFor(lng: string | undefined): string {
  return (lng ?? 'en').startsWith('zh') ? 'zh' : 'en';
}
document.documentElement.lang = htmlLangFor(i18n.resolvedLanguage);
i18n.on('languageChanged', (l) => {
  document.documentElement.lang = htmlLangFor(l);
});

export default i18n;
