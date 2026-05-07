/**
 * User – Account endpoints
 * POST /accounts/register
 * POST /accounts/login
 * GET  /accounts/me
 * GET  /accounts/me/seats
 */
import { httpClient } from '../http-client';
import type { AccountDTO, LoginResponse } from '../types/account';

export interface RegisterRequest {
  email: string;
  password: string;
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
    const res = await httpClient.get<SeatSummaryDTO[]>('/accounts/me/seats');
    return res.data;
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
