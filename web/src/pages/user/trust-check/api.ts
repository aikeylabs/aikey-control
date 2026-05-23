/**
 * trust-local HTTP client for the Trust Check page.
 *
 * Why a page-local API client (not in shared/api/):
 *   - trust-local lives on a DIFFERENT origin (8801) than aikey-control
 *     web (8090) — its base URL doesn't fit shared/api/'s axios
 *     instance that targets local-server. Pulling it into shared/ would
 *     require an "alt-base" override pattern that no other page
 *     currently needs.
 *   - Day 5 we re-evaluate: if a 2nd page (M5.2 ops dashboard, future
 *     `/admin/trust-central`) ends up needing trust-net access, promote
 *     this file to `shared/api/trust-local.ts` then.
 *   - For Day 2 the goal is minimal cross-file blast radius — other
 *     sessions are concurrently editing shared/ and we want to stay
 *     out of their way.
 *
 * No auth — trust-local runs on localhost only and listens on 127.0.0.1
 * by default (see degrade-detector/server_local/main.py). Cross-port
 * CORS is already set to `*` on the server, so the browser fetch goes
 * through without preflight games.
 */

const TRUST_LOCAL_BASE = 'http://127.0.0.1:8801';

/**
 * Mirrors the dict shape returned by trust-local's `_to_summary()`
 * (server_local/api/status.py). Kept identical field-for-field so the
 * server team can rename here and we'll catch the drift in tsc.
 */
export interface TrustSummary {
  alias_name: string;
  provider_id: string;
  model: string;
  /** Epoch seconds. */
  updated_at: number;
  /** Epoch seconds; null if never verified. */
  last_verified_at: number | null;
  /** "pass" | "fail" | "inconclusive" | "never" — the verdict of the
   *  most recent cascade verify run for this alias. */
  last_verify_result: string;
  s_l1: number | null;
  s_l2: number | null;
  s_l3: number | null;
  /** MIN-veto combiner — internal alerting gate.
   *
   *  NOT a user-facing headline anymore (2026-05-23 redesign): raw MIN
   *  reads as a definitive verdict ("15/100 = provider failed"), which
   *  is statistically dishonest for a single-run signal and exposes us
   *  to provider pushback. Kept here because:
   *    1. Backend still computes + persists it for internal alerting
   *    2. Per-alias dashboards / row pills can still use it as a
   *       threshold (e.g., color the alias row red when MIN < 30)
   *  But the SUB-SCORES drawer + headline pill should prefer
   *  ``s_display`` (harmonic mean) instead. */
  s_combined: number | null;
  /** Harmonic-mean combiner — UI headline.
   *
   *  Biased toward low values (so a single weak signal still flags) but
   *  never collapses to MIN, so the displayed number is less inflammatory
   *  for single-run results. Backend formula:
   *    s_display = N / Σ(1/s_i)   over non-null layers,
   *                0  when any included score is 0.
   *
   *  Examples (vs MIN / arithmetic):
   *    (70, 100, 15) → MIN=15  arith=61.7  s_display=33.0
   *    (95, 100, 95) → MIN=95  arith=96.7  s_display=96.6
   *
   *  See degrade-detector/docs/user-guide.zh.md "结果怎么读" for the
   *  user-facing explanation and degrade-detector/server_local/services/
   *  check_orchestrator.py::_compute_s_display for the math. */
  s_display: number | null;
  anomaly_suggested: boolean;
  /** Free-shape JSON blob describing which signals fired. We pass it
   *  through to the detail drawer (Day 4); not parsed in Day 2. */
  signals_summary: Record<string, unknown> | null;
  /** True if the alias is currently `aikey use`-selected for at least
   *  one provider. Server-side flag from
   *  `server_local/services/in_use.py` — web treats it as opaque, no
   *  business rule lives here. */
  is_in_use?: boolean;
  /** True if the credential is an OAuth account (Claude Pro/Max,
   *  ChatGPT Plus, etc.) rather than an API key. Web uses this for
   *  the secondary label / icon hint. */
  is_oauth?: boolean;
  /** True if the alias's provider is in the detector's currently
   *  supported scope (anthropic in MVP). Always true in responses
   *  today — the plugin filters out unsupported rows before
   *  responding — but exposed for forward-compat with mixed-mode
   *  rollouts. */
  is_supported_scope?: boolean;
  /** Vault's `base_url` for this credential — the user-configured
   *  endpoint (may be a relay). Stage 7 BAND view dedupes by this
   *  field; web MUST NOT re-derive baseurl from anywhere else.
   *  Null when vault was unreachable or the credential has no
   *  base_url column (older OAuth rows). */
  base_url?: string | null;

  // v2 layer fields (2026-05-22). The orchestrator writes all five
  // on each Check run; legacy `s_l1`/`s_l2`/`s_l3`/`s_combined` stay
  // for backward compat (s_l3 + s_l2 reused with v2 semantics, see
  // ``降智检测分层方案-v2-2026-05-22.md`` §4).
  /** L2 sub-component: pass_rate × 100 over the 10 question answers
   *  (``StructuredScorer``). Drawer shows this alongside L2-crowd. */
  s_l2_content?: number | null;
  /** L2 sub-component: remote crowd quorum or local 24h fallback.
   *  Source disclosed by ``s_l2_crowd_source``. */
  s_l2_crowd?: number | null;
  /** Source label for ``s_l2_crowd``: 'remote' | 'local_24h' | null.
   *  UI badge tells the operator where the crowd number came from. */
  s_l2_crowd_source?: string | null;
  /** True when no per-model baseline existed for L3 scoring → s_l3
   *  is the neutral 50 fallback, not a real measurement. */
  s_l3_baseline_missing?: boolean;
}

export interface TrustStatusListResponse {
  items: TrustSummary[];
}

export interface TrustStatusDetail extends TrustSummary {
  cascade_history: CascadeHistoryEntry[];
  /** Recent D-rule passive observations (D4/D5/D6 hits from chat
   *  traffic via the proxy rhythm observer). Last 10, DESC by
   *  `occurred_at`. Empty array when the alias has no observation
   *  events — never null/missing. Different from `cascade_history`
   *  (which is explicit Check runs). Added 2026-05-23 F1. */
  recent_observations: RecentObservation[];
}

/**
 * Public projection of a D-rule observation row (events.observation).
 * Whitelist mirrors `server_local/api/status.py::_OBSERVATION_FIELDS`
 * — keep both in sync. Backend test
 * `test_recent_observations_field_whitelist_no_internal_leak` catches
 * server-side drift; this interface catches web-side type drift.
 */
export interface RecentObservation {
  /** Epoch seconds when the proxy observed the SSE chunk that
   *  triggered the rule (`OnSSEEvent` → rescore). */
  occurred_at: number;
  /** "D4" | "D5" | "D6". Other values would be a backend bug. */
  rule: string;
  /** D5 model-mismatch text ("claimed=opus, response=haiku"). Null
   *  for D4/D6 which are numeric. */
  reason: string | null;
  /** D4/D6 `chunks_per_100_tokens` rate (rounded int). Null for D5
   *  (binary rule, no numeric measure). */
  score: number | null;
  /** Proxy trace_id — cross-reference with proxy logs / ndjson. */
  trace_id: string;
}

export interface CascadeHistoryEntry {
  verify_id: string;
  triggered_at: number;
  completed_at: number | null;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  /** M6 (Stage 0 schema). Question-bank hash present at the time of
   *  this cascade run. Web's `computeT24h` partitions by this so a
   *  rotation doesn't blend incomparable samples. Null on rows
   *  written by the pre-M6 path. */
  questions_version?: string | null;
  /** M6 (Stage 3). Which lane fired this cascade row. Web shows a
   *  chip per row in the drawer; the §6.6 24h aggregation does NOT
   *  filter by trigger_source (auto + manual verdicts are equivalent
   *  per decision 3.11). */
  trigger_source?: string | null;
}

/**
 * Shape mirroring server_local/api/verify.py — both POST /v1/verify
 * (which returns the freshly-created record) and GET /v1/verify/{id}
 * (which returns the live snapshot). Fields are nullable while
 * status === "running"; populated when status transitions to a
 * terminal value (pass / fail / inconclusive).
 */
export interface VerifyRecord {
  verify_id: string;
  alias_name: string;
  provider_id?: string;
  model?: string;
  triggered_at: number;
  completed_at?: number | null;
  /** "running" | "pass" | "fail" | "inconclusive" */
  status: string;
  progress?: { n_done: number; n_total: number; current_qid: string | null } | null;
  duration_ms?: number | null;
  error_message?: string | null;
  scoring_detail?: Record<string, unknown> | null;
}

/**
 * Body shape for POST /v1/verify.
 *
 * M6 decision 3.1: the manual path is unlimited. `force` stays as an
 * optional field for backward compatibility with older scripts that
 * still pass it, but the server ignores it. The UI no longer surfaces
 * a "retry now / 24h limit" path.
 */
export interface VerifyRequestBody {
  alias_name: string;
  provider_id: string;
  model: string;
  /** No-op since M6. Retained so older callers don't break. */
  force?: boolean;
}

class TrustLocalUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `trust-local at ${TRUST_LOCAL_BASE} is unreachable — start it via 'aikey trust sync' or 'make run-local' from degrade-detector. (cause: ${
        cause instanceof Error ? cause.message : String(cause)
      })`,
    );
    this.name = 'TrustLocalUnavailableError';
  }
}

/**
 * Typed error for POST /v1/status/{alias}/reset-tracking 409 path —
 * vault flipped the alias back to in_use between page load and click.
 * The drawer catches this specifically to show a friendlier toast
 * ("switch with `aikey use` first") instead of the generic failure
 * message.
 */
class TrustAliasInUseError extends Error {
  constructor(alias: string) {
    super(`Alias '${alias}' is currently in use; switch via \`aikey use\` first.`);
    this.name = 'TrustAliasInUseError';
  }
}

/**
 * Generic fetch wrapper. Distinguishes "trust-local down" (network /
 * CORS error → wrap as TrustLocalUnavailableError so the page can show
 * the right banner) from "endpoint returned non-2xx" (let the caller
 * decide whether to surface).
 */
async function trustLocalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${TRUST_LOCAL_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    // fetch throws on network/CORS issues — that's our "trust-local
    // offline" signal. Wrap so callers can switch on the error type.
    throw new TrustLocalUnavailableError(err);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    // M6 decision 3.1: manual /v1/verify is unlimited — 429 should
    // never come back. If it does (e.g., upstream rate-limit bubble),
    // surface it as a generic error rather than a typed
    // rate-limit-retry-with-force path; that UI lane is gone.
    throw new Error(`trust-local ${path} returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

export const trustLocalApi = {
  /**
   * GET /v1/status — list every alias trust-local knows about, ordered
   * by most-recently-updated. Empty `items` is a valid response
   * (freshly-installed detector with no observations yet).
   */
  listStatus(): Promise<TrustStatusListResponse> {
    return trustLocalFetch<TrustStatusListResponse>('/v1/status');
  },

  /**
   * GET /v1/status/{alias_name} — single alias detail + last 10
   * cascade-history entries. Used by the row-expand drawer (Day 4).
   */
  getAliasDetail(alias: string): Promise<TrustStatusDetail> {
    return trustLocalFetch<TrustStatusDetail>(
      `/v1/status/${encodeURIComponent(alias)}`,
    );
  },

  /**
   * Lightweight liveness probe. Used by the offline-detection banner
   * + by the sidebar gating (Day 5 — sidebar entry greys out when
   * trust-local is absent so users who didn't install detector aren't
   * teased with a dead link).
   */
  async healthz(): Promise<boolean> {
    try {
      await trustLocalFetch<{ status: string }>('/healthz');
      return true;
    } catch {
      return false;
    }
  },

  /**
   * POST /v1/verify — trigger one cascade verify run. Returns the
   * fresh "running" record with `verify_id`; the caller polls
   * `getVerifyStatus(verify_id)` until status leaves "running".
   *
   * M6 decision 3.1: manual path is unlimited; no 429 / rate-limited
   * special-case path. Errors come back as generic Error.
   */
  triggerVerify(body: VerifyRequestBody): Promise<VerifyRecord> {
    return trustLocalFetch<VerifyRecord>('/v1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  /**
   * GET /v1/verify/{verify_id} — single verify run snapshot. Server
   * updates `progress` per-question while running, so polling this
   * endpoint at ~1.5s gives a live progress bar.
   */
  getVerifyStatus(verifyId: string): Promise<VerifyRecord> {
    return trustLocalFetch<VerifyRecord>(`/v1/verify/${encodeURIComponent(verifyId)}`);
  },

  /**
   * GET /v1/settings/realtime-detection — read the real-time D-rule
   * scoring toggle. Default-OFF when the row hasn't been written yet
   * (server synthesises {enabled:false, updated_at:0, updated_by:""}).
   */
  getRealtimeDetection(): Promise<{
    enabled: boolean;
    updated_at: number;
    updated_by: string;
  }> {
    return trustLocalFetch('/v1/settings/realtime-detection');
  },

  /**
   * PUT /v1/settings/realtime-detection — flip the toggle. aikey-proxy
   * picks up the change on its next 5s poll, so the UI hint should
   * tell the user about that lag. Response echoes the new state.
   */
  setRealtimeDetection(enabled: boolean): Promise<{
    enabled: boolean;
    updated_at: number;
    updated_by: string;
  }> {
    return trustLocalFetch('/v1/settings/realtime-detection', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, updated_by: 'web' }),
    });
  },

  /**
   * POST /v1/status/{alias_name}/reset-tracking — wipe an alias's
   * degrade-detection history. Vault credential is NOT touched.
   *
   * Returns the per-table delete counts on success so the caller can
   * fence-check (cleared_events > 0 means there was actually history
   * to remove; cleared_state=1 means the snapshot is gone too).
   *
   * Special-cases the 409 (ALIAS_IN_USE) response as TrustAliasInUseError
   * so the drawer can show a targeted toast. Other non-2xx responses
   * propagate as generic Error via the shared error path.
   */
  async resetTracking(alias: string): Promise<{
    ok: true;
    alias_name: string;
    cleared_events: number;
    cleared_state: number;
  }> {
    let resp: Response;
    try {
      resp = await fetch(
        `${TRUST_LOCAL_BASE}/v1/status/${encodeURIComponent(alias)}/reset-tracking`,
        {
          method: 'POST',
          headers: { Accept: 'application/json' },
        },
      );
    } catch (err) {
      throw new TrustLocalUnavailableError(err);
    }
    if (resp.status === 409) {
      throw new TrustAliasInUseError(alias);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(
        `trust-local reset-tracking returned ${resp.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await resp.json()) as {
      ok: true;
      alias_name: string;
      cleared_events: number;
      cleared_state: number;
    };
  },
};

export { TrustLocalUnavailableError, TrustAliasInUseError };
