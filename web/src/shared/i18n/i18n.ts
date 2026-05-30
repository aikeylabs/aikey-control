import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enCommon from './locales/en/common.json';
import zhCommon from './locales/zh/common.json';

// Phase 0 i18n bootstrap. Default English; follow browser; remember manual choice.
// Detection order: localStorage (explicit user pick) -> navigator -> fallback 'en'.
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
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'aikey-lang',
      caches: ['localStorage'],
    },
  });

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
