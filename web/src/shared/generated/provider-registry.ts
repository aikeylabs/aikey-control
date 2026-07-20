// AUTO-GENERATED FROM aikey-cli/data/provider_registry.yaml.
// DO NOT EDIT BY HAND. Run `npm run gen:provider-registry` or
// `npm run prebuild` to regenerate after changing the YAML.
//
// Single source of truth: see workflow/CI/requirements/
// 2026-05-12-provider-display-label-spec.md.

export interface ProviderRegistryEntry {
  /** Canonical provider_code stored in vault bindings. */
  code: string;
  /** Family code for UI grouping (defaults to `code` for single-platform families). */
  family: string;
  /** Base display label rendered prominently (chip text / picker row). */
  display: string;
  /** Brand alias rendered in muted parentheses next to `display`. Absent
   *  for families whose `display` already encodes a platform discriminator
   *  (Kimi) or whose canonical code is itself the recognizable brand. */
  displayAlias?: string;
  /** Aliases recognized for OAuth-broker normalization and search. */
  oauthAliases: readonly string[];
}

export const PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = [
  {
    code: "anthropic",
    family: "anthropic",
    display: "anthropic",
    displayAlias: "claude",
    oauthAliases: ["claude"],
  },
  {
    code: "openai",
    family: "openai",
    display: "openai",
    displayAlias: "codex",
    oauthAliases: ["gpt","chatgpt","codex"],
  },
  {
    code: "google",
    family: "google",
    display: "google",
    displayAlias: "gemini",
    oauthAliases: ["gemini"],
  },
  {
    code: "deepseek",
    family: "deepseek",
    display: "deepseek",
    oauthAliases: [],
  },
  {
    code: "kimi_code",
    family: "kimi",
    display: "kimi(kimi-code)",
    oauthAliases: ["kimi"],
  },
  {
    code: "moonshot",
    family: "kimi",
    display: "kimi(moonshot)",
    oauthAliases: [],
  },
  {
    code: "groq",
    family: "groq",
    display: "groq",
    oauthAliases: [],
  },
  {
    code: "xai",
    family: "xai",
    display: "xai",
    displayAlias: "grok",
    oauthAliases: ["grok","xai_grok"],
  },
  {
    code: "openrouter",
    family: "openrouter",
    display: "openrouter",
    oauthAliases: [],
  },
  {
    code: "perplexity",
    family: "perplexity",
    display: "perplexity",
    oauthAliases: ["pplx"],
  },
  {
    code: "zhipu",
    family: "zhipu",
    display: "zhipu",
    displayAlias: "GLM",
    oauthAliases: ["glm","zhipuai"],
  },
  {
    code: "qwen",
    family: "qwen",
    display: "qwen",
    displayAlias: "DashScope",
    oauthAliases: ["dashscope","tongyi"],
  },
  {
    code: "doubao",
    family: "doubao",
    display: "doubao",
    displayAlias: "ARK",
    oauthAliases: ["ark","volcengine"],
  },
  {
    code: "siliconflow",
    family: "siliconflow",
    display: "siliconflow",
    oauthAliases: [],
  },
];

/** Lookup table: code → entry. Includes oauth aliases mapped to the canonical entry. */
export const ENTRY_BY_CODE: ReadonlyMap<string, ProviderRegistryEntry> = (() => {
  const m = new Map<string, ProviderRegistryEntry>();
  for (const e of PROVIDER_REGISTRY) {
    m.set(e.code.toLowerCase(), e);
    for (const alias of e.oauthAliases) m.set(alias.toLowerCase(), e);
  }
  return m;
})();

/** Lookup table: family → first entry in that family. Useful for vault group
 *  chip rendering where we group by family and need the family-level
 *  display_alias (single-platform families). Multi-platform families like
 *  `kimi` return whichever entry comes first in the YAML; its display_alias
 *  is undefined by design so the group chip stays plain "kimi". */
export const ENTRY_BY_FAMILY: ReadonlyMap<string, ProviderRegistryEntry> = (() => {
  const m = new Map<string, ProviderRegistryEntry>();
  for (const e of PROVIDER_REGISTRY) {
    if (!m.has(e.family)) m.set(e.family, e);
  }
  return m;
})();

/** Render the display + parenthetical alias as a single string. Used where
 *  the renderer cannot dim a substring (e.g. plain-text lists). For the
 *  vault chip + CLI picker we render the parts separately so the alias
 *  can be visually muted. */
export function displayLabelFull(e: ProviderRegistryEntry): string {
  return e.displayAlias ? `${e.display} (${e.displayAlias})` : e.display;
}

/** P1i.5 (design D-14/D-15): the (provider → supported protocols) compatibility
 *  matrix, derived from provider_fingerprint.yaml `provider_routes` — the same
 *  source master + proxy read. A (provider, protocol) pair is legal iff listed
 *  here. The backend is authoritative — it rejects an illegal combo with
 *  PROVIDER_PROTOCOL_UNSUPPORTED. This matrix has no web consumer today; it is
 *  kept as data for a possible future form-side pre-filter. */
export const PROVIDER_PROTOCOL_MATRIX: ReadonlyMap<string, readonly string[]> = new Map([
  ["anthropic", ["anthropic"]],
  ["deepseek", ["openai_compatible"]],
  ["doubao", ["openai_compatible"]],
  ["google_gemini", ["gemini"]],
  ["groq", ["openai_compatible"]],
  ["huggingface", ["openai_compatible"]],
  ["kimi_code", ["openai_compatible"]],
  ["moonshot", ["openai_compatible"]],
  ["openai", ["openai_compatible"]],
  ["openrouter", ["openai_compatible"]],
  ["perplexity", ["openai_compatible"]],
  ["qwen", ["openai_compatible"]],
  ["siliconflow", ["openai_compatible"]],
  ["xai_grok", ["openai_compatible"]],
  ["yunwu", ["openai_compatible"]],
  ["zeroeleven", ["openai_compatible"]],
  ["zhipu", ["anthropic","openai_compatible"]],
]);

/** Protocols a provider can speak. Empty for an unknown/custom provider — the
 *  caller should then allow any protocol (custom providers aren't in the matrix)
 *  and lean on the backend guard. */
export function protocolsForProvider(providerCode: string): readonly string[] {
  return PROVIDER_PROTOCOL_MATRIX.get(providerCode.toLowerCase()) ?? [];
}

/** Providers that support a protocol (inverse lookup). */
export function providersForProtocol(protocol: string): readonly string[] {
  const out: string[] = [];
  for (const [p, protos] of PROVIDER_PROTOCOL_MATRIX) {
    if (protos.includes(protocol)) out.push(p);
  }
  return out;
}

/** Whether a (provider, protocol) combo is in the matrix. Unknown provider =>
 *  true (custom providers are not constrained here; backend is authoritative). */
export function isProviderProtocolSupported(providerCode: string, protocol: string): boolean {
  const protos = PROVIDER_PROTOCOL_MATRIX.get(providerCode.toLowerCase());
  return protos ? protos.includes(protocol) : true;
}
