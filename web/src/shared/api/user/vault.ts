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
  secret_prefix: string | null;     // first 12 chars of plaintext (2026-05-09); null when locked OR len < 24 (entire secret too short to safely partial-reveal)
  secret_suffix: string | null;     // last 4 chars of plaintext; null when locked OR len < 24
  secret_len: number | null;        // total plaintext length; null when locked
  /**
   * Generic extension blob — see VaultExtra. The Vault page's "Last test"
   * column reads `extra?.last_test`. Optional + nullable for forward
   * compat: old CLI builds omit the field entirely, old vaults set it to
   * null. Both render as an em-dash placeholder.
   */
  extra?: VaultExtra | null;
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
  /**
   * Original/immutable upstream identity (typically email, falls back to
   * a user_id when the OAuth flow doesn't return an email). NEVER touched
   * by rename — see `local_alias` for the user-set label.
   */
  display_identity: string | null;
  /**
   * Effective user-facing label: `local_alias ?? display_identity`. Renamed
   * accounts surface their new label here while keeping `display_identity`
   * pointing at the upstream email. Pre-v1.0.1-alpha.1 vaults always have
   * `alias === display_identity`.
   */
  alias: string | null;
  /**
   * User-set local label written by the OAuth rename action. NULL means
   * "never renamed" (in which case `alias === display_identity`). Used by
   * the drawer to decide whether to render the alias and Identity rows
   * separately (renamed) or merge them (unchanged). Added v1.0.1-alpha.1.
   */
  local_alias: string | null;
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
  /**
   * Local proxy URL the SDK should target for THIS OAuth account
   * (e.g. `http://127.0.0.1:27200/anthropic`). Computed CLI-side via the
   * same `provider_info(code).proxy_path` lookup `aikey route` uses, so
   * the value matches the route table 1:1. Optional for forward-compat
   * with older CLI bundles that didn't emit this field; the drawer hides
   * the row when missing.
   */
  route_url?: string | null;
  /**
   * Opaque per-account routing token that maps to this OAuth credential
   * at the proxy. Stable identifier — safe to display. Mirrors the
   * `route_token` field on PersonalVaultRecord for uniform drawer code.
   * Null on pre-route-token vaults; drawer omits the row in that case.
   */
  route_token?: string | null;
  /**
   * Generic extension blob — see PersonalVaultRecord.extra. Same
   * forward-compat contract.
   */
  extra?: VaultExtra | null;
}

/**
 * Connectivity-test result snapshot persisted per key (2026-05-22).
 * Written by the Web "Test Connection" button (POST /api/user/vault/test)
 * and surfaced as the Vault page "Last test" column. `at` is unix
 * seconds; `latency_ms` is min successful API latency on pass, max ping
 * latency on fail (undefined if every probe failed before TCP).
 * `suite_results` is opaque per-target JSON used only by the popup —
 * shape mirrors the CLI's `aikey test --json` envelope so the same
 * shared renderer can drive both.
 */
export interface VaultLastTest {
  at: number;
  status: 'pass' | 'fail';
  /** Phase booleans (any-ok semantics across the credential's provider
   *  bindings). The Vault page's "Last test" column renders three dots
   *  driven directly by these — colour rule per user-spec 2026-05-22:
   *    chat_ok = true                   → green dot
   *    api_ok = false                   → amber dot (key reaches proxy,
   *                                       but upstream rejected — most
   *                                       commonly auth / quota)
   *    ping_ok = false                  → red dot (cannot even reach
   *                                       upstream, network / proxy
   *                                       config issue)
   *  Older snapshots may not carry these fields; treat undefined as
   *  the legacy `status` booleans (pass = all true, fail = api/chat
   *  not ok).
   */
  ping_ok?: boolean;
  api_ok?: boolean;
  chat_ok?: boolean;
  /** Chat probe was intentionally not executed; do not treat chat_ok=false as failure. */
  chat_skipped?: boolean;
  chat_skip_reason?: string;
  latency_ms?: number;
  error_code?: string;
  error_message?: string;
  suggestion?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suite_results?: any[];
}

/**
 * Generic per-key extension blob (2026-05-22). Source-of-truth doc lives
 * on the CLI side at `storage::SecretMetadata::extra`. First consumer is
 * `last_test`; any future per-key fact (favourites, tags, notes …) nests
 * here as a sibling subkey without a column-level migration.
 *
 * Always emitted by the server — null when the column doesn't exist yet
 * (old vault) or when no subkey has been set. Treat undefined the same
 * as null.
 */
export interface VaultExtra {
  last_test?: VaultLastTest | null;
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
  /**
   * Phase 3B (2026-05-11): map of `virtual_key_id → provider_codes[]` for
   * team keys that are the active binding in the local CLI vault. The
   * `records[]` field above never contains team rows (those come from B
   * cross-origin via useTeamVaultStore), but the binding info lives in
   * the local vault — this map joins the two. Vault page reads it to
   * populate each team row's `in_use_for` so the IN USE chip + active
   * dot fire under the correct protocol group, mirroring Personal/OAuth
   * semantics.
   *
   * Optional for forward-compat with older local-server / CLI builds
   * that predate the field; treat `undefined` as `{}`.
   */
  team_active_bindings?: Record<string, string[]>;
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
  /**
   * The new label written by rename. For oauth + team this is the
   * `local_alias` column on `provider_accounts` / `managed_virtual_keys_cache`
   * respectively — display_identity (oauth) and the server alias (team) stay
   * immutable. Personal renames don't populate this field; the new alias is
   * `id` itself.
   */
  local_alias?: string;
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

/**
 * Connectivity test request (2026-05-22). Web sends `{target, id}` and
 * the backend runs the same suite the CLI's `aikey test` runs (via
 * `_internal vault-op test`), persists the aggregate to vault, and
 * returns it for the popup.
 */
export interface TestRequest {
  target: 'personal' | 'oauth' | 'team';
  id: string;
}

export interface TestResponse {
  target: 'personal' | 'oauth' | 'team';
  id: string;
  /**
   * Whether the aggregated result was written to vault `extra.$.last_test`.
   * False for team rows in this iteration (storage layer not yet wired —
   * see VirtualKeyCacheEntry in storage_platform.rs). The popup should
   * surface "ran successfully but won't show in the column until the
   * next release" when this is false on a team target.
   */
  persisted: boolean;
  last_test: VaultLastTest;
}

/**
 * Pre-save connectivity probe request (2026-05-23). Web sends the
 * plaintext secret + protocol list, the backend builds an ad-hoc probe
 * target without ever touching the vault and returns aggregated phase
 * results in `VaultLastTest` shape.
 *
 * `alias_hint` is purely a label that appears in `suite_results[*].source_ref`
 * so the popup's per-provider breakdown can render an identifier; it is
 * NOT a vault alias and gets nothing written anywhere.
 */
export interface TestRawRequest {
  providers: string[];
  secret: string;
  alias_hint?: string;
  base_url?: string;
}

export interface TestRawResponse {
  providers: string[];
  alias_hint: string;
  last_test: VaultLastTest;
}

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

  /**
   * Run a connectivity probe against one key and persist the result to
   * `extra.$.last_test`. Backed by `_internal vault-op test`. Same suite
   * as the CLI's `aikey test --json` — single source of truth.
   *
   * No unlock required: the probe runs via aikey-proxy which decrypts
   * server-side; the Web only sees pass/fail + latency + error code.
   *
   * Latency note: this can take 5-30s depending on provider count + network.
   * Callers should set generous axios timeouts on the request (the backend's
   * internal CLI timeout is 45s; client should be >= that to surface the
   * server's I_CLI_TIMEOUT cleanly instead of a generic abort).
   */
  /**
   * Pre-save connectivity probe for the Add Key Guided flow (spec §3.1 /
   * §5.1). Differs from {@link test} in that the credential has not been
   * written to the vault yet — we send the plaintext secret + provider
   * list directly so the user can see Ping / API / Chat outcomes BEFORE
   * deciding to Save / Save anyway / Cancel.
   *
   * Result shape matches `VaultLastTest` so the page 2 Connectivity card
   * and probe table render identically to a post-save row.
   *
   * Backed by `_internal vault-op test_raw`. Reuses the same aggregation
   * rules (`aggregate_test_outcome`) and target factory
   * (`targets_from_new_personal_key`) that `aikey add`'s post-entry
   * probe uses — internal-command-reuses-public-core principle.
   */
  testRaw: async (req: TestRawRequest): Promise<TestRawResponse> => {
    // Same retry-on-5xx posture as test(): local-server restarts cleanly
    // and a single quiet retry hides that transient class of failure
    // from the user without papering over real backend bugs.
    try {
      const res = await httpClient.post<OkEnvelope<TestRawResponse> | ErrEnvelope>(
        '/api/user/vault/test-raw',
        req,
        { timeout: 60_000 },
      );
      return unwrap(res.data);
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response?.status;
      const transient = typeof httpStatus === 'number' && httpStatus >= 500 && httpStatus < 600;
      if (!transient) throw err;
      await new Promise(r => setTimeout(r, 800));
      const res2 = await httpClient.post<OkEnvelope<TestRawResponse> | ErrEnvelope>(
        '/api/user/vault/test-raw',
        req,
        { timeout: 60_000 },
      );
      return unwrap(res2.data);
    }
  },

  test: async (req: TestRequest): Promise<TestResponse> => {
    // Auto-retry once on a 5xx response. The most common cause is the
    // local-server being restarted mid-request (e.g. `make rebuild`
    // briefly drops connections). A single quiet retry hides that
    // transient class of failure from the user without papering over
    // real backend bugs — if the retry also 5xxes, we surface the
    // error so the popup's "Probe could not run" path can render a
    // friendly message.
    try {
      const res = await httpClient.post<OkEnvelope<TestResponse> | ErrEnvelope>(
        '/api/user/vault/test',
        req,
        { timeout: 60_000 },
      );
      return unwrap(res.data);
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response?.status;
      const transient = typeof httpStatus === 'number' && httpStatus >= 500 && httpStatus < 600;
      if (!transient) throw err;
      // Wait briefly so a restarting server has time to accept again.
      await new Promise(r => setTimeout(r, 800));
      const res2 = await httpClient.post<OkEnvelope<TestResponse> | ErrEnvelope>(
        '/api/user/vault/test',
        req,
        { timeout: 60_000 },
      );
      return unwrap(res2.data);
    }
  },
};

// ============================================================================
// OAuth Broker — Web Add-Key Guided flow (spec §6)
// ============================================================================
//
// The browser cannot speak directly to aikey-proxy:27200 (CORS + same-origin
// policy + the user has no idea what port the proxy is on). local-server
// stands in as a same-origin relay (POST /api/user/oauth/*) that forwards
// straight to the broker's POST /oauth/login / GET /oauth/status / POST
// /oauth/poll endpoints. The state machine lives in the React component;
// these helpers are just thin axios wrappers around the relay routes.

/**
 * OAuth login session as returned by the broker for Phase-1 (start) and
 * read by GET /status. Field presence depends on the flow type:
 *   - setup_token (Claude):   auth_url present; user pastes code#state
 *                             which is submitted via login() Phase-2.
 *   - auth_code   (Codex):    auth_url present; broker hosts a localhost
 *                             callback. Web polls /status until status
 *                             flips to "completed".
 *   - device_code (Kimi):     verification_url + user_code present.
 *                             Web polls /poll periodically.
 *
 * Shape mirrors aikey-auth-broker/types.go::LoginSession.
 */
export interface OAuthSession {
  id: string;
  provider: 'claude' | 'codex' | 'kimi' | string;
  flow_type: 'setup_token' | 'auth_code' | 'device_code' | string;
  status?: 'pending' | 'completed' | 'failed' | string;
  auth_url?: string;
  verification_url?: string;
  user_code?: string;
  // Populated once a token is acquired (Phase-2 / completed poll).
  // Wire field is `account_id` (broker's LoginSession.AccountID JSON tag);
  // the broker's logout endpoint takes `provider_account_id` in its
  // request body but the session response keeps the shorter form. We
  // mirror the broker's wire name here to avoid a transform layer.
  account_id?: string;
  display_identity?: string;
  error?: { code?: string; message?: string };
}

export interface OAuthStartRequest {
  provider: 'claude' | 'codex' | 'kimi' | string;
}

export interface OAuthSubmitCodeRequest {
  session_id: string;
  provider: 'claude' | 'codex' | 'kimi' | string;
  code: string; // For Claude: "<authcode>#<state>"
}

export interface OAuthPollRequest {
  session_id: string;
}

async function postBrokerJSON(url: string, body: unknown): Promise<OAuthSession> {
  const res = await httpClient.post<OAuthSession | { error: { code?: string; message?: string } }>(
    url,
    body,
    { timeout: 60_000 },
  );
  const data = res.data as OAuthSession & { error?: { code?: string; message?: string } };
  if (data?.error) {
    const err = new Error(data.error.message || 'OAuth broker error') as Error & { code?: string };
    err.code = data.error.code;
    throw err;
  }
  return data;
}

export const oauthApi = {
  /**
   * Phase-1: start a broker session for the given provider. Returns the
   * session id + flow_type + flow-specific URLs.
   *
   * Why no auto-retry: starting a session is cheap and idempotent only at
   * the broker level (a duplicate start opens a 2nd browser tab). The
   * caller's UI already has an "Open auth again" button for retries —
   * exposing a transparent retry here would cause silent double-opens.
   */
  start: async (req: OAuthStartRequest): Promise<OAuthSession> => {
    return postBrokerJSON('/api/user/oauth/login', req);
  },

  /**
   * Phase-2: submit the `code#state` paste (Claude setup_token only).
   * On success returns the session with provider_account_id +
   * display_identity populated and status="completed".
   */
  submitCode: async (req: OAuthSubmitCodeRequest): Promise<OAuthSession> => {
    return postBrokerJSON('/api/user/oauth/login', req);
  },

  /**
   * Poll the session status (Codex auth_code: broker is hosting the
   * localhost callback; we wait for it to flip "completed").
   */
  status: async (sessionId: string): Promise<OAuthSession> => {
    const res = await httpClient.get<OAuthSession>(
      `/api/user/oauth/status?session_id=${encodeURIComponent(sessionId)}`,
      { timeout: 30_000 },
    );
    return res.data;
  },

  /**
   * Device-Code poll (Kimi). The broker contacts upstream with the
   * stored device code and returns either pending (HTTP 202-ish) or
   * completed with token material.
   */
  poll: async (req: OAuthPollRequest): Promise<OAuthSession> => {
    return postBrokerJSON('/api/user/oauth/poll', req);
  },
};
