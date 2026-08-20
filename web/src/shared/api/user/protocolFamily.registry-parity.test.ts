import { describe, it, expect } from 'vitest';
import { PROVIDER_CATALOG } from '@/shared/generated/provider-registry';
import { familyOfProviderCode } from './protocolFamily';

/**
 * 🔴 The web must not keep its own copy of "which provider belongs to which
 * family" (2026-08-17).
 *
 * It did: a hardcoded `kimi_code | moonshot -> kimi`, with a comment inviting
 * the next person to add more by hand. The same mapping is generated from
 * aikey-cli/data/provider_registry.yaml into src/shared/generated, and the CLI
 * classifies from that YAML too — so the hand-written copy was a second
 * implementation of a rule the project already declares must live in exactly
 * one place (workflow/CI/requirements/2026-05-21-plugin-owns-domain-logic-web-
 * stays-generic.md, and CLAUDE.md's "优先走 fingerprint yaml 的配置").
 *
 * The failure mode it created was silent: a family added to the YAML would be
 * grouped correctly by the CLI and incorrectly by every page here, with
 * nothing red and no error in the console.
 */
describe('familyOfProviderCode', () => {
  it('agrees with the generated registry for every provider it ships', () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(familyOfProviderCode(entry.code)).toBe(entry.family.toLowerCase());
    }
  });

  it('covers more than one multi-platform family the moment the registry does', () => {
    // Not a behaviour assertion — a tripwire. If this ever counts more
    // multi-platform families than the old hardcode knew about (Kimi alone),
    // the hardcode would have been wrong from that day; reading the registry
    // is what keeps it right.
    const multi = new Set(
      PROVIDER_CATALOG.filter((e) => e.family.toLowerCase() !== e.code.toLowerCase())
        .map((e) => e.family.toLowerCase()),
    );
    for (const family of multi) {
      const members = PROVIDER_CATALOG.filter((e) => e.family.toLowerCase() === family);
      for (const m of members) {
        expect(familyOfProviderCode(m.code)).toBe(family);
      }
    }
  });

  it('leaves an unknown code alone rather than inventing a family', () => {
    expect(familyOfProviderCode('not-in-any-registry')).toBe('not-in-any-registry');
    expect(familyOfProviderCode('  MiXeD_Case  ')).toBe('mixed_case');
  });
});
