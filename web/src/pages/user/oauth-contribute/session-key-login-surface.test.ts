import { describe, expect, it } from 'vitest';

const source = await import('./index.tsx?raw').then((module) => module.default);

describe('Personal Session Key login surface', () => {
  it('keeps Browser OAuth and Session Key as coexisting tabs', () => {
    expect(source).toContain("(['browser', 'session_key'] as const)");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('oauthContribute.browserLoginTab');
    expect(source).toContain('oauthContribute.sessionKeyLoginTab');
  });

  it('chooses the login method before rendering Browser OAuth steps', () => {
    const tabs = source.indexOf('data-login-method-tabs');
    const egress = source.indexOf('data-browser-oauth-step="egress-check"');
    const accountLogin = source.indexOf('data-browser-oauth-step="account-login"');
    expect(tabs).toBeGreaterThanOrEqual(0);
    expect(egress).toBeGreaterThan(tabs);
    expect(accountLogin).toBeGreaterThan(egress);
    expect(source).toContain("effectiveLoginMethod === 'browser' && (");
  });

  it('exposes Session Key through the shared Claude and Codex capability rule', () => {
    expect(source).toContain('sessionKeyProviderKind');
    expect(source).toContain("sessionKeyKind === 'codex'");
    expect(source).toContain('oauthContribute.codexSessionKeyLabel');
    expect(source).toContain('oauthContribute.codexSessionKeyHint');
  });

  it('uses one masked multiline textarea and never exposes an identity-mismatch override', () => {
    expect(source).toContain('<textarea');
    expect(source).toContain('rows={4}');
    expect(source).toContain('wrap="soft"');
    expect(source).toContain('spellCheck={false}');
    expect(source).toContain("WebkitTextSecurity: 'disc'");
    expect(source).toContain('startSessionKeySignIn');
    expect(source).toContain('sessionKeyConfirmMut.mutate');
    expect(source).toContain('SESSION_KEY_IDENTITY_MISMATCH');
    expect(source).toContain('oauthContribute.loginIdentityMismatchError');
    expect(source).not.toContain('identityMismatchConfirmed');
    expect(source).not.toContain('oauthContribute.sessionKeyConfirmAgain');
  });

  it('places shared provider-specific acquisition help beside the visible input label', () => {
    expect(source).toContain('<SessionKeyHelp providerKind={sessionKeyKind} />');
    expect(source).toContain('htmlFor={sessionKeyInputID}');
    expect(source).toContain('id={sessionKeyInputID}');
  });
});
