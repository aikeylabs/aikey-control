/**
 * User Quick Import page — /user/import (renamed from "Bulk Import" 2026-04-22)
 *
 * Stage 5 MVP implementation. One route, three visual states driven by a
 * local `state` enum: empty | working | done. Vault unlock is an inline
 * banner (not a separate route). No modals, no drawers — per the
 * Q-UI-MINIMAL principles in
 * roadmap20260320/技术实现/阶段3-增强版KEY管理/批量导入-WebUI极简版-v2.md.
 *
 * Templates driving this layout:
 *   .superdesign/design_iterations/user_bulk_import_empty_2.html
 *   .superdesign/design_iterations/user_bulk_import_working_2.html
 *   .superdesign/design_iterations/user_bulk_import_done_2.html
 *   .superdesign/design_iterations/user_bulk_import_merged_3state.html (3-in-1 reference)
 *
 * Stage 5 scope delivered here:
 *   - Three-state layout with data-driven rendering
 *   - Inline Unlock banner (locked → password input → /api/user/vault/unlock)
 *   - Parse → draft list (calls /api/user/import/parse)
 *   - Import → batch_import (calls /api/user/import/confirm)
 *   - Basic orphan/weak/OAuth row variants
 *
 * Not yet wired (queued for §5 continuation):
 *   - Manual add card (inline)
 *   - Undo toast with countdown
 *   - OAuth handoff command copy + state
 *   - Source-line highlighting hover-sync
 *   - Virtual scrolling for > 100 drafts
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  importApi,
  type Candidate,
  type DraftRecord,
  type EndpointGroup,
  type ParseResponse,
  type ConfirmItem,
  type ConfirmResponse,
} from '@/shared/api/user/import';
import { pickHookReadiness } from '@/shared/api/user/vault';
import { useHookReadinessStore } from '@/store';
import { HookReadinessBanner } from '@/shared/components/HookReadinessBanner';
import { ProviderMultiSelect, providerChipClassFromId } from '@/shared/ui/ProviderMultiSelect';

type PageState = 'empty' | 'working' | 'done';

/**
 * v4.1 Stage 3 Phase E: UI row state wraps a DraftRecord (L2 grouper 产出),
 * 不再是单个 Candidate。
 *
 * - `record.fields` 已经由 backend grouper 分好 email/password/api_key/base_url
 * - `selected` 默认由 draft_type + provider 推断确定
 * - `expanded` 控制卡片 field rows 展开/折叠
 */
interface DraftRow {
  record: DraftRecord;
  selected: boolean;
  expanded: boolean;
  /**
   * 用户手动选择的 type (KEY / OAUTH);null = 跟 backend `record.draft_type` 或默认计算值走。
   *
   * 合约:backend CLI 的 `DraftType::classify` 已实现 email-first(email+api_key → OAUTH),
   * 所以正常情况下 UI 只需消费 `record.draft_type`。此字段用于用户下拉切换时的手动覆盖。
   */
  userType: 'KEY' | 'OAUTH' | null;
  /**
   * v4.1 Stage 6+: "use official" 按钮点击前的 base_url,用于 toggle 回退。
   *
   * 状态机(见 BaseUrlRow):
   *   - 用户点 "use official":prev = current; base_url = official
   *   - 用户点 "revert":base_url = prev; prev = null
   *   - 用户手改 input:prev = null (回退不再有意义 — 用户已接受新的 custom 值)
   *   null = 没有可回退的历史(初始状态,或刚完成 revert,或用户主动编辑过)。
   */
  prevBaseUrl: string | null;
  /** 派生标签 —— 基于 effectiveType 计算 */
  isOAuth: boolean;
  isWeak: boolean;
}

/**
 * 规则 2 · 默认 type 计算 (后端有 `draft_type` 时优先采用 backend 值;否则本地兜底)。
 *
 * 后端兜底一致性:和 `aikey-cli/src/commands_internal/parse/grouping/types.rs::DraftType::classify`
 * 完全对齐 —— email-first → OAUTH,无 email 但有 api_key → KEY,仅 password → OAUTH,其他 → KEY。
 */
function computeDefaultType(record: DraftRecord): 'KEY' | 'OAUTH' {
  // Backend v4.1 Post-Stage4 已输出 UPPERCASE 'KEY' | 'OAUTH'
  if (record.draft_type === 'KEY' || record.draft_type === 'OAUTH') return record.draft_type;
  // 兜底(理论不该走到):复刻 backend 规则
  const f = record.fields;
  if (f.email) return 'OAUTH';
  if (f.api_key) return 'KEY';
  if (f.password) return 'OAUTH';
  return 'KEY';
}

/** 用户未手选时走 default;手选了走手选。供 DraftRowCard / runImport 共用 */
function computeEffectiveType(row: DraftRow): 'KEY' | 'OAUTH' {
  return row.userType ?? computeDefaultType(row.record);
}

/**
 * v4.1 UI-03 fix: provider 显示 chip 时只取首 token,避免多词 hint 挤爆 chip。
 *
 * 例:block Title 行 "unknown oauth:" → provider_hint="unknown oauth" → displayToken="unknown"
 * 若 hint 为 undefined 或空,返回 undefined。
 */
function firstToken(hint: string | undefined): string | undefined {
  if (!hint) return undefined;
  const t = hint.trim().split(/\s+/)[0];
  return t.length > 0 ? t : undefined;
}

/**
 * F-4 P0 review fix (2026-04-23): 敏感字段的 "prefix + *** + suffix" 遮罩。
 *
 * 为什么是 "prefix + suffix" 而不是 `type="password"` 圆点:
 *   - Import 场景的核心诉求是"校验粘贴是否完整/正确",圆点把首尾也遮了校验不了
 *   - 首 10 + 末 6 保留识别度(用户认得出 `sk-ant-api03` / `AKIA` 等特征前缀 +
 *     末尾指纹),但**中段**值不会出现在截屏 / 录屏 / 屏幕共享里
 *
 * 长度处理:
 *   - len < 22(10 + 6 + 至少 3 ***) → 返回全部 `*` 等长(退化为不泄露任何字符)
 *   - len ≥ 22 → `前10 + '***' + 后6`
 *
 * @example
 *   maskSecret("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV") → "sk-ant-api***RSTUV"(简化)
 *   实际: 取字符数(多语言安全),避免 emoji / CJK 被截半。
 */
function maskSecret(v: string): string {
  const chars = Array.from(v);
  if (chars.length < 22) {
    return '*'.repeat(chars.length);
  }
  return chars.slice(0, 10).join('') + '***' + chars.slice(-6).join('');
}

/**
 * Map import error_code → one-line user-facing hint (P0 review fix F-1, 2026-04-23).
 *
 * Fallback order:
 *   1. Known code in IMPORT_ERROR_HINTS (covers the top surface: text too large,
 *      vault locked / key invalid, conflict, cli timeout, bad request).
 *   2. Raw error_message from envelope (cli-authored, usually readable).
 *   3. Generic "Parse failed" / "Import failed" by stage.
 *
 * `stage`:"parse" | "confirm"` distinguishes the two mutations for the generic
 * fallback copy.
 */
const IMPORT_ERROR_HINTS: Record<string, string> = {
  I_PARSE_TEXT_TOO_LARGE: 'Pasted text is too large — split into smaller chunks (≤ 1 MiB).',
  I_STDIN_INVALID_JSON:   'Request is malformed. Refresh the page and retry.',
  I_BAD_REQUEST:          'Request is malformed. Refresh the page and retry.',
  I_VAULT_LOCKED:         'Vault is locked. Unlock it above and try again.',
  I_VAULT_NO_SESSION:     'Session expired. Unlock the vault and try again.',
  I_VAULT_UNLOCK_FAILED:  'Vault key could not be verified. Unlock again with the correct master password.',
  I_CREDENTIAL_CONFLICT:  'One or more aliases conflict with existing entries. Rename them or choose Replace.',
  I_INVALID_ALIAS:        'One or more aliases are invalid (empty / too long / contain control chars).',
  I_CLI_TIMEOUT:          'The local CLI did not respond in time. Retry; if it persists, restart aikey-local-server.',
  I_CLI_NOT_FOUND:        'The local aikey CLI binary was not found. Install it and retry.',
  I_CLI_SPAWN_FAILED:     'The local CLI failed to start. See server logs for details.',
  I_CLI_MALFORMED_REPLY:  'The local CLI returned an invalid response. See server logs for details.',
};

function friendlyImportError(
  code: string | undefined,
  raw: string | undefined,
  stage: 'parse' | 'confirm',
): string {
  if (code && IMPORT_ERROR_HINTS[code]) return IMPORT_ERROR_HINTS[code];
  if (raw && raw.trim().length > 0 && raw.length <= 240) return raw;
  return stage === 'parse' ? 'Parse failed. Please try again.' : 'Import failed. Please try again.';
}

/**
 * 从 DraftRecord 派生初始 UI state (selected/expanded/userType 等)。
 */
/**
 * v4.2: 把 title → alias 统一 (web-layer override)。
 *
 * 规则 (来自 2026-04-23 用户反馈):
 *   1. 抽到 title  → alias = sanitize(title) (batch 内 dedup -N 后缀)
 *   2. 抽不到 title → 保留 backend 生成的 alias,回填 title = alias
 *   3. 统一后 `record.alias === record.fields.title`,UI preview 始终有可读标识
 *
 * 放 web 层而非 Rust handler 的 Why: backend 已对自动生成 alias 做 vault 去重,
 * 不想为 title-override 路径再引一次 vault alias 查询。intra-batch 冲突在这里
 * 就解决;vault-side 冲突由 confirm-time `I_CREDENTIAL_CONFLICT` 兜底,UI 允许
 * 用户直接编辑 alias 覆盖。
 *
 * Sanitization:
 *   - 保留: ASCII alnum / `_` / `-` (英文部分)
 *   - 其他 (含 CJK / 日韩文 / 空格 / 标点) → `_`,连续 `_` 合并,首尾 `_/-` 去掉
 *   - 全部转小写 (alias 字典风格统一 + 避免 "Kimi" vs "kimi" 在 vault 视作两条)
 *   - 截到 30 字符 (CLI 限 128,留足缓冲给 `-N` 后缀 + UI 卡片不被长名顶撑)
 *   - 纯 CJK title (如 "工作号") 清理后为空 → caller 退回自动生成 alias
 *
 * Why 英文-only: alias 参与 shell 变量名 / 文件路径 / URL query key 等场景,
 * 非 ASCII 字符在 Windows PowerShell / Git Bash / 某些 shell completion 会出问题。
 * 安全起见 alias 基准统一到英文,真有 CJK title 时让用户手动编辑覆盖。
 */
function sanitizeTitleToAlias(title: string): string {
  const cleaned = Array.from(title)
    .map((c) => (/[A-Za-z0-9_-]/.test(c) ? c : '_'))
    .join('');
  const collapsed = cleaned.replace(/_+/g, '_');
  const trimmed = collapsed.replace(/^[_-]+|[_-]+$/g, '').toLowerCase();
  return Array.from(trimmed).slice(0, 30).join('');
}

function applyTitleAliasUnification(records: DraftRecord[]): DraftRecord[] {
  const used = new Set<string>();
  return records.map((r) => {
    const rawTitle = r.fields.title;
    const sanitized = rawTitle ? sanitizeTitleToAlias(rawTitle) : '';
    // 空 sanitize 结果 (title='!!!' 类) 退回 backend alias;否则以 sanitize 为 base
    const base = sanitized.length > 0 ? sanitized : r.alias;
    let finalAlias = base;
    if (used.has(finalAlias)) {
      let n = 2;
      while (used.has(`${base}-${n}`)) n++;
      finalAlias = `${base}-${n}`;
    }
    used.add(finalAlias);
    return {
      ...r,
      alias: finalAlias,
      fields: { ...r.fields, title: finalAlias },
    };
  });
}

/**
 * Frontend-only host aliases for brand domains that aren't reachable via
 * either YAML map (`family_base_urls` + `family_login_urls`) but are still
 * commonly pasted by users. Kept narrow — every entry here is something
 * the YAML can't supply (apex / alternate brand domains, or sub-brands
 * that don't suffix-cover via the YAML hosts).
 *
 * Most "platform / console / chat / aistudio" subdomains are NOT here —
 * they come from `family_login_urls` via the rules endpoint. Adding to
 * this table is a sign the YAML should grow instead.
 *
 * Keys are pre-normalized hosts (lowercase, no `www.`). Matching is
 * label-boundary aware (`lookupFamilyByHost`): exact match wins, otherwise
 * the incoming host must end with `.${key}` so `platform.claude.com`
 * resolves to `claude.com` but `evilclaude.com` does not.
 */
const OFFICIAL_HOST_ALIASES: Record<string, string> = {
  // anthropic — apex / brand domains; YAML covers api.anthropic.com + claude.ai
  'anthropic.com': 'anthropic',
  'claude.com':    'anthropic',
  // openai — apex; YAML covers api.openai.com + chatgpt.com
  'openai.com':    'openai',
  // kimi / moonshot — apex / alternate brand; YAML covers api.moonshot.cn + www.kimi.com
  'moonshot.cn':   'kimi',
  'moonshot.ai':   'kimi',
  // deepseek — apex; YAML covers api.deepseek.com + platform.deepseek.com
  'deepseek.com':  'deepseek',
  // gemini — Gemini-branded chat domain not in YAML; aistudio.google.com is
  // already there via family_login_urls. Aliasing google.com would bleed
  // into unrelated Google products, so keep this Gemini-specific.
  'gemini.google.com': 'google_gemini',
  // groq — apex; YAML covers api.groq.com + console.groq.com
  'groq.com':      'groq',
  // xai_grok — apex; YAML covers api.x.ai + console.x.ai
  'x.ai':          'xai_grok',
  // zhipu — alternate brand spelling; YAML covers open.bigmodel.cn + bigmodel.cn
  'zhipuai.cn':    'zhipu',
  'zhipuai.com':   'zhipu',
  // doubao / volcengine ark — neither apex is in YAML
  'volces.com':       'doubao',
  'volcengine.com':   'doubao',
  // siliconflow — apex; YAML covers api.siliconflow.cn + cloud.siliconflow.cn
  'siliconflow.cn':   'siliconflow',
  // zeroeleven — bare 2233.ai brand; YAML covers aicoding.2233.ai + 0011.ai
  '2233.ai':       'zeroeleven',
};

/**
 * Resolve an incoming host against the official host map.
 *
 * Exact match wins; otherwise the host must end with `.${key}` so
 * subdomains resolve correctly (`platform.claude.com` → `claude.com`)
 * without false-positives on coincidental string suffixes
 * (`evilclaude.com` → no match because there is no preceding dot).
 *
 * If the map has multiple suffix matches (e.g. `api.openai.com` from
 * family_base_urls + `openai.com` from aliases), the more specific
 * (longer) key wins.
 */
function lookupFamilyByHost(host: string, hostToFamily: Map<string, string>): string | null {
  const exact = hostToFamily.get(host);
  if (exact) return exact;
  let bestKey = '';
  let bestFamily: string | null = null;
  for (const [key, family] of hostToFamily) {
    if (host.endsWith('.' + key) && key.length > bestKey.length) {
      bestKey = key;
      bestFamily = family;
    }
  }
  return bestFamily;
}

/**
 * Parse a host out of a user-entered URL fragment, normalize for matching.
 * Returns null on anything we can't confidently extract a host from.
 *
 * - `https://api.anthropic.com/v1/foo` → `api.anthropic.com`
 * - `claude.com/anything`              → `claude.com`        (auto-prepends scheme)
 * - `WWW.Claude.com`                   → `claude.com`        (lowercase + strip www.)
 * - empty / single token / `x@y`       → null
 */
function normalizeHost(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(candidate).hostname;
  } catch {
    return null;
  }
  if (!host) return null;
  host = host.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

/**
 * Build a host → family lookup from both YAML maps (`family_base_urls`
 * + `family_login_urls`) plus the static frontend alias table.
 *
 * Insertion order matters only for collisions, which shouldn't happen
 * within a single family but may across families if YAML hosts overlap
 * with aliases. Aliases write last so they win (they're hand-curated
 * for our specific UX needs).
 */
function buildOfficialHostToFamily(
  familyBaseUrls: Record<string, string> | undefined,
  familyLoginUrls: Record<string, string> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  const ingest = (m: Record<string, string> | undefined) => {
    if (!m) return;
    for (const [family, url] of Object.entries(m)) {
      const host = normalizeHost(url);
      if (host) map.set(host, family);
    }
  };
  ingest(familyBaseUrls);
  ingest(familyLoginUrls);
  for (const [host, family] of Object.entries(OFFICIAL_HOST_ALIASES)) {
    map.set(host, family);
  }
  return map;
}

/**
 * Auto-fill draft.fields.base_url according to the Use-Official defaulting
 * rules (parse-time, before the user has touched the field):
 *
 *   Rule 1 — base_url is empty + the inferred provider has an official URL
 *            → fill it with that URL.
 *   Rule 2 — base_url is non-empty AND its host (after normalization) maps
 *            to a known official family → replace with that family's
 *            official URL. The original value moves to `prevBaseUrl` so
 *            the user can revert.
 *
 * Rule 2 also rewrites `record.official_base_url` to the matched family's
 * URL when the inferred provider differs (or is missing). This keeps the
 * BaseUrlRow's `matchesOfficial` check coherent so the toggle button
 * shows "official" instead of pointing at a different family's URL.
 *
 * Returns { record, prevBaseUrl } so the caller can seed DraftRow.
 * prevBaseUrl is non-null only when Rule 2 fired (i.e., we replaced a
 * user-supplied URL with the official one and need to remember the old
 * value for revert).
 */
function applyOfficialDefaults(
  record: DraftRecord,
  familyBaseUrls: Record<string, string> | undefined,
  hostToFamily: Map<string, string>,
): { record: DraftRecord; prevBaseUrl: string | null } {
  const current = (record.fields.base_url ?? '').trim();

  // Rule 1: empty + inferred-provider has official → fill with inferred's URL.
  if (!current) {
    if (record.official_base_url) {
      return {
        record: {
          ...record,
          fields: { ...record.fields, base_url: record.official_base_url },
        },
        prevBaseUrl: null,
      };
    }
    return { record, prevBaseUrl: null };
  }

  // Rule 2: non-empty, host matches an official family → replace with that
  //         family's official URL. `prevBaseUrl` retains the original so
  //         the existing revert button can restore it.
  const host = normalizeHost(current);
  if (!host) return { record, prevBaseUrl: null };
  const matchedFamily = lookupFamilyByHost(host, hostToFamily);
  if (!matchedFamily) return { record, prevBaseUrl: null };
  const matchedUrl = familyBaseUrls?.[matchedFamily];
  if (!matchedUrl) return { record, prevBaseUrl: null };
  if (matchedUrl === current) return { record, prevBaseUrl: null };

  return {
    record: {
      ...record,
      fields: { ...record.fields, base_url: matchedUrl },
      official_base_url: matchedUrl,
    },
    prevBaseUrl: current,
  };
}

function draftToRow(record: DraftRecord, initialPrevBaseUrl: string | null = null): DraftRow {
  const defaultType = computeDefaultType(record);
  const isOAuth = defaultType === 'OAUTH';
  const hasKey = Boolean(record.fields.api_key);
  const confidenceOk = record.inference_confidence >= 0.5 || Boolean(record.inferred_provider);
  const isWeak = !hasKey && !isOAuth;
  // Auto-expand drafts with confidence >= 30% on mount 2026-04-25:
  // above 30% the parser extracted enough field data worth reviewing,
  // so show the fields by default. Below 30% is noise / near-empty
  // drafts where a collapsed header is clearer.
  const autoExpand = record.inference_confidence >= 0.3;
  return {
    record,
    selected: hasKey && confidenceOk && !isOAuth,
    expanded: autoExpand,
    userType: null,       // 初始跟默认值走;用户切换后固化
    // Stage 6b: use official/revert 回退历史. Seeded by Rule 2 in
    // applyOfficialDefaults so the revert button can restore the
    // user's pasted URL after we replace it with the official one.
    prevBaseUrl: initialPrevBaseUrl,
    isOAuth,
    isWeak,
  };
}

/**
 * v4.1 Stage 5+: ProviderMultiSelect 下拉候选 protocol 列表
 *
 * 来源:`PROVIDER_DEFAULT_BASE_URL` keys (覆盖 13 个主流官方厂商) + 几个常见聚合网关。
 * Why 聚合网关也列出来:虽然它们不当"严格协议",但用户可能就是想标记 "这把 KEY 是 openrouter
 * 网关",所以下拉里仍可见 — 只是 backend 不会自动填到 protocol_types[]。
 *
 * 用户在搜索框输入候选外的字符串 + 回车,可创建自定义 protocol(支持长尾 provider)。
 */
/**
 * 每个 protocol 的展示元数据:
 *   - `id`       wire value (写回 ConfirmItem.providers / record.protocol_types,与 CLI
 *                provider_fingerprint family IDs 对齐)
 *   - `label`    下拉里显示的友好名 (带品牌别名提示,如 "zhipu · GLM · 智谱")
 *                缺省时用 id
 *   - `aliases`  搜索时额外匹配的关键词 (品牌名 / 中文名 / 常用缩写);
 *                用户输入 "GLM" 也能定位到 id=zhipu
 *
 * baichuan / minimax 目前 YAML 里尚未配 family_base_url / family_login_url,
 * 所以只做 UI 识别条目 — 用户选中后 backend 仅存 protocol 字符串。
 * (qwen v4.2 已补 YAML,"use official" / "open login" 两个按钮都能用)
 */
// v4.2: KNOWN_PROTOCOLS / ProtocolMeta / providerChipClassFromId /
//   protocolMatchesQuery / ProviderMultiSelect 组件统一迁移到 shared/ui/ProviderMultiSelect.tsx,
//   vault Add Key 弹窗也走同一组件。

// ── Provider chip helpers ────────────────────────────────────────────────
// v4.1 Stage 3 Phase E 精简:老版 candidate-driven providerClass/providerLabel/
//   confidenceFromTier 已并入 DraftRowCard 里的 providerChipClassFromId +
//   record.inference_confidence。保留 tierDotClass 作 Candidate['tier'] 枚举
//   映射(v4.1 字段 tier dot 仍按 confirmed/suggested/warn/unknown 渲染)。

function tierDotClass(tier: Candidate['tier']): string {
  switch (tier) {
    case 'confirmed': return 'tier-confirmed';
    case 'suggested': return 'tier-suggested';
    case 'warn':      return 'tier-warn';
    default:          return 'tier-unknown';
  }
}

function truncateSecret(v: string, n = 12): string {
  if (v.length <= n * 2) return v;
  return `${v.slice(0, n)}…${v.slice(-4)}`;
}

// ── Module-level cross-mount cache (v4.1 Stage 13+) ─────────────────────
//
// 用户切菜单 → 组件 unmount → 再回来时希望 paste 的文本 / 已解析的 drafts / 编辑过的
// protocols/alias/base_url 等都还在。刷新后则丢(JS 模块重新初始化,此变量重置)。
//
// Why 不用 sessionStorage:sessionStorage 刷新会存活,与需求相反。
// Why 不用 React Context:只有这一个页面需要,context 过度设计;模块级变量够简单。
//
// F-5 P0 review fix (2026-04-23): cache 带 `savedAt` 时间戳,hydrate 时检查
// 是否超过 IMPORT_CACHE_TTL_MS(30 min)。超时则**丢弃 drafts/input/parseResp/
// confirmResp**(含明文密钥)避免长期驻留 JS heap,只保留 state='empty'。
// hoveredDraft / pinnedDraft 超时一起作废(是 draft 索引,drafts 丢了索引无意义)。
const IMPORT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — matches vault session TTL 的量级

interface ImportPageCache {
  state: PageState;
  input: string;
  drafts: DraftRow[];
  parseResp: ParseResponse | null;
  confirmResp: ConfirmResponse | null;
  hoveredDraft: number | null;
  pinnedDraft: number | null;
  /// Wall-clock ms when the cache was last written. Used for TTL expiry
  /// on re-mount; see `importPageCacheFresh()`.
  savedAt: number;
}
let importPageCache: ImportPageCache | null = null;

/** Return the cache only if it is still within TTL; otherwise null.
 *  Also nulls the module-level cache so subsequent reads hit the same path.
 *  Called lazily in each `useState(() => ...)` init. */
function importPageCacheFresh(): ImportPageCache | null {
  if (!importPageCache) return null;
  if (Date.now() - importPageCache.savedAt > IMPORT_CACHE_TTL_MS) {
    importPageCache = null;
    return null;
  }
  return importPageCache;
}

// ── Main component ───────────────────────────────────────────────────────

export default function UserBulkImportPage() {
  const qc = useQueryClient();
  // 从模块缓存 hydrate(初始值 lazy init,只在首次 mount 时读一次)
  // F-5: 跑一次 TTL check,过期了返回 null → 所有字段走默认值,避免明文密钥复用
  const hydrate = useMemo(() => importPageCacheFresh(), []);
  const [state, setState] = useState<PageState>(() => hydrate?.state ?? 'empty');
  const [input, setInput] = useState<string>(() => hydrate?.input ?? '');
  const [drafts, setDrafts] = useState<DraftRow[]>(() => hydrate?.drafts ?? []);
  const [parseResp, setParseResp] = useState<ParseResponse | null>(() => hydrate?.parseResp ?? null);
  const [confirmResp, setConfirmResp] = useState<ConfirmResponse | null>(() => hydrate?.confirmResp ?? null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockExpanded, setUnlockExpanded] = useState(false);
  // First-run "Set Master Password" inline form state. Mirrors /user/vault's
  // UnlockBanner first-run branch (per 20260430-个人vault-Web首次设置-方案A.md).
  // Web-only users who land on /user/import before /user/vault still need a
  // way to initialise the vault — without this branch they'd see a "VAULT
  // LOCKED + UNLOCK" CTA that can never succeed because no master password
  // exists yet.
  const [initPassword, setInitPassword] = useState('');
  const [initConfirm, setInitConfirm] = useState('');
  const [initExpanded, setInitExpanded] = useState(false);
  // v4.1 Stage 13+: SOURCE 面板"点击进入编辑"模式。working 态下默认显示高亮 pre,
  // 点文本切 textarea,失焦切回 pre。empty/done 态不受此 flag 影响。
  const [sourceEditMode, setSourceEditMode] = useState(false);
  // 2026-04-25: scroll-driven sync toggle. When on (default), dragging
  // EITHER pane's scrollbar moves the OTHER pane to keep the same
  // logical position (matching draft <-> source line range) visible.
  // Click-jumps (click a draft / click a source line) always sync —
  // this toggle only affects manual scrollbar dragging.
  const [scrollSync, setScrollSync] = useState(true);
  // Right pane (draft list) scroll container ref. Threaded through
  // <WorkingDrafts> to its overflow-auto wrapper so the sync effect
  // can read scrollTop / programmatically set it.
  const draftsScrollRef = useRef<HTMLDivElement | null>(null);
  // "Skip next N events" counters — programmatic scrollTo with
  // behavior:'auto' emits exactly one scroll event, so a counter is
  // exact. Listener decrements and bails. Earlier directional locks
  // with smooth-scroll + 350ms timeout were fragile: smooth-scroll
  // emits many events over ~300ms and the timeout could clear before
  // the animation ended, causing a bounce-back when the trailing
  // animation events fired into the freshly-unlocked listener.
  const srcSkipRef = useRef(0);
  const dstSkipRef = useRef(0);
  // v4.1 Stage 14+: swap SourcePane ↔ textarea 时保留滚动位置
  // textarea 自带 scrollTop;SourcePane 由外层 .source-pane-scroll 容器 overflow-auto 驱动
  const sourceScrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const savedSourceScroll = useRef(0);

  // Stage 14+ scroll 恢复(robust 版本):
  //   - 不用 autoFocus(浏览器 focus 会把光标滚到可见处覆盖 scrollTop);
  //     改成手动 focus({ preventScroll: true })
  //   - useLayoutEffect 在 paint 前同步执行,但某些浏览器 textarea 的 scrollHeight
  //     要等下一帧才完成 layout → 在 rAF 里再补一次,两次都设保证生效
  //   - 读一次 scrollHeight 强制 sync layout(抹平 Chrome/Firefox 时序差)
  useLayoutEffect(() => {
    if (state !== 'working') return;
    const saved = savedSourceScroll.current;
    const sc = sourceScrollRef.current;
    const ta = textareaRef.current;

    // 两种可能的滚动元素都设一遍(outer container 或 textarea 本身);
    // 无关的那个不会有副作用(scrollTop 超出 scrollHeight 会被 browser clamp 到 0)。
    // force sync layout 通过读 scrollHeight。
    const applyScroll = () => {
      if (sc) {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        sc.scrollHeight;
        sc.scrollTop = saved;
      }
      if (ta && sourceEditMode) {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        ta.scrollHeight;
        ta.scrollTop = saved;
      }
    };

    if (sourceEditMode && ta) {
      ta.focus({ preventScroll: true });
    }
    applyScroll();
    // 某些浏览器首次 layout 滞后,rAF 再设一次保险
    const raf = requestAnimationFrame(applyScroll);
    return () => cancelAnimationFrame(raf);
  }, [sourceEditMode, state]);

  // 2026-04-25: bidirectional scroll-sync — when scrollSync is on and
  // the user manually drags either pane's scrollbar, programmatically
  // move the OTHER pane to keep the same logical position visible.
  // Logical mapping = source line ↔ first draft whose line_range
  // contains that line. syncLockRef + rAF prevent feedback loops.
  // Picks the [data-line] index closest to the vertical center of the
  // source scroll viewport. Returns -1 if none found.
  function pickCenteredLine(scrollHost: HTMLElement): number {
    const center = scrollHost.scrollTop + scrollHost.clientHeight / 2;
    const lines = scrollHost.querySelectorAll<HTMLElement>('[data-line]');
    let best = -1;
    let bestDist = Infinity;
    lines.forEach((el) => {
      const elCenter = el.offsetTop + el.offsetHeight / 2;
      const dist = Math.abs(elCenter - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = parseInt(el.getAttribute('data-line') ?? '-1', 10);
      }
    });
    return best;
  }

  useEffect(() => {
    if (!scrollSync || state !== 'working') return;
    const src = sourceScrollRef.current;
    const dst = draftsScrollRef.current;
    if (!src || !dst) return;

    // Source → Drafts: user-driven src scroll triggers an instant
    // programmatic dst scroll. dstSkipRef++ before the write, dst's
    // listener decrements and bails on the synthetic event. Counter
    // > timeout because instant scroll emits exactly 1 event so the
    // count is exact regardless of speed / pause / interrupt.
    function syncFromSource() {
      if (!src || !dst) return;
      // The synthetic event from drafts→source's earlier write — bail.
      if (srcSkipRef.current > 0) { srcSkipRef.current--; return; }
      const targetLineIdx = pickCenteredLine(src);
      if (targetLineIdx < 0) return;
      const draftIdx = drafts.findIndex((d) => {
        const [s, e] = d.record.line_range;
        return targetLineIdx >= s && targetLineIdx <= e;
      });
      if (draftIdx < 0) return;
      const cardEl = dst.querySelector<HTMLDivElement>(
        `[data-draft-id="${drafts[draftIdx].record.id}"]`,
      );
      if (!cardEl) return;
      const target =
        cardEl.offsetTop - dst.clientHeight / 2 + cardEl.clientHeight / 2;
      // Skip the write if dst is already (close to) where we want it
      // — prevents emitting a no-op scroll event that would still
      // round-trip through dst's listener.
      if (Math.abs(dst.scrollTop - target) < 2) return;
      dstSkipRef.current++;
      dst.scrollTo({ top: target, behavior: 'auto' });
    }

    function syncFromDrafts() {
      if (!src || !dst) return;
      if (dstSkipRef.current > 0) { dstSkipRef.current--; return; }
      const center = dst.scrollTop + dst.clientHeight / 2;
      const cards = dst.querySelectorAll<HTMLDivElement>('[data-draft-id]');
      let best: HTMLDivElement | null = null;
      let bestDist = Infinity;
      cards.forEach((c) => {
        const cardCenter = c.offsetTop + c.clientHeight / 2;
        const dist = Math.abs(cardCenter - center);
        if (dist < bestDist) { bestDist = dist; best = c; }
      });
      if (!best) return;
      const draftId = (best as HTMLDivElement).getAttribute('data-draft-id');
      const draft = drafts.find((d) => d.record.id === draftId);
      if (!draft) return;
      const lineIdx = draft.record.line_range[0];
      const lineEl = src.querySelector<HTMLElement>(`[data-line="${lineIdx}"]`);
      if (!lineEl) return;
      const target =
        lineEl.offsetTop - src.clientHeight / 2 + lineEl.clientHeight / 2;
      if (Math.abs(src.scrollTop - target) < 2) return;
      srcSkipRef.current++;
      src.scrollTo({ top: target, behavior: 'auto' });
    }

    // rAF throttle per direction so a fast drag doesn't queue up dozens
    // of scrollTo writes in the same frame.
    let rafSrc = 0;
    let rafDst = 0;
    const onSrcScroll = () => {
      cancelAnimationFrame(rafSrc);
      rafSrc = requestAnimationFrame(syncFromSource);
    };
    const onDstScroll = () => {
      cancelAnimationFrame(rafDst);
      rafDst = requestAnimationFrame(syncFromDrafts);
    };
    src.addEventListener('scroll', onSrcScroll, { passive: true });
    dst.addEventListener('scroll', onDstScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafSrc);
      cancelAnimationFrame(rafDst);
      src.removeEventListener('scroll', onSrcScroll);
      dst.removeEventListener('scroll', onDstScroll);
    };
  }, [scrollSync, state, drafts]);
  // v4.1 Stage 13+: Clear / Re-PARSE 的确认弹窗
  const [confirmAction, setConfirmAction] = useState<'clear' | 'reparse' | null>(null);
  // v4.1 Stage 13.1+: Provider 必填拦截后,在缺 provider 的 selected draft 上持久显示
  //   "Required" 提示(直到用户填 provider 或取消勾选该 draft,条件自然失效)
  const [showRequiredFields, setShowProviderRequired] = useState(false);
  // 最近被 flash 的 draft id(runImport 拦截时触发,2s 后自动清)
  const [flashDraftId, setFlashDraftId] = useState<string | null>(null);
  // v4.1 Stage 3 Phase E.4: Source 高亮联动 —— 用 hover/click 的 draft idx 驱动高亮
  //   hoveredDraft: 鼠标悬停某 draft 卡片时临时高亮(hover 走,失)
  //   pinnedDraft: 点击某 draft "jump to source" 时持久高亮,再点击另一个切换
  const [hoveredDraft, setHoveredDraft] = useState<number | null>(() => hydrate?.hoveredDraft ?? null);
  const [pinnedDraft, setPinnedDraft] = useState<number | null>(() => hydrate?.pinnedDraft ?? null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  // Parse/Confirm page-level error (P0 review fix F-1, 2026-04-23):
  //   mutations 之前静默失败 → UI 按钮回到 idle,用户只看到 "点了没反应"。
  //   新增一条 banner 消费 parseMut/confirmMut 的 onError,把 error_code 映射成
  //   友好短句,原错误挂在 title 供 devtools/hover 查阅。
  const [pageError, setPageError] = useState<{ code?: string; message: string } | null>(null);

  // Hook coverage v1 (round-3 follow-up): batch_import is a real vault
  // mutation. The Rust handler already runs ensure_shell_hook + emits the
  // 3-field envelope; the only missing wire was the Web consumer. Same
  // pattern as vault/index.tsx mutations — onSuccess feeds the global
  // useHookReadinessStore so HookReadinessBanner re-renders for users who
  // import-only and never visit /user/vault.
  const setHookReadinessFromMutation = useHookReadinessStore((s) => s.setReadiness);

  // v4.1 Stage 13+: 状态变更 → 写回模块缓存(切菜单回来时 hydrate)
  // F-5: savedAt 记录写入时刻,hydrate 时据此 TTL 过期(importPageCacheFresh)
  useEffect(() => {
    importPageCache = {
      state, input, drafts, parseResp, confirmResp, hoveredDraft, pinnedDraft,
      savedAt: Date.now(),
    };
  }, [state, input, drafts, parseResp, confirmResp, hoveredDraft, pinnedDraft]);

  // Vault status polled on mount + after unlock/lock mutations.
  const { data: vault, dataUpdatedAt: vaultFetchedAt, refetch: refetchVault } = useQuery({
    queryKey: ['vault-status'],
    queryFn: importApi.vaultStatus,
    refetchOnWindowFocus: false,
  });

  // Static rules feed (layer versions + family_base_urls map). Used to drive
  // the Use-Official auto-fill rules in parseMut.onSuccess and changeProtocols.
  // Cached aggressively — the YAML behind it does not change between refreshes.
  const { data: rules } = useQuery({
    queryKey: ['import-rules'],
    queryFn: importApi.rules,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const familyBaseUrls = rules?.family_base_urls;
  const familyLoginUrls = rules?.family_login_urls;
  // host → family lookup, rebuilt only when the rules payload changes (rare).
  const officialHostToFamily = useMemo(
    () => buildOfficialHostToFamily(familyBaseUrls, familyLoginUrls),
    [familyBaseUrls, familyLoginUrls],
  );

  // Live TTL countdown. Anchors to the moment the vault query returned
  // (`vaultFetchedAt` + `ttl_seconds`) so the display actually ticks, not
  // just refreshes on re-fetch. A 1s interval bumps a dummy state value
  // which forces re-render; when the anchor hits zero we kick a refetch
  // so the vault state flips to locked without waiting for window focus.
  const [, setTick] = useState(0);
  const lockAtMs =
    vault?.unlocked && typeof vault.ttl_seconds === 'number' && vaultFetchedAt
      ? vaultFetchedAt + vault.ttl_seconds * 1000
      : null;
  useEffect(() => {
    if (lockAtMs === null) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= lockAtMs) {
        refetchVault();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockAtMs, refetchVault]);
  const liveRemainingSec =
    lockAtMs !== null ? Math.max(0, Math.floor((lockAtMs - Date.now()) / 1000)) : null;

  // Unlock: inline banner → password input → API → refetch status.
  const unlockMut = useMutation({
    mutationFn: importApi.vaultUnlock,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        setUnlockPassword('');
        setUnlockExpanded(false);
        setUnlockError(null);
        refetchVault();
      } else {
        setUnlockError(res.error_message || 'unlock failed');
      }
    },
    onError: (e: Error) => setUnlockError(e.message),
  });

  const lockMut = useMutation({
    mutationFn: importApi.vaultLock,
    onSuccess: () => refetchVault(),
  });

  // First-run init: same payload + minted-session contract as /user/vault.
  // Backend creates vault.db, derives the key, and mints an unlocked
  // session in one round-trip — so success transitions us straight to the
  // unlocked banner without a separate UNLOCK step.
  const initMut = useMutation({
    mutationFn: importApi.vaultInit,
    onSuccess: (res) => {
      if (res.status === 'ok' && res.unlocked) {
        setInitPassword('');
        setInitConfirm('');
        setInitExpanded(false);
        setInitError(null);
        refetchVault();
      } else if (res.error_code === 'I_VAULT_ALREADY_INITIALIZED') {
        // Race or stale UI: vault was initialised between our last poll
        // and submit (e.g. the user opened the vault tab in another
        // browser tab and finished setup there). Refetch silently — the
        // next render will show the regular unlock banner.
        setInitError(null);
        refetchVault();
      } else {
        setInitError(res.error_message || 'failed to set master password');
      }
    },
    onError: (e: Error) => setInitError(e.message),
  });

  const submitInit = () => {
    // No minimum length: stays consistent with the CLI first-run prompt
    // (aikey-cli/src/main.rs:3384-3391), which only requires that the two
    // entries match. Argon2id + AES-GCM handle any non-empty password.
    if (initPassword !== initConfirm) {
      setInitError('Passwords do not match');
      return;
    }
    setInitError(null);
    initMut.mutate({ password: initPassword });
  };

  // F-6 P0 review fix (2026-04-23): AbortController refs for in-flight
  // parse/confirm requests. On each new mutate, abort the previous request
  // (if any) so a slow prior response can't overwrite a fresh one — classic
  // "user rapid-clicks Re-parse" race. Axios maps AbortError into a rejection
  // the mutation's onError handles; we detect it by name so the ErrorBanner
  // doesn't flash a spurious "cancelled" message on intentional cancels.
  const parseAbortRef = useRef<AbortController | null>(null);
  const confirmAbortRef = useRef<AbortController | null>(null);
  // Unmount: abort any in-flight request so a late resolution can't setState
  // on a disposed component.
  useEffect(() => {
    return () => {
      parseAbortRef.current?.abort();
      confirmAbortRef.current?.abort();
    };
  }, []);
  const isAbortError = (e: unknown): boolean =>
    e instanceof Error && (e.name === 'CanceledError' || e.name === 'AbortError');

  const parseMut = useMutation({
    mutationFn: (req: Parameters<typeof importApi.parse>[0]) => {
      parseAbortRef.current?.abort();
      const ctrl = new AbortController();
      parseAbortRef.current = ctrl;
      return importApi.parse(req, { signal: ctrl.signal });
    },
    onMutate: () => setPageError(null),
    onSuccess: (res) => {
      setParseResp(res);
      // v4.1 Stage 3 Phase E: UI 行状态由 DraftRecord 派生,不再 per-candidate
      //   若 backend 返回 drafts (Phase D 后),走新路径;否则走旧兼容路径 (一 cand 一 row)
      if (res.drafts && res.drafts.length > 0) {
        // 2026-04-23 用户反馈:parse 完成默认展开第一个被自动勾选的 draft,
        // 让用户进入 working 态时立刻看到一条详情(字段 / provider / alias),
        // 而不是面对一堆全部折叠的卡片。无 selected 时 fallback 展开第一条。
        // v4.2: title ↔ alias 统一 (title 非空时覆盖 alias,否则回填 title=alias)
        const unified = applyTitleAliasUnification(res.drafts);
        // Apply Use-Official auto-fill rules (Rule 1: empty base_url, Rule 2:
        // host matches official family). prevBaseUrl is seeded only by Rule 2
        // so the user can revert via the existing baseurl-row toggle.
        const rows = unified.map((rec) => {
          const { record, prevBaseUrl } = applyOfficialDefaults(
            rec,
            familyBaseUrls,
            officialHostToFamily,
          );
          return draftToRow(record, prevBaseUrl);
        });
        const firstSelectedIdx = rows.findIndex((r) => r.selected);
        const expandIdx = firstSelectedIdx >= 0 ? firstSelectedIdx : 0;
        rows[expandIdx] = { ...rows[expandIdx], expanded: true };
        setDrafts(rows);
      } else {
        setDrafts([]);
      }
      // v4.2 (2026-04-24 用户反馈): parse 完成立即开启"缺失字段提示",
      //   用户不必先点 IMPORT 才知道哪些 draft 缺 provider / api_key。
      //   runImport 拦截路径仍会再开一次(幂等);用户解决完缺失字段后,
      //   hint 会因 missingX 条件自然失效 (isKeyMode && !isWeak && protocol empty).
      setShowProviderRequired(true);
      setState('working');
    },
    onError: (e: Error & { code?: string }) => {
      if (isAbortError(e)) return; // superseded by newer parse — silent
      setPageError({ code: e.code, message: friendlyImportError(e.code, e.message, 'parse') });
    },
  });

  const confirmMut = useMutation({
    mutationFn: (req: Parameters<typeof importApi.confirm>[0]) => {
      confirmAbortRef.current?.abort();
      const ctrl = new AbortController();
      confirmAbortRef.current = ctrl;
      return importApi.confirm(req, { signal: ctrl.signal });
    },
    onMutate: () => setPageError(null),
    onSuccess: (res) => {
      setConfirmResp(res);
      setState('done');
      setHookReadinessFromMutation(pickHookReadiness(res));
      qc.invalidateQueries({ queryKey: ['my-keys'] });
    },
    onError: (e: Error & { code?: string }) => {
      if (isAbortError(e)) return; // superseded by newer confirm — silent
      setPageError({ code: e.code, message: friendlyImportError(e.code, e.message, 'confirm') });
    },
  });

  // v4.1 Stage 7+ 规则 1 + Stage 13 调整: Provider 必填。
  //   - readyCount 统计"用户勾选准备导入"的 KEY 类 draft(含缺 provider 的);IMPORT 按钮显示此数量
  //   - 点 IMPORT 时若其中有缺 provider 的 → 拦截 + 滚动 + 闪烁 + 显示"Required"提示
  //   - missingProviderCount 仍用于 toolbar 红色警示("N missing provider")
  const missingProviderCount = drafts.filter(
    (d) => d.selected && !d.isOAuth && !d.isWeak && (d.record.protocol_types?.length ?? 0) === 0
  ).length;
  const readyCount = drafts.filter(
    (d) => d.selected && !d.isOAuth && !d.isWeak
  ).length;
  const oauthCount = drafts.filter((d) => d.isOAuth).length;
  // v4.1 Stage 12+: 用户选中的 OAuth draft(驱动 Done 页显示哪些 handoff 卡片;IMPORT 按钮也把它计入 "可 proceed")
  const selectedOauthCount = drafts.filter((d) => d.isOAuth && d.selected).length;
  const weakCount = drafts.filter((d) => d.isWeak).length;

  function startNewImport() {
    setState('empty');
    setInput('');
    setDrafts([]);
    setParseResp(null);
    setConfirmResp(null);
    setPageError(null);
  }

  /**
   * v4.1 Stage 12+: 全选 / 取消全选 drafts
   *
   * 行为:如果至少一个 draft 未选中 → 全选(所有 drafts 的 selected=true);
   *        全部已选中 → 全部取消(selected=false)。
   *
   * 注:OAUTH / weak / missing-provider 的 draft 也会被选中,但 runImport filter
   * 会按 effectiveType=KEY && protocols.length>0 再筛一次,所以不会误导入无效项。
   * 用户在视觉上能看到"全选"一致,符合直觉。
   */
  function toggleSelectAll() {
    const allSelected = drafts.length > 0 && drafts.every((d) => d.selected);
    const next = !allSelected;
    setDrafts((prev) => prev.map((d) => ({ ...d, selected: next })));
  }

  /**
   * v4.1 Stage 14+: 点击底部 stat 滚动到首个匹配 draft + 闪一下
   *   - "needs review" → 首个 isWeak
   *   - "missing provider" → 首个 selected + missing provider (复用拦截扫描)
   * 如果该 draft 被折叠,也展开它。
   */
  function scrollToFirstDraft(predicate: (d: DraftRow) => boolean) {
    const target = drafts.find(predicate);
    if (!target) return;
    setDrafts((prev) =>
      prev.map((d) => (d.record.id === target.record.id ? { ...d, expanded: true } : d))
    );
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLDivElement>(`[data-draft-id="${target.record.id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashDraftId(target.record.id);
      setTimeout(() => setFlashDraftId(null), 2000);
    });
  }

  function runImport() {
    // v4.1 Stage 13.1+ / Stage 14: 拦截"必填字段缺失"的 selected KEY draft
    //   - Provider (protocol_types.length === 0)
    //   - API Key (fields.api_key 空)
    //   → 滚到首个不合格的 draft + 闪烁 + 显示 "Required" 提示
    //   readyCount 已把这类 draft 算进来(所见即所勾),此处是"兑现承诺前的最后校验"
    const blocking = drafts.filter((d) => {
      if (!d.selected || d.isOAuth || d.isWeak) return false;
      const missingProvider = (d.record.protocol_types?.length ?? 0) === 0;
      const missingApiKey = !(d.record.fields.api_key ?? '').trim();
      return missingProvider || missingApiKey;
    });
    if (blocking.length > 0) {
      setShowProviderRequired(true);  // 打开所有缺 provider 的 draft 的 "Required" 提示(持久)
      // 确保被拦 draft 处于展开态(Provider 行才可见)
      setDrafts((prev) =>
        prev.map((d) =>
          blocking.some((b) => b.record.id === d.record.id) ? { ...d, expanded: true } : d
        )
      );
      const firstId = blocking[0].record.id;
      // 下一帧滚动(展开 state 生效 + DOM 更新后)
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLDivElement>(`[data-draft-id="${firstId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashDraftId(firstId);
        // 动画 2s 后清掉 flash(CSS keyframes 自己结束会平滑过渡)
        setTimeout(() => setFlashDraftId(null), 2000);
      });
      return;
    }

    // v4.1 Stage 3 Phase E + Stage 5 + Stage 6: 从 DraftRecord 生成 ConfirmItem
    //   - 只导入 effectiveType == KEY 的 Draft(OAUTH 走浏览器登录,不入 confirm)
    //   - alias 直接用 record.alias (backend parse 已 dedupe;用户可在 UI 编辑覆盖)
    //   - providers 直接用 record.protocol_types(UI multi-select 已把用户编辑写回此字段)
    //     backend `BatchImportItem` 会把 providers 写到 vault 的 supported_providers 并把
    //     provider_code 设为 providers[0] 作路由默认。
    const items: ConfirmItem[] = drafts
      // 到此 protocol_types 必非空(上面已拦截);保留条件做结构防御
      .filter((d) => d.selected && !d.isWeak && computeEffectiveType(d) === 'KEY' && (d.record.protocol_types?.length ?? 0) > 0)
      .flatMap((d) => {
        const out: ConfirmItem[] = [];
        const aliasBase = d.record.alias || `import-${d.record.id}`;
        const protocols = d.record.protocol_types ?? [];
        // Stage 7+ 规则 3: base_url 空时兜底用 inferred provider 的官方默认
        //   用户输入了(含空字符串 trim 后非空)→ 用用户值
        //   用户留空 → 兜底 record.official_base_url (CLI 从 YAML family_base_urls 填)
        //   两者都空 → undefined (后端留 NULL,proxy 走 provider default)
        const userBase = (d.record.fields.base_url ?? '').trim();
        const resolvedBase = userBase || d.record.official_base_url || undefined;
        if (d.record.fields.api_key) {
          out.push({
            alias: aliasBase,
            secret_plaintext: d.record.fields.api_key,
            providers: protocols.length > 0 ? protocols : undefined,
            base_url: resolvedBase,
          });
        }
        for (const [i, extra] of (d.record.fields.extra_secrets ?? []).entries()) {
          out.push({
            alias: `${aliasBase}-extra${i + 1}`,
            secret_plaintext: extra,
            providers: protocols.length > 0 ? protocols : undefined,
            base_url: resolvedBase,
          });
        }
        return out;
      });
    // v4.1 Stage 12+: 允许 "只选 OAuth 账号" 的情况触发 IMPORT
    //   - items 为空 + 有选中的 OAuth draft → 合成一个空 ConfirmResponse 直接跳 Done,
    //     让用户看到 OAuth handoff 卡片(复制命令 / Open login page 接着本地完成)。
    //   - items 为空 + 无 OAuth → 真的没事干,早退(按钮也不会让到这步,兜底)。
    if (items.length === 0) {
      if (selectedOauthCount > 0) {
        setConfirmResp({
          total: 0,
          inserted: 0,
          replaced: 0,
          skipped: 0,
          items: [],
          audit_logged: false,
          audit_failures: 0,
          job_id: null,
        });
        setState('done');
      }
      return;
    }
    confirmMut.mutate({
      items,
      on_conflict: 'error',
      source_hash: parseResp?.source_hash,
      source_type: 'paste',
    });
  }

  const unlocked = Boolean(vault?.unlocked);
  // `initialized` defaults to true on legacy local-server builds that don't
  // return the field (see VaultStatus type in shared/api/user/import.ts).
  const initialized = vault?.initialized ?? true;

  return (
    // `import-page` wrapper (2026-04-22): scopes IMPORT_CSS rules that
    // use generic class names (`.btn`, `.btn-primary`, etc.) so they
    // don't leak into UserShell's header (e.g. the Invite button, which
    // previously inherited .btn padding + font-size and shrank its icon
    // visually). See IMPORT_CSS block for the scope prefix.
    // h-full so the page claims the full height of its parent. UserShell
    // mounts <Outlet /> inside `<div className="flex-1 overflow-y-auto">` —
    // that's a block container, not a flex column, so the original `flex-1`
    // on this wrapper had no flex parent and was collapsing the page to
    // intrinsic content height. With h-full + min-h-0 the body can flex to
    // fill the viewport, which lets the Source pane respect its 80vh floor.
    <div className="import-page h-full flex flex-col min-w-0 min-h-0 overflow-hidden" data-state={state} data-vault={unlocked ? 'unlocked' : 'locked'}>
      <style>{IMPORT_CSS}</style>

      {/* Top header slot is provided by UserShell; we render only banners + body. */}

      {/* Hook readiness banner — render at page top so users who only do
          imports (skipping /user/vault entirely) still see the
          "almost-ready / aikey hook install" CTA after a successful
          batch_import. Returns null when readiness is wired/empty, so it
          stays out of the way until needed. */}
      <div style={{ padding: '12px 24px 0' }}>
        <HookReadinessBanner />
      </div>

      {/* ── Vault state banner ──────────────────────────────────────────────
          Three states under `!unlocked`:
            1. !initialized → "Vault Not Set Up" + SET MASTER PASSWORD CTA
               (web-only first-run path; mirrors /user/vault's UnlockBanner
               first-run branch — see 20260430-个人vault-Web首次设置-方案A.md)
            2. initialized && !unlockExpanded → "Vault Locked" + UNLOCK CTA
            3. initialized && unlockExpanded → password form
          The unlocked banner sits below this block (look for `{unlocked && …`).
       */}
      {!unlocked && !initialized && (
        <div className="unlock-banner px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 pl-3">
            <LockIcon />
            <span className="font-mono text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--foreground)' }}>Vault Not Set Up</span>
            <span className="text-xs font-sans" style={{ color: 'var(--muted-foreground)' }}>— Set a master password to start importing credentials</span>
          </div>
          <div className="flex items-center gap-3">
            {!initExpanded ? (
              <button className="btn btn-primary px-4 py-1.5 text-[11px]" onClick={() => setInitExpanded(true)}>SET MASTER PASSWORD</button>
            ) : (
              <div className="flex flex-col items-end gap-1.5">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => { e.preventDefault(); submitInit(); }}
                >
                  <input
                    autoFocus
                    type="password"
                    placeholder="Master password"
                    className="field-input"
                    style={{ width: 180 }}
                    value={initPassword}
                    onChange={(e) => setInitPassword(e.target.value)}
                  />
                  <input
                    type="password"
                    placeholder="Confirm"
                    className="field-input"
                    style={{ width: 140 }}
                    value={initConfirm}
                    onChange={(e) => setInitConfirm(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary px-3 py-1.5 text-[11px]" disabled={initMut.isPending || !initPassword || !initConfirm}>
                    {initMut.isPending ? 'SETTING…' : 'SET'}
                  </button>
                  <button type="button" className="btn btn-ghost text-[11px] px-2 py-1.5" onClick={() => { setInitExpanded(false); setInitPassword(''); setInitConfirm(''); setInitError(null); }}>Cancel</button>
                </form>
                {initError && (
                  <span className="text-[11px] font-mono text-red-400">{initError}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {!unlocked && initialized && (
        <div className="unlock-banner px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 pl-3">
            <LockIcon />
            <span className="font-mono text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--foreground)' }}>Vault Locked</span>
            <span className="text-xs font-sans" style={{ color: 'var(--muted-foreground)' }}>— Unlock with Master Password to import credentials</span>
          </div>
          <div className="flex items-center gap-3">
            {!unlockExpanded ? (
              <button className="btn btn-primary px-4 py-1.5 text-[11px]" onClick={() => setUnlockExpanded(true)}>UNLOCK</button>
            ) : (
              // Why the extra column wrapper around the form: the inline
              // error message used to sit next to Cancel, which pushed the
              // whole control row wider on long errors (e.g. the friendly
              // "Master password incorrect. Please check and try again.").
              // Dropping it to its own row below the form keeps the buttons
              // compact and the error text readable regardless of length,
              // while `items-end` right-aligns the message under the action
              // buttons so eye-flow stays with the last action the user took.
              <div className="flex flex-col items-end gap-1.5">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => { e.preventDefault(); unlockMut.mutate({ password: unlockPassword }); }}
                >
                  <input
                    autoFocus
                    type="password"
                    placeholder="Master Password"
                    className="field-input"
                    style={{ width: 220 }}
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary px-3 py-1.5 text-[11px]" disabled={unlockMut.isPending || !unlockPassword}>
                    {unlockMut.isPending ? 'UNLOCKING…' : 'UNLOCK'}
                  </button>
                  <button type="button" className="btn btn-ghost text-[11px] px-2 py-1.5" onClick={() => { setUnlockExpanded(false); setUnlockError(null); }}>Cancel</button>
                </form>
                {unlockError && (
                  <span className="text-[11px] font-mono text-red-400">{unlockError}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── Page-level error banner (F-1 P0 review fix, 2026-04-23) ───────── */}
      {/* Replaces the earlier silent-failure UX where parseMut/confirmMut
          would reset isPending without surfacing the error_code. Banner is
          cleared on the next mutation attempt (onMutate) and by the ✕ button. */}
      {pageError && (
        <div
          className="px-6 py-2 flex items-center justify-between flex-shrink-0"
          style={{
            background: 'rgba(239,68,68,0.08)',
            borderBottom: '1px solid rgba(239,68,68,0.35)',
          }}
          role="alert"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: '#f87171' }}>
              {pageError.code ?? 'Error'}
            </span>
            <span className="text-[12px] font-mono truncate" style={{ color: 'var(--foreground)' }} title={pageError.message}>
              {pageError.message}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost text-[11px] px-2 py-1"
            onClick={() => setPageError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
      {/* Vault-unlocked banner shows in every state (including empty) so the
          user gets visible confirmation that the unlock succeeded, plus the
          ticking auto-lock countdown. Earlier this was gated on
          `state !== 'empty'`, which hid the banner right after unlocking
          and made it look like the unlock hadn't taken effect. */}
      {unlocked && (
        <div className="unlock-banner-ok px-6 py-2 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <UnlockIcon />
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: '#4ade80' }}>Vault Unlocked</span>
            {liveRemainingSec !== null && (
              <span className="text-[12px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                · auto-lock in{' '}
                <span style={{ color: 'var(--foreground)' }}>
                  {Math.floor(liveRemainingSec / 60)}m {String(liveRemainingSec % 60).padStart(2, '0')}s
                </span>
              </span>
            )}
          </div>
          <button className="btn btn-ghost text-[10px] px-2 py-1" onClick={() => lockMut.mutate()}>Lock now</button>
        </div>
      )}

      {/* ── DONE state toast ────────────────────────────────────────────── */}
      {state === 'done' && confirmResp && (
        <div className="undo-toast px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 pl-3">
            <span className="font-mono text-sm font-bold uppercase tracking-wider" style={{ color: '#6ee7b7' }}>
              {/* v4.1 Stage 5+ fix: "imported" 用户视角 = inserted + replaced
                  (backend 字段拆三个 action;skipped 不算导入,failed 目前不返回) */}
              Imported {confirmResp.inserted + confirmResp.replaced} credentials
            </span>
            {confirmResp.failed && confirmResp.failed.length > 0 && (
              <span className="text-[12px] font-mono" style={{ color: '#fca5a5' }}>· {confirmResp.failed.length} failed</span>
            )}
          </div>
          <button className="btn btn-primary px-3 py-1.5 text-[11px]" onClick={startNewImport}>START NEW IMPORT</button>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {/* Body min-height: 80vh on tall windows, collapses to whatever the
          flex parent provides on short windows. Uses CSS min() so the
          floor never exceeds the available height and pushes the action
          bar off-screen. Without this floor the panes shrink to textarea
          content height on the empty state, which looked cramped. */}
      <div className="flex-1 flex min-h-0 overflow-hidden" style={{ minHeight: 'min(80vh, 100%)' }}>
        {/* LEFT pane: textarea (empty) or readonly source (working/done) */}
        <section className="w-[42%] flex flex-col" style={{ background: 'rgba(0,0,0,0.15)' }}>
          <div className="h-10 px-5 flex items-center justify-between flex-shrink-0" style={{ background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid var(--border)' }}>
            <span className="pane-header">{state === 'empty' ? 'Source · Paste or Add' : state === 'working' ? `Source · ${parseResp?.candidates.length ?? 0} detected` : 'Source · archived'}</span>
            <div className="flex items-center gap-3">
              {/* v4.2: working 态显式 Edit 按钮 —— 把 edit-mode 入口和 "click 行联动右侧"
                  解耦。双击 source 仍是快捷入口(见 SourcePane 外层 onDoubleClick)。 */}
              {state === 'working' && !sourceEditMode && (
                <button
                  type="button"
                  className="text-[10px] font-mono uppercase tracking-wider hover:text-[var(--foreground)]"
                  style={{ color: 'var(--muted-foreground)' }}
                  onClick={() => {
                    savedSourceScroll.current = sourceScrollRef.current?.scrollTop ?? 0;
                    setSourceEditMode(true);
                  }}
                  title="Edit source text (or double-click the source pane)"
                >
                  ✎ Edit
                </button>
              )}
              <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                {(new Blob([input]).size / 1024).toFixed(1)} KB
              </span>
            </div>
          </div>
          <div
            ref={sourceScrollRef}
            className="flex-1 overflow-auto source-pane-scroll"
            /* 持续跟踪外层容器滚动位置(SourcePane 模式) */
            onScroll={(e) => {
              if (!sourceEditMode) savedSourceScroll.current = e.currentTarget.scrollTop;
            }}
          >
            {/* Stage 13+/14+: SOURCE 面板三态 + swap 保留滚动位置
                - empty: 始终是 textarea
                - working + 非 edit 模式: 高亮 SourcePane(点击切入编辑;切换前保存外层 scrollTop)
                - working + edit 模式(focus): textarea(mount 后恢复 scroll 到 textarea;blur 切回前保存)
                - done: 只读归档 SourcePane
                textarea 与 SourcePane 的字体/行高/padding/背景已在 CSS 中统一,切换无视觉跳变 */}
            {state === 'empty' || (state === 'working' && sourceEditMode) ? (
              <textarea
                ref={textareaRef}
                /* 不用 autoFocus —— 浏览器 focus 会滚光标到可见处,覆盖 scrollTop;
                   改为 useLayoutEffect 里 focus({preventScroll:true}) 后手动 scrollTop */
                className="source-textarea"
                placeholder={state === 'empty' ? SAMPLE_PLACEHOLDER : undefined}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                /* Stage 14+: 持续跟踪 textarea 滚动位置(edit 模式) */
                onScroll={(e) => {
                  if (sourceEditMode) savedSourceScroll.current = e.currentTarget.scrollTop;
                }}
                onBlur={() => {
                  if (state === 'working') setSourceEditMode(false);
                }}
                disabled={!unlocked}
              />
            ) : (
              <div
                className={state === 'working' ? 'source-view source-view-editable' : 'source-view'}
                onDoubleClick={() => {
                  if (state === 'working') {
                    // 切入 edit 前保存外层容器 scrollTop → mount 后恢复到 textarea
                    savedSourceScroll.current = sourceScrollRef.current?.scrollTop ?? 0;
                    setSourceEditMode(true);
                  }
                }}
                title={state === 'working' ? 'Single-click a line to jump the card panel · double-click to edit source text' : undefined}
              >
                <SourcePane
                  text={input}
                  drafts={drafts}
                  hoveredDraft={hoveredDraft}
                  pinnedDraft={pinnedDraft}
                  onLineClick={state === 'working' ? (idx) => {
                    // v4.2: 点击 source 行 → 双向联动 (always-on click jump):
                    //   - 该行属于某 draft → toggle pin (同卡片再点取消 pin)
                    //   - 该行不属于任何 draft → 不清空已有 pin (避免用户点空行意外失焦)
                    //   命中后同时 scroll 右侧 draft 卡片可见。click jump 不受
                    //   scrollSync toggle 控制 — toggle 只管"拖滚动条"时的联动。
                    if (idx === null) return;
                    setPinnedDraft((prev) => (prev === idx ? null : idx));
                    const target = drafts[idx];
                    if (!target) return;
                    // 展开卡片让用户看到详情(和 onJumpToSource 行为对齐)
                    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, expanded: true } : d)));
                    requestAnimationFrame(() => {
                      const el = document.querySelector<HTMLDivElement>(`[data-draft-id="${target.record.id}"]`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                  } : undefined}
                />
              </div>
            )}
          </div>
          <div className="h-14 px-5 flex items-center justify-between flex-shrink-0" style={{ background: 'rgba(0,0,0,0.25)', borderTop: '1px solid var(--border)' }}>
            <span className="offline-pill"><WifiOffIcon />OFFLINE · NOTHING LEAVES</span>
            <div className="flex items-center gap-2">
              {/* Stage 13+: Clear 按钮 — empty 态若有文本、working 态始终可点;点击弹确认框 */}
              {((state === 'empty' && input.trim()) || state === 'working') && (
                <button
                  className="btn btn-ghost text-[11px] px-3 py-1.5"
                  onClick={() => setConfirmAction('clear')}
                  title="Clear all source text and parsed drafts"
                >
                  Clear
                </button>
              )}
              {state === 'empty' && (
                <button
                  className="btn btn-primary btn-primary-dim text-[11px] px-4 py-1.5"
                  disabled={!unlocked || !input.trim() || parseMut.isPending}
                  onClick={() => parseMut.mutate({ text: input, source_type: 'paste' })}
                >
                  {parseMut.isPending ? 'PARSING…' : 'PARSE LOCALLY'}
                </button>
              )}
              {state === 'working' && (
                <button
                  className="btn btn-outline text-[11px] px-3 py-1.5"
                  /* Stage 13+: Re-PARSE 先弹确认(右侧编辑会被重置) */
                  onClick={() => setConfirmAction('reparse')}
                >
                  <RefreshIcon />
                  RE-PARSE
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="pane-divider" />

        {/* RIGHT pane: drafts list / empty card / done summary */}
        <section className="flex-1 flex flex-col min-w-0" style={{ background: 'rgba(0,0,0,0.05)' }}>
          {state === 'empty' && <EmptyDraftsCard onPasteSample={() => setInput(SAMPLE_TEXT)} unlocked={unlocked} />}
          {state === 'working' && (
            <WorkingDrafts
              drafts={drafts}
              setDrafts={setDrafts}
              groups={parseResp?.groups ?? []}
              readyCount={readyCount}
              weakCount={weakCount}
              oauthCount={oauthCount}
              orphans={parseResp?.orphans ?? []}
              onHoverDraft={setHoveredDraft}
              onJumpToSource={(idx) => setPinnedDraft((prev) => (prev === idx ? null : idx))}
              showRequiredFields={showRequiredFields}
              flashDraftId={flashDraftId}
              setFlashDraftId={setFlashDraftId}
              scrollRef={draftsScrollRef}
              familyBaseUrls={familyBaseUrls}
            />
          )}
          {state === 'done' && confirmResp && (
            <DoneSummary
              resp={confirmResp}
              /* Stage 9/10: 传入所有 drafts,内部按 isOAuth / resp.items alias 分类到各 section */
              drafts={drafts}
            />
          )}
        </section>
      </div>

      {/* ── Action bar ──────────────────────────────────────────────────── */}
      {state === 'working' && (
        <div className="action-bar px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4 text-[12px] font-mono">
            <span className="flex items-center gap-1.5"><span className="tier-dot tier-confirmed" /><span className="font-bold" style={{ color: 'var(--foreground)' }}>{readyCount}</span><span style={{ color: 'var(--muted-foreground)' }}>ready</span></span>
            <span style={{ color: 'var(--muted-foreground)' }}>·</span>
            <span className="flex items-center gap-1.5"><span className="tier-dot tier-suggested" /><span className="font-bold" style={{ color: 'var(--foreground)' }}>{oauthCount}</span><span style={{ color: 'var(--muted-foreground)' }}>OAuth handoff</span></span>
            <span style={{ color: 'var(--muted-foreground)' }}>·</span>
            {/* Stage 14+: needs review / missing provider stat 可点击 → 滚到首个问题 draft */}
            <button
              type="button"
              className="stat-clickable flex items-center gap-1.5"
              onClick={() => scrollToFirstDraft((d) => d.isWeak)}
              disabled={weakCount === 0}
              title={weakCount === 0 ? undefined : 'Jump to first needs-review draft'}
            >
              <span className="tier-dot tier-warn" />
              <span className="font-bold" style={{ color: 'var(--foreground)' }}>{weakCount}</span>
              <span style={{ color: 'var(--muted-foreground)' }}>needs review</span>
            </button>
            {missingProviderCount > 0 && (
              <>
                <span style={{ color: 'var(--muted-foreground)' }}>·</span>
                <button
                  type="button"
                  className="stat-clickable flex items-center gap-1.5"
                  onClick={() =>
                    scrollToFirstDraft(
                      (d) =>
                        d.selected && !d.isOAuth && !d.isWeak && (d.record.protocol_types?.length ?? 0) === 0
                    )
                  }
                  title="Jump to first missing-protocol draft"
                >
                  <span className="tier-dot" style={{ background: '#f87171' }} />
                  <span className="font-bold" style={{ color: '#fca5a5' }}>{missingProviderCount}</span>
                  <span style={{ color: '#fca5a5' }}>missing protocol</span>
                </button>
              </>
            )}
            {/* 2026-04-25: source-hash readout replaced with the
                scroll-sync toggle. Styled identically to the Select-all
                button (.check check-inline indicator + label inside a
                btn-ghost) so both checkboxes in the action bar share
                one visual language. */}
            <span style={{ color: 'var(--muted-foreground)' }} className="mx-2">|</span>
            <button
              type="button"
              className="btn btn-ghost text-[11px] px-3 py-1.5 select-all-btn"
              onClick={() => setScrollSync((v) => !v)}
              title="When on, dragging either pane's scrollbar moves the other pane to keep the matching draft / source line visible."
            >
              <span
                className={`check check-inline${scrollSync ? ' checked' : ''}`}
                aria-hidden
              >
                {scrollSync && <span className="text-[10px]">✓</span>}
              </span>
              <span>Sync scroll</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Stage 12+/13+: 全选 / 取消全选 toggle(带 checkbox 视觉,支持 indeterminate 半选态) */}
            {(() => {
              const total = drafts.length;
              const selectedCount = drafts.filter((d) => d.selected).length;
              const allSelected = total > 0 && selectedCount === total;
              const someSelected = selectedCount > 0 && !allSelected;
              return (
                <button
                  className="btn btn-ghost text-[11px] px-3 py-1.5 select-all-btn"
                  onClick={toggleSelectAll}
                  disabled={total === 0}
                  title={total === 0 ? 'No drafts' : undefined}
                >
                  <span
                    className={`check check-inline${allSelected ? ' checked' : ''}${someSelected ? ' indeterminate' : ''}`}
                    aria-hidden
                  >
                    {allSelected && <span className="text-[10px]">✓</span>}
                    {someSelected && <span className="text-[10px] leading-none">−</span>}
                  </span>
                  <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
                </button>
              );
            })()}
            {/* Stage 13+: Clear all 也走确认弹窗(和 SOURCE 的 Clear 共用 clear 弹窗) */}
            <button
              className="btn btn-ghost text-[11px] px-3 py-1.5"
              onClick={() => setConfirmAction('clear')}
              title="Clear all source text and parsed drafts"
            >
              Clear all
            </button>
            <button
              className="btn btn-primary btn-primary-dim px-5 py-2 text-[12px]"
              /* Stage 7/12+: vault 锁住时禁用 Import;readyCount+selectedOauthCount 都 0 时禁用
                 (OAuth-only 选中也允许 proceed 到 Done 页看 handoff 卡片) */
              disabled={!unlocked || (readyCount === 0 && selectedOauthCount === 0) || confirmMut.isPending}
              onClick={runImport}
              title={
                !unlocked
                  ? 'Unlock vault to import'
                  : (readyCount === 0 && selectedOauthCount === 0 ? 'Select at least one draft' : undefined)
              }
            >
              {confirmMut.isPending
                ? 'IMPORTING…'
                : readyCount > 0
                  ? `IMPORT ${readyCount}${selectedOauthCount > 0 ? ` + ${selectedOauthCount} OAUTH` : ''}`
                  : `PROCEED · ${selectedOauthCount} OAUTH`}
              {!confirmMut.isPending && <ArrowRightIcon />}
            </button>
          </div>
        </div>
      )}

      {/* Stage 13+: Clear / Re-PARSE 确认弹窗 */}
      <ConfirmModal
        open={confirmAction === 'clear'}
        title="Clear everything?"
        description={
          <>
            This will remove all source text and discard parsed drafts on the right.
            <br />
            <span style={{ color: 'var(--muted-foreground)' }}>
              This action can't be undone.
            </span>
          </>
        }
        confirmLabel="Clear"
        variant="danger"
        onConfirm={() => {
          setConfirmAction(null);
          startNewImport();
        }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmModal
        open={confirmAction === 'reparse'}
        title="Re-parse source?"
        description={
          <>
            Your edits on the right panel
            <span style={{ color: '#ca8a04', fontWeight: 600 }}> (alias, providers, base_url, selection) </span>
            will be discarded and recomputed from the source text.
            <br />
            <span style={{ color: 'var(--muted-foreground)' }}>
              The source text itself stays unchanged.
            </span>
          </>
        }
        confirmLabel="Re-parse"
        onConfirm={() => {
          setConfirmAction(null);
          parseMut.mutate({ text: input, source_type: 'paste' });
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}

// ── Empty pane ───────────────────────────────────────────────────────────

function EmptyDraftsCard({ onPasteSample, unlocked }: { onPasteSample: () => void; unlocked: boolean }) {
  // Card fills the entire right pane (user request 2026-04-23, per
  // .superdesign/design_iterations/user_bulk_import_empty_3.html).
  // Inner `.nothing-inner` caps readable width so text doesn't sprawl on
  // wide screens, while `.nothing-card` absorbs the full pane. Title
  // + description + button stay centred; the "What we can parse" block
  // goes left-aligned (title) + stretched (list) so it reads as a
  // section rather than another paragraph.
  return (
    <div className="flex-1 flex p-[18px] min-h-0">
      <div className="nothing-card">
        <div className="nothing-inner">
          <div className="nothing-title">Nothing here yet</div>
          <p className="nothing-desc">
            Paste any unstructured text on the left (mixed formats OK), or create a record manually.
          </p>
          <button
            className="btn btn-outline text-[10px] px-3 py-1.5"
            onClick={onPasteSample}
            /* Stage 7+ 规则 4: Paste sample 会触发 setInput,但 empty→working 需要 parse,
               后者需要 vault unlock 才能跑(textarea 也 disabled)。Lock 态直接灰掉避免混淆。 */
            disabled={!unlocked}
            title={!unlocked ? 'Unlock vault to paste sample' : undefined}
          >
            <ClipboardPasteIcon />
            Paste sample
          </button>
          <div className="nothing-divider" />
          <div className="nothing-parse-title">What we can parse</div>
          <ul className="nothing-parse-list">
            {[
              'API keys (sk-ant, sk-proj, AIza, gsk_, ghp_, AKIA, SG., eyJ…)',
              'Email + password pairs',
              'OAuth accounts (generates CLI command)',
              'Third-party gateway base_url',
            ].map((label) => (
              <li key={label}>
                <span className="nothing-dot" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Working pane ─────────────────────────────────────────────────────────

function WorkingDrafts({
  drafts,
  setDrafts,
  groups,
  readyCount,
  weakCount,
  oauthCount,
  orphans,
  onHoverDraft,
  onJumpToSource,
  showRequiredFields,
  flashDraftId,
  setFlashDraftId,
  scrollRef,
  familyBaseUrls,
}: {
  drafts: DraftRow[];
  setDrafts: React.Dispatch<React.SetStateAction<DraftRow[]>>;
  /** v4.1 Stage 4: L3 endpoint cluster 产出。drafts 按 group.member_draft_ids 分层渲染 */
  groups: EndpointGroup[];
  readyCount: number;
  weakCount: number;
  oauthCount: number;
  /**
   * v4.1 Stage 3 Phase D: backend 的 orphans 字段现支持两种形态:
   *   - string (老 schema,单纯 candidate id)
   *   - { value: string; source_span?: [number, number] } (结构化 orphan 信息)
   * 同时 orphan_candidates 暴露完整 kind+value,长远用它。这里双兼容。
   */
  orphans: Array<{ value: string; source_span?: [number, number] } | string>;
  /** v4.1 Stage 3 E.4: hover draft 卡片 → 告诉 source pane 临时高亮 line_range */
  onHoverDraft: (idx: number | null) => void;
  /** 点击 draft "jump to source" → 持久高亮并 scroll into view (同 idx 切换关) */
  onJumpToSource: (idx: number) => void;
  /** v4.1 Stage 13.1+: IMPORT 拦截后,缺 provider 的 selected draft 显示 Required 提示 */
  showRequiredFields: boolean;
  /** IMPORT 拦截后闪烁的 draft id(2s 动画) */
  flashDraftId: string | null;
  /** v4.2: applyProviderToAll 后需要 flash 第一个被修改的 draft,让用户确认"改了" */
  setFlashDraftId: React.Dispatch<React.SetStateAction<string | null>>;
  /** 2026-04-25: scroll container ref for bidirectional scroll-sync —
   *  parent listens on this to detect manual scrolling on the right
   *  pane, programmatically scrolls the source pane in step. */
  scrollRef?: React.RefObject<HTMLDivElement>;
  /** family id → official base URL map (Use-Official Rule 3). undefined while
   *  the rules query is loading or if the backend omitted the field. */
  familyBaseUrls?: Record<string, string>;
}) {
  function toggle(idx: number) {
    setDrafts((prev) => prev.map((d, i) => i === idx ? { ...d, selected: !d.selected } : d));
  }
  function toggleExpand(idx: number) {
    setDrafts((prev) => prev.map((d, i) => i === idx ? { ...d, expanded: !d.expanded } : d));
  }
  function editField(idx: number, key: DraftFieldsEditable, value: string) {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === idx
          ? { ...d, record: { ...d.record, fields: { ...d.record.fields, [key]: value } } }
          : d
      )
    );
  }
  // 规则 3: 用户下拉切换 type,同时派生 isOAuth/selected 默认勾选状态
  //   (切到 OAUTH 默认取消勾选 —— 与原 draftToRow 中 isOAuth 勾选策略一致)
  function changeType(idx: number, newType: 'KEY' | 'OAUTH') {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const isOAuth = newType === 'OAUTH';
        return {
          ...d,
          userType: newType,
          isOAuth,
          // 切 OAUTH 默认取消勾选 (走浏览器登录);切 KEY 若有 api_key 默认勾选
          selected: isOAuth ? false : Boolean(d.record.fields.api_key),
        };
      })
    );
  }
  // v4.1 Stage 5+: 用户编辑 Provider multi-select 协议列表(增/删/自定义)
  //   直接 mutate record.protocol_types(和 editField 对 fields.* 的编辑模型一致),
  //   runImport 读 record.protocol_types 透传给 CLI 的 providers 字段。
  //
  // Use-Official Rule 3 (auto-fill base_url on protocol change):
  //   When the new selection has exactly one protocol AND the current
  //   base_url is empty, fill base_url with that protocol's official URL
  //   so users don't have to manually click "use official" right after
  //   picking one provider. Preconditions are strict — multi-protocol
  //   selections, or any non-empty base_url (including a value previously
  //   set by Use-Official itself), leave base_url untouched. official_base_url
  //   is also updated so the BaseUrlRow toggle reflects the matched family.
  function changeProtocols(idx: number, next: string[]) {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== idx) return d;
        const currentBase = (d.record.fields.base_url ?? '').trim();
        const onlyFamily = next.length === 1 ? next[0] : null;
        const officialUrl = onlyFamily ? familyBaseUrls?.[onlyFamily] : undefined;
        if (!currentBase && officialUrl) {
          return {
            ...d,
            record: {
              ...d.record,
              protocol_types: next,
              fields: { ...d.record.fields, base_url: officialUrl },
              official_base_url: officialUrl,
            },
          };
        }
        return { ...d, record: { ...d.record, protocol_types: next } };
      })
    );
  }
  /**
   * Apply the suggested provider to every draft in one click (P0 review fix F-2,
   * 2026-04-23). 触发条件:`suggestEntry` banner 显示的场景下用户点 APPLY TO。
   *
   * 行为:
   *   - `inferred_provider` 为空 → 写入 suggestKey(帮用户补上 banner 建议的 family)
   *   - `protocol_types` 为空 → 写入 `[suggestKey]`(过 IMPORT 按钮的"missing provider"检查)
   *   - 已有 inferred/protocol 的 draft **不覆盖**(用户已经手选过,保留其意图)
   *   - apply 完成后 dismiss banner(避免重复触发)
   *
   * 注:aggregator family(openrouter / yunwu / zeroeleven)的 protocol 应是 [],但
   * 前端不区分 aggregator;用户可通过 per-draft multi-select 手动清空或改多协议。
   */
  function applyProviderToAll(family: string) {
    // v4.2 (2026-04-24): 记录第一个被修改的 draft id,apply 完成后 flash + scroll 到它,
    //   让用户视觉上确认"确实改了"。修复"Apply 看起来没生效"的反馈。
    let firstAffectedId: string | null = null;
    setDrafts((prev) =>
      prev.map((d) => {
        const inferredEmpty = !d.record.inferred_provider;
        const protosEmpty = (d.record.protocol_types?.length ?? 0) === 0;
        if (!inferredEmpty && !protosEmpty) return d;
        if (firstAffectedId === null) firstAffectedId = d.record.id;
        return {
          ...d,
          record: {
            ...d.record,
            inferred_provider: inferredEmpty ? family : d.record.inferred_provider,
            protocol_types: protosEmpty ? [family] : d.record.protocol_types,
          },
        };
      }),
    );
    setDismissedSuggestKey(family);
    // 下一帧 DOM 更新后滚动 + flash
    if (firstAffectedId) {
      const id = firstAffectedId;
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLDivElement>(`[data-draft-id="${id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashDraftId(id);
        setTimeout(() => setFlashDraftId(null), 2000);
      });
    }
  }
  // v4.1 Stage 6+: 用户编辑 Alias(直接 mutate record.alias)
  function changeAlias(idx: number, next: string) {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === idx ? { ...d, record: { ...d.record, alias: next } } : d
      )
    );
  }
  /**
   * v4.1 Stage 6+: base_url 编辑路径(独立于 editField 因为要管 prevBaseUrl 状态机)。
   *
   * - `viaButton=true` (use official / revert 按钮点击) → 保存当前值到 prevBaseUrl
   * - `viaButton=false` (用户直接手改 input) → 清 prev (丢弃回退历史,用户已接受新值)
   */
  function changeBaseUrl(idx: number, next: string, viaButton: boolean) {
    setDrafts((prevState) =>
      prevState.map((d, i) => {
        if (i !== idx) return d;
        const currentBaseUrl = d.record.fields.base_url ?? '';
        return {
          ...d,
          prevBaseUrl: viaButton
            // 按钮路径:如果已经有 prev 且点的是 revert 回退,prev 要清空;
            // 否则保存 current 作为新 prev
            ? (d.prevBaseUrl !== null && next === d.prevBaseUrl ? null : currentBaseUrl)
            : null,
          record: { ...d.record, fields: { ...d.record.fields, base_url: next } },
        };
      })
    );
  }
  // Provider 推断 banner: ≥2 条 draft 共享同一 inferred_provider 时提示一键应用
  const providerGroups = new Map<string, number>();
  for (const d of drafts) {
    const p = d.record.inferred_provider;
    if (p) providerGroups.set(p, (providerGroups.get(p) ?? 0) + 1);
  }
  const suggestEntry = Array.from(providerGroups.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])[0];
  const suggestPct = suggestEntry ? Math.round((suggestEntry[1] / drafts.length) * 100) : 0;

  // Stage 14+: suggest banner 可关闭,dismiss key 按 suggest 的 provider family 记录。
  // 换了 provider 建议(重新 parse 或 drafts 组成变化)→ useEffect 重置 dismiss,让新建议重新出现。
  const suggestKey = suggestEntry?.[0] ?? null;
  const [dismissedSuggestKey, setDismissedSuggestKey] = useState<string | null>(null);
  useEffect(() => {
    if (suggestKey !== dismissedSuggestKey) setDismissedSuggestKey(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey]);

  // v4.2 fix (2026-04-24 用户反馈 "APPLY TO N 看起来没生效"):
  //   原 banner 的 `APPLY TO N` 里 N 用的是 **匹配数** (已标该 family 的 draft 数),
  //   但 applyProviderToAll 只动"还没标"的 draft。当所有 draft 都已标过 (后端
  //   enrich 跑全了 + 用户没改过) → Apply 是 no-op,用户看 banner 说 "APPLY TO 4"
  //   以为会改 4 条,实际 0 条,UX 像没实现。
  //   修:算出"真正会被 Apply 修改的 draft 数"(inferred 空 OR protocol_types 空 的条数)
  //   用作按钮 count;targets=0 时不显 banner 避免误导。
  const applyTargets = suggestKey
    ? drafts.filter((d) => {
        const inferredEmpty = !d.record.inferred_provider;
        const protosEmpty = (d.record.protocol_types?.length ?? 0) === 0;
        return inferredEmpty || protosEmpty;
      })
    : [];
  const showSuggest = Boolean(suggestEntry)
    && applyTargets.length > 0
    && dismissedSuggestKey !== suggestKey;

  return (
    <>
      {/* Provider suggestion banner — Stage 14+: 左侧加 X 可关闭 */}
      {showSuggest && suggestEntry && (
        <div className="suggest-bar px-5 py-2.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 text-[13px]">
            <button
              type="button"
              className="suggest-close"
              onClick={() => setDismissedSuggestKey(suggestKey)}
              title="Dismiss this suggestion"
              aria-label="Dismiss"
            >
              ×
            </button>
            <span className="font-mono" style={{ color: 'var(--primary)', fontWeight: 700 }}>{suggestPct}%</span>
            <span style={{ color: 'var(--foreground)' }}>of drafts look like</span>
            <span className={`chip ${providerChipClassFromId(suggestEntry[0])}`}>
              {suggestEntry[0].toUpperCase()}
            </span>
            <span style={{ color: 'var(--muted-foreground)' }}>— apply as protocol?</span>
          </div>
          <button
            className="apply-btn"
            onClick={() => applyProviderToAll(suggestEntry[0])}
            title={`Fill protocol=${suggestEntry[0].toUpperCase()} on ${applyTargets.length} draft(s) that don't already have one`}
          >
            APPLY TO {applyTargets.length}
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar px-5 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 text-[12px] font-mono">
          <span style={{ color: 'var(--muted-foreground)' }}><span className="font-bold" style={{ color: 'var(--foreground)' }}>{readyCount}</span> ready</span>
          <span style={{ color: 'var(--muted-foreground)' }}>·</span>
          <span style={{ color: 'var(--muted-foreground)' }}><span className="font-bold" style={{ color: '#ca8a04' }}>{weakCount}</span> weak</span>
          <span style={{ color: 'var(--muted-foreground)' }}>·</span>
          <span style={{ color: 'var(--muted-foreground)' }}><span className="font-bold" style={{ color: '#38bdf8' }}>{oauthCount}</span> OAuth</span>
        </div>
      </div>

      {/* Draft card list — v4.1 Stage 4: 按 EndpointGroup 分层,每 group 加 header */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-3 space-y-2">
        {renderGroupedDrafts({
          drafts,
          groups,
          toggle,
          toggleExpand,
          editField,
          changeType,
          changeProtocols,
          changeAlias,
          changeBaseUrl,
          onHoverDraft,
          onJumpToSource,
          showRequiredFields,
          flashDraftId,
        })}
        {drafts.length === 0 && (
          <div className="text-[12px] font-mono text-center py-6" style={{ color: 'var(--muted-foreground)' }}>
            No drafts grouped from the pasted text.
          </div>
        )}
      </div>
      {orphans.length > 0 && (
        <div className="px-5 py-2.5 flex items-center gap-2 flex-wrap flex-shrink-0" style={{ background: 'rgba(0,0,0,0.25)', borderTop: '1px solid var(--border)' }}>
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'var(--muted-foreground)' }}>Orphans</span>
          {orphans.map((o, i) => (<span key={i} className="orphan-chip">{typeof o === 'string' ? o : o.value}</span>))}
        </div>
      )}
    </>
  );
}

/**
 * v4.1 Stage 3 Phase E.2/E.3: Draft 卡片
 *
 * 对齐 `user_bulk_import_working_2.html` working 态:
 * - Collapsed header: checkbox + #N + provider chip + kind chip + 字段预览 + confidence bar + tier dot + chevron
 * - Expanded body: field rows (Provider select / Alias / Email / Password / API Key / base_url)
 *   每行: [label 80px | input 1fr | link icon | tier dot]
 */
type DraftFieldsEditable = 'email' | 'password' | 'api_key' | 'base_url';

/**
 * v4.1 Stage 4 Phase E: 按 EndpointGroup 分层渲染 drafts
 *
 * 每个 Group 渲染一个 header(provider + base_url + "N keys")+ 下挂 member drafts。
 * 若未传入 groups (老 parse 响应没有 groups 字段) 则 fallback 到单层 flat 渲染。
 *
 * draft idx 是**全局索引**,保留原 `#N` 顺序(UI 交互编号不受 group 分层影响)。
 */
function renderGroupedDrafts({
  drafts,
  groups,
  toggle,
  toggleExpand,
  editField,
  changeType,
  changeProtocols,
  changeAlias,
  changeBaseUrl,
  onHoverDraft,
  onJumpToSource,
  showRequiredFields,
  flashDraftId,
}: {
  drafts: DraftRow[];
  groups: EndpointGroup[];
  toggle: (idx: number) => void;
  toggleExpand: (idx: number) => void;
  editField: (idx: number, key: DraftFieldsEditable, value: string) => void;
  changeType: (idx: number, newType: 'KEY' | 'OAUTH') => void;
  changeProtocols: (idx: number, next: string[]) => void;
  changeAlias: (idx: number, next: string) => void;
  changeBaseUrl: (idx: number, next: string, viaButton: boolean) => void;
  onHoverDraft: (idx: number | null) => void;
  onJumpToSource: (idx: number) => void;
  showRequiredFields: boolean;
  flashDraftId: string | null;
}) {
  // 若 group 为空或只剩 1 group 且只 1 draft,flat 渲染更紧凑 (避免冗余 header)
  const useGrouped = groups.length >= 2 || (groups.length === 1 && groups[0].member_draft_ids.length >= 2);

  const idByDraftId = new Map(drafts.map((d, i) => [d.record.id, i] as const));

  const renderDraft = (d: DraftRow) => {
    const idx = idByDraftId.get(d.record.id);
    if (idx === undefined) return null;
    return (
      <DraftRowCard
        key={d.record.id}
        row={d}
        idx={idx + 1}
        onToggleSelect={() => toggle(idx)}
        onToggleExpand={() => toggleExpand(idx)}
        onEditField={(k, v) => editField(idx, k, v)}
        onChangeType={(t) => changeType(idx, t)}
        onChangeProtocols={(next) => changeProtocols(idx, next)}
        onChangeAlias={(next) => changeAlias(idx, next)}
        onChangeBaseUrl={(next, viaButton) => changeBaseUrl(idx, next, viaButton)}
        onHover={(enter) => onHoverDraft(enter ? idx : null)}
        onJumpToSource={() => onJumpToSource(idx)}
        showRequiredFields={showRequiredFields}
        flash={flashDraftId === d.record.id}
      />
    );
  };

  if (!useGrouped) {
    return <div className="space-y-1.5">{drafts.map(renderDraft)}</div>;
  }

  // 计算哪些 draft 已被 group 覆盖,剩下的(理论上应为空,但兜底)归"其他"
  const coveredIds = new Set<string>();
  for (const g of groups) for (const id of g.member_draft_ids) coveredIds.add(id);
  const orphanDrafts = drafts.filter((d) => !coveredIds.has(d.record.id));

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const members = g.member_draft_ids
          .map((id) => drafts.find((d) => d.record.id === id))
          .filter((d): d is DraftRow => Boolean(d));
        if (members.length === 0) return null;
        return (
          <div key={g.id} className="endpoint-group">
            <EndpointGroupHeader group={g} />
            <div className="space-y-1.5 pl-3 border-l border-dashed" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              {members.map(renderDraft)}
            </div>
          </div>
        );
      })}
      {orphanDrafts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono uppercase tracking-widest px-1" style={{ color: 'var(--muted-foreground)' }}>
            Ungrouped
          </div>
          {orphanDrafts.map(renderDraft)}
        </div>
      )}
    </div>
  );
}

function EndpointGroupHeader({ group }: { group: EndpointGroup }) {
  const providerLabel = group.provider ? group.provider.toUpperCase() : 'UNKNOWN';
  const chipClass = providerChipClassFromId(group.provider);
  // 2026-04-23: base_url (e.g. platform.moonshot.cn/console/api-keys)
  // removed from the group header — users reported the long login URL
  // adding noise without a matching action, and per-draft base_url is
  // still editable inside each card. If you need to resurface group-
  // level base_url later, gate behind a disclosure toggle rather than
  // making it always-visible.
  // 2026-04-25: member count ("N keys") and the group.reason tag
  // ("explicit" / "near-miss") also removed per user UX — provider
  // chip alone is sufficient to identify the group; the cards below
  // already show each key explicitly, so the count is redundant.
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <span className={`chip ${chipClass}`}>{providerLabel}</span>
    </div>
  );
}

function DraftRowCard({
  row,
  idx,
  onToggleSelect,
  onToggleExpand,
  onEditField,
  onChangeType,
  onChangeProtocols,
  onChangeAlias,
  onChangeBaseUrl,
  onHover,
  onJumpToSource,
  showRequiredFields,
  flash,
}: {
  row: DraftRow;
  idx: number;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onEditField: (key: DraftFieldsEditable, value: string) => void;
  /** 规则 3: 用户下拉切换 type (KEY / OAUTH) */
  onChangeType: (newType: 'KEY' | 'OAUTH') => void;
  /** v4.1 Stage 5+: 用户编辑 Provider multi-select 协议列表 */
  onChangeProtocols: (next: string[]) => void;
  /** v4.1 Stage 6+: 用户编辑 alias */
  onChangeAlias: (next: string) => void;
  /** v4.1 Stage 6+: 用户编辑 base_url(viaButton=true 表示通过 use official/revert 按钮) */
  onChangeBaseUrl: (next: string, viaButton: boolean) => void;
  /** v4.1 E.4: 鼠标进/出卡片,源 pane 临时高亮对应 line_range */
  onHover: (enter: boolean) => void;
  /** 点击卡片头部或 Jump 按钮,持久高亮 + scrollIntoView */
  onJumpToSource: () => void;
  /** v4.1 Stage 13.1+: IMPORT 拦截后为所有缺 provider 的 selected draft 显示 "Required" 提示 */
  showRequiredFields: boolean;
  /** 当前 draft 被 flash 动画提醒(IMPORT 拦截后 scroll 到首个时触发) */
  flash: boolean;
}) {
  const { record: r } = row;
  const effectiveType = computeEffectiveType(row);
  const isKeyMode = effectiveType === 'KEY';
  // v4.2 (2026-04-24): 字段级 missing 不再 gate 在 row.selected —— parse 完成后
  //   用户还没勾选时就能看到"这张 KEY 卡片缺 provider / api_key" 的 ⚠ REQUIRED 提示。
  //   红框 (CSS class `missing-provider`) 仍只给 selected 卡,避免 unselected faded 卡
  //   上多个红框反而视觉噪声。
  const missingProviderField = isKeyMode && !row.isWeak
    && (r.protocol_types?.length ?? 0) === 0;
  const missingApiKeyField = isKeyMode && !row.isWeak
    && !(r.fields.api_key ?? '').trim();
  // hint 不关心 selected (showRequiredFields 开就显)
  const missingProvider = missingProviderField;
  const missingApiKey = missingApiKeyField;
  // 但 CSS 红框只给 selected 卡
  const hasRequiredIssue = row.selected && (missingProviderField || missingApiKeyField);
  const className = [
    'draft-row',
    row.expanded && 'expanded',
    row.selected && 'selected',
    row.isWeak && 'weak',
    row.isOAuth && 'oauth',
    hasRequiredIssue && 'missing-provider',
    flash && 'flash-warn',
  ].filter(Boolean).join(' ');

  // UI-03: provider_hint 可能是 "unknown oauth" 多词,chip 只取首 token 避免视觉拥挤
  const providerId = r.inferred_provider ?? firstToken(r.provider_hint) ?? undefined;
  const providerLabelText = providerId ? providerId.toUpperCase() : 'UNKNOWN';
  // 规则 1: 'KEY ONLY' 简化为 'KEY'; 其余按 effectiveType 显示
  const kindChip = isKeyMode
    ? (r.fields.api_key ? 'KEY' : 'URL ONLY')
    : 'OAUTH';

  const confidencePct = Math.max(5, Math.round(r.inference_confidence * 40)); // 2.5 → 100%
  const tier: Candidate['tier'] = r.inferred_provider
    ? 'confirmed'
    : (r.inference_confidence > 0 ? 'suggested' : 'unknown');

  // Preview: title (首选) · alias (fallback)
  // v4.2 Layer 5: 用户手写的 title 作为唯一卡片标识,不再叠加 email / masked secret;
  // 抽不到 title 时退回 backend 生成的 alias (如 "kimi_key_1" / "alice@acme.io"),
  // 避免 "Kimi11 · sk-Rz…Po3i" 这种信息冗余。
  const previewParts: string[] = [];
  if (r.fields.title) {
    previewParts.push(r.fields.title);
  } else if (r.alias) {
    previewParts.push(r.alias);
  }

  return (
    <div
      className={className}
      data-draft-id={r.id}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="draft-header">
        <span className={`check ${row.selected ? 'checked' : ''}`} onClick={onToggleSelect}>
          {row.selected && <span className="text-[10px]">✓</span>}
        </span>
        <span className="text-[12px] font-mono w-6 text-right" style={{ color: '#71717a' }}>#{idx}</span>
        {/* Title moved right after `#` per 2026-04-25 UX: title is the
            card's primary identifier so it belongs next to the index.
            Gray-bold font-mono echoes master's table column-header
            weight (muted-foreground + bold) rather than the previous
            bright foreground — reads as a stable "card label" rather
            than shouty data. Click still triggers expand + jump. */}
        <span
          className="text-[14px] font-mono font-bold truncate flex-1 cursor-pointer self-stretch -my-[0.625rem] py-[0.625rem] flex items-center min-w-0"
          style={{ color: 'var(--muted-foreground)' }}
          onClick={() => {
            onJumpToSource();
            onToggleExpand();
          }}
          title={row.expanded ? 'Collapse & jump to source' : 'Expand & jump to source'}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onJumpToSource();
              onToggleExpand();
            }
          }}
        >
          <span className="truncate">{previewParts.join(' · ') || '(empty)'}</span>
        </span>
        <span className={`chip ${providerChipClassFromId(providerId)}`}>{providerLabelText}</span>
        {/* 规则 3: type 下拉切换 —— 原 chip-kind 改为交互控件 */}
        <select
          className="chip-kind chip-kind-select"
          value={kindChip === 'URL ONLY' ? 'KEY' : (effectiveType as string)}
          onChange={(e) => onChangeType(e.target.value as 'KEY' | 'OAUTH')}
          onClick={(e) => e.stopPropagation()}
          title="Switch credential type"
          aria-label="Credential type"
        >
          <option value="KEY">{kindChip === 'URL ONLY' ? 'URL ONLY' : 'KEY'}</option>
          <option value="OAUTH">OAUTH</option>
        </select>
        {/* 2026-04-23 用户反馈:百分比 + 进度条颜色弱化,跟整体卡片视觉强度对齐。
            tier=confirmed/suggested/unknown 都降低饱和度(70% 不饱和绿/蓝/灰) */}
        <span
          className="text-[11px] font-mono font-bold"
          style={{ color: tier === 'confirmed' ? 'rgba(74,222,128,0.7)' : tier === 'suggested' ? 'rgba(56,189,248,0.7)' : '#71717a' }}
        >
          {confidencePct}%
        </span>
        <div className="conf-bar"><span style={{ width: `${confidencePct}%` }} /></div>
        <span className={`tier-dot ${tierDotClass(tier)}`} />
        <button
          className="btn btn-ghost text-[10px] px-1.5 py-0.5"
          onClick={(e) => {
            // Prevent the parent's combined expand+jump from firing on top
            // of this button's toggle; chevron intentionally keeps "just
            // toggle" behavior so the user has a one-click collapse path.
            e.stopPropagation();
            onToggleExpand();
          }}
          title={row.expanded ? 'Collapse' : 'Expand'}
          aria-label={row.expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDownIcon up={row.expanded} />
        </button>
      </div>

      {/* Expanded body: field rows */}
      {row.expanded && (
        <div className="draft-body">
          {/* Stage 8+ 规则 1: 字段分 3 组,组间加更显的虚线,组内行间无分隔
              Group 1: Provider + Alias (credential 元信息)
              Group 2: Email + Password (账号凭据)
              Group 3: API Key + base_url (KEY 凭据)
              Extra secrets 归第 3 组之后(独立末尾) */}

          {/* Group 1: Provider + Alias */}
          <div className="field-group">
            <ProviderMultiSelectRow
              row={row}
              onChange={onChangeProtocols}
              showRequired={showRequiredFields && missingProvider}
            />
            <FieldRow
              label="Alias"
              value={r.alias}
              onChange={(v) => onChangeAlias(v)}
              placeholder={r.alias ? undefined : '(required — key name in vault)'}
              tier={r.alias ? 'confirmed' : 'unknown'}
            />
          </div>

          {/* Group 2: Email + Password (账号凭据;KEY 模式完全隐藏,不 render)
              2026-04-23 用户反馈第十二轮:KEY 模式下 Email/Password 与该凭据无关,
              之前用 disabled 灰掉仍占视觉位 → 改为**完全隐藏**。
              数据语义保留:r.fields.email / r.fields.password 仍存在 record 里,
              用户切回 OAUTH 时字段重新显现且值不丢。 */}
          {!isKeyMode && (
            <div className="field-group">
              <FieldRow
                label="Email"
                value={r.fields.email ?? ''}
                onChange={(v) => onEditField('email', v)}
                placeholder={r.fields.email === undefined ? '(optional — add if missing)' : undefined}
                tier={r.fields.email ? 'confirmed' : 'unknown'}
              />
              <FieldRow
                label="Password"
                value={r.fields.password ?? ''}
                onChange={(v) => onEditField('password', v)}
                placeholder={r.fields.password === undefined ? '(optional — add if missing)' : undefined}
                tier={r.fields.password ? 'confirmed' : 'unknown'}
                sensitive
              />
            </div>
          )}

          {/* Group 3: API Key + base_url (KEY 凭据;OAUTH 模式完全隐藏,不 render)
              同上:数据保留在 record.fields,用户切回 KEY 时重新显现。 */}
          {isKeyMode && (
            <div className="field-group">
              <FieldRow
                label="API Key"
                value={r.fields.api_key ?? ''}
                onChange={(v) => onEditField('api_key', v)}
                placeholder={r.fields.api_key === undefined ? '(required for KEY type)' : undefined}
                /* Stage 14: API Key 拦截后红色 Required hint(与 Provider 对齐) */
                hint={showRequiredFields && missingApiKey ? '⚠ REQUIRED' : undefined}
                hintColor={showRequiredFields && missingApiKey ? '#fca5a5' : undefined}
                tier={showRequiredFields && missingApiKey ? 'warn' : (r.fields.api_key ? 'confirmed' : 'unknown')}
                sensitive
              />
              <BaseUrlRow
                row={row}
                isKeyMode={isKeyMode}
                onEdit={(v) => onChangeBaseUrl(v, false)}
                onApplyOfficial={(v) => onChangeBaseUrl(v, true)}
                onRevert={(v) => onChangeBaseUrl(v, true)}
              />
            </div>
          )}

          {r.fields.extra_secrets && r.fields.extra_secrets.length > 0 && (
            <div className="field-row">
              <span className="field-label">Extra</span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
                + {r.fields.extra_secrets.length} more secrets in this block (auto-imported with same alias prefix)
              </span>
              <span />
              <span className="tier-dot tier-suggested" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
  hint,
  hintColor,
  tier,
  disabled,
  disabledHint,
  sensitive,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  hint?: string;
  /** v4.1 Stage 14+: 自定义 hint 文字颜色(用于 "Required" 红字等场景) */
  hintColor?: string;
  tier?: Candidate['tier'];
  /** 规则 4: 非当前 effectiveType 的字段 —— 灰掉且禁用输入 */
  disabled?: boolean;
  /** 禁用时替换 hint 的说明文字 (如 "KEY mode — N/A") */
  disabledHint?: string;
  /**
   * F-4 P0 review fix (2026-04-23): sensitive=true 时默认对 value 做
   * 前 10 + *** + 后 6 遮罩(maskSecret),加 Eye 按钮可临时 reveal。
   * 用于 api_key / password 这两个字段,防止截屏 / 录屏 / 屏幕共享时
   * 中段密钥值泄露。email / base_url / alias 不做遮罩(非敏感)。
   */
  sensitive?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const rowClass = disabled ? 'field-row field-row-disabled' : 'field-row';
  // 遮罩态:显示 masked value 但保持同一个 <input> 组件,便于复用 field-input 样式。
  //   - readOnly 在掩码态下强制为 true(防止用户试图编辑 `***`)
  //   - 已有 readOnly / disabled 的语义叠加:外部传进来 true 仍然 readOnly
  const isMasked = Boolean(sensitive) && !revealed && value.length > 0;
  const displayValue = isMasked ? maskSecret(value) : value;
  const effectiveReadOnly = readOnly || disabled || isMasked;
  return (
    <div className={rowClass}>
      <span className="field-label">{label}</span>
      {/* input + (可选) reveal 按钮包在同一格内,不改动 .field-row 的 grid 4 列布局。
          .field-input-wrap 的 right-padding + reveal 按钮 absolute 定位让按钮
          浮在 input 右内侧,不占用外层 grid 列,hint / tier-dot 对齐不变。 */}
      <span className="field-input-wrap">
        <input
          className={`field-input${sensitive ? ' field-input-has-reveal' : ''}`}
          type="text"
          value={displayValue}
          placeholder={placeholder}
          onChange={onChange && !isMasked ? (e) => onChange(e.target.value) : undefined}
          readOnly={effectiveReadOnly}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
        />
        {sensitive && value.length > 0 && !disabled && (
          <button
            type="button"
            className="field-reveal-btn"
            onClick={() => setRevealed((r) => !r)}
            title={revealed ? 'Hide value' : 'Reveal full value'}
            aria-label={revealed ? 'Hide' : 'Reveal'}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </span>
      <span
        className="text-[11px] font-mono"
        style={{
          color: disabled ? 'var(--muted-foreground)' : (hintColor ?? 'var(--muted-foreground)'),
          fontWeight: hintColor ? 700 : undefined,
          letterSpacing: hintColor ? '0.08em' : undefined,
          whiteSpace: 'nowrap',
        }}
      >
        {disabled ? (disabledHint ?? '') : (hint ?? '')}
      </span>
      <span className={`tier-dot ${tierDotClass(disabled ? 'unknown' : (tier ?? 'unknown'))}`} />
    </div>
  );
}

/**
 * v4.2: Provider multi-select 行 — 共享 `ProviderMultiSelect` 组件的 import 页
 *   特有外壳(field-row label + 右侧 hint + tier dot)。组件本体 (chips + 搜索 +
 *   portal dropdown + KNOWN_PROTOCOLS) 统一到 shared/ui/ProviderMultiSelect.tsx,
 *   vault Add Key 弹窗也走同一组件,下拉不再被弹窗底栏裁剪。
 */
function ProviderMultiSelectRow({
  row,
  onChange,
  showRequired,
}: {
  row: DraftRow;
  onChange: (next: string[]) => void;
  /** v4.1 Stage 13.1+: IMPORT 拦截后,在缺 provider 的 selected draft 显示 "Required" 提示 */
  showRequired: boolean;
}) {
  const selected: string[] = row.record.protocol_types ?? [];
  return (
    <div className="field-row field-row-multi">
      <span className="field-label">Protocols</span>
      <ProviderMultiSelect
        values={selected}
        onChange={onChange}
        showRequired={showRequired}
      />
      {showRequired && selected.length === 0 ? (
        <span className="provider-required-hint" title="Protocol is required to import this credential">
          ⚠ Required
        </span>
      ) : (
        /* "N selected" source label removed 2026-04-25 — chips inside
           ProviderMultiSelect already make the count visible, extra
           text was redundant. Empty <span> keeps grid-column count. */
        <span />
      )}
      <span className={`tier-dot ${tierDotClass(showRequired && selected.length === 0 ? 'warn' : (selected.length > 0 ? 'suggested' : 'unknown'))}`} />
    </div>
  );
}

/**
 * v4.1 Stage 5+ 规则 3 + Stage 6b toggle: base_url 行 + "use official" 按钮
 *
 * 按钮三态(isKeyMode=true 前提):
 *   A. hasOfficial && !matchesOfficial
 *      → 按钮 "use official" 可点 → onApplyOfficial(official)
 *   B. matchesOfficial && prevBaseUrl !== null
 *      → 按钮 "revert" 可点 → onRevert(prevBaseUrl) 恢复到历史值
 *   C. matchesOfficial && prevBaseUrl === null
 *      → 按钮灰掉("official",无可回退历史)
 *   D. !hasOfficial
 *      → 按钮灰掉("no default")
 * OAUTH 模式 → 整行 disabled,按钮也灰
 *
 * onEdit(v): 手动编辑 input,调用方清掉 prevBaseUrl 历史
 * onApplyOfficial(v): "use official" 路径,调用方存当前 → prevBaseUrl
 * onRevert(v): "revert" 路径,调用方清掉 prevBaseUrl
 */
function BaseUrlRow({
  row,
  isKeyMode,
  onEdit,
  onApplyOfficial,
  onRevert,
}: {
  row: DraftRow;
  isKeyMode: boolean;
  onEdit: (v: string) => void;
  onApplyOfficial: (v: string) => void;
  onRevert: (v: string) => void;
}) {
  const record = row.record;
  const official = record.official_base_url;
  const currentValue = record.fields.base_url ?? '';
  const hasOfficial = Boolean(official);
  const matchesOfficial = hasOfficial && currentValue === official;
  const canRevert = matchesOfficial && row.prevBaseUrl !== null;
  const canApply = isKeyMode && hasOfficial && !matchesOfficial;
  const disabledInput = !isKeyMode;
  const rowClass = disabledInput ? 'field-row field-row-disabled field-row-baseurl' : 'field-row field-row-baseurl';

  // hint 文案
  let hint: string;
  if (!isKeyMode) {
    hint = 'OAUTH mode — N/A';
  } else if (!hasOfficial) {
    hint = currentValue ? '' : 'provider default unknown';
  } else if (matchesOfficial) {
    hint = 'official';
  } else if (currentValue) {
    hint = 'custom';
  } else {
    hint = '';
  }
  const tier: Candidate['tier'] = disabledInput
    ? 'unknown'
    : (matchesOfficial || currentValue ? 'confirmed' : (hasOfficial ? 'suggested' : 'unknown'));

  // 按钮显示状态
  const btnMode: 'apply' | 'revert' | 'disabled' = canApply
    ? 'apply'
    : (isKeyMode && canRevert ? 'revert' : 'disabled');
  const btnLabel = btnMode === 'revert' ? 'revert' : 'use official';
  const btnActive = btnMode !== 'disabled';

  let btnTitle: string;
  if (!isKeyMode)              btnTitle = 'OAUTH mode — N/A';
  else if (!hasOfficial)       btnTitle = 'No official default for this provider';
  else if (btnMode === 'apply') btnTitle = `Replace with official: ${official}`;
  else if (btnMode === 'revert') btnTitle = row.prevBaseUrl && row.prevBaseUrl.trim()
    ? `Revert to previous: ${row.prevBaseUrl}`
    : 'Revert to empty (clear base_url)';
  else                          btnTitle = 'Already using official base_url';

  function handleBtnClick() {
    if (btnMode === 'apply' && official)        onApplyOfficial(official);
    else if (btnMode === 'revert')              onRevert(row.prevBaseUrl ?? '');
  }

  return (
    <div className={rowClass}>
      <span className="field-label">base_url</span>
      <div className="baseurl-input-wrap">
        <input
          className="field-input"
          type="text"
          value={currentValue}
          placeholder={
            disabledInput
              ? undefined
              : (hasOfficial
                  ? `(optional — click "use official" for ${official})`
                  : '(optional — leave blank for provider default)')
          }
          onChange={(e) => onEdit(e.target.value)}
          readOnly={disabledInput}
          disabled={disabledInput}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className={`baseurl-official-btn${btnActive ? '' : ' is-disabled'}${btnMode === 'revert' ? ' is-revert' : ''}`}
          onClick={handleBtnClick}
          disabled={!btnActive}
          title={btnTitle}
        >
          {btnLabel}
        </button>
      </div>
      <span className="text-[11px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
        {hint}
      </span>
      <span className={`tier-dot ${tierDotClass(tier)}`} />
    </div>
  );
}

// v4.2: providerChipClassFromId 从 @/shared/ui/ProviderMultiSelect 导入 (上方已 import)。

// ── Source pane: per-line rendering with draft-linked highlight ─────────
//
// v4.1 Stage 3 Phase E.4: 把 `<pre>` 整块文本拆成 per-line `<span>`,每行可由
// DraftRecord.line_range 驱动高亮。hover draft → 临时高亮;点击 draft →
// 持久高亮 + scrollIntoView。颜色取自 working_2.html 的 5 色循环 (hl-c1..c5)。

/**
 * 计算每一行要套的高亮 class。
 * - pinned draft 的 line_range 内所有行 → hl-c{N} 持久类
 * - hovered draft 的 line_range 内所有行 → hl-hover (优先级低于 pinned)
 */
/**
 * 2026-04-23 用户反馈:左侧高亮颜色 = 右侧卡片对应状态色,完全同 RGB+α。
 * 不再按 draft index 5 色循环,改为按**该 pinned draft 的状态**映射:
 *   - 校验失败(missing provider / missing api_key)→ hl-failed (与 .draft-row.missing-provider 同色)
 *   - WEAK 弱提示                                 → hl-weak   (与 .draft-row.weak 同色)
 *   - OAUTH 类型                                  → hl-oauth  (与 .draft-row.oauth 同色)
 *   - 默认 KEY                                    → hl-key    (与 .draft-row.selected 同金色)
 * 同 status 的多张卡片对应的源文本段都用同色;1:1 对应靠 pinned/hover 单选实现
 * (用户点哪张卡片,左侧只有那张卡片的 line_range 被 hl-* 覆盖)。
 */
function statusHlClass(d: DraftRow): string {
  // 计算 missingProvider/missingApiKey 与 DraftRowCard 的判定逻辑保持一致
  const isKeyMode = computeEffectiveType(d) === 'KEY';
  const missingProvider = d.selected && isKeyMode && !d.isWeak
    && (d.record.protocol_types?.length ?? 0) === 0;
  const missingApiKey = d.selected && isKeyMode && !d.isWeak
    && !(d.record.fields.api_key ?? '').trim();
  if (missingProvider || missingApiKey) return 'hl-failed';
  if (d.isWeak) return 'hl-weak';
  if (d.isOAuth) return 'hl-oauth';
  return 'hl-key';
}

/**
 * 2026-04-23 用户反馈第五轮:背景色和色条解耦,各自独立由不同动作触发。
 *   - **勾选 (selected)** → 显示背景色 bg-{state}(标记"会被导入")
 *   - **点击 (pinned)**   → 显示 3px 色条 hl-{state}(标记"用户当前关注")
 *   - 两者独立,同时勾+点 → bg + bar 双显
 * state(KEY/OAUTH/WEAK/FAILED)按 statusHlClass(draft) 决定,RGB+α 与右侧
 * .draft-row.{state} 1:1 对齐。
 */
function computeLineClass(
  lineIdx: number,
  drafts: DraftRow[],
  hoveredIdx: number | null,
  pinnedIdx: number | null,
): string {
  const classes: string[] = ['src-line'];

  // 背景色:只在被勾选的 draft 覆盖本行时显示。
  // 多个 selected drafts 可能 overlap,取第一个的状态决定 bg(实际场景里 overlap 罕见)
  const coveringSelected = drafts.find((d) => {
    if (!d.selected) return false;
    const [s, e] = d.record.line_range;
    return lineIdx >= s && lineIdx <= e;
  });
  if (coveringSelected) {
    // bg-key / bg-oauth / bg-weak / bg-failed
    classes.push(`bg-${statusHlClass(coveringSelected).slice(3)}`);
  }

  // 色条:只在用户点击 pinned 的 draft 覆盖本行时显示
  if (pinnedIdx !== null && pinnedIdx < drafts.length) {
    const pinned = drafts[pinnedIdx];
    const [s, e] = pinned.record.line_range;
    if (lineIdx >= s && lineIdx <= e) {
      classes.push(statusHlClass(pinned)); // hl-key / hl-oauth / hl-weak / hl-failed
    }
  }
  // hover overlay(中性白,临时,任一时刻最高优先级)
  if (hoveredIdx !== null && hoveredIdx !== pinnedIdx && hoveredIdx < drafts.length) {
    const [s, e] = drafts[hoveredIdx].record.line_range;
    if (lineIdx >= s && lineIdx <= e) {
      classes.push('src-line-hover');
    }
  }
  return classes.join(' ');
}

function SourcePane({
  text,
  drafts,
  hoveredDraft,
  pinnedDraft,
  onLineClick,
}: {
  text: string;
  drafts: DraftRow[];
  hoveredDraft: number | null;
  pinnedDraft: number | null;
  /** v4.2: 点击一行 → 查该行所属 draft 索引 (未找到传 null),parent 决定 toggle pin 还是清空 */
  onLineClick?: (draftIdx: number | null) => void;
}) {
  const lines = text.split('\n');
  const pinnedRef = useRef<HTMLSpanElement | null>(null);

  // 当 pinnedDraft 变化时,scroll 到对应首行 (click-jump always-on)
  useEffect(() => {
    if (pinnedDraft !== null && pinnedRef.current) {
      pinnedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [pinnedDraft]);

  const pinnedStartLine =
    pinnedDraft !== null && pinnedDraft < drafts.length
      ? drafts[pinnedDraft].record.line_range[0]
      : -1;

  function handleLineClick(e: React.MouseEvent, lineIdx: number) {
    if (!onLineClick) return;
    // 阻止外层 wrapper 的 onDoubleClick (edit-mode 触发) 误命中
    e.stopPropagation();
    // 命中规则: line_range 包含此行的第一张 draft (多 draft 同 block 取首张)
    const hit = drafts.findIndex((d) => {
      const [s, ee] = d.record.line_range;
      return lineIdx >= s && lineIdx <= ee;
    });
    onLineClick(hit >= 0 ? hit : null);
  }

  return (
    <pre className="source-pre">
      {lines.map((line, i) => {
        const cls = computeLineClass(i, drafts, hoveredDraft, pinnedDraft);
        const isPinnedStart = i === pinnedStartLine;
        return (
          <span
            key={i}
            ref={isPinnedStart ? pinnedRef : undefined}
            className={cls}
            data-line={i}
            onClick={onLineClick ? (e) => handleLineClick(e, i) : undefined}
          >
            {line || ' '}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

// ── Confirm modal (reusable) ─────────────────────────────────────────────
//
// v4.1 Stage 13+: 轻量自制确认弹窗,与页面 dark theme 一致。
// Clear / Re-PARSE 共用。按 ESC 或点遮罩 = Cancel。
function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  const btnClass = variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

  return (
    <div className="confirm-modal-overlay" onMouseDown={onCancel}>
      <div className="confirm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="confirm-modal-title">{title}</div>
        <div className="confirm-modal-desc">{description}</div>
        <div className="confirm-modal-btns">
          <button
            type="button"
            className="btn btn-ghost text-[11px] px-3 py-1.5"
            onClick={onCancel}
          >
            {cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            autoFocus
            className={`${btnClass} text-[11px] px-4 py-1.5`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Done pane ────────────────────────────────────────────────────────────

/**
 * v4.1 Stage 9+: inferred provider → `aikey auth login <arg>` 的 arg 名
 *
 * CLI 目前只支持 3 个 provider 走 auth login (`claude` / `codex` / `kimi`),
 * 其余 OAUTH draft 即便在 UI 被识别出来,也没有对应的一键 login 命令。
 *
 * - anthropic → claude  (Anthropic OAuth = Claude.ai 登录)
 * - openai    → codex   (OpenAI OAuth   = Codex/ChatGPT Plus 登录)
 * - kimi      → kimi    (Kimi OAuth     = Moonshot 账号登录)
 * - 其他      → undefined (UI 显示 "OAuth login not supported yet")
 */
/**
 * v4.1 Stage 11+: POSIX single-quote wrapping for safe shell copy-paste.
 *
 * alias 里含 shell 元字符(space / `@` / `:` / `$` 等)时,裸拼到命令里用户复制粘贴到 bash
 * 会被词法拆分或做变量展开。规则:
 *   - 无需引号的字符集([A-Za-z0-9_\-./=]) → 原样返回
 *   - 其他情况 → 包 `'...'` 并把每个内嵌 `'` 替换为 `'\''`(POSIX idiom)
 */
function shellQuote(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_\-./=]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function oauthLoginProvider(inferredProvider: string | undefined): string | undefined {
  if (!inferredProvider) return undefined;
  switch (inferredProvider) {
    case 'anthropic': return 'claude';
    case 'openai':    return 'codex';
    case 'kimi':      return 'kimi';
    default:          return undefined;
  }
}

/**
 * v4.1 Stage 10+ Done page (按 design_iterations/user_bulk_import_done_3.html 模板实现)
 *
 * 结构:
 *   1. Stat strip (4 块: Imported / OAuth pending / Failed / Skipped)
 *   2. OAuth notice + handoff cards (带 step 序号 + Open login page 按钮)
 *   3. Imported section (backend resp.items 里 action=inserted/replaced 的条目,按 alias join 回 drafts)
 *   4. Skipped section (on_conflict=skip 时才有)
 *   5. Failed section (backend 未来可能填充 resp.failed;当前 batch_import 用 on_conflict=error 不出)
 *
 * drafts join 策略:resp.items 只带 alias + action,其余展示字段(provider/kind/preview)从 drafts[] 按 alias 找回。
 * 对于 extra_secrets 衍生的 alias(如 `foo-extra1`),能找到同前缀的 source draft 即可展示 provider chip。
 */
function DoneSummary({
  resp,
  drafts,
}: {
  resp: ConfirmResponse;
  drafts: DraftRow[];
}) {
  // Stage 12+: Done 页只展示 **用户选中** 的 OAuth draft(尊重选择;用户取消勾的不需要处理)
  const oauthDrafts = drafts.filter((d) => d.isOAuth && d.selected);
  const importedItems = (resp.items ?? []).filter((it) => it.action === 'inserted' || it.action === 'replaced');
  const skippedItems = (resp.items ?? []).filter((it) => it.action === 'skipped');
  const failedItems = resp.failed ?? [];

  // 按 alias 找回对应 draft(包括 extra_secrets 的别名前缀匹配)
  const draftByAlias = new Map<string, DraftRow>();
  for (const d of drafts) {
    if (d.record.alias) draftByAlias.set(d.record.alias, d);
  }
  function findDraft(alias: string): DraftRow | undefined {
    const direct = draftByAlias.get(alias);
    if (direct) return direct;
    // extra_secrets → alias like `{base}-extra1`;剥掉后缀再 lookup
    const extraMatch = alias.match(/^(.+)-extra\d+$/);
    if (extraMatch) return draftByAlias.get(extraMatch[1]);
    return undefined;
  }

  return (
    <div className="flex-1 overflow-auto p-6 done-summary">
      {/* Stat strip */}
      <div className="done-stat-strip">
        <div className="done-stat">
          <span className="done-stat-ico done-stat-ico-ok">✓</span>
          <span className="done-stat-lbl">Imported</span>
          <span className="done-stat-val">{resp.inserted + resp.replaced}</span>
        </div>
        <div className="done-stat">
          <span className="done-stat-ico done-stat-ico-sky">↗</span>
          <span className="done-stat-lbl">OAuth pending</span>
          <span className="done-stat-val" style={{ color: '#60a5fa' }}>{oauthDrafts.length}</span>
        </div>
        <div className="done-stat">
          <span className="done-stat-ico done-stat-ico-red">!</span>
          <span className="done-stat-lbl">Failed</span>
          <span className="done-stat-val" style={{ color: '#f87171' }}>{failedItems.length}</span>
        </div>
        <div className="done-stat">
          <span className="done-stat-ico done-stat-ico-dim">»</span>
          <span className="done-stat-lbl">Skipped</span>
          <span className="done-stat-val" style={{ color: 'var(--muted-foreground)' }}>{skippedItems.length + resp.skipped}</span>
        </div>
      </div>

      {/* OAuth handoffs */}
      {oauthDrafts.length > 0 && (
        <>
          <DoneSectionTitle color="#60a5fa" label={`OAuth accounts · ${oauthDrafts.length} pending`} meta="one click to finish each" />
          <div className="oauth-notice">
            <span className="oauth-notice-ico">ⓘ</span>
            <div className="oauth-notice-body">
              <div className="oauth-notice-title">OAuth accounts can't be bulk-imported yet</div>
              <div className="oauth-notice-desc">
                For security, OAuth credentials must be issued by each provider directly.
                {' '}We've pre-filled the exact command for each account below — just click{' '}
                <strong>Open login page</strong>{' '}
                (or copy the command) to finish them one by one.
              </div>
            </div>
          </div>
          <div className="done-cards">
            {oauthDrafts.map((d, i) => (
              <OAuthHandoffCard key={d.record.id} row={d} step={i + 1} />
            ))}
          </div>
        </>
      )}

      {/* Failed */}
      {failedItems.length > 0 && (
        <>
          <DoneSectionTitle color="#f87171" label={`Failed · ${failedItems.length}`} meta="see error details below" />
          <div className="done-rows">
            {failedItems.map((f, i) => (
              <div key={i} className="done-row done-row-failed">
                <span className="done-row-idx">#{i + 1}</span>
                <span className="chip chip-failed">Failed</span>
                <span className="done-row-alias">{f.alias}</span>
                <span className="done-row-err-code">{f.error_code}</span>
                <span className="done-row-err-msg" title={f.error_message}>{f.error_message}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Imported */}
      {importedItems.length > 0 && (
        <>
          <DoneSectionTitle color="#6ee7b7" label={`Imported · ${importedItems.length}`} meta="ready to use in Virtual Keys" />
          <div className="done-rows">
            {importedItems.map((it, i) => {
              const d = findDraft(it.alias);
              const provider = d?.record.inferred_provider ?? firstToken(d?.record.provider_hint) ?? 'unknown';
              const kind = kindLabel(d);
              const preview = draftPreview(d, it.alias);
              return (
                <div key={i} className="done-row done-row-imported">
                  <span className="done-row-idx">#{i + 1}</span>
                  <span className="chip chip-imported">{it.action === 'replaced' ? 'Replaced' : 'Imported'}</span>
                  <span className={`chip ${providerChipClassFromId(provider)}`}>{provider.toUpperCase()}</span>
                  <span className="chip-kind">{kind}</span>
                  <span className="done-row-preview">{preview}</span>
                  <span className="done-row-alias-mono">{it.alias}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Skipped */}
      {skippedItems.length > 0 && (
        <>
          <DoneSectionTitle color="var(--muted-foreground)" label={`Skipped · ${skippedItems.length}`} meta="alias already exists (on_conflict=skip)" />
          <div className="done-rows">
            {skippedItems.map((it, i) => (
              <div key={i} className="done-row">
                <span className="done-row-idx">#{i + 1}</span>
                <span className="chip chip-skipped">Skipped</span>
                <span className="done-row-alias-mono">{it.alias}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DoneSectionTitle({ color, label, meta }: { color: string; label: string; meta: string }) {
  return (
    <div className="done-section-title">
      <span style={{ color }}>{label}</span>
      <span className="done-section-meta">{meta}</span>
    </div>
  );
}

/** Kind chip label:与 DraftRowCard 头部 chip 逻辑对齐 */
function kindLabel(d: DraftRow | undefined): string {
  if (!d) return 'KEY';
  const isOAuth = d.isOAuth;
  const f = d.record.fields;
  if (isOAuth) return 'OAUTH';
  if (f.api_key && f.email) return 'ACCT + API';
  if (f.api_key) return 'KEY';
  if (f.base_url) return 'GATEWAY';
  return 'KEY';
}

/** 用户可见预览:优先 email · secret-tail 拼一行 */
function draftPreview(d: DraftRow | undefined, fallbackAlias: string): string {
  if (!d) return fallbackAlias;
  const parts: string[] = [];
  if (d.record.fields.email) parts.push(d.record.fields.email);
  if (d.record.fields.api_key) parts.push(truncateSecret(d.record.fields.api_key, 10));
  if (d.record.fields.base_url) parts.push(d.record.fields.base_url);
  return parts.length > 0 ? parts.join(' · ') : fallbackAlias;
}

/**
 * v4.1 Stage 9+/10: OAuth handoff card (按 done_3 模板)
 *
 * 布局:
 *   - Head: step 圆圈 + OAuth chip + provider chip + title + status pill
 *   - Meta: Account email, Alias(2x2 grid)
 *   - CLI box: 终端样式命令 + Copy 按钮
 *   - Actions: 说明文字 + "Open login page" 按钮(window.open(login_url))
 *
 * Why 不再把 email 作 --account 参数:CLI 当前不支持 --alias/--account,加了会报错。
 * 待 CLI 加参数后再扩展命令。
 */
function OAuthHandoffCard({ row, step }: { row: DraftRow; step: number }) {
  const r = row.record;
  const loginArg = oauthLoginProvider(r.inferred_provider);
  // Stage 11+: 命令带 `--alias <r.alias>`,跳过 auth login 后的 display name 交互 prompt
  //   alias 里如果有 shell 元字符(: /@ 等) 用单引号包一下,避免 copy 粘贴到 bash 被拆词
  const aliasArg = r.alias ? ` --alias ${shellQuote(r.alias)}` : '';
  const command = loginArg ? `aikey auth login ${loginArg}${aliasArg}` : null;
  const providerId = r.inferred_provider ?? firstToken(r.provider_hint);
  const providerLabel = (providerId ?? 'unknown').toUpperCase();
  const email = r.fields.email;
  const loginUrl = r.login_url;
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function onOpen() {
    if (!loginUrl) return;
    window.open(loginUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={`oauth-card${command ? '' : ' is-unsupported'}`}>
      <div className="oauth-card-head">
        <span className="oauth-step">{step}</span>
        <span className="chip chip-oauth">OAuth</span>
        <span className={`chip ${providerChipClassFromId(providerId)}`}>{providerLabel}</span>
        <span className="oauth-card-title">
          {r.alias}
          {' '}
          <span className="oauth-card-title-dim">· #{row.record.id}</span>
        </span>
        {/* F-3 P0 review fix (2026-04-23): 去掉 "Not started" 状态 pill。
            OAuth 完成事实在 vault.db(CLI 写 entry),不需要 Web 页监控。
            该 pill 之前是静态硬编码 "Not started",用户跑完 `aikey auth login`
            回到 Web 页仍显示 "Not started",反而误导"流程没通"。
            去掉 pill 后,卡片只承担"告诉用户去 terminal 跑什么命令"的职责,
            完成状态由 Vault 页 + `my-keys` 列表天然体现。 */}
      </div>
      <div className="oauth-meta-grid">
        <span className="oauth-meta-k">Account</span>
        <span className="oauth-meta-v oauth-meta-v-ok">{email ?? '(no email parsed)'}</span>
        <span className="oauth-meta-k">Alias</span>
        <span className="oauth-meta-v">{r.alias}</span>
      </div>
      {command && (
        <div className="oauth-cli">
          <code className="oauth-cli-cmd">
            <span className="oauth-cli-prompt">$ </span>
            {command}
          </code>
          <button
            type="button"
            className="oauth-cli-copy"
            onClick={onCopy}
            title="Copy command to clipboard"
          >
            {copied ? '✓ copied' : '⎘ Copy'}
          </button>
        </div>
      )}
      <div className="oauth-actions">
        <span className="oauth-actions-note">
          {command
            ? (loginUrl
                ? 'Opens your browser to the provider login — token is written back automatically.'
                : 'Run command in a local terminal — no login URL configured for this provider.')
            : `No \`aikey auth login\` flow for ${providerId ?? 'unknown'} yet — store as API key manually.`}
        </span>
        <div className="oauth-actions-btns">
          {loginUrl && (
            <button
              type="button"
              className="btn-open-login"
              onClick={onOpen}
              title={`Open ${loginUrl} in a new tab`}
            >
              ↗ Open login page
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Icons (inline SVG to avoid pulling lucide-react) ─────────────────────

function LockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" style={{ color: 'var(--primary)' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" style={{ color: '#4ade80' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function WifiOffIcon() {
  // Mirrors lucide's wifi-off: three concentric arcs + diagonal slash + dot.
  // Keeping each arc in its own <path> (vs one compressed `d` string) avoids
  // arc-flag parsing ambiguity that truncated the earlier one-path version.
  // strokeWidth=1.6 at 14px reads cleanly without looking chunky.
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h.01" />
      <path d="M8.5 16.429a5 5 0 017 0" />
      <path d="M5 12.859a10 10 0 015.17-2.69" />
      <path d="M19 12.859a10 10 0 00-2.007-1.523" />
      <path d="M2 8.82a15 15 0 014.177-2.643" />
      <path d="M22 8.82a15 15 0 00-11.288-3.764" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

function ClipboardPasteIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 2H9a1 1 0 00-1 1v2a1 1 0 001 1h6a1 1 0 001-1V3a1 1 0 00-1-1zM8 4H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2v-3M16 4h2a2 2 0 012 2v1M13 11l4 4-4 4M8 15h9" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

// Eye / EyeOff: heroicons v2 outline (同 vault 页 ICON_EYE / ICON_EYE_OFF,
// 让 reveal 交互在 Import / Vault 两处视觉统一)。
function EyeIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function EyeOffIcon({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function ChevronDownIcon({ up }: { up?: boolean }) {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      style={{ transform: up ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease' }}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  );
}

// ── Scoped styles (reproduces the superdesign tokens without polluting
//    other user pages). Keep in sync with
//    .superdesign/design_iterations/theme_2.css. ─────────────────────────

const IMPORT_CSS = `
/* v3 styling pass (2026-04-23). Rewritten on top of the Stage-4 batch-import
 * refactor to match .superdesign/design_iterations/user_bulk_import_{empty,
 * working,done}_3.html. Behavioural JSX left untouched — this is a
 * palette + surface + button-weight update only. Key token shifts:
 *
 *   --surface-2 = card body background (pane body)
 *   --surface-3 = draft-row background (one step above pane body)
 *   --line / --line-strong = two border weights used consistently
 *   provider chip palette: anthropic → gold, openai → violet, oauth → sky
 *     (collapsed the old indigo/emerald legacy palette so the page now
 *     uses the same provider colour mapping as overview + usage-ledger)
 *
 * Scope: every .btn* rule stays under .import-page to prevent the Invite
 * button in UserShell from inheriting padding (old shrink-icon bug). Other
 * selectors (.unlock-banner, .draft-row, .tier-*, .chip-*) are name-unique
 * and don't need the prefix.
 */
.import-page{
  --imp-surface-2: #1f1f23;
  --imp-surface-3: #2a2a2f;
  --imp-line: rgba(255,255,255,0.06);
  --imp-line-strong: rgba(255,255,255,0.10);
  --imp-text-dim: #8b8b94;
  /* Dim the page-wide foreground so the working-state source pane and
     draft panel don't read as harsh pure-white against the dark canvas.
     One zinc step down (50 -> 300) — noticeable but not muted. */
  --foreground: #d4d4d8;
}
.import-page .btn{display:inline-flex;align-items:center;justify-content:center;gap:0.375rem;border-radius:6px;font-family:var(--font-mono);font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing: 0.05em;padding:8px 14px;border:1px solid transparent;transition:all 180ms ease;cursor:pointer}
.import-page .btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:rgba(250, 204, 21,0.6);box-shadow:0 0 0 1px rgba(250, 204, 21,0.15),0 6px 20px -10px rgba(250, 204, 21,0.5)}
.import-page .btn-primary:hover{background:#fde047;transform:translateY(-1px)}
.import-page .btn-primary:disabled{background:var(--muted);color:var(--muted-foreground);box-shadow:none;border-color:var(--border);cursor:not-allowed;transform:none;opacity:0.7}
.import-page .btn-outline{background:transparent;color:var(--foreground);border-color:var(--imp-line-strong)}
.import-page .btn-outline:hover{background:rgba(255,255,255,0.04);border-color:var(--imp-text-dim)}
.import-page .btn-ghost{background:transparent;color:var(--imp-text-dim)}
.import-page .btn-ghost:hover{background:rgba(255,255,255,0.04);color:var(--foreground)}

.pane-header{font-family:var(--font-mono);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing: 0.05em;color:var(--imp-text-dim)}
.pane-divider{width:1px;background:var(--imp-line)}
.offline-pill{display:inline-flex;align-items:center;gap:0.375rem;font-family:var(--font-mono);font-size:10.5px;font-weight:600;color:var(--imp-text-dim);letter-spacing: 0.05em;text-transform:uppercase;padding:5px 10px;border:1px solid var(--imp-line-strong);border-radius:3px;background:rgba(0,0,0,0.2)}

/* ── Unlock banners ──────────────────────────────────────────────
 * Locked: gold inset bar + gold-tinted gradient (call-to-action).
 * Unlocked: emerald inset bar (3px box-shadow, not a ::before so it
 *   plays nicely with the gradient background).
 */
.unlock-banner{background:linear-gradient(90deg,rgba(250, 204, 21,0.08) 0%,rgba(250, 204, 21,0.02) 100%);border-bottom:1px solid rgba(250, 204, 21,0.35);box-shadow:inset 3px 0 0 0 var(--primary)}
.unlock-banner-ok{background:rgba(16,185,129,0.06);border-bottom:1px solid rgba(16,185,129,0.25);box-shadow:inset 3px 0 0 0 #10b981}
.undo-toast{background:linear-gradient(90deg,rgba(16,185,129,0.14) 0%,rgba(16,185,129,0.03) 100%);border-bottom:1px solid rgba(16,185,129,0.4);box-shadow:inset 3px 0 0 0 #10b981}

/* ── Source pane ─────────────────────────────────────────────── */
/* Stage 13+/14+: source 面板 textarea / SourcePane 字体/padding/行高/wrap/letter-spacing 全部严格统一
   → 切换两态视觉零跳动。注意:textarea 的 UA style 默认和 <pre> 不一致(tab-size / letter-spacing /
   font-kerning / font-variant-ligatures 等),必须显式重置成和 pre 一样。 */
.source-textarea{display:block;width:100%;height:100%;background:transparent;resize:none;color:var(--foreground);font-family:var(--font-mono);font-size:13px;padding:18px 20px;outline:none;border:none;line-height:1.85;box-sizing:border-box;white-space:pre-wrap;word-break:break-all;overflow-wrap:break-word;letter-spacing:0;word-spacing:0;tab-size:4;-moz-tab-size:4;font-variant-ligatures:none;font-kerning:none;font-feature-settings:normal;margin:0;text-indent:0;text-rendering:auto;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.source-textarea::placeholder{color:var(--imp-text-dim);opacity:0.7}
.source-textarea:disabled{opacity:0.5;cursor:not-allowed}
.source-pane-scroll{background:transparent}
.source-view{min-height:100%;display:flex;flex-direction:column}
.source-view-editable{cursor:text}
/* Stage 14+: 与 .source-textarea 严格一致,详见上方注释 */
.source-pre{font-family:var(--font-mono);font-size:13px;line-height:1.85;padding:18px 20px;color:var(--foreground);white-space:pre-wrap;word-break:break-all;overflow-wrap:break-word;letter-spacing:0;word-spacing:0;tab-size:4;-moz-tab-size:4;font-variant-ligatures:none;font-kerning:none;font-feature-settings:normal;margin:0;text-indent:0;text-rendering:auto;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;box-sizing:border-box}
/* v4.1 Stage 3 E.4: Source pane draft-linked line highlight
   (5-colour cycle + hover state).
   Retained during 2026-04-23 v3 restyle — this cross-pane sync is a
   feature, not a decoration (ref: .claude/CLAUDE.md "UI 改版不得丢失既有功能"). */
/* Stage 14+: 用 inset box-shadow 代替 border-left 实现左侧色条,零 layout 影响
   (border-left:2px 透明也占 2px 宽度,会让 pre 里的文字比 textarea 右移 2px) */
.src-line{display:block;padding:0 0.5rem;margin-left:-0.5rem;transition:background-color 120ms ease,box-shadow 120ms ease}
.src-line-hover{background:rgba(255,255,255,0.06);box-shadow:inset 2px 0 0 rgba(255,255,255,0.3)}
/* 2026-04-23 用户反馈第五轮:bg(背景色)和 bar(色条)解耦,各自由不同动作触发:
     - 勾选 (selected) → bg-{state}  : 仅显示**背景色**,RGB+α 完全等于 .draft-row.{state} 的 bg
     - 点击 (pinned)   → hl-{state}  : 仅显示**3px 色条**,RGB 与卡片状态 border 同源
     - 同时勾+点                       : bg + bar 双显
   state(KEY/OAUTH/WEAK/FAILED)由 statusHlClass(draft) 决定。 */

/* === 背景色(仅在勾选时)===
   2026-04-23 第七轮:左/右色值不再 1:1。
   - 右侧卡片 bg 保持原浅色(用户决策"卡片融入背景")
   - 左侧 src-line bg 加深(蓝/红 0.10、黄 0.06、金 0.06),让源文本里被勾选的行
     一眼可见,作为选中范围的"明确标识"
   色相(RGB tuple)仍跟右侧卡片状态色同源,只是 α 各自调到适合自己角色的强度。 */
.src-line.bg-key   {background:rgba(250, 204, 21,0.06)}
.src-line.bg-weak  {background:rgba(234,179,8,0.06)}
.src-line.bg-oauth {background:rgba(96,165,250,0.10)}
.src-line.bg-failed{background:rgba(248,113,113,0.10)}

/* === 3px 色条(仅在点击时) === */
.src-line.hl-key   {box-shadow:inset 3px 0 0 rgba(250, 204, 21,0.55)}
.src-line.hl-weak  {box-shadow:inset 3px 0 0 #fde047}
.src-line.hl-oauth {box-shadow:inset 3px 0 0 rgba(96,165,250,0.55)}
.src-line.hl-failed{box-shadow:inset 3px 0 0 rgba(248,113,113,0.65)}

/* === hover overlay(中性白色,临时,所有状态之上) === */
.src-line.src-line-hover{background:rgba(255,255,255,0.06);box-shadow:inset 3px 0 0 rgba(255,255,255,0.3)}

/* ── Empty-state card ─────────────────────────────────────────── */
/* Empty-state card — fills the entire right pane with surface-2 fill
   and a 1px line border (the pane itself acts as the card). Inner
   content is capped at ~520px so long lines stay readable on wide
   screens without leaving the card feeling empty. */
.nothing-card{flex:1;display:flex;flex-direction:column;background:var(--imp-surface-2);border:1px solid var(--imp-line-strong);border-radius:8px;overflow:hidden}
.nothing-inner{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;width:100%;max-width:520px;margin:0 auto;padding:48px 32px 36px}
.nothing-title{font-family:var(--font-mono);font-size:13px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted-foreground);opacity:0.85;margin-bottom:14px}
/* Prose in this page uses sans (Inter) rather than mono so the eye can
   scan words as shapes instead of as fixed-width character grids —
   2026-04-25 UX pass. Credentials, aliases, URLs, and IDs keep mono. */
.nothing-desc{font-family:var(--font-sans);font-size:13px;line-height:1.6;color:var(--imp-text-dim);margin-bottom:22px;max-width:360px}
.nothing-divider{width:80%;height:1px;margin:28px auto 20px;background:var(--imp-line-strong)}
.nothing-parse-title{font-family:var(--font-mono);font-size:10.5px;font-weight:700;letter-spacing: 0.05em;text-transform:uppercase;color:var(--imp-text-dim);align-self:flex-start;margin-bottom:12px}
.nothing-parse-list{list-style:none;margin:0;padding:0;align-self:stretch}
.nothing-parse-list li{display:flex;align-items:flex-start;gap:10px;padding:7px 0;font-family:var(--font-sans);font-size:13px;color:var(--muted-foreground);text-align:left}
.nothing-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,0.5);margin-top:7px;flex-shrink:0}

/* ── Working toolbar + sub-row ─────────────────────────────────── */
.toolbar{background:rgba(0,0,0,0.15);border-bottom:1px solid var(--imp-line)}

/* ── Tier dots ────────────────────────────────────────────────── */
.tier-dot{display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0}
.tier-confirmed{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,0.5)}
.tier-suggested{background:#38bdf8;box-shadow:0 0 6px rgba(56,189,248,0.5)}
.tier-warn{background:#f97316;box-shadow:0 0 6px rgba(249,115,22,0.5)}
.tier-unknown{background:var(--imp-text-dim)}

/* ── Chips ────────────────────────────────────────────────────── */
/* 2026-04-23 用户反馈:卡片标题 provider chip + KEY/OAUTH 类型 chip 视觉过于突出,
   弱化边框/底色透明度,让卡片标题区视觉重心回归到 alias 文案。文字色保留(provider 识别度) */
.chip{display:inline-flex;align-items:center;gap:0.25rem;font-family:var(--font-mono);font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px;text-transform:uppercase;letter-spacing: 0.05em;border:1px solid rgba(255,255,255,0.06);flex-shrink:0}
/* Anthropic/Claude → brand gold. v3 consolidates anthropic as the primary
   provider swatch; we keep .chip-claude as the class name for API stability
   but shift the colour from indigo to gold. */
/* 2026-04-23 用户反馈第二轮:chip 和 KEY/OAUTH 下拉框继续弱化 ——
   background 全部改 transparent(完全融入卡片标题行底色,不再形成"色块"),
   border 透明度再降一档。
   2026-04-23 第三轮:文字色也加暗向背景靠拢,从 full saturation 的纯品牌色
   降到去饱和暗调(rgba α≈0.55-0.65 + 暗一档的灰调底)。视觉效果:idle 态
   几乎完全融入卡片背景 #2a2a2f,只在认真看时显出 provider 的色相提示。 */
.chip-claude{background:transparent;color:rgba(202,165,17,0.65);border-color:rgba(250, 204, 21,0.12)}
.chip-openai{background:transparent;color:rgba(140,118,200,0.65);border-color:rgba(167,139,250,0.12)}
.chip-oauth{background:transparent;color:rgba(80,140,200,0.65);border-color:rgba(96,165,250,0.12)}
/* v4.2: 国产模型 (kimi/deepseek/zhipu/doubao/siliconflow/qwen/baichuan/minimax) — 暖珊瑚红系 */
.chip-china{background:transparent;color:rgba(210,125,95,0.65);border-color:rgba(239,157,129,0.14)}
/* v4.2: 其他海外厂商 (gemini/groq/xai/hf/perplexity/mistral) — 冷青蓝系 */
.chip-overseas{background:transparent;color:rgba(95,170,175,0.65);border-color:rgba(110,193,201,0.14)}
/* v4.2: 聚合网关 (openrouter/yunwu/zeroeleven) — 中性石板灰 */
.chip-gateway{background:transparent;color:rgba(135,145,160,0.62);border-color:rgba(148,163,184,0.14)}
.chip-unknown{background:transparent;color:rgba(140,140,150,0.65);border-color:rgba(113,113,122,0.16)}
/* Dimmer gray than --imp-text-dim so the kind dropdown (KEY / OAUTH)
   reads quieter than the draft title to its left — title is
   --muted-foreground (#a1a1aa), chip-kind drops two zinc steps to
   #52525b (zinc-600) per 2026-04-25 UX. */
.chip-kind{font-family:var(--font-mono);font-size:10px;font-weight:700;color:#52525b;padding:3px 8px;background:transparent;border:1px solid rgba(255,255,255,0.045);border-radius:3px;text-transform:uppercase;letter-spacing: 0.05em}
/* 规则 3: 下拉切换的 chip-kind 专属样式 —— 小改 appearance/hover,尽量和静态 chip 视觉一致。
   Chevron drawn via two linear-gradient triangles (pre-2026-04-25
   SVG-url experiment broke the <style> block layout — browser's CSS
   parser was choking on something in the data-URL, so rules after it
   silently dropped, taking .draft-header { display:flex } with them).
   Triangles are painted at #a1a1aa (muted-foreground) — brighter than
   the KEY/OAUTH text (#52525b) so the "clickable" affordance is easy
   to spot even when the text is intentionally quiet.
   IMPORTANT: the override rules below use background-color rather
   than the background shorthand, otherwise the chevron background-
   image is reset alongside the color. */
.chip-kind-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;cursor:pointer;padding-right:20px;background-image:linear-gradient(45deg,transparent 50%,#8b8b94 50%),linear-gradient(135deg,#8b8b94 50%,transparent 50%);background-position:calc(100% - 10px) 50%,calc(100% - 6px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
/* 全局 src/index.css 的 input/select/textarea !important 也压 chip-kind-select(它是个 <select>),
   所以这里 idle/hover/focus 的 bg/border/box-shadow 全部加 !important 反覆盖。
   color needs !important because global src/index.css forces
   select { color: var(--foreground) !important }. Without it the
   KEY/OAUTH text overrides back to bright white. */
.chip-kind-select{background-color:transparent !important;color:#52525b !important;border:1px solid rgba(255,255,255,0.045) !important}
.chip-kind-select:hover{color:#71717a !important;background-color:rgba(255,255,255,0.025) !important;border-color:rgba(255,255,255,0.10) !important}
.chip-kind-select:focus{outline:none;background-color:rgba(255,255,255,0.05) !important;border-color:rgba(255,255,255,0.28) !important;box-shadow:0 0 0 2px rgba(255,255,255,0.06) !important}

/* ── Draft rows ───────────────────────────────────────────────── */
/* v4.1 Stage 7+ fix: overflow visible 允许 Provider 下拉弹出卡片边界外(原 overflow:hidden 裁剪了下拉);
   圆角保留,因 header/body 都是矩形 padding box,没有子元素伸出圆角外 */
/* 2026-04-23 用户反馈:正常卡片边框过深,长时间扫视眼花。把默认/hover 边框降一档透明度,
   warn/failed/missing-provider 等"校验不通过"的状态边框保持原色不变(用户原话:
   "校验不通过的红色边框和内容底色不要变,只变正常的卡片"). */
/* Inset bottom box-shadow + outer border = two adjacent 1px horizontal
   lines at the card bottom, mirroring master's "double-line" table
   ending (last-row border stacked with card outer border). */
.draft-row{background:var(--imp-surface-3);border:1px solid rgba(255,255,255,0.05);border-radius:6px;box-shadow:inset 0 -1px 0 0 rgba(255,255,255,0.05);transition:all 150ms ease;overflow:visible;position:relative}
.draft-row:hover{border-color:rgba(255,255,255,0.14)}
.draft-row.selected{border-color:rgba(250, 204, 21,0.22);box-shadow:0 0 0 1px rgba(250, 204, 21,0.06),inset 0 -1px 0 0 rgba(250, 204, 21,0.18)}
/* 2026-04-23 第七轮:右侧卡片 bg 回滚到原浅色(weak 0.03 / oauth 0.04 / failed 0.05 /
   missing-provider 0.04)。用户决策:右侧弱化保持(卡片不抢眼),左侧 src-line bg 单独加深
   (源文本要让用户一眼能看到选中范围)。不再追求左右 1:1 同色,左右各自承担不同视觉职责。 */
.draft-row.weak{border-color:#fde047;border-style:dashed;background:rgba(234,179,8,0.03)}
.draft-row.oauth{border-color:rgba(96,165,250,0.35);background:rgba(96,165,250,0.04)}
.draft-row.failed{border-color:rgba(248,113,113,0.4);background:rgba(248,113,113,0.05);box-shadow:0 0 0 1px rgba(248,113,113,0.06),inset 0 -1px 0 0 rgba(248,113,113,0.3)}
/* Stage 7+ 规则 1: selected KEY draft 缺 Provider(必填),红框 + 淡红底提示导入会被阻止 */
.draft-row.missing-provider{border-color:rgba(248,113,113,0.45);background:rgba(248,113,113,0.04);box-shadow:0 0 0 1px rgba(248,113,113,0.08),inset 0 -1px 0 0 rgba(248,113,113,0.3)}
/* Stage 13.1+: IMPORT 拦截时在被拦 draft 上闪烁(2s 2 个回合),注意焦点落在这一条 */
.draft-row.flash-warn{animation:draft-flash 1s ease-in-out 2}
@keyframes draft-flash{
  0%,100%{box-shadow:0 0 0 1px rgba(248,113,113,0.08)}
  50%{box-shadow:0 0 0 3px rgba(248,113,113,0.55),0 0 18px rgba(248,113,113,0.45);background:rgba(248,113,113,0.10)}
}
/* Provider 字段 "Required" 提示(FieldRow hint 位置) */
.provider-required-hint{font-family:var(--font-mono);font-size:10.5px;font-weight:700;letter-spacing: 0.05em;color:#fca5a5;white-space:nowrap;text-transform:uppercase}
/* Stage 14+: action-bar 里可点击的 stat(needs review / missing provider);hover 加下划线暗示可点 */
.stat-clickable{background:transparent;border:none;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.stat-clickable:hover:not(:disabled){text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
.stat-clickable:disabled{cursor:default;opacity:0.6}
/* Header strip is the "dark lid" over the lighter body, matching the
   vault-page table pattern (dark CardHeader over lighter tbody). The
   bottom border shows only when the body is expanded below — collapsed
   cards just read as a single dark bar. */
.draft-header{display:flex;align-items:center;gap:0.5rem;padding:0.625rem 0.875rem;cursor:pointer;min-height:42px;background:rgba(0,0,0,0.2);border-top-left-radius:6px;border-top-right-radius:6px}
.draft-row:not(.expanded) .draft-header{border-bottom-left-radius:6px;border-bottom-right-radius:6px}
.draft-row.expanded .draft-header{border-bottom:1px solid var(--imp-line)}
.check{width:16px;height:16px;border:1.5px solid var(--imp-line-strong);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;background:transparent;flex-shrink:0;cursor:pointer;color:var(--primary-foreground);font-size:10px}
.check.checked{background:var(--primary);border-color:var(--primary)}
/* Stage 13+: indeterminate 半选态(部分勾选)— 用 primary 淡色 + hyphen 符号 */
.check.indeterminate{background:rgba(250, 204, 21,0.3);border-color:var(--primary);color:var(--primary-foreground)}
/* Select all 按钮里的 inline check —— 尺寸稍小,不影响 btn padding 对齐 */
.check-inline{width:14px;height:14px;font-size:9px}
.select-all-btn{display:inline-flex;align-items:center;gap:8px}

/* ── Orphans row ─────────────────────────────────────────────── */
.orphan-chip{display:inline-flex;align-items:center;gap:0.25rem;font-family:var(--font-mono);font-size:11px;padding:3px 8px;border:1px dashed var(--imp-line-strong);background:rgba(0,0,0,0.3);color:var(--imp-text-dim);border-radius:10px}

/* ── Action bar (bottom) ──────────────────────────────────────── */
.action-bar{background:rgba(24,24,27,0.92);backdrop-filter:saturate(140%) blur(10px);-webkit-backdrop-filter:saturate(140%) blur(10px);border-top:1px solid var(--imp-line-strong);box-shadow:0 -8px 24px -12px rgba(0,0,0,0.6)}

/* ── Field editing (expanded draft body) ──────────────────────── */
/* 2026-04-23 用户反馈第十轮:全局 src/index.css 给 input/select/textarea 加了
   !important 的 background-color/border/focus 规则,会**强制覆盖**本页的 .field-input
   样式(用户截图发现 idle 态实际是 var(--muted) 深灰,而不是 transparent)。
   修复:本页 .field-input 系列规则全部加 !important 局部反覆盖,不动全局 css 避免
   影响其他页面的 input 样式。
   分级:transparent → 0.025 (hover) → 0.05 (focus,加强凸显) */
/* 第十一轮:idle 边框完全透明(输入框在 idle 态跟 .draft-body 100% 融合,肉眼不可见)。
   hover 时边框浮现提示"这里有输入框",focus 时进一步加强。 */
.field-input{background:transparent !important;border:1px solid transparent !important;border-radius:3px !important;padding:0.375rem 0.5rem;color:var(--foreground);font-family:var(--font-mono) !important;font-size:12.5px;outline:none;width:100%;transition:background 120ms ease,border-color 120ms ease,box-shadow 120ms ease}
.field-input:hover:not(:focus):not(:disabled){background:rgba(255,255,255,0.025) !important;border-color:rgba(255,255,255,0.10) !important}
.field-input:focus{background:rgba(255,255,255,0.05) !important;border-color:rgba(255,255,255,0.28) !important;box-shadow:0 0 0 2px rgba(255,255,255,0.06) !important}
/* Body reads as the lighter "tbody" surface — inherits --imp-surface-3
   from the outer .draft-row (no extra dark overlay). The header border
   above carries the visual separator. */
/* Horizontal padding bumped 0.75rem → 1.25rem (12px → 20px) so the
   field rows breathe inside the card frame, reading as padded card
   content rather than flush-edge table cells. Vertical padding kept
   compact so the card stays tight top-to-bottom. */
.draft-body{padding:0.5rem 1.25rem 0.75rem 1.25rem}
/* Stage 8+ 规则 1: 字段行默认无底线(组内行间无视觉分隔);
   分组通过 .field-group 的 border-bottom 控制(组间的分隔线更明显) */
.field-row{display:grid;grid-template-columns:80px 1fr auto 10px;gap:0.5rem;align-items:center;padding:0.375rem 0.25rem;font-family:var(--font-mono);font-size:12.5px}
/* F-4: sensitive field 的 input + reveal 按钮外层包装(相对定位 + 右内边距
   让 Eye 按钮 absolute 浮在 input 右侧内部,不占 .field-row 的 grid 列)。 */
.field-input-wrap{position:relative;width:100%;min-width:0}
.field-input-has-reveal{padding-right:28px !important}
.field-reveal-btn{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:transparent;border:none;cursor:pointer;padding:4px;color:var(--muted-foreground);display:inline-flex;align-items:center;justify-content:center;border-radius:3px}
.field-reveal-btn:hover{color:var(--foreground);background:rgba(255,255,255,0.04)}
/* 2026-04-25 — label column right-aligned so every colon lines up at
   the same x-coordinate, giving values a uniform left-aligned start.
   Colon suffix applied via ::after so JSX call sites stay clean. */
.field-label{color:var(--imp-text-dim);font-size:10px;text-transform:uppercase;letter-spacing: 0.05em;font-weight:600;text-align:right;justify-self:end}
.field-label::after{content:" :";opacity:0.6}
/* Field groups — no dividers, no extra spacing. Every field-row has
   the same vertical rhythm regardless of group boundary (2026-04-25:
   divider lines removed AND the group gap flattened so users read one
   continuous property list, not three bundles). */
.field-group{padding:0;margin:0}
/* 规则 4: 非当前 effectiveType 的字段整行灰掉,input 禁止交互 */
.field-row-disabled{opacity:0.4}
/* disabled:bg 比 idle 略暗一档(rgba 黑色叠加)区别于活跃输入框 */
.field-row-disabled .field-input{background:rgba(0,0,0,0.10) !important;cursor:not-allowed;color:var(--imp-text-dim) !important;border-color:rgba(255,255,255,0.04) !important}
.field-row-disabled .field-input:focus{background:rgba(0,0,0,0.10) !important;border-color:rgba(255,255,255,0.04) !important;box-shadow:none !important}
/* v4.1 Stage 5+: Provider multi-select row (替换 Provider FieldRow) */
.field-row-multi{align-items:start}
.field-row-multi .field-label{padding-top:6px}
/* Provider row's ProviderMultiSelect container has no left padding of
   its own, while sibling rows (input-based) get 9px of visual offset
   from the input's 1px border + 0.5rem padding. Shift the chips area
   right to match so the chip's first character aligns with the plain
   input text column below (KIMI ↔ kimi11 ↔ sk-... ↔ https://...). */
.field-row-multi .provider-ms{padding-left:9px}
.protocol-multiselect{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-height:28px;position:relative}
.protocol-chip{display:inline-flex;align-items:center;gap:4px;background:rgba(250, 204, 21,0.08);border:1px solid rgba(250, 204, 21,0.3);border-radius:3px;padding:2px 4px 2px 8px;font-family:var(--font-mono);font-size:11px;color:var(--primary);text-transform:uppercase;letter-spacing: 0.05em;font-weight:700}
.protocol-chip-x{background:transparent;border:none;color:var(--primary);cursor:pointer;padding:0 3px;font-size:14px;line-height:1;opacity:0.7;font-family:inherit}
.protocol-chip-x:hover{opacity:1;color:#f87171}
.protocol-add-btn{background:transparent;border:1px dashed var(--imp-line-strong);border-radius:3px;color:var(--imp-text-dim);font-family:var(--font-mono);font-size:10.5px;padding:3px 10px;cursor:pointer;letter-spacing: 0.05em}
.protocol-add-btn:hover{color:var(--foreground);border-color:var(--primary);border-style:solid}
.protocol-add-box{position:relative;display:flex;flex-direction:column;flex:1;min-width:180px}
.protocol-search{background:rgba(0,0,0,0.4);border:1px solid var(--primary);border-radius:3px;padding:0.25rem 0.5rem;color:var(--foreground);font-family:var(--font-mono);font-size:12px;outline:none;width:100%}
.protocol-dropdown{position:absolute;top:100%;left:0;right:0;margin-top:2px;background:var(--imp-surface-2);border:1px solid var(--imp-line-strong);border-radius:3px;box-shadow:0 4px 12px rgba(0,0,0,0.5);max-height:240px;overflow-y:auto;z-index:100}
.protocol-option{display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--foreground);font-family:var(--font-mono);font-size:12px;padding:0.375rem 0.625rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.03)}
.protocol-option:hover{background:rgba(250, 204, 21,0.08);color:var(--primary)}
.protocol-option:last-child{border-bottom:none}
.protocol-option-custom{color:#86efac;font-style:italic}
.protocol-option-custom:hover{background:rgba(134,239,172,0.1);color:#86efac}
.protocol-dropdown-empty{padding:0.5rem 0.625rem;color:var(--imp-text-dim);font-family:var(--font-mono);font-size:12px;font-style:italic}
/* v4.1 Stage 5+: base_url 行 + "use official" 按钮 */
.field-row-baseurl .baseurl-input-wrap{display:flex;align-items:center;gap:6px;width:100%}
.field-row-baseurl .baseurl-input-wrap .field-input{flex:1;min-width:0}
/* 2026-04-23 第十三轮:USE OFFICIAL 按钮弱化,跟卡片内其他可交互元素同风格。
   idle: transparent + 低 α 浅金边 + 暗金文字(融入卡片);
   hover: 淡金 bg + 稍明显边 + 文字恢复原金色(明确"正在被指向"),与 field-input hover 视觉档位一致。 */
.baseurl-official-btn{flex-shrink:0;background:transparent;border:1px solid rgba(250, 204, 21,0.18);border-radius:3px;color:rgba(202,165,17,0.75);font-family:var(--font-mono);font-size:10.5px;padding:3px 8px;cursor:pointer;letter-spacing: 0.05em;text-transform:uppercase;white-space:nowrap;transition:all 120ms ease}
.baseurl-official-btn:hover:not(.is-disabled){background:rgba(250, 204, 21,0.05);border-color:rgba(250, 204, 21,0.32);color:var(--primary)}
.baseurl-official-btn.is-disabled{border-color:var(--imp-line-strong);color:var(--imp-text-dim);opacity:0.5;cursor:not-allowed}
/* v4.1 Stage 9+: Pending OAuth handoffs (Done page) */
/* v4.1 Stage 10+: Done page — 按 design_iterations/user_bulk_import_done_3.html 模板 */

/* Stat strip */
.done-summary .done-stat-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:1.25rem}
.done-stat{background:var(--imp-surface-2);border:1px solid var(--imp-line);border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px}
.done-stat-ico{font-family:var(--font-mono);font-size:14px;font-weight:700;width:16px;text-align:center}
.done-stat-ico-ok{color:#4ade80}
.done-stat-ico-sky{color:#60a5fa}
.done-stat-ico-red{color:#f87171}
.done-stat-ico-dim{color:var(--imp-text-dim)}
.done-stat-lbl{font-family:var(--font-mono);font-size:10.5px;font-weight:600;letter-spacing: 0.05em;text-transform:uppercase;color:var(--imp-text-dim)}
.done-stat-val{font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--foreground);margin-left:auto;line-height:1}

/* Section titles */
.done-section-title{display:flex;align-items:center;gap:8px;margin:1rem 0 0.5rem;font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing: 0.05em;text-transform:uppercase}
.done-section-meta{margin-left:auto;color:var(--imp-text-dim);font-weight:500;letter-spacing:0.04em;text-transform:none}

/* Row list (imported / failed / skipped) */
.done-cards{display:flex;flex-direction:column;gap:10px;margin-bottom:0.75rem}
.done-rows{display:flex;flex-direction:column;gap:6px;margin-bottom:0.75rem}
.done-row{background:var(--imp-surface-3);border:1px solid var(--imp-line-strong);border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:12px}
.done-row-imported{border-color:rgba(16,185,129,0.22);background:linear-gradient(90deg,rgba(16,185,129,0.04) 0%,var(--imp-surface-3) 40%)}
.done-row-failed{border-color:rgba(248,113,113,0.3);background:rgba(248,113,113,0.04)}
.done-row-idx{color:var(--imp-text-dim);width:26px;font-size:12px}
.done-row-preview{flex:1;color:var(--foreground);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.done-row-alias{color:var(--foreground);font-weight:600}
.done-row-alias-mono{color:var(--imp-text-dim);font-size:12px;margin-left:auto}
.done-row-err-code{color:#fca5a5;font-size:11.5px;font-weight:700;letter-spacing: 0.05em}
.done-row-err-msg{font-family:var(--font-sans);color:var(--imp-text-dim);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Chip variants used on Done rows */
.chip-failed{color:#fca5a5;background:rgba(248,113,113,0.08);border-color:rgba(248,113,113,0.3)}
.chip-imported{color:#6ee7b7;background:rgba(16,185,129,0.08);border-color:rgba(16,185,129,0.3)}
.chip-skipped{color:var(--imp-text-dim);background:rgba(255,255,255,0.03)}

/* OAuth notice banner */
.oauth-notice{margin:0 0 0.75rem;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;background:rgba(96,165,250,0.06);border:1px solid rgba(96,165,250,0.25);border-left:3px solid #60a5fa;border-radius:6px}
.oauth-notice-ico{color:#60a5fa;font-size:16px;line-height:1.3;flex-shrink:0}
.oauth-notice-body{flex:1}
.oauth-notice-title{font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing: 0.05em;text-transform:uppercase;color:#93c5fd;margin-bottom:4px}
.oauth-notice-desc{font-family:var(--font-sans);font-size:12.5px;line-height:1.55;color:var(--foreground)}
.oauth-notice-desc strong{color:#93c5fd}

/* OAuth handoff card (带 step 序号 + Open login page 按钮) */
.oauth-card{background:var(--imp-surface-3);border:1px solid rgba(96,165,250,0.25);border-radius:8px;overflow:hidden;position:relative;padding:0}
.oauth-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#60a5fa;box-shadow:0 0 8px rgba(96,165,250,0.35)}
.oauth-card.is-unsupported{border-color:var(--imp-line-strong);opacity:0.75}
.oauth-card.is-unsupported::before{background:var(--imp-line-strong);box-shadow:none}
.oauth-card-head{padding:12px 14px 10px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--imp-line);flex-wrap:wrap}
.oauth-step{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(96,165,250,0.12);border:1px solid rgba(96,165,250,0.4);color:#60a5fa;font-family:var(--font-mono);font-size:11px;font-weight:700;flex-shrink:0}
.oauth-card-title{font-family:var(--font-mono);font-size:13px;font-weight:700;letter-spacing: 0.05em;color:var(--foreground)}
.oauth-card-title-dim{color:var(--imp-text-dim);font-weight:500;letter-spacing:0.04em}
.oauth-meta-grid{padding:10px 14px 10px;display:grid;grid-template-columns:80px 1fr;gap:4px 14px;font-family:var(--font-mono);font-size:12px}
.oauth-meta-k{color:var(--imp-text-dim);letter-spacing: 0.05em;text-transform:uppercase;font-size:10.5px;align-self:center}
.oauth-meta-v{color:var(--foreground)}
.oauth-meta-v-ok{color:#6ee7b7}
.oauth-cli{margin:0 14px 10px;background:rgba(0,0,0,0.4);border:1px solid var(--imp-line);border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:10px;font-family:var(--font-mono);font-size:12.5px}
.oauth-cli-cmd{flex:1;color:#86efac;user-select:all;white-space:nowrap;overflow-x:auto}
.oauth-cli-prompt{color:var(--imp-text-dim);user-select:none;margin-right:4px}
.oauth-cli-copy{flex-shrink:0;background:transparent;border:1px solid var(--imp-line-strong);color:var(--imp-text-dim);padding:4px 10px;border-radius:4px;font-family:var(--font-mono);font-size:10px;letter-spacing: 0.05em;text-transform:uppercase;font-weight:600;cursor:pointer}
.oauth-cli-copy:hover{color:var(--foreground);border-color:var(--imp-text-dim)}
.oauth-actions{padding:0 14px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.oauth-actions-note{font-family:var(--font-sans);font-size:11.5px;color:var(--imp-text-dim);letter-spacing:0.02em;flex:1;min-width:200px}
.oauth-actions-btns{display:flex;gap:8px;flex-shrink:0}
.btn-open-login{background:#60a5fa;color:#0c1e3a;border:1px solid rgba(96,165,250,0.7);border-radius:4px;padding:6px 12px;font-family:var(--font-mono);font-size:10.5px;font-weight:700;letter-spacing: 0.05em;text-transform:uppercase;cursor:pointer;box-shadow:0 0 0 1px rgba(96,165,250,0.15),0 6px 20px -10px rgba(96,165,250,0.6);transition:all 180ms ease}
.btn-open-login:hover{background:#93c5fd;transform:translateY(-1px)}
/* Stage 8+ 规则 2: revert 用中性灰(区分 use official 的 primary gold,但不抢视觉) */
.baseurl-official-btn.is-revert{border-color:var(--imp-line-strong);color:var(--imp-text-dim)}
.baseurl-official-btn.is-revert:hover:not(.is-disabled){background:rgba(255,255,255,0.04);color:var(--foreground);box-shadow:none}

/* ── Confidence bar ───────────────────────────────────────────── */
/* 2026-04-23: 进度条颜色与百分比一同弱化,跟卡片整体视觉强度对齐 */
.conf-bar{width:64px;height:3px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;overflow:hidden;flex-shrink:0}
.conf-bar>span{display:block;height:100%;background:rgba(250, 204, 21,0.45)}

/* ── Provider suggest bar ─────────────────────────────────────── */
/* v3 uses gold tint to match the "apply as provider" CTA's primary-colour
   action. Old palette was indigo; keeping the .suggest-bar / .apply-btn
   selectors but swapping tokens. */
.suggest-bar{background:rgba(250, 204, 21,0.04);border-bottom:1px solid var(--imp-line)}
/* Stage 14+: suggest 横幅左侧关闭按钮(小圆 × 按钮,dismiss 当前 provider 建议) */
.suggest-close{width:20px;height:20px;border-radius:50%;border:1px solid rgba(250, 204, 21,0.3);background:transparent;color:var(--primary);font-family:var(--font-mono);font-size:14px;line-height:1;cursor:pointer;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;padding:0;margin-right:4px;transition:all 120ms ease}
.suggest-close:hover{background:rgba(250, 204, 21,0.12);border-color:var(--primary);color:#fde047}
/* Darker yellow (#ca8a04 = amber-600) than the bright --primary
   (#facc15) — these two bulk-action buttons (Apply-to-all + the big
   Import commit) carry heavier consequences than modal Save / Unlock,
   so we quiet them to the "in-use / chart accent" dark-yellow family
   already in use across the app. */
.apply-btn{font-family:var(--font-mono);font-size:10.5px;font-weight:700;letter-spacing: 0.05em;text-transform:uppercase;padding:6px 10px;border-radius:4px;background:#ca8a04;color:#0b0b0b;border:1px solid rgba(202,138,4,0.7);box-shadow:0 0 0 1px rgba(202,138,4,0.18);cursor:pointer}
.apply-btn:hover{background:#eab308;transform:translateY(-1px)}

/* .btn-primary-dim is now defined globally in src/index.css 2026-04-25
   so vault, import, and any other page can stack it on .btn-primary
   to switch to the dark-yellow family. Local override removed. */

/* ── Stat cards (done state) ──────────────────────────────────── */
.stat-card{background:var(--imp-surface-2);border:1px solid var(--imp-line);border-radius:8px;padding:1rem 1.25rem}

/* ── Endpoint group dashed divider ────────────────────────────── */
.endpoint-group{margin-bottom:0.5rem}

/* ── Confirm modal (Stage 13+: Clear / Re-PARSE) ──────────────── */
.confirm-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:1000;animation:confirm-fade-in 120ms ease-out}
.confirm-modal{background:var(--imp-surface-2);border:1px solid var(--imp-line-strong);border-radius:8px;padding:24px 28px;min-width:420px;max-width:520px;box-shadow:0 20px 60px -20px rgba(0,0,0,0.7);animation:confirm-pop-in 140ms ease-out}
.confirm-modal-title{font-family:var(--font-mono);font-size:15px;font-weight:700;letter-spacing:0.02em;color:var(--foreground);margin-bottom:8px}
.confirm-modal-desc{font-family:var(--font-sans);font-size:12.5px;line-height:1.6;color:var(--foreground);margin-bottom:18px}
.confirm-modal-btns{display:flex;justify-content:flex-end;gap:8px}
@keyframes confirm-fade-in{from{opacity:0}to{opacity:1}}
@keyframes confirm-pop-in{from{opacity:0;transform:translateY(-6px) scale(0.98)}to{opacity:1;transform:none}}
/* Danger variant for destructive confirms (Clear) */
.btn-danger{background:#dc2626;color:#fff;border:1px solid rgba(220,38,38,0.7);border-radius:6px;cursor:pointer;font-family:var(--font-mono);font-weight:700;letter-spacing: 0.05em;text-transform:uppercase}
.btn-danger:hover{background:#ef4444}
`;

// Example strings obfuscated 2026-04-22: originals looked like real
// emails / passwords / keys, which risked leaking user data whenever
// anyone screenshotted the empty Import page. All values below were
// regenerated with matching length and character class (lowercase
// letters, mixed case, digits, hex) so the parser still demonstrates
// the same heuristics (email detection, separator splitting, hex key
// shape) without exposing credential-looking strings.
const SAMPLE_PLACEHOLDER = `Paste your credentials here — any format, any separator…

Example:

claude2: SF (pro-04/15)
xaimqvupceobnl@zerqmail.com
----khVp3b9tRxM----c742b31f9a5e064a1b837f62cd91de40

claude3: K (pro-03/30)
邮箱: xUJpzcrlvpeonqcab@cordel.com
密码: k2p5QW7fVZHdC1
apikey = 8261d47e209458264913571842067483950

OpenAI: sk-proj-Kp3mQ8rTn7...
base_url: https://my-gateway.company.com/v1`;

const SAMPLE_TEXT = `claude2: SF (pro-04/15)
user@example.com
----hunter2----sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

OpenAI: sk-proj-ABCDEF1234567890abcdefGHIJklmn
base_url: https://my-gateway.company.com/v1
`;
