/**
 * User – Account endpoints
 * POST /accounts/register
 * POST /accounts/login
 * GET  /accounts/me
 * GET  /accounts/me/seats
 */
import { httpClient } from '../http-client';
import { runtimeConfig } from '@/app/config/runtime';

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

  // Online agents this member owns (alpha.5). Team-plane API reached via the
  // vault-bridge on the Personal web (same dual-homed path as mySeats).
  myAgents: async (): Promise<MyAgentDTO[]> => {
    const res = await httpClient.get<{ agents: MyAgentDTO[] }>(`${ME_BRIDGE_BASE}/agents`);
    return res.data.agents ?? [];
  },

  createAgent: async (body: { alias: string; provider_code?: string; oauth_group_id?: string }): Promise<MyAgentDTO> => {
    const res = await httpClient.post<MyAgentDTO>(`${ME_BRIDGE_BASE}/agents`, body);
    return res.data;
  },

  deleteAgent: async (seatId: string): Promise<void> => {
    await httpClient.delete(`${ME_BRIDGE_BASE}/agents/${seatId}`);
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
