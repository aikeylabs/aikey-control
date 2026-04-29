/**
 * Shared view model types used across the UI.
 */

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface DashboardOverviewVM {
  activeVirtualKeys: number | null;
  totalVirtualKeys: number | null;
  requests24h: number | null;
  requests24hDelta: number | null; // percent change
  cost24hUsd: number | null;
  cost24hDelta: number | null;
  activeProviders: number | null;
}

// ── Seats ──────────────────────────────────────────────────────────────────

export interface SeatListItemVM {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'suspended' | 'pending';
  createdAt: string;
}

// ── Virtual Keys ───────────────────────────────────────────────────────────

export interface VirtualKeyListItemVM {
  id: string;
  alias: string;
  prefix: string;
  status: 'active' | 'suspended' | 'revoked';
  createdAt: string;
  expiresAt?: string;
}

// ── Providers ──────────────────────────────────────────────────────────────

export interface ProviderListItemVM {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface CredentialListItemVM {
  id: string;
  alias: string;
  providerId: string;
  status: 'active' | 'rotated' | 'revoked';
  createdAt: string;
  lastRotatedAt?: string;
}

// ── Bindings ───────────────────────────────────────────────────────────────

export interface BindingListItemVM {
  id: string;
  alias: string;
  credentialId: string;
  status: string;
  createdAt: string;
}

// ── Control Events ─────────────────────────────────────────────────────────

export interface ControlEventListItemVM {
  id: string;
  eventType: string;
  subjectId: string;
  subjectType: string;
  actorId: string;
  reason: string;
  createdAt: string;
}
