import { describe, it, expect } from 'vitest';
import { isSyntheticIdentityEmail, memberDisplayLabel } from './member-identity';

/**
 * 🔴 The fence for "the console never renders the synthetic handle".
 *
 * `sso+feishu.<digest>@sso.local` is what an SSO account carries in its email
 * column. It is a key, not an address — nobody can send mail to it and the
 * member has never seen it. Returning it from memberDisplayLabel is the one
 * failure this file exists to prevent.
 */
describe('isSyntheticIdentityEmail', () => {
  it('recognises the synthetic login handle in any casing', () => {
    expect(isSyntheticIdentityEmail('sso+feishu.9f3c1a@sso.local')).toBe(true);
    expect(isSyntheticIdentityEmail('  SSO+Feishu.9F3C1A@SSO.LOCAL  ')).toBe(true);
  });

  it('leaves real addresses alone', () => {
    expect(isSyntheticIdentityEmail('member@example.com')).toBe(false);
    // A real address that merely mentions sso is not a handle.
    expect(isSyntheticIdentityEmail('sso.admin@example.com')).toBe(false);
  });

  it('treats absent values as not synthetic', () => {
    expect(isSyntheticIdentityEmail(undefined)).toBe(false);
    expect(isSyntheticIdentityEmail(null)).toBe(false);
    expect(isSyntheticIdentityEmail('')).toBe(false);
  });
});

describe('memberDisplayLabel', () => {
  it('prefers the seat alias — the provider display name the member recognises', () => {
    expect(memberDisplayLabel('member@example.com', 'Feishu Member', 'Member')).toBe('Feishu Member');
  });

  it('falls back to a real address when there is no alias', () => {
    expect(memberDisplayLabel('member@example.com', undefined, 'Member')).toBe('member@example.com');
    expect(memberDisplayLabel('member@example.com', '   ', 'Member')).toBe('member@example.com');
  });

  it('🔴 never returns the synthetic handle, with or without an alias', () => {
    const handle = 'sso+feishu.9f3c1a@sso.local';
    expect(memberDisplayLabel(handle, 'Feishu Member', 'Member')).toBe('Feishu Member');
    // No alias yet (the seat has not been provisioned): a neutral label, 🚫 not
    // the handle. "No name yet" beats a string the member cannot act on.
    expect(memberDisplayLabel(handle, undefined, 'Member')).toBe('Member');
    expect(memberDisplayLabel(handle, '', 'Member')).toBe('Member');
  });

  it('falls back when there is nothing at all', () => {
    expect(memberDisplayLabel(undefined, undefined, 'Member')).toBe('Member');
  });
});

/**
 * 🔴 The console has MORE THAN ONE source of "me": the team session, and a
 * deliberate cross-fetch of the local machine used to scope vault/usage data.
 * The second answers with a local-bypass sentinel. A member on the team console
 * saw `local@aikey.local` as their own identity because a display slot read the
 * wrong one (Production, 2026-07-21).
 *
 * Fixing the source is the real fix; this is the backstop that survives the next
 * rewiring. 能红: drop IDENTITY_SENTINELS and these return the sentinel.
 */
describe('memberDisplayLabel — local-bypass sentinels are not people', () => {
  for (const sentinel of ['local@aikey.local', 'local@localhost', 'personal-local', 'local-owner', 'LOCAL@AIKEY.LOCAL']) {
    it(`never renders ${sentinel} as the member`, () => {
      expect(memberDisplayLabel(sentinel, undefined, 'Member')).toBe('Member');
      // With a real name available, the name wins — as it does for any source.
      expect(memberDisplayLabel(sentinel, 'Feishu Member', 'Member')).toBe('Feishu Member');
    });
  }

  it('still returns an ordinary corporate address untouched', () => {
    expect(memberDisplayLabel('member@example.com', undefined, 'Member')).toBe('member@example.com');
  });
});
