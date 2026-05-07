/**
 * Cross-edition org/seat types.
 * Used by both master console and user-facing adapters.
 * OrgDTO stays here even though only master pages currently consume it,
 * so the type lives in a neutral location for future user-side use cases.
 */

export interface OrgDTO {
  org_id: string;
  name: string;
  status: string;
  created_at: string;
}

export interface SeatDTO {
  seat_id: string;
  org_id: string;
  account_id: string;
  invited_email: string;
  seat_status: string;
  claimed_at?: string;
  created_at: string;
}
