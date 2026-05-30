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

export default i18n;
