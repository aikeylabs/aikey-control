/**
 * Cross-edition account types.
 * Used by both master console and user-facing API clients.
 * Why: keep type contracts neutral so the user repo (post-split)
 * does not need to import from master/.
 */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AccountDTO {
  id: string;
  account_id: string; // backend returns account_id
  email: string;
  role: string;
  org_id?: string;
  created_at: string;
}

export interface LoginResponse {
  token: string;
  account: AccountDTO;
}
