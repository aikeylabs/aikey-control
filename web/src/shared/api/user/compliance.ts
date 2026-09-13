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
  /**
   * The numbered placeholder this finding's value was ACTUALLY forwarded to the
   * model as (`{{PHONE_1}}`), where `redacted_snippet` shows the detector's
   * numberless form (`{{PHONE}}`). Two views of one finding: the snippet is what
   * the DETECTOR saw, this is the name the value went out under. Stamped by the
   * proxy at forward time — numbering is request-scoped, so only the proxy can
   * know it (方案 L «结果回填», update doc 20260810 §16.3).
   *
   * 🔴 ABSENT IS NORMAL, NOT A GAP — never render it as a warning:
   *   - PERSONAL lane: absent ALWAYS. Local-lane events are uploaded by the
   *     detector straight into control.db and never pass through the proxy, so
   *     there is nothing to back-fill and no version of anything changes that.
   *     The self-view answers "which of my values was it?" with the eye instead.
   *   - TEAM lane (master's /user/compliance wrapper injects a superset DTO that
   *     carries this field): absent means the value did NOT go out under a
   *     placeholder of its own — audit-only finding, ceiling-capped piece,
   *     restore degrade path, or an older proxy.
   * Declared here because the shared page reads it for whichever source is
   * injected; `redacted_snippet` deliberately stays unchanged either way.
   */
  wire_label?: string;
  /**
   * The classification grade the matching leaf stamped on THIS hit —
   * `local_compliance_findings.level` / `compliance_findings.level`.
   *
   * 🔴 Absent is a real state, not a zero. A hit that maps to no classification
   * leaf carries NO grade (spec: R-compliance-grading-1.S2); rendering 0 would
   * file it as the least-sensitive content. Same rule as `max_level` below.
   */
  level?: number | null;
  /**
   * The classification leaf that stamped `level`, e.g.
   * `公司信息/研发/项目代号`. Same field name and meaning on the local and the
   * master store (2026-09-11 决策点 41 = A), so the member self-view and the org
   * audit page can be read side by side.
   *
   * 🔴 It does NOT replace `category`: the category is what the detection
   * channel matched, this is where the content is filed
   * (spec: R-compliance-grading-23.S1).
   */
  leaf_path?: string;
}

/**
 * The REQUEST-level escalation conclusion — why the whole request was stopped,
 * as opposed to what each individual hit was.
 *
 * Present ONLY on a `scenario: "request_verdict"` event; every content-hit event
 * omits it. Field set fixed by DEC-compliance-grading-14 and mirrored byte for
 * byte across aikey-proxy, aikey-control-master and the local lane, so the same
 * payload decodes identically wherever it is read.
 */
export interface ComplianceEscalationDTO {
  /** The escalation rule that fired, e.g. a cumulative-level threshold. */
  rule: string;
  /** How many pieces were counted toward that rule. */
  counted: number;
  /** Event ids of the content hits that were counted — the link from a verdict
   *  to its evidence. Ids only: no hash, no fingerprint, no snippet. */
  unit_ids: string[];
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
  /**
   * Highest sensitivity grade (敏感等级) among this event's findings —
   * `compliance_events.max_level`, wire name taken verbatim from the master
   * DTO (aikey-control-master service/internal/compliance/handler.go).
   *
   * 🔴 OPTIONAL, and absent is a real state, not a zero: a detector older than
   * the grading release reports no grade, and master's intake also drops a
   * level the org's `labels` document does not define. The console renders
   * NOTHING for absent rather than a plausible default — see
   * shared/compliance/level-badge.tsx (spec: R-compliance-grading-7.S1).
   */
  max_level?: number | null;
  /**
   * Why the WHOLE request was stopped. Absent on content-hit events and on
   * anything a pre-grading detector wrote.
   *
   * 🔴 Without rendering this, the self-view shows three `mask` hits plus one
   * unexplained `block`, and the one question a member opens this page to answer
   * —「我这条请求为什么被拦」— is exactly the one that got dropped
   * (spec: R-compliance-grading-23.S1; task 1.16 plumbed it to the DTO, 5.1
   * renders it).
   */
  escalation?: ComplianceEscalationDTO | null;
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
  /** Stored finding entity type (CN_ADDRESS / CN_PHONE / …), EXACT match —
   *  distinct from `category`, which the local lane treats as a three-column
   *  fuzzy search. See shared/compliance/entity-types.ts for the labelling. */
  entity_type?: string;
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
  /**
   * Runtime wiring state of this engine in the detector that produced the
   * report — ABSENT when the serving backend cannot see it (2026-08-14, D8).
   *
   * Present on the Personal lane (the live local detector answers for itself).
   * Absent on the team lane: master mirrors the detector's shipped assembly but
   * has no view of any node's runtime, and one org has N enforcing nodes.
   *
   * 🔴 Never coerce the absent case to `false` — that renders running engines as
   * 未启用. Route it through `engineLoadBadge()` in
   * pages/user/compliance/engine-load-state.ts, which is the only place allowed
   * to decide what absence means.
   */
  loaded?: boolean;
  note?: string;
}

export interface EffectivePacksReport {
  built_in: BuiltInPackDTO[];
  engines: BuiltInEngineDTO[];
  pulled: PulledPackDTO[];
  cursor: number;
  /** Effective runtime action-policy state on the ENFORCING node. The local
   *  lane relays it verbatim from the proxy admin endpoint; the team mirror
   *  serves identity-only packs and omits it (one org has N enforcing nodes),
   *  so every reader must guard on absence. `lane_grade_ceilings` carries the
   *  password-lane level as `password.credential_password.tier_inferred`:
   *  "audit" = Basic (simple), "mask" = Advanced (阶段8/合规密码档分级 R6). */
  action_policy?: { lane_grade_ceilings?: Record<string, string> };
}

export interface FilterLatencyLaneDTO {
  count: number;
  window_samples: number;
  p50_ms: number;
  p95_ms: number;
  under_15ms_percent: number;
}

export interface FilterPerformanceDTO {
  window_size: number;
  samples_started_at?: string;
  last_observed_at?: string;
  incremental: FilterLatencyLaneDTO;
  cold: FilterLatencyLaneDTO;
}

/** GET /api/user/compliance/packs envelope. available=false when no compliance
 *  filter is running (compliance off / offline / proxy unreachable). */
export interface EffectivePacksResponse {
  available: boolean;
  report?: EffectivePacksReport;
  /** Content-free rolling latency evidence from the active Proxy generation. */
  performance?: FilterPerformanceDTO;
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
