/**
 * Phase 3 (2026-06-02) — local compliance self-view API client.
 *
 * Mirrors the local-server handler at
 *   aikey-control/service/appkit/user-local/compliance_handlers.go
 * (GET /api/user/compliance/events), which reads the local data SQLite
 * (control.db) tables local_compliance_events + local_compliance_findings.
 *
 * Single-user / no tenant: this is the user's OWN view on their machine.
 * DC5: the server returns metadata + redacted snippet only — never the raw
 * prompt text. The response is a plain JSON object (NOT the {status,data}
 * envelope the vault endpoints use), so this client parses it directly.
 */
import { httpClient } from '../http-client';

export interface ComplianceFindingDTO {
  finding_id: string;
  rule_id?: string;
  category: string;
  entity_type: string;
  severity: string;       // critical | high | medium | low
  confidence: number;     // 0-100
  detector?: string;
  redacted_snippet?: string;
}

export interface ComplianceEventDTO {
  event_id: string;
  created_at: string;     // RFC3339
  user_id?: string;
  target_model?: string;
  scenario?: string;
  prompt_length: number;
  action_taken: string;   // allow | mask | block | warn
  findings: ComplianceFindingDTO[];
}

export interface ComplianceListResponse {
  events: ComplianceEventDTO[];
  total: number;
  limit: number;
  offset: number;
}

export interface ComplianceListQuery {
  severity?: string;
  category?: string;
  action?: string;
  from?: string;          // RFC3339
  to?: string;            // RFC3339
  limit?: number;
  offset?: number;
}

export const complianceApi = {
  /**
   * List the local user's own compliance events (newest first), with optional
   * severity / category / action / time-range filters + offset pagination.
   * Returns empty events + total=0 when nothing has been detected yet.
   */
  listEvents: (q: ComplianceListQuery): Promise<ComplianceListResponse> =>
    httpClient
      .get<ComplianceListResponse>('/api/user/compliance/events', { params: q })
      .then((r) => r.data),
};
