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
  owner_pool: boolean; // true = my own agent pool, false = a company pool
}

// One online agent (GET /accounts/me/agents). The connection fields
// (base_url / vk / *_blocked / vk_pending) are populated ONLY on the CREATE
// response — vk is the plaintext returned once at issue time (hash-only storage;
// never recoverable later). On the list they are absent.
export interface MyAgentDTO {
  seat_id: string;
  alias: string;
  status: string;
  source: AgentSourceDTO;
  created_at: string;
  base_url?: string;
  base_url_blocked?: boolean;
  vk?: string;
  vk_pending?: boolean;
}

// Matches OrgSeat JSON from backend: seat_id, org_id, invited_email, seat_status, etc.
export interface SeatSummaryDTO {
  seat_id: string;
  org_id: string;
  invited_email: string;
  seat_status: string;
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
      // No team session yet → no agents (empty, not an error). Real transport /
      // auth failures throw so the page shows its error state.
      if (res.kind === 'not-logged-in') return [];
      throw new Error(`agents unavailable: ${res.kind}`);
    }
    return res.agents ?? [];
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

  // Rotate / recover an agent's team OAuth VK — re-mints its token and returns the
  // NEW plaintext ONCE (base_url + vk, same shape as create). The recovery for a VK
  // whose plaintext was never captured at create (empty pool) or is lost; the DB is
  // hash-only, so rotation is the only way to reveal a usable VK again. vk_pending
  // when the pool still has no enabled account.
  rotateAgentVK: async (seatId: string): Promise<MyAgentDTO> => {
    const res = await teamPostJSON<MyAgentDTO>(`/accounts/me/agents/${seatId}/vk`, {});
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
