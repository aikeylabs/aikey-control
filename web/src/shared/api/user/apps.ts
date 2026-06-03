/**
 * Phase 4 阶段 3 (2026-05-21) — Connected Apps API client.
 *
 * Mirrors the backend handlers at
 *   aikey-control/service/pkg/userapi/app/handlers.go
 * which subprocess to `aikey _internal app.<action>` via cli.Bridge.
 *
 * Routes:
 *   GET  /api/user/apps/list      → list all registered apps + bindings
 *   POST /api/user/apps/get       → single app detail (body: {slug})
 *   POST /api/user/apps/route     → set per-upstream binding
 *   POST /api/user/apps/revoke    → revoke all active keys (irreversible)
 *   POST /api/user/apps/pause     → pause active keys (reversible)
 *   POST /api/user/apps/resume    → resume paused keys
 *   POST /api/user/apps/rotate    → atomic revoke + reissue new bearer
 *
 * Unlock policy (2026-05-21):
 *   - list / get        — public read; do NOT require unlock. Returns
 *     metadata only (slug / name / vendor / upstreams / binding alias
 *     references / timestamps), no secrets.
 *   - route / revoke / pause / resume / rotate — require unlock. The Go
 *     side guards these with Store.RequireUnlock; if the vault session
 *     is missing, the 401 envelope carries I_VAULT_LOCKED /
 *     I_VAULT_NO_SESSION which the callWithErrorExtraction helper below
 *     surfaces as e.code, so caller can prompt re-unlock.
 */
import axios, { type AxiosResponse } from 'axios';

import { httpClient } from '../http-client';

// ── Envelope shapes (shared with vault.ts) ──────────────────────────────

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

/**
 * Wrapper around an axios call that:
 *
 *   1. On HTTP 2xx → unwraps the OkEnvelope and returns `data`. If the
 *      body is unexpectedly an ErrEnvelope at 200 (the CLI emits these
 *      shapes uniformly, so this can happen), throws with .code/.message
 *      copied from the envelope.
 *
 *   2. On HTTP 4xx/5xx where the body still contains a JSON envelope
 *      (true for every endpoint backed by `userapi/cli.WriteErr` — which
 *      is all of them), extracts the envelope and throws a friendly
 *      Error whose `.code` is the structured I_* code. This is what
 *      makes the UI's `err.code === 'I_VAULT_LOCKED'` branch fire
 *      instead of the user seeing axios's default "Request failed
 *      with status code 401" message.
 *
 *   3. On HTTP 4xx/5xx WITHOUT a parseable body (rare — server crash
 *      mid-response, etc.), synthesizes a code from the status: 401 →
 *      I_VAULT_LOCKED (most common cause), other → leaves it bare.
 *
 *   4. On network failure (axios.isAxiosError without response, or
 *      non-axios throw), rethrows unchanged so callers can detect it
 *      separately if they want.
 *
 * Why this lives in apps.ts and not in a shared util: import.ts already
 * has a near-identical pattern scoped to its unlock endpoint. When 3+
 * api/user/*.ts files need the same helper we should extract; for now
 * the duplication is small and keeps the change scope tight.
 */
async function callWithErrorExtraction<T>(
  req: () => Promise<AxiosResponse<OkEnvelope<T> | ErrEnvelope>>,
): Promise<T> {
  try {
    const res = await req();
    return unwrap(res.data);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      const body = err.response.data as Partial<ErrEnvelope>;
      if (body.status === 'error' && body.error_code) {
        const e = new Error(body.error_message ?? `Request failed (${body.error_code})`) as Error & {
          code?: string;
        };
        e.code = body.error_code;
        throw e;
      }
    }
    // Status-only fallback for the common 401 case (server returned but
    // not in our envelope format — e.g. proxy 401 before reaching our
    // handlers). We assume "vault locked" because that's the dominant
    // cause for /api/user/apps/* and the user-visible mitigation is the
    // same as I_VAULT_LOCKED.
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      const e = new Error('Vault locked — unlock to continue') as Error & { code?: string };
      e.code = 'I_VAULT_LOCKED';
      throw e;
    }
    throw err;
  }
}

// ── Record shapes — must match _internal app.* JSON output ──────────────
//
// Source of truth: aikey-cli/src/commands_internal/app.rs (handle_list /
// handle_get). When the CLI shape changes, this file must follow within
// the same commit per the dual-edit dual-write rule (Schema-Code 一致性).

/**
 * Credential source type for a per-upstream binding. The CLI accepts both
 * legacy and canonical aliases; the UI only ever sees the canonical form
 * on read but should send canonical on write.
 *
 * - `personal` / `personal_api_key` — vault alias (e.g., "my-claude")
 * - `team` / `managed_virtual_key`  — virtual key id
 * - `personal_oauth_account`         — OAuth account id
 */
export type KeySourceType =
  | 'personal'
  | 'personal_api_key'
  | 'team'
  | 'managed_virtual_key'
  | 'personal_oauth_account';

/**
 * Compact, user-facing label for a `key_source_type` value. The raw
 * type strings (`personal_oauth_account`, `managed_virtual_key`) are
 * verbose enough to wrap in tight table cells and read more like
 * implementation details than user concepts. We collapse them to short
 * labels (OAUTH, TEAM) for the Apps page's "STATUS / BINDING" cells.
 *
 * Unknown values are passed through verbatim so a future CLI emitting a
 * new key_source_type still surfaces (rather than silently bucketing
 * into one of the known labels).
 */
export function bindingTypeLabel(keySourceType: string): string {
  switch (keySourceType) {
    case 'personal':
    case 'personal_api_key':
      return 'personal';
    case 'team':
    case 'managed_virtual_key':
      return 'team';
    case 'personal_oauth_account':
      return 'oauth';
    default:
      return keySourceType;
  }
}

/**
 * Single per-upstream binding row. Tells the UI "for upstream X, the app
 * currently calls key Y of source type Z". Empty array = no bindings yet,
 * meaning runtime requests will fail with BINDING_NOT_FOUND until the
 * user uses the Switch Key modal.
 */
export interface AppBinding {
  upstream: string;          // canonical provider code: "anthropic" | "openai" | "kimi_code" | ...
  key_source_type: string;   // KeySourceType serialized — accept widened string for forward compat
  key_source_ref: string;    // alias / virtual_key_id / oauth_account_id (storage identifier)
  /**
   * User-facing label for display, resolved by the CLI:
   * - personal / team → same as `key_source_ref` (alias / vk_id are already user-facing)
   * - personal_oauth_account → resolved to the OAuth account's email or
   *   user-set local_alias (effective_label on the Rust side). Falls back
   *   to the raw `provider_account_id` if the account row is missing.
   * Optional for backwards compat with older CLI builds that didn't
   * emit this field — UI should fall back to `key_source_ref` when absent.
   */
  key_source_label?: string;
}

/**
 * Row shape returned by GET /api/user/apps/list. Matches the JSON object
 * the CLI's handle_list emits for each app.
 */
export interface AppListRow {
  slug: string;
  name: string;
  vendor: string;
  upstreams: string[];          // declared upstream provider list (register-time)
  app_kind: 'third-party' | 'first-party';
  follow_user_active: boolean;
  has_active_key: boolean;
  key_id: string | null;
  key_created_at: number | null; // unix seconds
  last_used_at: number | null;   // unix seconds; null = never called
  bindings: AppBinding[];
  created_at: number;
  updated_at: number;
}

/**
 * Detail shape returned by POST /api/user/apps/get. Matches the JSON
 * object the CLI's handle_get emits.
 */
export interface AppDetailData {
  app: {
    slug: string;
    name: string;
    vendor: string;
    upstreams: string[];
    app_kind: 'third-party' | 'first-party';
    follow_user_active: boolean;
    requested_permissions: string[];
    created_at: number;
    updated_at: number;
  };
  bindings: AppBinding[];
  active_keys: Array<{
    key_id: string;
    created_at: number;
    last_used_at: number | null;
  }>;
}

// ── Request shapes ──────────────────────────────────────────────────────

export interface AppRouteRequest {
  slug: string;
  upstream: string;
  key_source_type: KeySourceType;
  key_source_ref: string;
}

// ── Response shapes (mostly thin) ───────────────────────────────────────

export interface AppListData {
  apps: AppListRow[];
}

/**
 * One entry in the GET /api/user/apps/health response. Sourced from the
 * local proxy's in-memory cache of "most recent app pipeline call per
 * app_slug" — volatile (lost on proxy restart, not persisted). The UI
 * uses it to classify each app row into 4 buckets:
 *   - OK     status_code in [200, 300)
 *   - Warn   status_code in [400, 500)
 *   - Error  status_code >= 500  OR  error_type is non-empty
 *   - Never  slug not present in the response (no entry in cache)
 *
 * last_call_at is ISO-8601 (Go time.Time JSON default). Frontend converts
 * to a relative "5min ago" via relativeTime() at render time.
 */
export interface AppHealth {
  app_slug: string;
  last_call_at: string;     // ISO-8601 timestamp
  status_code: number;
  error_type?: string;      // empty for 2xx; provider error type or proxy-side category otherwise
}

/** Response for GET /api/user/apps/health.
 *  `apps` is sorted by app_slug for deterministic snapshot tests. */
export interface AppHealthData {
  apps: AppHealth[];
}

export interface AppRouteResponse {
  slug: string;
  upstream: string;
  ok: boolean;
}

export interface AppRevokeResponse {
  slug: string;
  revoked_count: number;
}

export interface AppPauseResponse {
  slug: string;
  paused_count: number;
}

export interface AppResumeResponse {
  slug: string;
  resumed_count: number;
}

export interface AppRotateResponse {
  slug: string;
  key_id: string;
  api_key: string;           // the new aikey_app_<64hex> bearer
  base_url: string;          // http://127.0.0.1:27200/apps/<slug>/v1
}

/** Response for POST /api/user/apps/uninstall (2026-05-23, paired with
 *  the rc.5 default-install flip). Whole-system removal — service down,
 *  binary gone, vault rows wiped. */
export interface AppUninstallResponse {
  slug: string;
  status: 'uninstalled';
}

/**
 * Response for POST /api/user/apps/filter-status (2026-06-02). Reports
 * whether the content filter is enabled for an app + which pipeline
 * stages are active. Backs the local-web "AI compliance detection"
 * on/off toggle. Matches the CLI's handle_filter_status JSON
 * ({slug, enabled, stages}).
 *
 * `enabled` = (filter_stages is non-NULL). `stages` is the active stage
 * list (e.g. ["pre_forward"]); empty when disabled.
 */
export interface AppFilterStatusData {
  slug: string;
  enabled: boolean;
  stages: string[];
  /** Whether the local self-view records "allow" (clean-scan) events. Default
   *  false (off, save space) — the "record allowed events" sub-toggle. */
  record_allow?: boolean;
}

/** Response for POST /api/user/apps/filter-set (2026-06-02). Echoes the
 *  resulting enabled state. */
export interface AppFilterSetResponse {
  slug: string;
  enabled: boolean;
}

/** Response for POST /api/user/apps/reveal-token (2026-05-25). Carries
 *  the plaintext bearer + its key_id + the proxy base_url. Detail
 *  page renders the value with a masked-by-default toggle + Copy
 *  button; the value is NOT persisted in React Query cache (kept in
 *  component state, dropped on unmount). */
export interface AppRevealTokenResponse {
  slug: string;
  key_id: string;
  route_token: string;
  base_url: string;
}

// ── Web UI self-service registration (2026-05-25) ──────────────────────
//
// Pairs with POST /api/user/apps/register. Per the plan doc
// (roadmap20260320/技术实现/update/2026-05-25-third-party-app-web-ui-add.md
// §4.4), the Web path is locked to third-party — the backend hardcodes
// app_kind=third-party and rejects FIRST_PARTY_SLUGS, so this request
// shape intentionally omits app_kind / first_party / follow_user_active.

export interface AppRegisterRequest {
  slug: string;                                // kebab-case, 3-64 chars; `[a-z][a-z0-9-]*`
  name?: string;                               // optional; backend defaults to slug
  vendor?: string;                             // optional free-text owner tag
  upstreams: string[];                         // required, non-empty
  requested_permissions?: string[];            // reserved; not enforced at runtime yet
}

/**
 * Bindings the backend snapshotted into the new app's profile from the
 * user's current `aikey use` selection. The Web UI shows this as the
 * "Will use" preview in the TokenRevealModal so the user sees which
 * provider key the new bearer will route to before they paste the token
 * into their agent.
 */
export interface AppRegisterBindingPreview {
  upstream: string;
  key_source_type: string;
  /** Stable storage identifier (alias / virtual_key_id / provider_account_id).
   *  Used by follow-up calls like `aikey app route`. */
  key_source_ref: string;
  /**
   * Friendly display string resolved by the CLI:
   * - personal → same as `key_source_ref`
   * - team → `local_alias` (or server `alias` if not renamed)
   * - personal_oauth_account → email / local_alias / external_id
   *   (falls back to `provider_account_id` only if nothing else exists)
   * Optional for forwards compat — UI MUST fall back to `key_source_ref`
   * when absent (older CLI builds didn't emit this field).
   */
  key_source_label?: string;
}

/**
 * Response payload for the register endpoint. `route_token` is the
 * one-time plaintext bearer — the UI MUST display it in the token-reveal
 * modal with a Copy button + "won't be shown again" warning. The token
 * is NOT recoverable later; the recovery path is rotate.
 */
export interface AppRegisterResponse {
  slug: string;
  name: string;
  vendor: string;
  upstreams: string[];
  app_kind: 'third-party';                          // always — backend hardcodes
  follow_user_active: false;                        // always — backend hardcodes
  requested_permissions: string[];
  action: 'inserted' | 'updated';                   // updated = idempotent re-register
  key_id: string;                                   // UUIDv4
  /** One-time plaintext bearer. Show, let user copy, then drop. */
  route_token: string;
  base_url: string;                                 // http://127.0.0.1:27200/apps/<slug>/v1
  base_url_protocol: string;                        // first upstream's protocol family
  bearer_was_new: boolean;                          // false if re-register reused an existing bearer
  snapshotted_bindings: AppRegisterBindingPreview[]; // bindings copied from default profile
  preserved_bindings: AppRegisterBindingPreview[];   // bindings the prior `aikey app route` had set
  missing_upstreams_for_aikey_use: string[];        // upstreams where `aikey use` has no selection — warn
}

// ── API client ──────────────────────────────────────────────────────────
//
// Each function does ONE Bridge → CLI subprocess round-trip. The CLI is
// stateless and re-exec cost is ~30ms (Stage 0.3 baseline) — well within
// dashboard click → response budget. We do NOT batch on the client; let
// React/SWR handle dedupe.

export const appsApi = {
  /**
   * List all registered apps. Returns ALL apps regardless of app_kind
   * (including first-party like degrade-detector). The UI distinguishes
   * first-party via a badge but does not filter — see Phase 4 阶段 3
   * revised decision 2026-05-21.
   */
  list: (): Promise<AppListData> =>
    callWithErrorExtraction(() =>
      httpClient.get<OkEnvelope<AppListData> | ErrEnvelope>('/api/user/apps/list'),
    ),

  /**
   * Fetch full detail for one app. Includes the app metadata, all
   * per-upstream bindings, and the list of currently active keys
   * (typically just one; multiple only during a rotate window).
   */
  get: (slug: string): Promise<AppDetailData> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppDetailData> | ErrEnvelope>(
        '/api/user/apps/get',
        { slug },
      ),
    ),

  /**
   * Set the per-upstream binding for an app. UPSERT semantics — calling
   * twice for the same (slug, upstream) tuple overwrites the second
   * time. The new binding applies to the NEXT request the app makes;
   * in-flight requests using the old binding complete normally.
   */
  route: (req: AppRouteRequest): Promise<AppRouteResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppRouteResponse> | ErrEnvelope>(
        '/api/user/apps/route',
        req,
      ),
    ),

  /**
   * Revoke ALL active keys for the app. IRREVERSIBLE — the agent's
   * bearer will 401 on the next request. The app record + binding rows
   * are preserved; user can re-register to get a new bearer.
   */
  revoke: (slug: string): Promise<AppRevokeResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppRevokeResponse> | ErrEnvelope>(
        '/api/user/apps/revoke',
        { slug },
      ),
    ),

  /**
   * Pause active keys (reversible via resume). Different from revoke:
   * the bearer still exists, just doesn't authenticate. Use for
   * "temporarily disable" semantics (e.g., investigating suspicious
   * usage before deciding to revoke).
   */
  pause: (slug: string): Promise<AppPauseResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppPauseResponse> | ErrEnvelope>(
        '/api/user/apps/pause',
        { slug },
      ),
    ),

  /**
   * Resume paused keys. Inverse of pause. No-op (resumed_count: 0) when
   * no paused key exists.
   */
  resume: (slug: string): Promise<AppResumeResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppResumeResponse> | ErrEnvelope>(
        '/api/user/apps/resume',
        { slug },
      ),
    ),

  /**
   * Atomic: revoke old key + issue new key (with same bindings).
   * Returns the NEW bearer in `api_key`. The agent must restart with
   * the new env or its requests will 401 on the next call.
   */
  rotate: (slug: string): Promise<AppRotateResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppRotateResponse> | ErrEnvelope>(
        '/api/user/apps/rotate',
        { slug },
      ),
    ),

  /**
   * Whole-system uninstall: stops the plugin's service, removes the
   * binary, and wipes vault rows (app_keys + bindings + app_records).
   * Added 2026-05-23 alongside the rc.5 default-install flip — users
   * who got degrade-detector auto-installed need a single UI button to
   * opt out cleanly.
   *
   * Bypasses the mutationLockedSlugs revoke/rotate guard because
   * uninstall is whole-system: the service goes down FIRST (via the
   * plugin's install_service.sh --uninstall), THEN the bearer is
   * removed. There's no half-state where a running agent has no
   * bearer (the failure mode the revoke lock guards against).
   */
  uninstall: (slug: string): Promise<AppUninstallResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppUninstallResponse> | ErrEnvelope>(
        '/api/user/apps/uninstall',
        { slug },
      ),
    ),

  /**
   * Re-read the currently-active bearer plaintext for a slug
   * (2026-05-25). Caller is the detail page's ISSUED BEARER section,
   * which keeps the value in component state (NOT React Query cache —
   * cache lifetime is unbounded and persistent across page nav, which
   * is exactly what we don't want for a token reveal).
   *
   * Failure modes the UI handles:
   *   - I_NO_ACTIVE_TOKEN — slug has no active key (revoked or never
   *     registered). UI should show "No active token to reveal — register
   *     or rotate first."
   *   - I_VAULT_LOCKED    — needs unlock; UI re-prompts inline.
   *   - I_APP_REVEAL_FAILED — generic backend failure; show err.message.
   */
  revealToken: (slug: string): Promise<AppRevealTokenResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppRevealTokenResponse> | ErrEnvelope>(
        '/api/user/apps/reveal-token',
        { slug },
      ),
    ),

  /**
   * Self-service registration from the Web UI Add modal (2026-05-25). The
   * backend hardcodes app_kind=third-party + rejects FIRST_PARTY_SLUGS,
   * so this client deliberately does not accept those fields. Returns
   * the one-time `route_token` — the caller (AddAppModal) MUST hand it
   * straight to the TokenRevealModal and never persist it.
   *
   * Error codes the UI is likely to surface (all via err.code):
   *   - I_INVALID_SLUG                 — bad slug shape (must be [a-z][a-z0-9-]{2,63})
   *   - I_FIRST_PARTY_SLUG_RESERVED    — slug clashes with a built-in app
   *   - I_NO_UPSTREAMS                 — empty upstreams array
   *   - I_VAULT_LOCKED                 — needs unlock; modal already shows the unlock prompt
   *   - I_APP_REGISTER_FAILED          — generic backend failure; show err.message
   */
  register: (req: AppRegisterRequest): Promise<AppRegisterResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppRegisterResponse> | ErrEnvelope>(
        '/api/user/apps/register',
        req,
      ),
    ),

  /**
   * Read the proxy's in-memory "most recent call per app_slug" snapshot.
   * Drives the /user/apps list page Health column. Returns an empty
   * `apps` array when no traffic has been observed (e.g. immediately
   * after proxy restart — the cache is process-memory only).
   *
   * Error codes the UI may surface:
   *   - PROXY_UNREACHABLE        — aikey-proxy is not running
   *   - HEALTH_NOT_AVAILABLE     — proxy returned non-200 (older build, cache not wired)
   */
  health: (): Promise<AppHealthData> =>
    callWithErrorExtraction(() =>
      httpClient.get<OkEnvelope<AppHealthData> | ErrEnvelope>('/api/user/apps/health'),
    ),

  /**
   * Read whether the content filter is enabled for an app (2026-06-02).
   * Public read (no unlock) — metadata only. Backs the Settings page
   * "AI compliance detection" toggle's initial state.
   */
  filterStatus: (slug: string): Promise<AppFilterStatusData> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppFilterStatusData> | ErrEnvelope>(
        '/api/user/apps/filter-status',
        { slug },
      ),
    ),

  /**
   * Enable / disable the content filter for an app (2026-06-02).
   * Requires unlock (disabling turns off a safety control). The CLI
   * side bumps the vault change_seq; the local proxy reloads within
   * ~5s and spawns / kills the detector child accordingly — no manual
   * proxy restart needed.
   *
   * Error codes the UI handles via err.code:
   *   - I_VAULT_LOCKED — needs unlock; surface inline re-unlock prompt
   *   - I_APP_FILTER_SET_FAILED — generic backend failure; show err.message
   */
  filterSet: (slug: string, enable: boolean): Promise<AppFilterSetResponse> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<AppFilterSetResponse> | ErrEnvelope>(
        '/api/user/apps/filter-set',
        { slug, enable },
      ),
    ),

  /**
   * Set whether the local self-view records "allow" (clean-scan) events
   * (2026-06-03). Default off (save space). Requires unlock (vault mutation).
   * The proxy reload re-spawns the detector with the new flag so it gates
   * allow emission at source. Echoes {slug, record_allow}.
   */
  filterRecordAllow: (slug: string, enable: boolean): Promise<{ slug: string; record_allow: boolean }> =>
    callWithErrorExtraction(() =>
      httpClient.post<OkEnvelope<{ slug: string; record_allow: boolean }> | ErrEnvelope>(
        '/api/user/apps/filter-record-allow',
        { slug, enable },
      ),
    ),
};
