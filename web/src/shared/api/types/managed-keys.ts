/**
 * Cross-edition managed-key types.
 * Used by both master console and user-facing adapters.
 * Why: keep type contracts neutral so the user repo (post-split)
 * does not need to import from master/.
 */

export interface VirtualKeyDTO {
  virtual_key_id: string;
  org_id: string;
  seat_id: string;
  alias: string;
  key_status: string;
  share_status: string;
  current_revision: string;
  expires_at?: string;
  updated_at: string;
}
