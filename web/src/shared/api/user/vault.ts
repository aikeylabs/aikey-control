/**
 * User Vault CRUD endpoints (2026-04-23).
 *
 * These go through the Go local-server importpkg handler which spawns the
 * Rust aikey CLI for every vault-touching call. See
 * aikey-control/service/internal/api/user/importpkg/vault_crud.go for the
 * server-side map.
 *
 *   GET    /api/user/vault/list          -> merged personal + oauth records
 *   PATCH  /api/user/vault/entry/alias   -> rename (auto-suffix on conflict)
 *   POST   /api/user/vault/entry         -> add personal key (oauth → 403)
 *   DELETE /api/user/vault/entry         -> delete by target + id
 *   POST   /api/user/vault/reveal        -> one-shot plaintext (personal only)
 *
 * Unlock / lock / status endpoints are shared with the Import page and live
 * in ./import.ts — this module does not redefine them.
 */
import { httpClient } from '../http-client';

// ── Unified target ───────────────────────────────────────────────────────
//
// Every record carries a `target` discriminator so the UI picks chips /
// actions without reading credential_type / provider_code. See
// 阶段3-增强版KEY管理/个人vault-Web页面-技术方案.md §2.0 for the rationale.
export type VaultTarget = 'personal' | 'oauth' | 'team';

// ── Record shapes ────────────────────────────────────────────────────────
//
// Personal + OAuth records are flattened into a single `records[]` array at
// /list time. Both shapes share `target`, `id`, `alias`, `provider_code`/
// `provider`, `created_at`, `status`; the rest is target-specific.

export interface PersonalVaultRecord {
  target: 'personal';
  id: string;                       // == alias
  alias: string;
  provider_code: string | null;
  /**
   * Canonical API-protocol family ("anthropic" / "openai" / "kimi" / ...).
   * For personal keys this is provider_code normalized by
   * `oauth_provider_to_canonical` on the CLI side; claude↔anthropic and
   * codex↔openai are not expected for personal keys (they're always the
   * canonical form at write time) but the same normalizer is applied
   * defensively to keep the single source of truth in one place.
   *
   * Used by the vault Web page as the GROUPING key. The raw `provider_code`
   * / `provider` fields remain authoritative for per-row identity display
   * and binding semantics. Falls back to "unknown" for legacy entries
   * with no provider assigned.
   */
  protocol_family: string;
  base_url: string | null;
  /**
   * Provider's recommended default URL, surfaced by the CLI from its
   * canonical `PROVIDER_DEFAULTS` table when the user did not set a
   * custom `base_url` (i.e. `base_url` is null). The web drawer uses
   * it to show the real URL + one-click copy instead of an opaque
   * "provider default" placeholder. Absent on records parsed from
   * older CLI builds that predate this field — treat `undefined` the
   * same as `null` (no known default for this provider).
   */
  official_base_url?: string | null;
  /**
   * Fully-qualified proxy URL that client SDKs should point at when
   * using this record (e.g. `http://127.0.0.1:27200/anthropic`). CLI
   * builds it from the running proxy port + the provider's registered
   * proxy path (`provider_registry.yaml::proxy_path`). Mirrors what
   * `aikey route` prints, so users can copy the same URL from the Web
   * drawer instead of switching to the terminal. Null for provider
   * codes without a proxy routing entry; undefined on older CLI
   * builds that predate this field.
   */
  route_url?: string | null;
  supported_providers: string[];
  created_at: number;               // unix seconds
  status: 'active';                 // entries has no enabled column — always active
  /**
   * Stable public identifier (`aikey_vk_...`) stored alongside the entry.
   * Rendered as a secondary line under the alias ("vk_9f2a…a7e3") so the
   * user can correlate a key with its route token without opening the
   * drawer. May be null on very old vaults that predate v1.0.4.
   */
  route_token: string | null;
  /**
   * Unix seconds of the last recorded usage (bumped by
   * `_internal vault-op record_usage`; proxy integration is future wiring
   * per 2026-04-23 plan). Null until the key has been used. Added v1.0.6.
   */
  last_used_at: number | null;
  /**
   * Monotonic counter of recorded usages. Default 0 on unused keys and
   * on vaults that predate v1.0.6.
   */
  use_count: number;
  /**
   * True when this alias is bound for AT LEAST ONE provider in
   * `user_profile_provider_bindings`. Orthogonal to `status` — a key with
   * `status:'active'` but `in_use:false` is simply "available but not
   * selected". Kept for back-compat with older Web bundles; new code
   * SHOULD prefer `in_use_for` so the in-use badge is rendered only in
   * the group whose provider this alias is actually bound to (regression
   * 2026-04-30: a key bound only to openai showed `in_use=true` under
   * the anthropic group too because the flag was provider-agnostic).
   */
  in_use?: boolean;
  /**
   * Per-provider list: which providers this alias is the active binding
   * for. Empty array = not in use anywhere. The Web UI renders the
   * in-use badge for a record under group `G` ONLY when `G ∈ in_use_for`.
   * That removes the false "two inuse" appearance that flat `in_use`
   * caused for multi-provider keys.
   *
   * Optional for forward-compat with CLI versions that predate the
   * field — fall back to `in_use` (legacy global semantics) when missing.
   */
  in_use_for?: string[];
  /**
   * Secret shape fields. **Null when the response is locked** (the cli
   * path is `list_metadata_locked`, which reads only plaintext metadata
   * and never decrypts). The UI should render a pure-asterisk secret
   * pill whenever `secret_prefix === null`.
   */
  secret_prefix: string | null;     // known prefix (sk-ant-api03- / sk-proj- / AIza ...) or first 4 chars; null when locked
  secret_suffix: string | null;     // last 4 chars; null when locked
  secret_len: number | null;        // total plaintext length; null when locked
}

export interface OAuthVaultRecord {
  target: 'oauth';
  id: string;                       // == provider_account_id
  provider_account_id: string;
  provider: string;                 // e.g. claude / codex / kimi (broker vocabulary)
  /**
   * Canonical API-protocol family. Broker-vocabulary `provider` values
   * (claude / codex) map to their API families (anthropic / openai) via
   * the CLI's `oauth_provider_to_canonical`. See PersonalVaultRecord.
   * protocol_family for the full contract.
   */
  protocol_family: string;
  auth_type: string;
  credential_type: string;
  display_identity: string | null;  // email / username
  alias: string | null;             // mirror of display_identity for uniform UI access
  external_id: string | null;
  org_uuid: string | null;
  account_tier: string | null;
  status: string;                   // active / revoked / expired / error
  created_at: number;
  last_used_at: number | null;
  /**
   * Monotonic counter of recorded usages. Added v1.0.6 alongside the
   * Personal entries' `use_count` column. Default 0 on unused accounts
   * and on vaults that predate v1.0.6.
   */
  use_count: number;
  /**
   * Unix seconds at which the OAuth access_token expires. Sourced from
   * `provider_account_tokens.token_expires_at` via a LEFT JOIN so a
   * missing row (account without tokens yet) surfaces as null rather
   * than omitting the field. Used to render "expires in 27d" sub-lines
   * and the drawer's Meta field. Access/refresh token bytes are never
   * exposed — this timestamp is the only derivative surfaced.
   */
  token_expires_at: number | null;
  /**
   * True when this OAuth account is bound for AT LEAST ONE provider.
   * See PersonalVaultRecord.in_use for the full rationale + history.
   */
  in_use?: boolean;
  /**
   * Per-provider list. See PersonalVaultRecord.in_use_for for semantics.
   */
  in_use_for?: string[];
}

export type VaultRecord = PersonalVaultRecord | OAuthVaultRecord;

// ── List response ────────────────────────────────────────────────────────

export interface VaultListData {
  records: VaultRecord[];
  counts: {
    personal: number;
    oauth: number;
    team: number;
    total: number;
  };
  /**
   * True when the caller had no valid vault session — cli path was
   * `list_metadata_locked`. Personal records in this mode carry
   * `secret_prefix/_suffix/_len = null`. Mutations (rename/delete/add)
   * and reveal will return 401/422 from the HTTP layer while locked.
   */
  locked: boolean;
}

// ── Mutation payloads ────────────────────────────────────────────────────

export interface RenameRequest {
  target: VaultTarget;
  id: string;
  new_value: string;
}

export interface RenameResponse {
  target: VaultTarget;
  id: string;                       // post-rename value (may include auto -2/-3 suffix)
  old_id?: string;
  display_identity?: string;        // for oauth
  action_taken: 'renamed';
  audit_logged?: boolean;
}

export interface DeleteRequest {
  target: VaultTarget;
  id: string;
}

export interface DeleteResponse {
  target: VaultTarget;
  id: string;
  action_taken: 'deleted';
  audit_logged?: boolean;
  // Hook coverage v1: `vault-op delete_target` is in the merge_hook_status
  // set so envelope carries hook fields too. Optional because Go layer
  // older than v1 won't emit them.
  hook_file_installed?: boolean;
  hook_rc_wired?: boolean;
  hook_failure_reason?: HookFailureReason | null;
}

export interface AddRequest {
  target?: 'personal';              // default personal; oauth/team rejected at server
  alias: string;
  secret_plaintext: string;
  provider?: string;
  providers?: string[];
  base_url?: string;
}

export interface AddResponse {
  alias: string;                    // post-conflict auto-suffix reflects final name
  action_taken: 'inserted' | 'replaced';
  provider?: string;
  audit_logged?: boolean;
  // Hook coverage v1: server-side `vault-op add` calls merge_hook_status
  // → envelope carries hook fields. The Web `Add key` modal's onSuccess
  // must feed these into useHookReadinessStore so the banner can show
  // up after a Web-only add (otherwise users on the pure-Web onboarding
  // path never see the prompt to run `aikey hook install`).
  hook_file_installed?: boolean;
  hook_rc_wired?: boolean;
  hook_failure_reason?: HookFailureReason | null;
}

// RevealRequest / RevealResponse and the vaultApi.reveal() client method
// were removed 2026-04-24 (security review round 2). Plaintext credentials
// never travel CLI → Go → browser anymore. The drawer shows a copyable
// `aikey get <alias>` command; users run it in their terminal where the
// plaintext lands in the clipboard (auto-clears after 30s). The absence of
// these types is the contract — do not restore them.

export interface UseRequest {
  // Stage 7-1 (active-state cross-shell sync, 2026-04-27): team accepted.
  // For team, id can be virtual_key_id, local_alias, or server alias —
  // the CLI resolves all three.
  target: 'personal' | 'oauth' | 'team';
  id: string;
}

export interface UseResponse {
  target: 'personal' | 'oauth' | 'team';
  id: string;
  /**
   * The provider codes the new binding now routes. For a personal key this
   * mirrors entries.supported_providers (or falls back to provider_code); for
   * an OAuth account this is always a single-element array.
   */
  activated_providers: string[];
  /**
   * Whether `~/.aikey/active.env` was refreshed after the binding write.
   * False only when the filesystem write failed — the DB binding is already
   * committed either way, so the optimistic UI state is valid.
   */
  active_env_refreshed: boolean;
  audit_logged?: boolean;
  /**
   * Hook coverage v1 fields. Web bridge always renders the hook file
   * (Layer 1) when these handlers run, but never wires the rc file
   * (Layer 2) — that requires a CLI prompt. Front-end uses these to
   * drive the §2.4 banner state machine: when file=true & rc=false,
   * suggest `aikey hook install`; when file=false, the failure_reason
   * tells which sub-case (shell undetectable / io error / disabled).
   */
  hook_file_installed?: boolean;
  hook_rc_wired?: boolean;
  hook_failure_reason?: HookFailureReason | null;
}

/** Hook coverage v1 failure reason codes. Stable contract. */
export type HookFailureReason =
  | 'shell_undetectable'
  | 'home_unset'
  | 'io_error'
  | 'aikey_no_hook';

/** Distilled three-field hook readiness derived from any UseResponse. */
export interface HookReadiness {
  fileInstalled: boolean;
  rcWired: boolean;
  failureReason: HookFailureReason | null;
}

/**
 * Shape any vault response that carries hook coverage v1 fields can
 * conform to. UseResponse / AddResponse / DeleteResponse all extend
 * this; new endpoints that go through `merge_hook_status` should too.
 */
export interface HookFieldsBearing {
  hook_file_installed?: boolean;
  hook_rc_wired?: boolean;
  hook_failure_reason?: HookFailureReason | null;
}

/**
 * Pure helper: pick hook readiness fields from any response that
 * extends HookFieldsBearing. Handlers' onSuccess pass the response in
 * directly; works for vaultApi.use, vaultApi.add, future delete /
 * batch_import callers.
 *
 * Generalised from the original `hookReadinessFromUseResponse` (still
 * exported as a deprecated alias for callers that hadn't migrated yet).
 */
export function pickHookReadiness(res: HookFieldsBearing): HookReadiness {
  return {
    fileInstalled: res.hook_file_installed ?? false,
    rcWired: res.hook_rc_wired ?? false,
    failureReason: res.hook_failure_reason ?? null,
  };
}

/** @deprecated use {@link pickHookReadiness} — kept for back-compat. */
export const hookReadinessFromUseResponse = pickHookReadiness;

// ── Envelope helpers ─────────────────────────────────────────────────────
//
// Identical shape to import.ts but kept local to avoid a cross-module import
// that would pull the whole parse/confirm type surface into the vault page
// bundle.

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

export const vaultApi = {
  list: async (): Promise<VaultListData> => {
    const res = await httpClient.get<OkEnvelope<VaultListData> | ErrEnvelope>('/api/user/vault/list');
    return unwrap(res.data);
  },

  rename: async (req: RenameRequest): Promise<RenameResponse> => {
    const res = await httpClient.patch<OkEnvelope<RenameResponse> | ErrEnvelope>(
      '/api/user/vault/entry/alias',
      req,
    );
    return unwrap(res.data);
  },

  delete: async (req: DeleteRequest): Promise<DeleteResponse> => {
    const res = await httpClient.delete<OkEnvelope<DeleteResponse> | ErrEnvelope>(
      '/api/user/vault/entry',
      { data: req },
    );
    return unwrap(res.data);
  },

  add: async (req: AddRequest): Promise<AddResponse> => {
    const res = await httpClient.post<OkEnvelope<AddResponse> | ErrEnvelope>(
      '/api/user/vault/entry',
      req,
    );
    return unwrap(res.data);
  },

  // vaultApi.reveal() removed 2026-04-24 — see RevealRequest note above.

  /**
   * Promote a key to be the active routing target for its provider(s).
   * Non-interactive analog of the `aikey use <alias>` CLI command. Personal
   * keys with multi-provider `supported_providers` are promoted across ALL
   * listed providers in one call (matches CLI non-interactive semantics).
   *
   * Requires an unlocked vault session. Returns 401 (I_VAULT_LOCKED) when
   * the caller has no session cookie.
   */
  use: async (req: UseRequest): Promise<UseResponse> => {
    const res = await httpClient.post<OkEnvelope<UseResponse> | ErrEnvelope>(
      '/api/user/vault/use',
      req,
    );
    return unwrap(res.data);
  },
};
