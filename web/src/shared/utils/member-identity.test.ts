import { describe, it, expect } from 'vitest';
import {
  isSyntheticIdentityEmail,
  memberAliasSlug,
  memberDisplayLabel,
  memberDiscriminator,
  memberIdentity,
  memberIdentityLine,
} from './member-identity';

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

/**
 * 🔴 A display name is not an identity. Two members called 李承熙 in one
 * organization must not render identically in a seat list — an administrator
 * revoking access has to know which person they are acting on.
 */
describe('memberDiscriminator / memberIdentityLine', () => {
  const a = 'sso+feishu.6ad2973deea1fda6356a024a01de13dc@sso.local';
  const b = 'sso+feishu.9f3c1a04bb27ee5510cc44de77aa9012@sso.local';

  it('derives a short, stable discriminator from the handle', () => {
    expect(memberDiscriminator(a)).toBe('feishu:6ad2973d');
    expect(memberDiscriminator(a)).toBe(memberDiscriminator(a)); // stable
  });

  it('🔴 separates two members who share a display name', () => {
    expect(memberDiscriminator(a)).not.toBe(memberDiscriminator(b));
    const lineA = memberIdentityLine(a, '李承熙', '—');
    const lineB = memberIdentityLine(b, '李承熙', '—');
    expect(lineA).not.toBe(lineB);
    expect(lineA).toBe('李承熙 · feishu:6ad2973d');
  });

  it('🚫 never exposes the raw union_id or the full handle', () => {
    const line = memberIdentityLine(a, '李承熙', '—');
    expect(line).not.toContain('@sso.local');
    expect(line).not.toContain('sso+');
    // Only a truncated digest, not the whole thing.
    expect(line).not.toContain('6ad2973deea1fda6356a024a01de13dc');
  });

  it('leaves ordinary accounts as a plain address', () => {
    expect(memberDiscriminator('member@example.com')).toBe('');
    expect(memberIdentityLine('member@example.com', undefined, '—')).toBe('member@example.com');
    expect(memberIdentityLine('member@example.com', 'Ada', '—')).toBe('Ada');
  });

  it('falls back when there is nothing to show', () => {
    expect(memberIdentityLine(undefined, undefined, '—')).toBe('—');
  });
});

/**
 * 🔴 `memberIdentity` is the single point every display slot must go through.
 *
 * 能红: return `{ primary: email }` from it (i.e. reinstate the `alias || email`
 * each page used to write inline) and the "never the handle" assertions fail.
 */
describe('memberIdentity — the one display point', () => {
  const handle = 'sso+feishu.6ad2973deea1fda6356a024a01de13dc@sso.local';
  const other = 'sso+feishu.9f3c1a04bb27ee5510cc44de77aa9012@sso.local';

  it('renders an SSO member as {name} · {discriminator}', () => {
    const id = memberIdentity(handle, '李承熙', '—');
    expect(id.primary).toBe('李承熙');
    expect(id.secondary).toBe('feishu:6ad2973d');
    expect(id.unambiguous).toBe('李承熙 · feishu:6ad2973d');
  });

  it('🚫 never emits the synthetic handle in any visible field', () => {
    for (const id of [memberIdentity(handle, '李承熙', '—'), memberIdentity(handle, undefined, '—')]) {
      for (const shown of [id.primary, id.secondary ?? '', id.unambiguous]) {
        expect(shown).not.toContain('@sso.local');
        expect(shown).not.toContain('sso+');
      }
    }
  });

  it('🔴 keeps two members with the same display name apart', () => {
    expect(memberIdentity(handle, '李承熙', '—').unambiguous).not.toBe(
      memberIdentity(other, '李承熙', '—').unambiguous,
    );
  });

  it('falls back to the discriminator — not the fallback — for an unnamed SSO member', () => {
    expect(memberIdentity(handle, undefined, '—').primary).toBe('feishu:6ad2973d');
  });

  it('pairs a named ordinary member with their real address', () => {
    const id = memberIdentity('member@acme.corp', 'Ada', '—');
    expect(id.primary).toBe('Ada');
    expect(id.secondary).toBe('member@acme.corp');
    expect(id.unambiguous).toBe('Ada · member@acme.corp');
  });

  it('shows an unnamed ordinary member as the address alone, with no empty second line', () => {
    const id = memberIdentity('member@acme.corp', undefined, '—');
    expect(id.primary).toBe('member@acme.corp');
    expect(id.secondary).toBeUndefined();
  });

  it('never renders a local-bypass sentinel as a person', () => {
    expect(memberIdentity('local@aikey.local', undefined, '—').primary).toBe('—');
  });

  it('uses the fallback only when there is nothing at all', () => {
    expect(memberIdentity(undefined, undefined, '—').primary).toBe('—');
    expect(memberIdentity('', '  ', '—').primary).toBe('—');
  });

  it('🔴 makes the discriminator an admin just read on screen searchable', () => {
    // The regression: searchText carried the full handle only, so pasting the
    // `feishu:6ad2973d` shown in a confirmation dialog returned zero rows.
    const id = memberIdentity(handle, '李承熙', '—');
    expect(id.searchText).toContain('feishu:6ad2973d');
    expect(id.searchText).toContain('李承熙');
    // The raw handle stays searchable for whoever has it from a server log.
    expect(id.searchText).toContain('sso+feishu');
  });

  it('lowercases the haystack so a mixed-case box still matches', () => {
    expect(memberIdentity('Ada@Acme.Corp', 'Ada Lovelace', '—').searchText).toContain('ada lovelace');
  });
});

/**
 * 🔴 The only identity helper whose output gets WRITTEN DOWN. A generated VK
 * alias lands in the database, billing views and CSV exports; unlike a rendering
 * bug it cannot be taken back.
 *
 * 能红: slug the local part of the handle instead (the pre-fix behaviour) and
 * the "no handle" assertion fails with `sso-feishu-6ad2973dee…`.
 */
describe('memberAliasSlug — persisted, so it must never carry the handle', () => {
  const handle = 'sso+feishu.6ad2973deea1fda6356a024a01de13dc@sso.local';

  it('uses the short discriminator for an SSO member', () => {
    expect(memberAliasSlug(handle)).toBe('feishu-6ad2973d');
  });

  it('🚫 never bakes the handle into a name that gets persisted', () => {
    const slug = memberAliasSlug(handle);
    expect(slug).not.toContain('sso');
    expect(slug).not.toContain('6ad2973deea1fda6356a024a01de13dc');
    expect(`key-${slug}-claude`).not.toContain('@');
  });

  it('keeps the familiar address prefix for an ordinary member', () => {
    expect(memberAliasSlug('wang.nan@acme.corp')).toBe('wang-nan');
  });

  it('is always a usable ASCII token', () => {
    expect(memberAliasSlug(undefined)).toBe('seat');
    expect(memberAliasSlug('@acme.corp')).toBe('seat');
    expect(memberAliasSlug('...@acme.corp')).toBe('seat');
    expect(/^[a-zA-Z0-9-]+$/.test(memberAliasSlug(handle))).toBe(true);
  });
});
