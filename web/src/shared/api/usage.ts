/**
 * Usage query API client — connects to aikey-data/query-service.
 *
 * Dev: proxied via vite (/v1/usage/* → localhost:27310)
 * Prod: routed through API gateway / reverse proxy
 */
import { httpClient } from './http-client';

// --- Response types ---

export interface TimelinePoint {
  date: string;       // YYYY-MM-DD
  total_tokens: number;
  request_count: number;
}

export interface HourlyPoint {
  /** 0..23 in the **caller's local timezone** (sent via `?tz=` on
   * the request; the backend buckets there). Render verbatim — do
   * NOT re-convert to local on the client or you'll double-shift. */
  hour: number;
  total_tokens: number;
  request_count: number;
}

export interface ProtocolTimelinePoint {
  date: string;
  protocol_type: string;
  total_tokens: number;
  request_count: number;
}

export interface ProtocolTotal {
  protocol_type: string;
  total_tokens: number;
  request_count: number;
}

/**
 * One row of the 2026-05-25 "Usage By App" ranking on /user/usage-ledger.
 *
 * Two row shapes coexist:
 *
 *   - **Registered app row** (`app_slug` non-empty): traffic that went
 *     through `/apps/<slug>/v1/...` — a Connected App (first-party like
 *     `degrade-detector` or third-party like `claude-mem`). The frontend
 *     shows `app_slug` directly as the label; for first-party slugs it
 *     also renders an "INTERNAL" badge so the user can tell apart their
 *     own agents from AiKey's built-in pipeline noise.
 *
 *   - **Direct row** (`app_slug` empty): default `/v1/...` traffic with no
 *     app context — typically the user running `claude` / `codex` / `kimi`
 *     CLI tools against their `aikey use` selection. The proxy can't
 *     distinguish CLI tools (claude vs. curl-to-anthropic both look the
 *     same on the wire), so we use `provider_code` as the proxy for "tool
 *     name" and map anthropic→claude, openai→codex, etc. on the client.
 */
export interface AppTotal {
  /** Empty string for direct-traffic rows; non-empty for registered apps. */
  app_slug: string;
  /** Canonical short form (anthropic / openai / moonshot / kimi_code / ...). */
  provider_code: string;
  total_tokens: number;
  request_count: number;
}

/** Phase 3B R23 (2026-05-11) — raw recent request row surfaced by the
 *  Overview "Recent Requests" card. Sourced from `usage_event_ods`
 *  directly so canary probes can be filtered (DWD aggregates strip
 *  `route_source`). Default limit 5 in the API call. */
export interface RecentRequest {
  request_id: string;
  event_time_ms: number;
  provider_code: string;
  model: string;
  total_tokens: number;
  http_status_code: number;
  virtual_key_id: string;
  request_status: string; // "success" | "error" | ...
}

/** Per-model usage breakdown row powering `/user/performance`'s "Usage by
 *  model" chart. Same 4-segment Anthropic cache shape as KeyTotal so
 *  the FE can render with the existing stacked-bar idiom (uncached /
 *  cache_creation / cache_read / output).
 *
 *  `model` is the provider-reported string verbatim (no snapshot
 *  normalization — `claude-sonnet-4-5-20250929` and `claude-sonnet-4-6`
 *  are separate rows). NULL / empty values are coalesced to `"unknown"`
 *  server-side. */
export interface ModelTotal {
  model: string;
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  total_tokens: number;
  request_count: number;
}

/** 2026-05-26 — Performance Top N sessions chart row.
 * SessionID can be "" meaning "no session header detected" (the
 * collapsed bucket for curl / generic SDKs / legacy events). All
 * sample_* fields are picked via MAX/MIN aggregates from rows that
 * contributed — they give the FE enough context to label the row
 * without a per-session JOIN.
 */
export interface SessionTotal {
  session_id: string;
  sample_virtual_key_id?: string;
  sample_alias?: string;
  sample_identity?: string;     // email when an OAuth session contributed
  sample_app_slug?: string;     // representative app_slug (UA-derived or registered)
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  total_tokens: number;
  request_count: number;
}

export interface KeyTotal {
  virtual_key_id: string;
  alias?: string;    // human-readable label (personal / team BYOK)
  identity?: string; // email / display_identity (OAuth sessions; added 2026-04-22)
  // app_slug: client app attribution for the row's bucket.
  //   - registered Connected Apps → server-issued slug (authoritative)
  //   - OAuth direct calls        → UA-derived slug ("claude-code" / "cursor" /
  //                                  "cline" / "unknown-app"); spoofable, display-only.
  // Added 2026-05-26 to disambiguate multi-session OAuth rows under the same
  // email — see the usage-ledger row rendering for the subtitle treatment.
  app_slug?: string;
  // Anthropic prompt-caching tuple — all optional so non-Anthropic providers
  // and pre-v1.0.5 servers serialise without them.
  //   - input_tokens         = total prompt input (already includes cached + creation;
  //                            see proxy provider/anthropic.go totalInput())
  //   - cached_input_tokens  = Anthropic cache_read_input_tokens (legacy column name)
  //   - cache_creation_input_tokens = Anthropic cache_creation_input_tokens
  //   - output_tokens        = output
  // Therefore: uncached = input_tokens - cached_input_tokens - cache_creation_input_tokens
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  total_tokens: number;
  request_count: number;
}

// --- Query params ---

/** YYYY-MM-DD **in the user's local timezone** — what "today" means to them.
 *
 * Previously we used `d.toISOString().slice(0,10)` which returns the UTC
 * date; a user in +08:00 late at night would see their "today" collapse
 * to UTC yesterday. After the tz-local refactor (bugfix 20260424) the
 * server interprets `?start_date` / `?end_date` / `?date` as the
 * caller's local calendar day (paired with `?tz=<IANA>`), so the client
 * must send the *local* date to match. */
function dateParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultRange(days = 30): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start_date: dateParam(start), end_date: dateParam(end) };
}

/** IANA tz (e.g. "Asia/Shanghai") detected from the browser. Sent on
 * every usage API call so the server can bucket events per the user's
 * local calendar day / hour. Safe fallback to "UTC" if Intl is
 * unavailable (very old browsers) — server treats empty / UTC the
 * same. */
function browserTZ(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// --- Personal identity ---
// Personal queries accept seat_id, account_id, or org_id=personal (local-user mode).

interface PersonalIdentity {
  seat_id?: string;
  account_id?: string;
  org_id?: string; // "personal" for local-user mode
}

function personalParams(id: PersonalIdentity): Record<string, string> {
  if (id.seat_id) return { seat_id: id.seat_id };
  if (id.org_id === 'personal') return { org_id: 'personal' };
  if (id.account_id) return { account_id: id.account_id };
  return {};
}

// --- API ---

export const usageApi = {
  // ── Personal page ──

  /**
   * Daily total tokens / request count. Powers `/user/cost` whole-vault
   * trend AND `/user/apps/<slug>` per-app trend.
   *
   * `appSlug` (Phase 4 Connected Apps Stage B, v1.0.0-rc.5): when set,
   * the server narrows the aggregate to `usage_fact_dwd.app_slug = ?`.
   * Omit / pass empty for whole-vault view (existing /user/cost
   * behaviour, unchanged).
   */
  personalTimeline: async (id: PersonalIdentity, startDate?: string, endDate?: string, appSlug?: string): Promise<TimelinePoint[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const params: Record<string, string> = { ...personalParams(id), ...range, tz: browserTZ() };
    if (appSlug) params.app_slug = appSlug;
    const res = await httpClient.get<TimelinePoint[]>('/v1/usage/personal/timeline', { params });
    return res.data;
  },

  personalHourly: async (id: PersonalIdentity, date?: string): Promise<HourlyPoint[]> => {
    const params: Record<string, string> = { ...personalParams(id), tz: browserTZ() };
    if (date) params.date = date;
    const res = await httpClient.get<HourlyPoint[]>('/v1/usage/personal/hourly', { params });
    return res.data;
  },

  personalByProtocolTimeline: async (id: PersonalIdentity, startDate?: string, endDate?: string): Promise<ProtocolTimelinePoint[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<ProtocolTimelinePoint[]>('/v1/usage/personal/by-protocol/timeline', {
      params: { ...personalParams(id), ...range, tz: browserTZ() },
    });
    return res.data;
  },

  personalByProtocolTotal: async (id: PersonalIdentity, startDate?: string, endDate?: string): Promise<ProtocolTotal[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<ProtocolTotal[]>('/v1/usage/personal/by-protocol/total', {
      params: { ...personalParams(id), ...range, tz: browserTZ() },
    });
    return res.data;
  },

  personalByKeyTotal: async (id: PersonalIdentity, startDate?: string, endDate?: string, sessionId?: string): Promise<KeyTotal[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const params: Record<string, string> = { ...personalParams(id), ...range, tz: browserTZ() };
    if (sessionId) params.session_id = sessionId;
    const res = await httpClient.get<KeyTotal[]>('/v1/usage/personal/by-key/total', { params });
    return res.data;
  },

  /**
   * 2026-05-25 — "Usage By App" ranking. Server returns rows grouped by
   * (app_slug, provider_code); see `AppTotal` for the two row shapes.
   * Sorted by `total_tokens DESC` server-side; client just renders in
   * order (and may slice to top N for display).
   */
  personalByAppTotal: async (id: PersonalIdentity, startDate?: string, endDate?: string): Promise<AppTotal[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<AppTotal[]>('/v1/usage/personal/by-app/total', {
      params: { ...personalParams(id), ...range, tz: browserTZ() },
    });
    return res.data;
  },

  /**
   * Per-model usage rows for `/user/performance`'s "Usage by model"
   * chart AND `/user/apps/<slug>` per-app model breakdown.
   * Server sorts by total_tokens DESC and caps at 20 rows.
   *
   * `appSlug` — see `personalTimeline` doc; same semantics.
   */
  personalByModelTotal: async (id: PersonalIdentity, startDate?: string, endDate?: string, appSlug?: string, sessionId?: string): Promise<ModelTotal[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const params: Record<string, string> = { ...personalParams(id), ...range, tz: browserTZ() };
    if (appSlug) params.app_slug = appSlug;
    if (sessionId) params.session_id = sessionId;
    const res = await httpClient.get<ModelTotal[]>('/v1/usage/personal/by-model/total', { params });
    return res.data;
  },

  /**
   * 2026-05-26 — "Top N sessions" ranking on /user/performance.
   * Server groups by session_id (NULL/'' coalesced into one "no session"
   * bucket), sorts by total_tokens DESC, caps at `limit` (default 10).
   *
   * Note: this endpoint deliberately IGNORES any session_id filter —
   * selecting a session in the UI shouldn't shrink the ranking to one
   * row (see design doc §5.3 for the rationale).
   */
  personalBySessionTotal: async (id: PersonalIdentity, startDate?: string, endDate?: string, limit?: number): Promise<SessionTotal[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const params: Record<string, string> = { ...personalParams(id), ...range, tz: browserTZ() };
    if (limit) params.limit = String(limit);
    const res = await httpClient.get<SessionTotal[]>('/v1/usage/personal/by-session/total', { params });
    return res.data;
  },

  /** Phase 3B R23: most recent N non-canary requests for the Overview
   *  "Recent Requests" card. Default 5, max 50 (server caps). No date
   *  window — "recent" always means newest regardless of the chart
   *  range the user is currently viewing. */
  personalRecent: async (id: PersonalIdentity, limit = 5): Promise<RecentRequest[]> => {
    const res = await httpClient.get<{ requests: RecentRequest[] }>(
      '/v1/usage/personal/recent',
      { params: { ...personalParams(id), limit: String(limit) } },
    );
    return res.data.requests ?? [];
  },

  // ── Master page methods (masterTimeline, masterByProtocolTotal,
  //    masterUserRanking) live in master/web; user/web is user-only. ──
};
