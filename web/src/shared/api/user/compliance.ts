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
  /** Local-only un-redacted matched text + surrounding context (self-view).
   *  Only the local store carries this; the master/team path stays redacted. */
  context_snippet?: string;
}

export interface ComplianceEventDTO {
  event_id: string;
  created_at: string;     // RFC3339
  user_id?: string;
  target_model?: string;
  scenario?: string;
  prompt_length: number;
  action_taken: string;   // allow | mask | block | warn
  detect_latency_ms?: number;  // detection step's own time (ms), self-view only
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

/** One built-in (embedded baseline) pack effective in the detector. */
export interface BuiltInPackDTO {
  name: string;
  kind: string; // "built-in"
}

/** One server-distributed pack pulled from master, effective in the detector. */
export interface PulledPackDTO {
  pack_id: string;
  name: string;
  version: number;
  status: string; // active | audit_only | ...
  kind: string; // pack_kind, e.g. "tenant-custom"
  rule_count: number;
  phrase_count: number;
}

/** One built-in NLP engine (CRF NER / semantic-recall classifier) effective in
 *  the detector — runs alongside the YAML packs but is not a pack. */
export interface BuiltInEngineDTO {
  name: string; // "ner.char" | "ner.token" | "recall.semantic"
  kind: string; // "ner-crf" | "semantic-classifier"
  entities: string[];
  loaded: boolean;
  note?: string;
}

export interface EffectivePacksReport {
  built_in: BuiltInPackDTO[];
  engines: BuiltInEngineDTO[];
  pulled: PulledPackDTO[];
  cursor: number;
}

/** GET /api/user/compliance/packs envelope. available=false when no compliance
 *  filter is running (compliance off / offline / proxy unreachable). */
export interface EffectivePacksResponse {
  available: boolean;
  report?: EffectivePacksReport;
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

  /**
   * Currently-effective compliance packs in the LIVE detector on this machine:
   * built-in baseline + server-distributed (pulled from master). Relayed by
   * local-server → aikey-proxy → detector IPC. Same source the engine uses.
   */
  getEffectivePacks: (): Promise<EffectivePacksResponse> =>
    httpClient
      .get<EffectivePacksResponse>('/api/user/compliance/packs')
      .then((r) => r.data),
};
