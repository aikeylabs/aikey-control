import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Functional test for buildCrossAppUrl (2026-07-02 bugfix: cross-app
 * language flicker). The real ../i18n/i18n module touches `document`
 * at import time (html-lang sync), which the node test environment
 * doesn't have — so the i18next singleton is mocked with a mutable
 * stand-in; buildCrossAppUrl itself is the real user-run code.
 *
 * See workflow/CI/bugfix/2026-07-02-cross-app-language-flicker.md.
 */
const mockI18n = vi.hoisted((): { resolvedLanguage?: string; language?: string } => ({}));
vi.mock('../i18n/i18n', () => ({ default: mockI18n }));

import { buildCrossAppUrl } from './cross-app-url';

describe('buildCrossAppUrl', () => {
  beforeEach(() => {
    mockI18n.resolvedLanguage = undefined;
    mockI18n.language = undefined;
  });

  it('appends ?lang= with the active language', () => {
    mockI18n.resolvedLanguage = 'en';
    expect(buildCrossAppUrl('http://192.168.3.62:3000', '/user/virtual-keys')).toBe(
      'http://192.168.3.62:3000/user/virtual-keys?lang=en',
    );
  });

  it('collapses zh-* variants to zh (matches nonExplicitSupportedLngs)', () => {
    mockI18n.resolvedLanguage = 'zh-CN';
    expect(buildCrossAppUrl('http://192.168.3.62:3000', '/user/usage-ledger')).toBe(
      'http://192.168.3.62:3000/user/usage-ledger?lang=zh',
    );
  });

  it('falls back to i18n.language, then to en, when resolvedLanguage is unset', () => {
    mockI18n.language = 'zh';
    expect(buildCrossAppUrl('http://x', '/p')).toBe('http://x/p?lang=zh');
    mockI18n.language = undefined;
    expect(buildCrossAppUrl('http://x', '/p')).toBe('http://x/p?lang=en');
  });

  it('joins with & when the path already carries a query string', () => {
    mockI18n.resolvedLanguage = 'en';
    expect(buildCrossAppUrl('http://127.0.0.1:8090', '/user/vault?focus=vk-1')).toBe(
      'http://127.0.0.1:8090/user/vault?focus=vk-1&lang=en',
    );
  });

  it('same-origin (empty/null base) links skip the lang handoff — one origin, one localStorage (2026-07-03 Q1)', () => {
    mockI18n.resolvedLanguage = 'en';
    expect(buildCrossAppUrl(null, '/user/vault')).toBe('/user/vault');
    expect(buildCrossAppUrl('', '/user/virtual-keys')).toBe('/user/virtual-keys');
    // cross-origin keeps the handoff
    expect(buildCrossAppUrl('http://x', '/p')).toBe('http://x/p?lang=en');
  });
});
