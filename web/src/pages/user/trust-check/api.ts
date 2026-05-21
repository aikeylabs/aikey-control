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
  /** Combined 0..100 trust score. UI's primary band-decision input. */
  s_combined: number | null;
  anomaly_suggested: boolean;
  /** Free-shape JSON blob describing which signals fired. We pass it
   *  through to the detail drawer (Day 4); not parsed in Day 2. */
  signals_summary: Record<string, unknown> | null;
}

export interface TrustStatusListResponse {
  items: TrustSummary[];
}

export interface TrustStatusDetail extends TrustSummary {
  cascade_history: CascadeHistoryEntry[];
}

export interface CascadeHistoryEntry {
  verify_id: string;
  triggered_at: number;
  completed_at: number | null;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
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
 * Body shape for POST /v1/verify. force=true bypasses the 24h
 * server-side rate limit (arch doc §5.1). Day 3 default = false;
 * the page re-fires with force=true after user confirmation when the
 * first request 429s.
 */
export interface VerifyRequestBody {
  alias_name: string;
  provider_id: string;
  model: string;
  force?: boolean;
}

/**
 * trust-local returns 429 with a JSON body that carries the
 * `next_eligible_at` epoch. We thread it through as a typed error so
 * the page can render "wait until 14:32" without re-parsing.
 */
class TrustLocalRateLimitedError extends Error {
  readonly code = 'VERIFY_RATE_LIMITED';
  constructor(
    message: string,
    readonly lastVerifiedAt: number | null,
    readonly nextEligibleAt: number | null,
  ) {
    super(message);
    this.name = 'TrustLocalRateLimitedError';
  }
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
    // Try to upgrade well-known structured errors (rate limit) into
    // their typed counterparts so callers can switch on `instanceof`.
    if (resp.status === 429) {
      try {
        const parsed = JSON.parse(text);
        const detail = parsed?.detail ?? parsed;
        if (detail?.error_code === 'VERIFY_RATE_LIMITED') {
          throw new TrustLocalRateLimitedError(
            String(detail.message ?? 'verify rate-limited'),
            typeof detail.last_verified_at === 'number' ? detail.last_verified_at : null,
            typeof detail.next_eligible_at === 'number' ? detail.next_eligible_at : null,
          );
        }
      } catch (err) {
        // The body wasn't JSON, or didn't have the expected shape.
        // Re-throw upgraded errors; fall through to generic for the rest.
        if (err instanceof TrustLocalRateLimitedError) throw err;
      }
    }
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
   * Throws `TrustLocalRateLimitedError` on 429 — callers should
   * surface a friendly "wait until X" message and offer force=true
   * as an explicit retry.
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
};

export { TrustLocalUnavailableError, TrustLocalRateLimitedError };
