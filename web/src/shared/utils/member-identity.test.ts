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
