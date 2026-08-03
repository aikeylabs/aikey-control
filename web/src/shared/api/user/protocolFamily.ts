/** displayProtocolFamily normalizes a TEAM record's wire protocol into the
 *  user-facing Client Route used by the key pages (Vault, Team Keys).
 *
 *  `openai_compatible` is the endpoint protocol; `openai` is the Codex/OpenAI
 *  client-route label. This normalization never reads or returns provider data:
 *  Mock, OpenAI, Zhipu, and other providers can all sit behind that same protocol
 *  while remaining distinct on the provider axis.
 *
 *  Display-only — routing wire values and provider identity are untouched.
 *
 *  Single source for BOTH key pages so the two never drift. */
export function displayProtocolFamily(protocol: string | null | undefined): string {
  const lc = (protocol ?? '').trim().toLowerCase();
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

/** Minimal two-axis binding shape shared by the key pages. */
export interface ProtocolProviderBinding {
  protocol?: string | null;
  provider?: string | null;
  provider_display_alias?: string | null;
  /** ORDER axis (I19) — which hop of its lane this binding is. Both fields come
   *  straight off the binding row.
   *
   *  🔴 Optional, and absent is NOT 1/"primary": a control plane predating them
   *  sends neither, and the key list renders no role chip at all rather than
   *  inventing a primary. `priority` ships next to the role because two hops at
   *  the same priority is a reachable state in which no hop is first — a fact
   *  only two equal numbers can report. */
  priority?: number | null;
  fallback_role?: string | null;
}

/**
 * Distinct Client Routes from the binding read model.
 *
 * `bindings[].protocol` is endpoint truth, then displayProtocolFamily maps that
 * canonical wire value to the client selection slot. The legacy scalar is
 * accepted only when an older server/CLI has not delivered bindings yet.
 * Provider values are deliberately never consulted here.
 */
export function bindingClientRoutes(
  bindings: ProtocolProviderBinding[] | null | undefined,
  legacyProtocol?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const binding of bindings ?? []) {
    const family = displayProtocolFamily(binding.protocol);
    if (family && !seen.has(family)) {
      seen.add(family);
      out.push(family);
    }
  }
  if (out.length > 0) return out;

  const fallback = displayProtocolFamily(legacyProtocol);
  return fallback ? [fallback] : [];
}

/** Provider codes behind one Client Route, preserving binding order. */
export function bindingProviderCodes(
  bindings: ProtocolProviderBinding[] | null | undefined,
  clientRoute?: string | null,
): string[] {
  const wanted = displayProtocolFamily(clientRoute);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const binding of bindings ?? []) {
    if (wanted && displayProtocolFamily(binding.protocol) !== wanted) continue;
    const provider = (binding.provider ?? '').trim().toLowerCase();
    if (provider && !seen.has(provider)) {
      seen.add(provider);
      out.push(provider);
    }
  }
  return out;
}

/** Provider display labels behind one Client Route (`code(alias)`). */
export function bindingProviderLabels(
  bindings: ProtocolProviderBinding[] | null | undefined,
  clientRoute?: string | null,
): string[] {
  const wanted = displayProtocolFamily(clientRoute);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const binding of bindings ?? []) {
    if (wanted && displayProtocolFamily(binding.protocol) !== wanted) continue;
    const provider = (binding.provider ?? '').trim().toLowerCase();
    if (!provider) continue;
    const alias = (binding.provider_display_alias ?? '').trim();
    const label = alias ? `${provider}(${alias})` : provider;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}
