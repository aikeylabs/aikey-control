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
  /** Whether the provider appears in normal API-key pickers. */
  picker: boolean;
}

/** Full display catalog, including providers hidden from normal API-key pickers. */
export const PROVIDER_CATALOG: readonly ProviderRegistryEntry[] = [
  {
    code: "anthropic",
    family: "anthropic",
    display: "anthropic",
    displayAlias: "claude",
    oauthAliases: ["claude"],
    picker: true,
  },
  {
    code: "openai",
    family: "openai",
    display: "openai",
    displayAlias: "codex",
    oauthAliases: ["gpt","chatgpt","codex"],
    picker: true,
  },
  {
    code: "mock",
    family: "mock",
    display: "Mock Provider",
    oauthAliases: [],
    picker: false,
  },
  {
    code: "google",
    family: "google",
    display: "google",
    displayAlias: "gemini",
    oauthAliases: ["gemini"],
    picker: false,
  },
  {
    code: "deepseek",
    family: "deepseek",
    display: "deepseek",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "kimi_code",
    family: "kimi",
    display: "kimi(kimi-code)",
    oauthAliases: ["kimi"],
    picker: true,
  },
  {
    code: "moonshot",
    family: "kimi",
    display: "kimi(moonshot)",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "groq",
    family: "groq",
    display: "groq",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "xai",
    family: "xai",
    display: "xai",
    displayAlias: "grok",
    oauthAliases: ["grok","xai_grok"],
    picker: true,
  },
  {
    code: "openrouter",
    family: "openrouter",
    display: "openrouter",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "perplexity",
    family: "perplexity",
    display: "perplexity",
    oauthAliases: ["pplx"],
    picker: true,
  },
  {
    code: "zhipu",
    family: "zhipu",
    display: "zhipu",
    displayAlias: "GLM",
    oauthAliases: ["glm","zhipuai"],
    picker: true,
  },
  {
    code: "qwen",
    family: "qwen",
    display: "qwen",
    displayAlias: "DashScope",
    oauthAliases: ["dashscope","tongyi"],
    picker: true,
  },
  {
    code: "doubao",
    family: "doubao",
    display: "doubao",
    displayAlias: "ARK",
    oauthAliases: ["ark","volcengine"],
    picker: true,
  },
  {
    code: "siliconflow",
    family: "siliconflow",
    display: "siliconflow",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "huggingface",
    family: "huggingface",
    display: "huggingface",
    displayAlias: "HF",
    oauthAliases: ["hf"],
    picker: true,
  },
  {
    code: "yunwu",
    family: "yunwu",
    display: "yunwu",
    displayAlias: "云雾",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "zeroeleven",
    family: "zeroeleven",
    display: "zeroeleven",
    displayAlias: "0011.ai",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "mistral",
    family: "mistral",
    display: "mistral",
    oauthAliases: ["mistralai"],
    picker: true,
  },
  {
    code: "together",
    family: "together",
    display: "together",
    oauthAliases: ["togetherai"],
    picker: true,
  },
  {
    code: "fireworks",
    family: "fireworks",
    display: "fireworks",
    oauthAliases: ["fireworksai"],
    picker: true,
  },
  {
    code: "cerebras",
    family: "cerebras",
    display: "cerebras",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "github_models",
    family: "github_models",
    display: "github_models",
    displayAlias: "GitHub Models",
    oauthAliases: ["githubmodels"],
    picker: true,
  },
  {
    code: "vercel_gateway",
    family: "vercel_gateway",
    display: "vercel_gateway",
    displayAlias: "Vercel AI Gateway",
    oauthAliases: ["vercel"],
    picker: true,
  },
  {
    code: "minimax",
    family: "minimax",
    display: "minimax",
    oauthAliases: ["minimaxi"],
    picker: true,
  },
  {
    code: "stepfun",
    family: "stepfun",
    display: "stepfun",
    displayAlias: "阶跃星辰",
    oauthAliases: ["step"],
    picker: true,
  },
  {
    code: "hunyuan",
    family: "hunyuan",
    display: "hunyuan",
    displayAlias: "腾讯混元",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "qianfan",
    family: "qianfan",
    display: "qianfan",
    displayAlias: "百度千帆",
    oauthAliases: ["ernie","wenxin"],
    picker: true,
  },
  {
    code: "sambanova",
    family: "sambanova",
    display: "sambanova",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "aihubmix",
    family: "aihubmix",
    display: "aihubmix",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "ai302",
    family: "ai302",
    display: "ai302",
    displayAlias: "302.AI",
    oauthAliases: ["302ai"],
    picker: true,
  },
];

/** Providers visible in normal API-key pickers. */
export const PROVIDER_REGISTRY: readonly ProviderRegistryEntry[] = [
  {
    code: "anthropic",
    family: "anthropic",
    display: "anthropic",
    displayAlias: "claude",
    oauthAliases: ["claude"],
    picker: true,
  },
  {
    code: "openai",
    family: "openai",
    display: "openai",
    displayAlias: "codex",
    oauthAliases: ["gpt","chatgpt","codex"],
    picker: true,
  },
  {
    code: "deepseek",
    family: "deepseek",
    display: "deepseek",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "kimi_code",
    family: "kimi",
    display: "kimi(kimi-code)",
    oauthAliases: ["kimi"],
    picker: true,
  },
  {
    code: "moonshot",
    family: "kimi",
    display: "kimi(moonshot)",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "groq",
    family: "groq",
    display: "groq",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "xai",
    family: "xai",
    display: "xai",
    displayAlias: "grok",
    oauthAliases: ["grok","xai_grok"],
    picker: true,
  },
  {
    code: "openrouter",
    family: "openrouter",
    display: "openrouter",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "perplexity",
    family: "perplexity",
    display: "perplexity",
    oauthAliases: ["pplx"],
    picker: true,
  },
  {
    code: "zhipu",
    family: "zhipu",
    display: "zhipu",
    displayAlias: "GLM",
    oauthAliases: ["glm","zhipuai"],
    picker: true,
  },
  {
    code: "qwen",
    family: "qwen",
    display: "qwen",
    displayAlias: "DashScope",
    oauthAliases: ["dashscope","tongyi"],
    picker: true,
  },
  {
    code: "doubao",
    family: "doubao",
    display: "doubao",
    displayAlias: "ARK",
    oauthAliases: ["ark","volcengine"],
    picker: true,
  },
  {
    code: "siliconflow",
    family: "siliconflow",
    display: "siliconflow",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "huggingface",
    family: "huggingface",
    display: "huggingface",
    displayAlias: "HF",
    oauthAliases: ["hf"],
    picker: true,
  },
  {
    code: "yunwu",
    family: "yunwu",
    display: "yunwu",
    displayAlias: "云雾",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "zeroeleven",
    family: "zeroeleven",
    display: "zeroeleven",
    displayAlias: "0011.ai",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "mistral",
    family: "mistral",
    display: "mistral",
    oauthAliases: ["mistralai"],
    picker: true,
  },
  {
    code: "together",
    family: "together",
    display: "together",
    oauthAliases: ["togetherai"],
    picker: true,
  },
  {
    code: "fireworks",
    family: "fireworks",
    display: "fireworks",
    oauthAliases: ["fireworksai"],
    picker: true,
  },
  {
    code: "cerebras",
    family: "cerebras",
    display: "cerebras",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "github_models",
    family: "github_models",
    display: "github_models",
    displayAlias: "GitHub Models",
    oauthAliases: ["githubmodels"],
    picker: true,
  },
  {
    code: "vercel_gateway",
    family: "vercel_gateway",
    display: "vercel_gateway",
    displayAlias: "Vercel AI Gateway",
    oauthAliases: ["vercel"],
    picker: true,
  },
  {
    code: "minimax",
    family: "minimax",
    display: "minimax",
    oauthAliases: ["minimaxi"],
    picker: true,
  },
  {
    code: "stepfun",
    family: "stepfun",
    display: "stepfun",
    displayAlias: "阶跃星辰",
    oauthAliases: ["step"],
    picker: true,
  },
  {
    code: "hunyuan",
    family: "hunyuan",
    display: "hunyuan",
    displayAlias: "腾讯混元",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "qianfan",
    family: "qianfan",
    display: "qianfan",
    displayAlias: "百度千帆",
    oauthAliases: ["ernie","wenxin"],
    picker: true,
  },
  {
    code: "sambanova",
    family: "sambanova",
    display: "sambanova",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "aihubmix",
    family: "aihubmix",
    display: "aihubmix",
    oauthAliases: [],
    picker: true,
  },
  {
    code: "ai302",
    family: "ai302",
    display: "ai302",
    displayAlias: "302.AI",
    oauthAliases: ["302ai"],
    picker: true,
  },
];

/** Lookup table: code → entry. Includes oauth aliases mapped to the canonical entry. */
export const ENTRY_BY_CODE: ReadonlyMap<string, ProviderRegistryEntry> = (() => {
  const m = new Map<string, ProviderRegistryEntry>();
  for (const e of PROVIDER_CATALOG) {
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
  for (const e of PROVIDER_CATALOG) {
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
  ["ai302", ["openai_compatible"]],
  ["aihubmix", ["openai_compatible"]],
  ["anthropic", ["anthropic"]],
  ["cerebras", ["openai_compatible"]],
  ["deepseek", ["anthropic","openai_compatible"]],
  ["doubao", ["anthropic","openai_compatible"]],
  ["fireworks", ["openai_compatible"]],
  ["github_models", ["openai_compatible"]],
  ["google", ["gemini"]],
  ["groq", ["openai_compatible"]],
  ["huggingface", ["openai_compatible"]],
  ["hunyuan", ["openai_compatible"]],
  ["kimi_code", ["openai_compatible"]],
  ["minimax", ["anthropic","openai_compatible"]],
  ["mistral", ["openai_compatible"]],
  ["mock", ["anthropic","openai_compatible"]],
  ["moonshot", ["anthropic","openai_compatible"]],
  ["openai", ["openai_compatible"]],
  ["openrouter", ["openai_compatible"]],
  ["perplexity", ["openai_compatible"]],
  ["qianfan", ["openai_compatible"]],
  ["qwen", ["anthropic","openai_compatible"]],
  ["sambanova", ["openai_compatible"]],
  ["siliconflow", ["openai_compatible"]],
  ["stepfun", ["openai_compatible"]],
  ["together", ["openai_compatible"]],
  ["vercel_gateway", ["openai_compatible"]],
  ["xai", ["openai_compatible"]],
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

/** One official endpoint for a (provider, protocol) pair. `url` is
 *  `base_url + version` — the address the proxy actually forwards to, computed
 *  by the same rule as Go's `EffectiveUpstream`, so what the dialog displays and
 *  what `LookupByBaseURL` resolves are the same string by construction. */
export interface ProviderEndpoint {
  /** base_url + version. Empty version means base_url verbatim (perplexity,
   *  github_models) — appending a version there yields a nonexistent address. */
  url: string;
  /** URL host, including port if the row carries one. */
  host: string;
  /** The row's path_prefix ('' for a host's catch-all row). */
  pathPrefix: string;
  /** Declared canonical endpoint when the pair has several rows. */
  isDefault: boolean;
  /** 'b' = the endpoint research found consistent secondary sources but no
   *  official page stating this URL. Surfaced in the UI as a "community
   *  verified" badge — an admin should know which addresses we could not
   *  confirm from the vendor itself. Read from the YAML row's inline comment. */
  tier?: 'b';
}

/** Every official endpoint, keyed `${provider}|${protocol}`.
 *
 *  Mirrors the FULL provider_routes table — picker-hidden providers (mock,
 *  google) included — so the cross-language parity test can compare it against
 *  Go's answers over the whole table. Visibility is applied by the query
 *  helpers below, not by omitting rows here. */
export const PROVIDER_ENDPOINTS: ReadonlyMap<string, readonly ProviderEndpoint[]> = new Map([
  ["ai302|openai_compatible", [{"url":"https://api.302.ai/v1","host":"api.302.ai","pathPrefix":"","isDefault":false,"tier":"b"}]],
  ["aihubmix|openai_compatible", [{"url":"https://aihubmix.com/v1","host":"aihubmix.com","pathPrefix":"","isDefault":true,"tier":"b"},{"url":"https://api.aihubmix.com/v1","host":"api.aihubmix.com","pathPrefix":"","isDefault":false,"tier":"b"}]],
  ["anthropic|anthropic", [{"url":"https://api.anthropic.com/v1","host":"api.anthropic.com","pathPrefix":"","isDefault":false}]],
  ["cerebras|openai_compatible", [{"url":"https://api.cerebras.ai/v1","host":"api.cerebras.ai","pathPrefix":"","isDefault":false}]],
  ["deepseek|anthropic", [{"url":"https://api.deepseek.com/anthropic/v1","host":"api.deepseek.com","pathPrefix":"/anthropic","isDefault":false}]],
  ["deepseek|openai_compatible", [{"url":"https://api.deepseek.com/v1","host":"api.deepseek.com","pathPrefix":"","isDefault":false}]],
  ["doubao|anthropic", [{"url":"https://ark.cn-beijing.volces.com/api/coding/v1","host":"ark.cn-beijing.volces.com","pathPrefix":"/api/coding","isDefault":false}]],
  ["doubao|openai_compatible", [{"url":"https://ark.cn-beijing.volces.com/api/v3","host":"ark.cn-beijing.volces.com","pathPrefix":"","isDefault":false},{"url":"https://ark.cn-beijing.volces.com/api/coding/v3","host":"ark.cn-beijing.volces.com","pathPrefix":"/api/coding/v3","isDefault":false}]],
  ["fireworks|openai_compatible", [{"url":"https://api.fireworks.ai/inference/v1","host":"api.fireworks.ai","pathPrefix":"","isDefault":false}]],
  ["github_models|openai_compatible", [{"url":"https://models.github.ai/inference","host":"models.github.ai","pathPrefix":"","isDefault":false}]],
  ["google|gemini", [{"url":"https://generativelanguage.googleapis.com/v1beta","host":"generativelanguage.googleapis.com","pathPrefix":"","isDefault":false}]],
  ["groq|openai_compatible", [{"url":"https://api.groq.com/openai/v1","host":"api.groq.com","pathPrefix":"","isDefault":false}]],
  ["huggingface|openai_compatible", [{"url":"https://api-inference.huggingface.co/v1","host":"api-inference.huggingface.co","pathPrefix":"","isDefault":false}]],
  ["hunyuan|openai_compatible", [{"url":"https://api.hunyuan.cloud.tencent.com/v1","host":"api.hunyuan.cloud.tencent.com","pathPrefix":"","isDefault":false}]],
  ["kimi_code|openai_compatible", [{"url":"https://api.kimi.com/coding/v1","host":"api.kimi.com","pathPrefix":"","isDefault":true},{"url":"https://api.kimi.com/coding/v1","host":"www.kimi.com","pathPrefix":"","isDefault":false}]],
  ["minimax|anthropic", [{"url":"https://api.minimaxi.com/anthropic/v1","host":"api.minimaxi.com","pathPrefix":"/anthropic","isDefault":true},{"url":"https://api.minimax.io/anthropic/v1","host":"api.minimax.io","pathPrefix":"/anthropic","isDefault":false}]],
  ["minimax|openai_compatible", [{"url":"https://api.minimaxi.com/v1","host":"api.minimaxi.com","pathPrefix":"","isDefault":true},{"url":"https://api.minimax.io/v1","host":"api.minimax.io","pathPrefix":"","isDefault":false}]],
  ["mistral|openai_compatible", [{"url":"https://api.mistral.ai/v1","host":"api.mistral.ai","pathPrefix":"","isDefault":false}]],
  ["mock|anthropic", [{"url":"http://mock-provider.aikey.internal/anthropic/v1","host":"mock-provider.aikey.internal","pathPrefix":"/anthropic","isDefault":false}]],
  ["mock|openai_compatible", [{"url":"http://mock-provider.aikey.internal/openai/v1","host":"mock-provider.aikey.internal","pathPrefix":"/openai","isDefault":false}]],
  ["moonshot|anthropic", [{"url":"https://api.moonshot.cn/anthropic/v1","host":"api.moonshot.cn","pathPrefix":"/anthropic","isDefault":true},{"url":"https://api.moonshot.ai/anthropic/v1","host":"api.moonshot.ai","pathPrefix":"/anthropic","isDefault":false}]],
  ["moonshot|openai_compatible", [{"url":"https://api.moonshot.cn/v1","host":"api.moonshot.cn","pathPrefix":"","isDefault":true},{"url":"https://api.moonshot.cn/v1","host":"platform.moonshot.cn","pathPrefix":"","isDefault":false},{"url":"https://api.moonshot.ai/v1","host":"api.moonshot.ai","pathPrefix":"","isDefault":false}]],
  ["openai|openai_compatible", [{"url":"https://api.openai.com/v1","host":"api.openai.com","pathPrefix":"","isDefault":false}]],
  ["openrouter|openai_compatible", [{"url":"https://openrouter.ai/api/v1","host":"openrouter.ai","pathPrefix":"","isDefault":false}]],
  ["perplexity|openai_compatible", [{"url":"https://api.perplexity.ai","host":"api.perplexity.ai","pathPrefix":"","isDefault":false}]],
  ["qianfan|openai_compatible", [{"url":"https://qianfan.baidubce.com/v2","host":"qianfan.baidubce.com","pathPrefix":"","isDefault":false}]],
  ["qwen|anthropic", [{"url":"https://dashscope.aliyuncs.com/api/v2/apps/claude-code-proxy/v1","host":"dashscope.aliyuncs.com","pathPrefix":"/api/v2/apps/claude-code-proxy","isDefault":false}]],
  ["qwen|openai_compatible", [{"url":"https://dashscope.aliyuncs.com/compatible-mode/v1","host":"dashscope.aliyuncs.com","pathPrefix":"","isDefault":false}]],
  ["sambanova|openai_compatible", [{"url":"https://api.sambanova.ai/v1","host":"api.sambanova.ai","pathPrefix":"","isDefault":false,"tier":"b"}]],
  ["siliconflow|openai_compatible", [{"url":"https://api.siliconflow.cn/v1","host":"api.siliconflow.cn","pathPrefix":"","isDefault":false}]],
  ["stepfun|openai_compatible", [{"url":"https://api.stepfun.com/v1","host":"api.stepfun.com","pathPrefix":"","isDefault":false}]],
  ["together|openai_compatible", [{"url":"https://api.together.ai/v1","host":"api.together.ai","pathPrefix":"","isDefault":true},{"url":"https://api.together.xyz/v1","host":"api.together.xyz","pathPrefix":"","isDefault":false}]],
  ["vercel_gateway|openai_compatible", [{"url":"https://ai-gateway.vercel.sh/v1","host":"ai-gateway.vercel.sh","pathPrefix":"","isDefault":false}]],
  ["xai|openai_compatible", [{"url":"https://api.x.ai/v1","host":"api.x.ai","pathPrefix":"","isDefault":false}]],
  ["yunwu|openai_compatible", [{"url":"https://yunwu.ai/v1","host":"yunwu.ai","pathPrefix":"","isDefault":false}]],
  ["zeroeleven|openai_compatible", [{"url":"https://aicoding.2233.ai/v1","host":"aicoding.2233.ai","pathPrefix":"","isDefault":false}]],
  ["zhipu|anthropic", [{"url":"https://open.bigmodel.cn/api/anthropic/v1","host":"open.bigmodel.cn","pathPrefix":"/api/anthropic","isDefault":true},{"url":"https://api.z.ai/api/anthropic/v1","host":"api.z.ai","pathPrefix":"/api/anthropic","isDefault":false}]],
  ["zhipu|openai_compatible", [{"url":"https://open.bigmodel.cn/api/paas","host":"open.bigmodel.cn","pathPrefix":"","isDefault":false},{"url":"https://open.bigmodel.cn/api/coding/paas/v4","host":"open.bigmodel.cn","pathPrefix":"/api/coding/paas/v4","isDefault":false},{"url":"https://api.z.ai/api/paas/v4","host":"api.z.ai","pathPrefix":"/api/paas","isDefault":false,"tier":"b"}]],
]);

/** Protocols the credential dialog may offer, with how many providers speak each.
 *
 *  DERIVED: the protocols of rows whose provider is picker-visible. `gemini` is
 *  absent because google is `picker: false` (R-8) — aikey-proxy registers no
 *  gemini adapter, so a credential created on it 502s on its first request.
 *  🚫 There is no hard-coded exclusion list; flipping that flag back would put
 *  the protocol here again, and aikey-proxy's TestFence_I7_* would go red. */
export const PROTOCOL_CATALOG: readonly { value: string; providerCount: number }[] = [
  {
    "value": "anthropic",
    "providerCount": 7
  },
  {
    "value": "openai_compatible",
    "providerCount": 28
  }
];

/** Every official endpoint for a (provider, protocol) pair, in YAML order. */
export function endpointsFor(provider: string, protocol: string): readonly ProviderEndpoint[] {
  return PROVIDER_ENDPOINTS.get(`${provider.toLowerCase()}|${protocol.toLowerCase()}`) ?? [];
}

/** The endpoint to auto-fill for a (provider, protocol) pair, or `undefined`
 *  when the table declares no truthful default.
 *
 *  🔴 Replicates Go's `ByProviderProtocol` four-stage decision EXACTLY:
 *    1. exactly one row flagged `default`  → that row
 *    2. more than one flagged default      → undefined (the YAML is ambiguous)
 *    3. exactly one row at all             → that row
 *    4. exactly one row with an empty path_prefix → that row (the catch-all)
 *    otherwise                             → undefined
 *
 *  🚫 It must never fall back to `endpoints[0]`. That would make YAML row order
 *  a routing decision the user cannot see and no error would ever report —
 *  which is precisely what the `default` field exists to prevent. Returning
 *  undefined lets the dialog leave the box empty and say why. */
export function defaultEndpointFor(
  provider: string,
  protocol: string,
): ProviderEndpoint | undefined {
  return pickDefaultEndpoint(endpointsFor(provider, protocol));
}

/** The four-stage decision itself, over an arbitrary row set.
 *
 *  Exported separately so a test can drive the AMBIGUOUS case directly. The
 *  real table satisfies I-5 — every declared (provider, protocol) pair resolves
 *  — which means every `ok:false` in it comes from a pair that simply does not
 *  exist, where returning undefined is trivially correct. The case that actually
 *  distinguishes a correct implementation from `rows[0]` is "several rows, none
 *  flagged default", and the table deliberately contains none of those. Without
 *  this seam that case could only be tested by breaking the real YAML. */
export function pickDefaultEndpoint(
  rows: readonly ProviderEndpoint[],
): ProviderEndpoint | undefined {
  const declared = rows.filter((r) => r.isDefault);
  if (declared.length === 1) return declared[0];
  if (declared.length > 1) return undefined;
  if (rows.length === 1) return rows[0];
  const catchAll = rows.filter((r) => r.pathPrefix === '');
  if (catchAll.length === 1) return catchAll[0];
  return undefined;
}

/** Providers that speak a protocol AND are visible in the credential dialog.
 *  This is the dialog's ONLY provider source — there is no second list. */
export function pickerProvidersForProtocol(protocol: string): readonly string[] {
  const want = protocol.toLowerCase();
  const out: string[] = [];
  for (const key of PROVIDER_ENDPOINTS.keys()) {
    const [provider, proto] = key.split('|');
    if (proto !== want) continue;
    const entry = ENTRY_BY_CODE.get(provider);
    if (!entry || !entry.picker) continue;
    if (!out.includes(provider)) out.push(provider);
  }
  return out;
}

/** Every provider the dialog may offer, across all protocols. The "all
 *  protocols" option shows exactly this set, and I-10 requires it to equal the
 *  union of the per-protocol subsets — which it does by construction here. */
export function allPickerProviders(): readonly string[] {
  const out: string[] = [];
  for (const { value } of PROTOCOL_CATALOG) {
    for (const p of pickerProvidersForProtocol(value)) if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Protocols a provider speaks, restricted to the dialog's catalogue. */
export function pickerProtocolsForProvider(provider: string): readonly string[] {
  const want = provider.toLowerCase();
  return PROTOCOL_CATALOG.map((p) => p.value).filter((proto) => endpointsFor(want, proto).length > 0);
}
