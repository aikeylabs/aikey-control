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

export interface KeyTotal {
  virtual_key_id: string;
  alias?: string;    // human-readable label (personal / team BYOK)
  identity?: string; // email / display_identity (OAuth sessions; added 2026-04-22)
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

export interface UserRanking {
  account_id: string;
  seat_id: string;
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

  personalTimeline: async (id: PersonalIdentity, startDate?: string, endDate?: string): Promise<TimelinePoint[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<TimelinePoint[]>('/v1/usage/personal/timeline', {
      params: { ...personalParams(id), ...range, tz: browserTZ() },
    });
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

  personalByKeyTotal: async (id: PersonalIdentity, startDate?: string, endDate?: string): Promise<KeyTotal[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<KeyTotal[]>('/v1/usage/personal/by-key/total', {
      params: { ...personalParams(id), ...range, tz: browserTZ() },
    });
    return res.data;
  },

  // ── Master page ──

  masterTimeline: async (orgId: string, startDate?: string, endDate?: string): Promise<TimelinePoint[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<TimelinePoint[]>('/v1/usage/master/timeline', {
      params: { org_id: orgId, ...range, tz: browserTZ() },
    });
    return res.data;
  },

  masterByProtocolTotal: async (orgId: string, startDate?: string, endDate?: string): Promise<ProtocolTotal[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<ProtocolTotal[]>('/v1/usage/master/by-protocol/total', {
      params: { org_id: orgId, ...range, tz: browserTZ() },
    });
    return res.data;
  },

  masterUserRanking: async (orgId: string, startDate?: string, endDate?: string, limit = 20): Promise<UserRanking[]> => {
    const range = startDate && endDate ? { start_date: startDate, end_date: endDate } : defaultRange();
    const res = await httpClient.get<UserRanking[]>('/v1/usage/master/ranking', {
      params: { org_id: orgId, ...range, limit, tz: browserTZ() },
    });
    return res.data;
  },
};
