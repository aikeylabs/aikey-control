/**
 * User – Key delivery endpoints
 * GET  /accounts/me/pending-keys
 * GET  /accounts/me/all-keys
 * GET  /virtual-keys/:virtualKeyID/delivery   (CLI only — returns plaintext keys)
 * GET  /virtual-keys/:virtualKeyID/summary    (Web console — metadata only, no keys)
 * POST /virtual-keys/:virtualKeyID/claim
 */
import { httpClient } from '../http-client';
import { runtimeConfig } from '@/app/config/runtime';
import type { BindingAxis } from '@/shared/types/team-vault';
export { routedGroupAccount } from './routed-group-account';

// 2026-07-03 composing gateway: vault-bridge base resolution — see
// RuntimeConfig.vaultBridgeApiBase for the four-quadrant table.
const ME_BRIDGE_BASE: string = runtimeConfig.vaultBridgeApiBase ?? '/accounts/me';


export interface PendingKeyDTO {
  virtual_key_id: string;
  org_id: string;
  seat_id: string;
  alias: string;
  provider_code: string;
  share_status: string;
  expires_at?: string;
}

// One (metric, period) quota row for a key's seat: current-period used + limit.
export interface SeatQuotaItem {
  metric: string; // "usd" | "tokens"
  period: string; // "monthly" | "daily"
  used: number;
  limit: number;
}

/**
 * A candidate pool account behind a oauth-group VK (master snapshot projection —
 * the SAME shape the local vault gets, single source of truth). `assigned` is
 * master's static rank-0 default pick; the proxy's live selection (cooled-account
 * fallback) is a later stage.
 */
export interface GroupAccountRef {
  account_id: string;
  identity: string; // email / alias for display
  provider_code: string;
  priority: number;
  assigned: boolean; // master-assigned default (static rank-0 / engine ledger pick)
  // current_routed (C2): the account the proxy is ACTUALLY routing this seat to now
  // (engine override ?? rank-0), stamped by the proxy's live 60s rail onto the local
  // vault. Fresher + more authoritative than `assigned` (a key-sync snapshot copy).
  // Absent on the master-snapshot shape (no proxy rail there) → fall back to assigned.
  current_routed?: boolean;
  credential_type?: string; // 'api_key' | 'oauth_account' — drawer labels KEY vs OAuth
  credential_id?: string;
  login_status?: 'logged_in' | 'needs_login' | 'auth_failed' | 'revoked' | string;
  // Local proxy cooldown projection. These fields explain the same skip-set
  // that determines current_routed; they never drive routing in the browser.
  route_status?: 'window_exhausted' | 'window_protected' | 'rate_limited' | 'auth_failed' | 'upstream_unavailable' | string;
  route_retry_at?: number; // unix seconds
  // Provider quota observations delivered through the existing group-runtime
  // rail. Fractions are 0..1. Absent means unknown — never treat it as 0%.
  util_5h?: number;
  util_7d?: number;
  util_observed_at?: number; // unix seconds
  window_max_util_pct?: number;
  window_status?: string;
  window_reset_at?: number;
  window_7d_max_util_pct?: number;
  window_7d_status?: string;
  window_7d_reset_at?: number;
}

export interface UserKeyDTO {
  virtual_key_id: string;
  org_id: string;
  seat_id: string;
  alias: string;
  provider_code: string;
  // protocol_type (2026-07-03): the VK's binding-derived protocol — the STABLE protocol
  // source for a group VK (whose provider_code is always empty). Used as the protocol
  // fallback so an orphaned group VK (seat unbound from group → group_accounts empty)
  // still shows its protocol instead of "unknown". Absent on older servers.
  protocol_type?: string;
  // Canonical two-axis read model. `protocol` and `provider` are independent;
  // user pages render them directly and never infer one from the other.
  bindings?: BindingAxis[];
  // Provider-axis compatibility list. It does NOT describe protocol lanes;
  // bindings[].protocol is the only multi-protocol display source.
  supported_providers?: string[];
  key_status: string;
  share_status: string;
  expires_at?: string;
  // Seat-level quota (one entry per rule) for the usage/limit bar. Absent when the
  // seat has no quota or the server edition doesn't wire quota.
  seat_quota?: SeatQuotaItem[];
  // oauth_group projection (Stage A): when this VK targets a oauth_group, the shared
  // group + candidate pool accounts. Absent for direct-bind VKs. Same source as
  // the vault page (master snapshot.GroupAccounts).
  oauth_group_id?: string;
  group_accounts?: GroupAccountRef[];
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
  // 2026-07-03 shape-typed delivery family: which kind of VK this is.
  //   'direct'      — credential-backed slots below.
  //   'oauth_group' — pool VK: slots stay empty here; the pool panel (group_accounts)
  //                   is the routing view. oauth_group_id identifies the group.
  //   'none'        — no bindings configured yet (benign — NOT an error; the old
  //                   contract 503'd this normal state).
  // Absent on pre-2026-07 servers → treat as legacy (undifferentiated empty slots).
  binding_mode?: 'direct' | 'oauth_group' | 'none';
  oauth_group_id?: string;
  slots: SummarySlotDTO[];
}

export const deliveryApi = {
  pendingKeys: async (): Promise<PendingKeyDTO[]> => {
    const res = await httpClient.get<{ pending_keys: PendingKeyDTO[] }>(`${ME_BRIDGE_BASE}/pending-keys`);
    return res.data.pending_keys ?? [];
  },

  allKeys: async (): Promise<UserKeyDTO[]> => {
    const res = await httpClient.get<{ keys: UserKeyDTO[] }>(`${ME_BRIDGE_BASE}/all-keys`);
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
