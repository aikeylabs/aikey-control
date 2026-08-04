/**
 * User – Account endpoints
 * POST /accounts/register
 * POST /accounts/login
 * GET  /accounts/me
 * GET  /accounts/me/seats
 */
import { httpClient } from '../http-client';
import { runtimeConfig } from '@/app/config/runtime';
import {
  teamGetJSON,
  teamPostJSON,
  teamDeleteJSON,
  isTeamFetchError,
  isTeamWriteError,
} from '../team/team-fetch';

// 2026-07-03 composing gateway: vault-bridge base — dual-homed family #3
// (see RuntimeConfig.vaultBridgeApiBase). The plain /accounts/me IDENTITY
// endpoint deliberately keeps its path (team identity when logged in).
const ME_BRIDGE_BASE: string = runtimeConfig.vaultBridgeApiBase ?? '/accounts/me';

import type { AccountDTO, LoginResponse } from '../types/account';
import type { GroupAccountRef } from './delivery';

export interface RegisterRequest {
  email: string;
  password: string;
}

// Derived credential source of an agent's VK (never stored server-side; the
// backend projects it from the VK binding). `type` is polymorphic — this phase
// always 'oauth_group'; 'api_key' is a designed evolution the UI already renders.
export interface AgentSourceDTO {
  type: string; // 'oauth_group' | 'api_key'
  oauth_group_id?: string;
  name?: string;
  provider_code?: string;
  protocol_type?: string;
  owner_pool: boolean; // true = my own agent pool, false = a company pool
}

export type AgentRoutingState =
  | 'bound'
  | 'binding_pending'
  | 'unbound'
  | 'binding_stale'
  | 'source_unavailable'
  | 'unavailable';

export interface AgentRoutingSummaryDTO {
  state: AgentRoutingState;
  account_id?: string;
  identity?: string;
  binding_updated_at?: number;
}

export interface AgentPoolStatusDTO {
  agent_seat_id: string;
  source: AgentSourceDTO;
  binding: AgentRoutingSummaryDTO;
  accounts: GroupAccountRef[];
  accounts_state: 'available' | 'unavailable';
  runtime: {
    state: 'available' | 'not_reported' | 'unavailable';
    node_id?: string;
    node_liveness?: string;
    updated_at?: number;
    total_accounts: number;
    schedulable_accounts: number;
    earliest_retry_at?: number;
  };
}

export interface AgentLastServedStatusDTO {
  agent_seat_id: string;
  state: 'available' | 'no_data' | 'unavailable';
  last_served?: {
    account_id: string;
    identity?: string;
    request_at_ms: number;
    request_status?: string;
  };
}

// One online agent (GET /accounts/me/agents). The connection fields
// (base_url / vk / *_blocked / vk_pending) are populated ONLY on the CREATE /
// get-VK response — vk is the plaintext returned once at issue time (hash-only
// storage; never recoverable later). On the list they are absent EXCEPT vk_hint.
export interface MyAgentDTO {
  seat_id: string;
  owner_seat_id?: string;
  alias: string;
  status: string;
  source: AgentSourceDTO;
  created_at: string;
  base_url?: string;
  base_url_blocked?: boolean;
  vk?: string;
  vk_pending?: boolean;
  /** 2026-07-18 (additive): VK exists but the pool has ZERO enabled accounts —
   * calls would 503; the reveal warns alongside the token. */
  pool_empty?: boolean;
  /** Availability is independent from seat status. `ready` requires every
   * enabled pool account to have usable runtime material for the parent seat;
   * `no_login` means none do; `degraded` means partial/unknown/disabled. */
  pool_readiness: 'ready' | 'no_login' | 'degraded';
  pool_accounts_total: number;
  pool_accounts_ready: number;
  pool_readiness_reason?: string;
  /** 2026-07-19 (additive, reuse-first): MASKED head+tail of the agent's active
   * VK (e.g. "aikey_team_oauth_1a2b3c••••7f8g"). Carried on the LIST so a member
   * can IDENTIFY which VK an agent holds WITHOUT rotating it. Empty when no VK
   * yet, or when the VK predates hints (issued before v1.0.1-alpha.5) — rotate to
   * populate. Never the plaintext (unrecoverable). */
  vk_hint?: string;
  /** Lightweight allocation-ledger projection for the list. This is the
   * public Ingress binding, not the local Vault/proxy current_routed state. */
  routing_summary?: AgentRoutingSummaryDTO;
}

// Matches OrgSeat JSON from backend: seat_id, org_id, invited_email, seat_status, etc.
export interface SeatSummaryDTO {
  seat_id: string;
  org_id: string;
  invited_email: string;
  seat_status: string;
  /** Renamable display name — the single source of truth for a person's name on
   * the web (requirements 2026-07-10-member-sso-login R19). Filled from the
   * provider's display name on every SSO login. It is what the console shows
   * instead of `invited_email` when that address is a synthetic handle. */
  alias?: string;
  claimed_at?: string;
  created_at: string;
}

export const userAccountsApi = {
  register: async (req: RegisterRequest): Promise<LoginResponse> => {
    const res = await httpClient.post<LoginResponse>('/accounts/register', req);
    return res.data;
  },

  login: async (req: { email: string; password: string }): Promise<LoginResponse> => {
    const res = await httpClient.post<LoginResponse>('/accounts/login', req);
    return res.data;
  },

  me: async (): Promise<AccountDTO> => {
    const res = await httpClient.get<AccountDTO>('/accounts/me');
    return res.data;
  },

  /**
   * Seats via the PLAIN path, for resolving the member's display name.
   *
   * 🔴 Why not mySeats(): that one goes through ME_BRIDGE_BASE, which on a
   * personal box is the local vault-bridge and answers `[]` — so the alias, and
   * with it the member's name, is invisible there. `/accounts/me/seats` is
   * forwarded to the team server on that box and is same-origin on the team
   * console, so it carries the alias on every edition. Using the bridge for
   * identity is what left the console calling a signed-in member "member".
   */
  mySeatsForIdentity: async (): Promise<SeatSummaryDTO[]> => {
    const res = await httpClient.get<SeatSummaryDTO[]>('/accounts/me/seats');
    return res.data ?? [];
  },

  mySeats: async (): Promise<SeatSummaryDTO[]> => {
    const res = await httpClient.get<SeatSummaryDTO[]>(`${ME_BRIDGE_BASE}/seats`);
    return res.data;
  },

  // Online agents this member owns (alpha.5). Agents are TEAM-PLANE entities
  // (seat principals in the org, created on the master), so they are fetched
  // BROWSER→MASTER via team-fetch (/system/team-url + /system/team-jwt →
  // {teamUrl}/accounts/me/agents), NOT the local vault-bridge — the Personal
  // local-server serves /accounts/me/* as empty compatibility stubs and has no
  // agents domain (2026-07-16 fix: P4 wired these to the vault-bridge by mistake,
  // yielding a 404 on the standalone Personal web).
  myAgents: async (): Promise<MyAgentDTO[]> => {
    const res = await teamGetJSON<{ agents: MyAgentDTO[] }>('/accounts/me/agents');
    if (isTeamFetchError(res)) {
      // Missing team auth is not a truthful empty list: the server has not said
      // there are zero agents. Throw every failure class so the page renders its
      // explicit retry/error state instead of hiding agents behind "empty".
      throw new Error(`agents unavailable: ${res.kind}`);
    }
    return res.agents ?? [];
  },

  agentPoolStatus: async (seatId: string): Promise<AgentPoolStatusDTO> => {
    const res = await teamGetJSON<AgentPoolStatusDTO>(`/accounts/me/agents/${seatId}/pool-status`);
    if (isTeamFetchError(res)) throw new Error(`agent pool status unavailable: ${res.kind}`);
    return res;
  },

  agentLastRoute: async (seatId: string): Promise<AgentLastServedStatusDTO> => {
    const res = await teamGetJSON<AgentLastServedStatusDTO>(`/accounts/me/agents/${seatId}/last-route`);
    if (isTeamFetchError(res)) throw new Error(`agent last route unavailable: ${res.kind}`);
    return res;
  },

  createAgent: async (body: { alias: string; provider_code?: string; oauth_group_id?: string }): Promise<MyAgentDTO> => {
    const res = await teamPostJSON<MyAgentDTO>('/accounts/me/agents', body);
    if (isTeamWriteError(res)) throw new Error(res.message);
    if (isTeamFetchError(res)) throw new Error(`create agent failed: ${res.kind}`);
    return res;
  },

  deleteAgent: async (seatId: string): Promise<void> => {
    const res = await teamDeleteJSON(`/accounts/me/agents/${seatId}`);
    if (isTeamWriteError(res)) throw new Error(res.message);
    if (isTeamFetchError(res)) throw new Error(`delete agent failed: ${res.kind}`);
  },

  // setAgentStatus — REVERSIBLE pause/resume (2026-07-31 fix). "suspend" parks an
  // agent, "resume" brings it back.
  //
  // 🔴 Why this is NOT deleteAgent: the row's "停用" button used to call DELETE,
  // which revokes TERMINALLY — the member had no way back and no warning that the
  // word "停用" meant "吊销". Suspend/resume moves only `seat_status`; the agent's
  // team OAuth VK row stays active, so resuming restores the SAME key the member
  // already pasted into their third-party agent (no re-mint, no re-keying). Both
  // enforcement points — the ingress resolve and the key-delivery projection —
  // gate on seat status alone, which is what makes that true.
  setAgentStatus: async (seatId: string, action: 'suspend' | 'resume'): Promise<void> => {
    const res = await teamPostJSON<{ status: string }>(`/accounts/me/agents/${seatId}/status`, { action });
    if (isTeamWriteError(res)) throw new Error(res.message);
    if (isTeamFetchError(res)) throw new Error(`${action} agent failed: ${res.kind}`);
  },

  // getAgentVK — NON-destructive "get VK" (reuse-first, 2026-07-19). First-issues
  // the VK when the agent has none yet (returns the plaintext once); if a VK
  // already exists it is a no-op that reveals NOTHING new (returns vk_hint only, no
  // vk), so checking a VK can never invalidate the one already configured in a
  // third-party agent. Same Agent shape as create. vk_pending when the pool still
  // has no enabled account.
  getAgentVK: async (seatId: string): Promise<MyAgentDTO> => {
    const res = await teamPostJSON<MyAgentDTO>(`/accounts/me/agents/${seatId}/vk`, { action: 'ensure' });
    if (isTeamWriteError(res)) throw new Error(res.message);
    if (isTeamFetchError(res)) throw new Error(`get agent VK failed: ${res.kind}`);
    return res;
  },

  // rotateAgentVK — EXPLICIT, DESTRUCTIVE re-mint. Invalidates the current VK and
  // returns a NEW plaintext ONCE. The DB is hash-only, so rotation is the only way
  // to reveal a usable VK again once the original is lost/leaked. The UI gates this
  // behind a confirmation because any agent using the old key must be re-keyed.
  rotateAgentVK: async (seatId: string): Promise<MyAgentDTO> => {
    const res = await teamPostJSON<MyAgentDTO>(`/accounts/me/agents/${seatId}/vk`, { action: 'rotate' });
    if (isTeamWriteError(res)) throw new Error(res.message);
    if (isTeamFetchError(res)) throw new Error(`rotate agent VK failed: ${res.kind}`);
    return res;
  },

  myReferrals: async (): Promise<ReferralDTO[]> => {
    const res = await httpClient.get<ReferralDTO[]>('/accounts/me/referrals');
    return res.data;
  },
};

export interface ReferralDTO {
  referral_id: string;
  referrer_account_id: string;
  referred_email: string;
  referred_account_id?: string;
  status: string; // pending | completed
  created_at: string;
  completed_at?: string;
}
