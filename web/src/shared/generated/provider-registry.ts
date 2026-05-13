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
