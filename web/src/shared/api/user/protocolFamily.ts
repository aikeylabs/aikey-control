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
