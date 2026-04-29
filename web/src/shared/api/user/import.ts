/**
 * User – Quick Import endpoints (renamed from "Bulk Import" 2026-04-22).
 *
 * These all go through the Go local-server importpkg handler which spawns
 * the Rust aikey CLI for every vault-touching call. See
 * aikey-control/service/internal/api/user/importpkg for the full map.
 *
 *   POST /api/user/vault/unlock       -> derive Argon2id -> mint session cookie
 *   POST /api/user/vault/lock         -> drop session
 *   GET  /api/user/vault/status       -> probe (no auth)
 *
 *   POST /api/user/import/parse       -> parse raw text into drafts
 *   POST /api/user/import/confirm     -> batch_import drafts (requires unlock)
 *   GET  /api/user/import/rules       -> static layer versions + known providers
 */
import axios from 'axios';

import { httpClient } from '../http-client';
import type { HookFailureReason } from './vault';

// ── Unlock-specific error mapping ────────────────────────────────────────
//
// Backend returns HTTP 401 with body
//   { status: "error", error_code: "I_VAULT_UNLOCK_FAILED", error_message: "..." }
// on a wrong master password. axios' default error.message on 401 is the
// unfriendly "Request failed with status code 401" — we surface the
// envelope's error_message instead, and upgrade known codes to a friendlier
// UI string. Fallback order: mapped hint → envelope message → axios default.
const UNLOCK_ERROR_HINTS: Record<string, string> = {
  I_VAULT_UNLOCK_FAILED: 'Master password incorrect. Please check and try again.',
  I_VAULT_KEY_INVALID:   'Master password incorrect. Please check and try again.',
  I_VAULT_NOT_INITIALIZED: 'No vault on this host yet. Run `aikey add <alias>` once in the CLI to create one.',
  I_CLI_NOT_FOUND:       'aikey CLI not found on this host — Import cannot reach the vault.',
  I_CLI_TIMEOUT:         'Vault unlock timed out. Retry, or check ~/.aikey/logs/control-*.log.',
};

interface BackendErrEnvelope {
  status?: string;
  error_code?: string;
  error_message?: string;
}

/** Re-throw a vault-unlock axios failure as an Error whose .message is UI-safe. */
function throwFriendlyUnlockError(err: unknown): never {
  if (axios.isAxiosError(err) && err.response?.data) {
    const body = err.response.data as BackendErrEnvelope;
    if (body.status === 'error' && body.error_code) {
      const hint = UNLOCK_ERROR_HINTS[body.error_code];
      const msg = hint ?? body.error_message ?? `Unlock failed (${body.error_code})`;
      const e = new Error(msg) as Error & { code?: string };
      e.code = body.error_code;
      throw e;
    }
  }
  throw err;
}

// ── Vault session ────────────────────────────────────────────────────────

export interface VaultStatus {
  unlocked: boolean;
  ttl_seconds?: number;
}

export interface UnlockRequest {
  password: string;
}

export interface UnlockResponse {
  status: 'ok' | 'error';
  unlocked?: boolean;
  ttl_seconds?: number;
  error_code?: string;
  error_message?: string;
}

// ── Parse ────────────────────────────────────────────────────────────────

export interface ParseRequest {
  text: string;
  source_type?: 'paste' | 'file';
  batch_provider_hint?: string;
  max_candidates?: number;
}

export interface ProviderGuess {
  id: string;
  display: string;
  tier: 'confirmed' | 'ambiguous' | 'warn';
}

export interface Candidate {
  id: string;
  kind: 'email' | 'password_like' | 'secret_like' | 'url' | 'base_url' | 'label' | 'unknown';
  value: string;
  tier: 'confirmed' | 'suggested' | 'warn' | 'unknown';
  provider?: ProviderGuess;
  source_span?: [number, number];
}

// ── v4.1 Stage 3 Phase D: DraftRecord (L2 grouper 输出) ──────────────────

export type DraftType = 'KEY' | 'OAUTH';

export type GroupReason =
  | 'single_line_complex'
  | 'title_block'
  | 'credential_block'
  | 'standalone'
  | 'multi_password_expand';

/**
 * v4.1 Stage 3: Draft 的字段集合 (L2 grouper 产出)。
 *
 * 与 aikey-cli `parse/grouping/types.rs::DraftFields` 严格对齐:
 * 空字段 serde 会 skip,TypeScript 用 `?` / `undefined` 表示。
 */
export interface DraftFields {
  email?: string;
  password?: string;
  api_key?: string;
  base_url?: string;
  /** Stage 2/3 多 secret 时,首 secret 进 api_key,剩余进此列表 */
  extra_secrets: string[];
  /**
   * v4.2 Layer 5: 用户手写的 Draft 卡片标题 (block 首行的"自然语言短文本"),
   * 如 "Kimitest8" / "工作号"。UI 卡片预览优先显示 title,回落到原有的 email /
   * 掩码 secret。由 rule_title::extract 抽取,grouper 按 line_range 回挂。
   */
  title?: string;
}

/** Provider 推断证据 (L3 endpoint cluster 填;Stage 3 Phase C 前为空 []) */
export interface InferenceSource {
  source:
    | 'fingerprint_confirmed'
    | 'fingerprint_likely'
    | 'inline_title_keyword'
    | 'section_heading_keyword'
    | 'shell_var_pattern'
    | 'url_host_pattern';
  [k: string]: unknown;
}

/**
 * v4.1 Stage 3 L2 grouper 输出 —— Web UI "Draft 卡片" 一对一映射。
 *
 * 与 aikey-cli `parse/grouping/types.rs::DraftRecord` 严格对齐。
 * `line_range` 是闭区间 `[start, end]`,UI 可用作 "jump to source"。
 */
export interface DraftRecord {
  id: string;
  /**
   * v4.1 Stage 6+: Backend-suggested alias (vault 写入时的 key 名).
   *
   * Parse handler 基于 inferred_provider (fallback provider_hint) 生成,
   * 并与 vault 现有 aliases + 本 batch 其他 draft 做 dedupe(`-2`/`-3` 后缀)。
   * UI 合约:用户可在卡片里编辑此字段覆盖;runImport 发送 `ConfirmItem.alias = record.alias`。
   */
  alias: string;
  draft_type: DraftType;
  reason: GroupReason;
  line_range: [number, number];
  fields: DraftFields;
  provider_hint?: string;
  inferred_provider?: string;
  /** Provider 推断置信度 [0, 2.5],Stage 4 前保持 0 */
  inference_confidence: number;
  inference_evidence: InferenceSource[];
  /**
   * v4.1 Stage 5+: 严格协议类型列表 (从 inferred_provider 派生)。
   *
   * - 官方厂商指纹命中               → `[family]` (单元素,如 `["anthropic"]`)
   * - 聚合网关命中 (openrouter等)    → `[]` (UI multi-select 让用户手选)
   * - 推断不到 / enrich 未运行       → `[]`
   *
   * UI 合约:UI 用此值作为 Provider multi-select 的"默认选中协议"。
   * 与 aikey-cli `parse/grouping/types.rs::DraftRecord.protocol_types` 严格对齐。
   */
  protocol_types: string[];
  /**
   * v4.1 Stage 10+: 推断出的 provider 对应的官方登录/API Key 页面 URL。
   *
   * CLI 从 fingerprint YAML `family_login_urls` 查 `inferred_provider` 得到;
   * UI "Open login page" 按钮用 `window.open(login_url)` 跳登录页,用户在
   * 浏览器完成 OAuth 或申请 API Key。
   *
   * undefined = 未推断出 provider 或 YAML 未配置该 family 的 URL。
   */
  login_url?: string;
  /**
   * v4.2: 推断出的 provider 对应的官方 API base_url。
   *
   * CLI 从 fingerprint YAML `family_base_urls` 查 `inferred_provider` 得到;
   * UI "use official" 按钮点击时把此值填入 `fields.base_url`。
   *
   * undefined = 未推断出 provider 或 YAML 未配置该 family 的 base_url。
   * (以前这张映射硬编码在前端 PROVIDER_DEFAULT_BASE_URL Record,现挪 YAML)
   */
  official_base_url?: string;
}

// ── v4.1 Stage 4: EndpointGroup (L3 cluster) ────────────────────────────

export type ClusterReason =
  | 'explicit'              // draft 自带 base_url
  | 'same_block_labeled'    // 同 block 有 URL 行且 `base_url:` 标签
  | 'same_block'            // 同 block 有 URL 行 (无标签)
  | 'inherited_sticky'      // 跨 block 继承 URL (sticky 评分 ≥ 阈值)
  | 'default';              // 未推断 (base_url=null)

/**
 * v4.1 Stage 4 L3 endpoint cluster 输出 —— 同 provider+base_url 的 Drafts 聚成一组。
 *
 * UI 可按 group 分层展示:每个 group header 显示 provider + base_url,下挂 member drafts。
 * 与 aikey-cli `parse/grouping/types.rs::EndpointGroup` 严格对齐。
 */
export interface EndpointGroup {
  id: string;                         // "g-1" / "g-2" ...
  provider?: string;                  // "anthropic" / "openai" / "kimi" / "unknown" (与 CLI provider type 字典对齐)
  base_url?: string;                  // 规范化后的 URL (去 query/fragment/尾斜杠)
  member_draft_ids: string[];         // 指回 DraftRecord.id
  confidence: number;                 // 所有 member 的最低 sticky 分数 (最弱链)
  reason: ClusterReason;
}

export interface ParseResponse {
  candidates: Candidate[];
  /** v4.1 Stage 3 Phase D: L2 grouper 产出 Draft 列表,UI 按此渲染卡片 */
  drafts?: DraftRecord[];
  /** v4.1 Stage 4: L3 endpoint cluster 聚合,UI 可按 group 分层渲染 */
  groups?: EndpointGroup[];
  orphans?: Array<{ value: string; source_span?: [number, number] } | string>;
  /** v4.1 新增:orphan candidates 的 kind+value 结构(老 UI 可忽略) */
  orphan_candidates?: Array<{ id: string; kind: string; value: string }>;
  layer_versions: { rules: string; crf: string; fingerprint: string; grouper?: string };
  parse_duration_ms?: number;
  source_hash?: string;
}

// ── Confirm (batch import) ───────────────────────────────────────────────

export interface ConfirmItem {
  alias: string;
  secret_plaintext: string;
  /**
   * Single-protocol shorthand (backward compat).
   *
   * If `providers` is given, it wins over `provider`. Backend CLI
   * (`BatchImportItem`) stores `supported_providers` = `providers`,
   * `provider_code` = `providers[0]`.
   */
  provider?: string;
  /**
   * v4.1 Stage 5+: Multi-protocol binding for one KEY (UI multi-select source).
   *
   * Populated from `DraftRecord.protocol_types` (auto-filled by fingerprint
   * for official vendors; empty for aggregator gateways — user selects
   * manually via ProviderMultiSelect).
   *
   * Backend writes each item to `entries.supported_providers` JSON array;
   * `provider_code` routing-default = `providers[0]`.
   */
  providers?: string[];
  /**
   * v4.1 Stage 7+: Per-entry base URL override.
   *
   * Sources (UI fallback chain):
   *   1. User explicit `DraftRecord.fields.base_url` (parsed or typed)
   *   2. Fall back to `defaultBaseUrl(inferred_provider)` for official vendors
   *   3. Leave undefined → backend stores NULL (proxy uses provider default)
   *
   * Backend writes via `storage::set_entry_base_url(alias, Some(url))`.
   */
  base_url?: string;
}

export interface ConfirmRequest {
  items: ConfirmItem[];
  on_conflict?: 'error' | 'skip' | 'replace';
  job_id?: string;
  source_type?: 'paste' | 'file';
  source_hash?: string;
}

/**
 * Backend shape (from Rust `handle_batch_import` result envelope):
 *   { total, inserted, replaced, skipped, items[], audit_logged, audit_failures, job_id }
 *
 * `inserted` = new aliases written; `replaced` = existing aliases overwritten
 * (on_conflict="replace"); `skipped` = existing aliases left alone
 * (on_conflict="skip"); `failed` are not returned by batch_import itself —
 * the handler fails fast on conflict with `on_conflict="error"`, or returns
 * a top-level error envelope on any vault error.
 *
 * UI-facing "imported" total = inserted + replaced (skipped and unchanged
 * don't count as imports).
 */
export interface ConfirmResponse {
  total: number;
  inserted: number;
  replaced: number;
  skipped: number;
  items?: Array<{ alias: string; action: 'inserted' | 'replaced' | 'skipped' }>;
  audit_logged?: boolean;
  audit_failures?: number;
  job_id?: string | null;
  /** Populated only if the handler tracks per-item failures (reserved; not emitted today). */
  failed?: Array<{ alias: string; error_code: string; error_message: string }>;
  // Hook readiness envelope — same contract as vault-op {use,add,delete}.
  // The Rust handle_batch_import path runs ensure_shell_hook → merge_hook_status,
  // so a successful import is a real "vault was just mutated" event and should
  // feed useHookReadinessStore alongside the other mutating Web flows.
  hook_file_installed?: boolean;
  hook_rc_wired?: boolean;
  hook_failure_reason?: HookFailureReason | null;
}

// 2026-04-23: removed `ImportJob` type + `importApi.history()` stub together
// with the un-shipped import_jobs / import_items tables (collapsed out of
// v1.0.4-alpha CLI migration). No UI ever consumed this API.

// ── Rules (static) ───────────────────────────────────────────────────────

export interface RulesResponse {
  layer_versions: { rules: string; crf: string; fingerprint: string };
  sample_providers: string[];
  /**
   * v4.2+: family id → official API base_url map (mirrors
   * aikey-cli/data/provider_fingerprint.yaml `family_base_urls`).
   *
   * The per-draft `DraftRecord.official_base_url` only carries the URL
   * for that draft's `inferred_provider`. The Import page's "Use Official"
   * auto-fill rules need the same map keyed by an arbitrary protocol id
   * (e.g. when the user toggles `protocol_types` after parse, or when a
   * pasted base_url's host matches a different family than the inferred one).
   * Backend serves this from RulesHandler so the YAML stays the single
   * source of truth.
   */
  family_base_urls?: Record<string, string>;
  /**
   * v4.2+: family id → official login / API-key management page URL
   * (mirrors aikey-cli/data/provider_fingerprint.yaml `family_login_urls`).
   *
   * Harvested for hosts only — the path is irrelevant. Covers the
   * browser-facing domains (e.g. `aistudio.google.com`,
   * `dashscope.console.aliyun.com`, `chatgpt.com`) that aren't in
   * `family_base_urls` but are commonly pasted by users. Including this
   * in the host index means the alias table on the frontend stays small
   * and YAML remains the single source of truth.
   */
  family_login_urls?: Record<string, string>;
}

// ── Envelope helpers ─────────────────────────────────────────────────────

interface OkEnvelope<T> {
  status: 'ok';
  data: T;
  request_id?: string;
}

interface ErrEnvelope {
  status: 'error';
  error_code: string;
  error_message: string;
}

function unwrap<T>(env: OkEnvelope<T> | ErrEnvelope): T {
  if (env.status !== 'ok') {
    const err = env as ErrEnvelope;
    const e = new Error(err.error_message) as Error & { code?: string };
    e.code = err.error_code;
    throw e;
  }
  return env.data;
}

// ── API client ───────────────────────────────────────────────────────────

export const importApi = {
  vaultStatus: async (): Promise<VaultStatus> => {
    const res = await httpClient.get<OkEnvelope<VaultStatus> & VaultStatus>('/api/user/vault/status');
    // StatusHandler returns {status, unlocked, ttl_seconds} directly (not wrapped).
    return { unlocked: Boolean(res.data.unlocked), ttl_seconds: res.data.ttl_seconds };
  },

  vaultUnlock: async (req: UnlockRequest): Promise<UnlockResponse> => {
    try {
      const res = await httpClient.post<UnlockResponse>('/api/user/vault/unlock', req);
      return res.data;
    } catch (err) {
      // Why throwFriendlyUnlockError exists: 401 body is a structured envelope
      // {status: "error", error_code: "I_VAULT_UNLOCK_FAILED", error_message}
      // that never reaches axios' default .message. We rewrite the Error so
      // the page's onError: (e) => setUnlockError(e.message) shows
      // "Master password incorrect…" instead of "Request failed with status
      // code 401".
      throwFriendlyUnlockError(err);
    }
  },

  vaultLock: async (): Promise<void> => {
    await httpClient.post('/api/user/vault/lock');
  },

  // F-6 P0 review fix (2026-04-23): optional AbortSignal opts enable the
  // page layer to cancel the in-flight request when the user fires a new
  // parse/confirm before the previous one settled (rapid Re-parse click on
  // slow network → stale response overwriting fresh one). Both mutations
  // pass the signal through to axios.
  parse: async (req: ParseRequest, opts?: { signal?: AbortSignal }): Promise<ParseResponse> => {
    const res = await httpClient.post<OkEnvelope<ParseResponse> | ErrEnvelope>(
      '/api/user/import/parse', req, { signal: opts?.signal },
    );
    return unwrap(res.data);
  },

  confirm: async (req: ConfirmRequest, opts?: { signal?: AbortSignal }): Promise<ConfirmResponse> => {
    const res = await httpClient.post<OkEnvelope<ConfirmResponse> | ErrEnvelope>(
      '/api/user/import/confirm', req, { signal: opts?.signal },
    );
    return unwrap(res.data);
  },

  // 2026-04-23: removed `history()` together with the backend route +
  // import_jobs / import_items tables. See type declaration comment above.

  rules: async (): Promise<RulesResponse> => {
    const res = await httpClient.get<OkEnvelope<RulesResponse> | ErrEnvelope>('/api/user/import/rules');
    return unwrap(res.data);
  },
};
