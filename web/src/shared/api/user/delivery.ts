/**
 * User – Key delivery endpoints
 * GET  /accounts/me/pending-keys
 * GET  /accounts/me/all-keys
 * GET  /virtual-keys/:virtualKeyID/delivery   (CLI only — returns plaintext keys)
 * GET  /virtual-keys/:virtualKeyID/summary    (Web console — metadata only, no keys)
 * POST /virtual-keys/:virtualKeyID/claim
 */
import { httpClient } from '../http-client';

export interface PendingKeyDTO {
  virtual_key_id: string;
  org_id: string;
  seat_id: string;
  alias: string;
  provider_code: string;
  share_status: string;
  expires_at?: string;
}

export interface UserKeyDTO {
  virtual_key_id: string;
  org_id: string;
  seat_id: string;
  alias: string;
  provider_code: string;
  key_status: string;
  share_status: string;
  expires_at?: string;
}

// One fallback candidate within a protocol slot.
// Targets are ordered by priority ASC; CLI/proxy tries them in order.
export interface BindingTargetDTO {
  binding_id: string;
  provider_id: string;
  provider_code: string;
  base_url: string;
  provider_key: string; // plaintext real API key — TLS-protected; store encrypted locally
  credential_id: string;
  credential_revision: string;
  priority: number;
  fallback_role: string; // "primary" | "fallback"
}

// One protocol lane with one or more fallback targets.
export interface ProtocolSlotDTO {
  protocol_type: string;
  binding_targets: BindingTargetDTO[];
}

export interface DeliveryDTO {
  virtual_key_id: string;
  org_id: string;
  seat_id: string;
  alias: string;
  current_revision: string;
  key_status: string;
  share_status: string;
  expires_at?: string;
  // Grouped by protocol_type; targets ordered by priority ASC.
  // CLI selects the slot matching the desired protocol, then tries targets in order.
  slots: ProtocolSlotDTO[];
}

// Summary target — same as BindingTargetDTO but without provider_key.
// Used by the Web console to show binding metadata without exposing secrets.
export interface SummaryTargetDTO {
  binding_id: string;
  provider_id: string;
  provider_code: string;
  base_url: string;
  priority: number;
  fallback_role: string;
}

export interface SummarySlotDTO {
  protocol_type: string;
  targets: SummaryTargetDTO[];
}

export interface KeySummaryDTO {
  virtual_key_id: string;
  org_id: string;
  seat_id: string;
  alias: string;
  current_revision: string;
  key_status: string;
  share_status: string;
  expires_at?: string;
  slots: SummarySlotDTO[];
}

export const deliveryApi = {
  pendingKeys: async (): Promise<PendingKeyDTO[]> => {
    const res = await httpClient.get<{ pending_keys: PendingKeyDTO[] }>('/accounts/me/pending-keys');
    return res.data.pending_keys ?? [];
  },

  allKeys: async (): Promise<UserKeyDTO[]> => {
    const res = await httpClient.get<{ keys: UserKeyDTO[] }>('/accounts/me/all-keys');
    return res.data.keys ?? [];
  },

  getDelivery: async (virtualKeyId: string): Promise<DeliveryDTO> => {
    const res = await httpClient.get<DeliveryDTO>(`/virtual-keys/${virtualKeyId}/delivery`);
    return res.data;
  },

  /** Summary endpoint for Web console — returns metadata only, no plaintext keys. */
  getSummary: async (virtualKeyId: string): Promise<KeySummaryDTO> => {
    const res = await httpClient.get<KeySummaryDTO>(`/virtual-keys/${virtualKeyId}/summary`);
    return res.data;
  },

  claimKey: async (virtualKeyId: string): Promise<{ share_status: string }> => {
    const res = await httpClient.post<{ share_status: string }>(`/virtual-keys/${virtualKeyId}/claim`);
    return res.data;
  },
};
