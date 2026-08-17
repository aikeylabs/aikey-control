import { describe, expect, it } from 'vitest';
import { SESSION_KEY_HELP_PROVIDERS } from './SessionKeyHelp';

const source = await import('./SessionKeyHelp.tsx?raw').then((module) => module.default);

describe('Session Key acquisition help', () => {
  it('maps each provider to its official homepage and exact cookie name', () => {
    expect(SESSION_KEY_HELP_PROVIDERS.claude).toMatchObject({
      officialURL: 'https://claude.ai/',
      cookieName: 'sessionKey',
    });
    expect(SESSION_KEY_HELP_PROVIDERS.codex).toMatchObject({
      officialURL: 'https://chatgpt.com/',
      cookieName: '__Secure-next-auth.session-token',
    });
  });

  it.each(Object.values(SESSION_KEY_HELP_PROVIDERS))('uses a clean official URL for $officialURL', (provider) => {
    const url = new URL(provider.officialURL);
    expect(url.protocol).toBe('https:');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.pathname).toBe('/');
  });

  it('keeps help explicit, accessible, and unable to read browser cookies', () => {
    expect(source).toContain('aria-expanded={expanded}');
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain('copyText(value)');
    expect(source).not.toContain('document.cookie');
    expect(source).not.toContain('/api/auth/session');
  });
});
