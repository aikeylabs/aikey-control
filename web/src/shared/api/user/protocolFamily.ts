/** displayProtocolFamily normalizes a TEAM record's `protocol_family` /
 *  `protocol_type` for display + grouping on the key pages (Vault, Team-keys).
 *
 *  Why: an OAuth group VK whose seat has no routed account carries the raw binding
 *  `protocol_type` ("openai_compatible") instead of a provider family. The same pool
 *  WITH a routed account resolves to the account's provider_code ("openai"). So two
 *  codex pools rendered under two different labels ("openai_compatible" vs "openai")
 *  purely by routed-account state. OAuth pools are constrained to anthropic / openai
 *  (R34 one-pool-one-provider), so an `openai_compatible` POOL is unambiguously the
 *  openai provider — fold it to "openai" so a pool renders identically either way.
 *
 *  NOT a general protocol→provider map: `openai_compatible` is shared by
 *  deepseek / groq / kimi / … (see provider_fingerprint.yaml), but those cannot be
 *  OAuth pools today. Revisit if a non-openai openai_compatible provider becomes
 *  poolable. Display-only — routing wire values (route_token) are untouched.
 *
 *  Single source for BOTH key pages so the two never drift. */
export function displayProtocolFamily(protocolFamily: string | null | undefined): string {
  const lc = (protocolFamily ?? '').trim().toLowerCase();
  if (lc === 'openai_compatible') return 'openai';
  return lc;
}

/** provider_code → display family (V layer).
 *
 *  Source of truth: CLI provider registry (`data/provider_registry.yaml`
 *  RegistryEntry.family) + Rust `provider_registry::family_of()`. This frontend
 *  mapping mirrors only the MULTI-platform families (currently just Kimi);
 *  single-platform providers (anthropic / openai / google_gemini / ...) return the
 *  code unchanged — matching the registry's "family defaults to code" rule.
 *
 *  Why it exists: pages that expand a key's `supported_providers` (an array of
 *  provider_codeS, not families) must family-group correctly. The vault page has
 *  done this since 2026-04-30 / 2026-05-12; virtual-keys joined on 2026-07-13 when
 *  multi-protocol VKs turned out to render only their FIRST protocol. Lifted here
 *  from vault/index.tsx so both pages share ONE family口径 instead of duplicating it.
 */
export function familyOfProviderCode(code: string): string {
  const lc = (code ?? '').trim().toLowerCase();
  if (lc === 'kimi_code' || lc === 'moonshot' || lc === 'kimi') return 'kimi';
  // Add other multi-platform families here when they appear in the registry.
  return lc;
}
