import { describe, expect, it } from 'vitest';

const source = await import('./index.tsx?raw').then((module) => module.default);

describe('Personal Session Key login surface', () => {
  it('keeps Browser OAuth and Session Key as coexisting tabs', () => {
    expect(source).toContain("(['browser', 'session_key'] as const)");
    expect(source).toContain('role="tablist"');
    expect(source).toContain("oauthContribute.browserLoginTab");
    expect(source).toContain("oauthContribute.sessionKeyLoginTab");
  });

  it('chooses the login method before rendering Browser OAuth steps', () => {
    const tabs = source.indexOf('data-login-method-tabs');
    const egress = source.indexOf('data-browser-oauth-step="egress-check"');
    const accountLogin = source.indexOf('data-browser-oauth-step="account-login"');
    expect(tabs).toBeGreaterThanOrEqual(0);
    expect(egress).toBeGreaterThan(tabs);
    expect(accountLogin).toBeGreaterThan(egress);
    expect(source).toContain("effectiveLoginMethod === 'browser' && <div");
  });

  it('exposes Session Key for real and resident-mock Anthropic protocol accounts', () => {
    expect(source).toContain("account.provider_code === 'anthropic' && (!account.protocol_type || account.protocol_type === 'anthropic')");
    expect(source).toContain("account.provider_code === 'mock' && account.protocol_type === 'anthropic'");
  });

  it('uses one password input and one automatic confirmation action', () => {
    expect(source).toContain('type="password"');
    expect(source).toContain('onClick={startSessionKeySignIn}');
    expect(source).toContain("sessionKeyConfirmMut.mutate");
    expect(source).toContain("role={sessionKeyStatus.tone === 'error' ? 'alert' : 'status'}");
  });
});
