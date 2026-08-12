package userlocal

// Phase 3 — local compliance self-view store (Personal/Trial).
//
// Two HTTP handlers backed by the local data SQLite (control.db), tables
// local_compliance_events + local_compliance_findings (rc.9 ComponentData
// migration). They mirror the master-side intake wire + audit-log read shape
// (aikey-control-master/service/internal/compliance/{handler.go,storage/audit.go})
// MINUS the tenant dimension — this is a single-user local store.
//
// DC5 「原文不出本机」 as it applies HERE: this store is on the user's own box
// (local-server binds 127.0.0.1), so it is the ONE place the un-redacted matched
// text is allowed to live. Each finding carries two snippets with different
// jobs: `redacted_snippet` (masked — what the self-view shows by default) and
// `context_snippet` (the raw matched text + context — revealed only when the
// user clicks the eye in the drawer), purged after localComplianceRetentionDays.
// The master/team store is the opposite: it has no context_snippet column and
// its intake wire refuses the field outright. Reinstated 2026-08-09 after the
// user reversed the 2026-06-03 "masked form only" decision — a masked
// ***CN_NAME*** cannot tell you which of your own values tripped a rule.
//
// Ingest (POST /v1/compliance/events) is a machine endpoint — the local
// detector POSTs to it. It is unauthenticated by design: the local-server
// binds 127.0.0.1 only (decision D2), so reachability IS the gate. Writes are
// idempotent (ON CONFLICT(event_id/finding_id) DO NOTHING) so a detector retry
// can't double-count.
//
// Read (GET /api/user/compliance/events) is a local_bypass browser endpoint
// drained by the /user/compliance page; serves metadata + BOTH snippets (the
// page decides which one is on screen — masked by default, raw behind the eye).

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// localComplianceRetentionDays bounds how long local compliance events are kept
// (user decision 2026-06-02: plaintext store + retention auto-purge). Enforced
// event-driven on each ingest — NOT a background cron (per the no-periodic-
// sweep convention). Configurable later if a UI/config knob is needed.
const localComplianceRetentionDays = 30

// ── Intake wire (mirrors master intakeEventWire MINUS tenant_id) ──────────

type complianceIntakeRequest struct {
	Events []complianceEventWire `json:"events"`
}

type complianceEventWire struct {
	EventID      string    `json:"event_id"`
	CreatedAt    time.Time `json:"created_at"`
	UserID       string    `json:"user_id,omitempty"`
	ProxyVersion string    `json:"proxy_version,omitempty"`
	TargetModel  string    `json:"target_model,omitempty"`
	Scenario     string    `json:"scenario,omitempty"`
	PromptLength int       `json:"prompt_length"`
	ActionTaken  string    `json:"action_taken"`
	PromptHash   string    `json:"prompt_hash,omitempty"`
	// DetectLatencyMs is the detection step's own wall-clock time (ms, float —
	// often sub-ms), shown in the self-view drawer. Stored in the events.metadata
	// JSON column (reuses the existing extension column — no schema change).
	// 0/absent → not stored/shown.
	DetectLatencyMs float64                 `json:"detect_latency_ms,omitempty"`
	Findings        []complianceFindingWire `json:"findings"`
}

type complianceFindingWire struct {
	FindingID       string `json:"finding_id"`
	RuleID          string `json:"rule_id,omitempty"`
	Category        string `json:"category"`
	EntityType      string `json:"entity_type"`
	Severity        string `json:"severity"`
	Confidence      int    `json:"confidence"`
	StartOffset     int    `json:"start_offset"`
	EndOffset       int    `json:"end_offset"`
	Detector        string `json:"detector,omitempty"`
	RedactedSnippet string `json:"redacted_snippet,omitempty"`
	// ContextSnippet is the LOCAL-ONLY un-redacted matched text + surrounding
	// context, shown in the /user/compliance self-view drawer. The detector
	// sends it ONLY when targeting the local ingest (localhost); the master
	// path never carries it (DC5). Stored plaintext in control.db (local).
	ContextSnippet string `json:"context_snippet,omitempty"`
}

type complianceIngestResponse struct {
	AcceptedIDs []string `json:"accepted_ids"`
}

// ── Wire-drift detection (lenient decode + loud WARN) ────────────────────
//
// WHY THIS EXISTS, AND WHY IT IS NOT `DisallowUnknownFields`
//
// The master/team ingest (aikey-control-master compliance/handler.go) decodes
// with DisallowUnknownFields and answers 400. That gate is a PRIVACY gate: the
// master's wire struct deliberately omits context_snippet, so the 400 is what
// makes it physically impossible for un-redacted local text to reach the
// master (DC5). This lane has the opposite requirement — the local self-view
// is exactly where the un-redacted text belongs (migration v1.0.0-rc.10 added
// local_compliance_findings.context_snippet for it) — so there is no privacy
// reason to copy the gate here.
//
// The reason NOT to copy it is stronger than "no reason to": the master's 400
// is SURVIVABLE and this lane's would be TERMINAL.
//   - Team lane: aikey-proxy ships the event (filter_dispatch.go) and on
//     failure writes it to dead_letter.jsonl, then auto-replays on recovery.
//     A 400 there conserves the event until the version skew is fixed.
//   - Local lane: the detector's own uploader posts to 127.0.0.1
//     (ai-compliance-detector internal/intake/uploader.go). On 4xx it returns
//     immediately — "retrying won't fix a contract bug" — and the flush path
//     then does `batch = batch[:0]`. In-memory only: no spool, no WAL, no
//     dead-letter (that machinery is keyed by RouteSource and structurally
//     cannot address the local ingest).
// So strict mode here would trade "one field is missing" for "100% of the
// user's compliance history is permanently gone, and the page just looks
// empty". The gate and the net were designed as a pair; taking the gate
// without the net is worse than either. Hence: decode leniently, keep the
// event, and make the drift LOUD instead of silent.
//
// The strict decoder is still used — as a DETECTOR ONLY, never to reject — so
// that what this lane warns about is by construction exactly what the master
// lane would have refused. No hand-maintained list of known field names (that
// list would itself drift); encoding/json stays the single source of truth for
// "unknown".

// complianceWireDrift is the ingest decoder's drift state machine.
//
// FLOOD CONTROL: drift is a STANDING CONDITION, not an incident. The moment
// the detector starts sending a field this build lacks, every single batch
// trips the check — at per-turn cadence that is a log flood, and a flood is
// just a different way of hiding the signal. Sampling (1-in-N) or rate
// limiting (1-per-minute) would still emit an unbounded trickle forever and
// would never tell the operator how much was actually affected.
//
// So this logs EDGES, not occurrences (the project's "只记状态转变" rule):
// CLEAN → DRIFT emits one WARN; every identical repeat is counted, not logged;
// DRIFT → CLEAN emits one WARN carrying the total. One episode = two lines,
// regardless of whether it spanned 3 events or 3 million. A changed signature
// counts as a new episode so a second, different drift can never hide behind
// the first. Process-scoped: a restart re-announces, which is intentional
// (fresh evidence per process lifetime).
type complianceWireDrift struct {
	mu sync.Mutex
	// signature is the strict decoder's error text, e.g.
	// `json: unknown field "trace_id"`. Empty means CLEAN.
	signature  string
	suppressed int64
}

// observe records one decode outcome and returns the log line to emit, if any.
// Returning the decision instead of logging inline keeps the lock off the
// logger and keeps the state machine unit-testable.
func (d *complianceWireDrift) observe(signature string) (event string, prevSignature string, suppressed int64, emit bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if signature == d.signature {
		if signature != "" {
			d.suppressed++
		}
		return "", "", 0, false
	}
	prevSignature, suppressed = d.signature, d.suppressed
	d.signature, d.suppressed = signature, 0
	if signature == "" {
		return shared.EventUserLocalComplianceWireDriftCleared, prevSignature, suppressed, true
	}
	return shared.EventUserLocalComplianceWireDriftDetected, prevSignature, suppressed, true
}

// detectComplianceWireDrift strictly re-decodes the SAME bytes that already
// decoded leniently. Because the strict pass differs from the lenient one by
// exactly one added constraint, and the lenient pass succeeded, any error here
// is an unknown-field error — its text is returned verbatim as the signature.
func detectComplianceWireDrift(raw []byte) string {
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	var probe complianceIntakeRequest
	if err := strict.Decode(&probe); err != nil {
		return err.Error()
	}
	return ""
}

// firstComplianceEventID returns the batch's first event id, the correlation
// key an operator can look up in local_compliance_events. Empty for an empty
// batch (an empty batch cannot drift on the event fields, but it can still
// drift on the envelope, so the WARN must not depend on this being present).
func firstComplianceEventID(events []complianceEventWire) string {
	if len(events) == 0 {
		return ""
	}
	return events[0].EventID
}

// complianceIngestHandler writes incoming events + findings to control.db.
//
// The drift tracker is created once per registration (handler.go registers
// this endpoint once), so its state is process-scoped — which is what makes
// "one WARN per drift episode" mean one per server lifetime, not one per
// request.
func complianceIngestHandler(db *sql.DB, logger *slog.Logger) http.HandlerFunc {
	drift := &complianceWireDrift{}
	return func(w http.ResponseWriter, r *http.Request) {
		// Read once: the bytes are needed twice (lenient decode + drift probe).
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		if err != nil {
			logger.Warn("compliance ingest: read body failed", "error", err)
			cmplErr(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		var req complianceIntakeRequest
		// json.Decoder (not json.Unmarshal) preserves the pre-2026-08-10
		// trailing-bytes tolerance exactly — this change must not make the
		// happy path any stricter than it already was.
		if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&req); err != nil {
			logger.Warn("compliance ingest: decode body failed", "error", err)
			cmplErr(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		// Drift probe. Never affects the response — the event is stored either
		// way; see the block comment above for why.
		signature := detectComplianceWireDrift(raw)
		if event, prevSignature, suppressed, emit := drift.observe(signature); emit {
			// Correlation: this lane has no request_id and no trace_id. There
			// is no request-id middleware on the local-server, the detector's
			// uploader sends only Content-Type, and trace_id is proxy-stamped
			// on the TEAM path only (filter_dispatch.go injectTraceID) so it
			// never reaches here. event_id is the correlation key that actually
			// exists: it is the primary key of local_compliance_events, so the
			// operator can go straight from this line to the affected rows.
			attrs := []any{
				"event.name", event,
				"error.code", shared.CodeDataUnknownField,
				"first_event_id", firstComplianceEventID(req.Events),
				"event_count", len(req.Events),
			}
			if event == shared.EventUserLocalComplianceWireDriftCleared {
				attrs = append(attrs, "resolved_drift", prevSignature, "suppressed_requests", suppressed)
				logger.Warn("compliance ingest: wire drift cleared — the local-server now understands every field the detector sends", attrs...)
			} else {
				attrs = append(attrs, "drift", signature)
				if prevSignature != "" {
					attrs = append(attrs, "superseded_drift", prevSignature, "suppressed_requests", suppressed)
				}
				logger.Warn("compliance ingest: wire drift — the detector sent a field this local-server does not know; the event was stored WITHOUT it. Upgrade the local-server (or downgrade ai-compliance-detector) so the two agree.", attrs...)
			}
		}
		accepted := make([]string, 0, len(req.Events))
		for _, ev := range req.Events {
			if ev.EventID == "" || ev.ActionTaken == "" {
				logger.Warn("compliance ingest: skipping event missing event_id/action_taken", "event_id", ev.EventID)
				continue
			}
			// "allow" (clean-scan) events are gated at the SOURCE (the detector,
			// via the AIKEY_COMPLIANCE_RECORD_ALLOW env the proxy sets from the
			// filter_record_allow flag) — by default they never reach here, so
			// the store records whatever it's given. See record_allow design
			// (2026-06-03): enforcement moved from store-side to detector-side so
			// it also saves the upload, controllable from the settings page.
			if err := insertComplianceEvent(r.Context(), db, ev); err != nil {
				logger.Warn("compliance ingest: insert event failed", "event_id", ev.EventID, "error", err)
				continue
			}
			accepted = append(accepted, ev.EventID)
		}
		// Event-driven retention purge (no cron): drop events past the window.
		purgeOldComplianceEvents(r.Context(), db, logger)
		shared.JSON(w, http.StatusOK, complianceIngestResponse{AcceptedIDs: accepted})
	}
}

// purgeOldComplianceEvents deletes local compliance events (and their findings)
// older than localComplianceRetentionDays. Two explicit DELETEs (findings then
// events) so it works regardless of the foreign_keys pragma. datetime() on both
// sides normalizes the RFC3339 stored timestamps vs SQLite's space-form 'now'.
// Non-fatal: a purge failure must not break ingest (WARN + continue).
func purgeOldComplianceEvents(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	cutoff := fmt.Sprintf("-%d days", localComplianceRetentionDays)
	if _, err := db.ExecContext(ctx, `
		DELETE FROM local_compliance_findings
		WHERE event_id IN (SELECT event_id FROM local_compliance_events WHERE datetime(created_at) < datetime('now', ?))`, cutoff); err != nil {
		logger.Warn("compliance retention: purge findings failed", "error", err)
		return
	}
	if _, err := db.ExecContext(ctx, `
		DELETE FROM local_compliance_events WHERE datetime(created_at) < datetime('now', ?)`, cutoff); err != nil {
		logger.Warn("compliance retention: purge events failed", "error", err)
	}
}

// insertComplianceEvent writes one event + its findings. ON CONFLICT DO NOTHING
// makes a detector retry idempotent (the local store can't double-count).
func insertComplianceEvent(ctx context.Context, db *sql.DB, ev complianceEventWire) error {
	created := ev.CreatedAt
	if created.IsZero() {
		created = time.Now().UTC()
	}
	// Observability extension fields go in the metadata JSON column (reuses the
	// existing extension column — no schema change). NULL when nothing to store.
	var metadata any
	if ev.DetectLatencyMs > 0 {
		if b, err := json.Marshal(map[string]float64{"detect_latency_ms": ev.DetectLatencyMs}); err == nil {
			metadata = string(b)
		}
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO local_compliance_events
			(event_id, created_at, user_id, proxy_version, target_model, scenario, prompt_length, action_taken, prompt_hash, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(event_id) DO NOTHING`,
		ev.EventID, created.UTC().Format(time.RFC3339), nullStr(ev.UserID), nullStr(ev.ProxyVersion),
		nullStr(ev.TargetModel), nullStr(ev.Scenario), ev.PromptLength, ev.ActionTaken, nullStr(ev.PromptHash), metadata)
	if err != nil {
		return err
	}
	for _, f := range ev.Findings {
		if f.FindingID == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO local_compliance_findings
				(finding_id, event_id, rule_id, category, entity_type, severity, confidence, start_offset, end_offset, detector, redacted_snippet, context_snippet)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(finding_id) DO NOTHING`,
			f.FindingID, ev.EventID, nullStr(f.RuleID), f.Category, f.EntityType, f.Severity,
			f.Confidence, f.StartOffset, f.EndOffset, nullStr(f.Detector), nullStr(f.RedactedSnippet), nullStr(f.ContextSnippet)); err != nil {
			return err
		}
	}
	return nil
}

// ── Read / audit-log (mirrors master ListAuditEvents MINUS tenant) ────────

type complianceListResponse struct {
	Events []complianceAuditEvent `json:"events"`
	Total  int                    `json:"total"`
	Limit  int                    `json:"limit"`
	Offset int                    `json:"offset"`
}

type complianceAuditEvent struct {
	EventID      string `json:"event_id"`
	CreatedAt    string `json:"created_at"`
	UserID       string `json:"user_id,omitempty"`
	TargetModel  string `json:"target_model,omitempty"`
	Scenario     string `json:"scenario,omitempty"`
	PromptLength int    `json:"prompt_length"`
	ActionTaken  string `json:"action_taken"`
	// DetectLatencyMs: detection step's own time (ms, float), parsed from the
	// metadata JSON column. Omitted when absent/zero.
	DetectLatencyMs float64                  `json:"detect_latency_ms,omitempty"`
	Findings        []complianceAuditFinding `json:"findings"`
}

type complianceAuditFinding struct {
	FindingID       string `json:"finding_id"`
	RuleID          string `json:"rule_id,omitempty"`
	Category        string `json:"category"`
	EntityType      string `json:"entity_type"`
	Severity        string `json:"severity"`
	Confidence      int    `json:"confidence"`
	Detector        string `json:"detector,omitempty"`
	RedactedSnippet string `json:"redacted_snippet,omitempty"`
	// ContextSnippet: local-only un-redacted matched text + context (self-view).
	ContextSnippet string `json:"context_snippet,omitempty"`
}

// complianceListHandler returns the user's own compliance events (newest
// first) with optional filters. Two queries (events page + batch findings)
// mirror master audit.go to avoid N+1 + row fan-out.
func complianceListHandler(db *sql.DB, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit := clampInt(parseIntDefault(q.Get("limit"), 50), 1, 200)
		offset := parseIntDefault(q.Get("offset"), 0)
		if offset < 0 {
			offset = 0
		}

		// Build WHERE from event-level + finding-level (EXISTS) filters.
		var where []string
		var args []any
		if action := q.Get("action"); action != "" {
			where = append(where, "e.action_taken = ?")
			args = append(args, action)
		}
		if from := q.Get("from"); from != "" {
			if t, err := time.Parse(time.RFC3339, from); err == nil {
				where = append(where, "e.created_at >= ?")
				args = append(args, t.UTC().Format(time.RFC3339))
			} else {
				logger.Warn("compliance list: bad 'from' timestamp", "value", from)
			}
		}
		if to := q.Get("to"); to != "" {
			if t, err := time.Parse(time.RFC3339, to); err == nil {
				where = append(where, "e.created_at <= ?")
				args = append(args, t.UTC().Format(time.RFC3339))
			} else {
				logger.Warn("compliance list: bad 'to' timestamp", "value", to)
			}
		}
		// Finding-level filters via EXISTS subquery (an event matches if it
		// has at least one finding of the given severity / category).
		if sev := q.Get("severity"); sev != "" {
			where = append(where, "EXISTS (SELECT 1 FROM local_compliance_findings f WHERE f.event_id = e.event_id AND f.severity = ?)")
			args = append(args, sev)
		}
		// Free-text search box (param kept as `category` for wire compat): an
		// event matches if any of its findings' category, entity type, OR matched
		// content snippet contains the query (case-insensitive partial). This makes
		// the box a real search — "phone" finds CN_PHONE, "pii" finds the category,
		// "赵六" finds the snippet — instead of an exact-category picker that only
		// matched the literal enum value.
		if cat := q.Get("category"); cat != "" {
			where = append(where, "EXISTS (SELECT 1 FROM local_compliance_findings f WHERE f.event_id = e.event_id AND (f.category LIKE ? OR f.entity_type LIKE ? OR f.context_snippet LIKE ?))")
			like := "%" + cat + "%"
			args = append(args, like, like, like)
		}
		// entity_type: EXACT match on the detected entity (2026-08-11 user
		// request), distinct from the `category` box above which is a deliberate
		// three-column fuzzy search.
		//
		// 🔴 Both may be present and are ANDed. They are not redundant: 「PHONE」
		// typed in the search box also matches a snippet that merely mentions the
		// word, while this picks the finding whose entity_type IS CN_PHONE. The
		// console offers the enumerated values through this param and keeps the
		// box for free text.
		if et := q.Get("entity_type"); et != "" {
			where = append(where, "EXISTS (SELECT 1 FROM local_compliance_findings f WHERE f.event_id = e.event_id AND f.entity_type = ?)")
			args = append(args, et)
		}
		whereSQL := ""
		if len(where) > 0 {
			whereSQL = "WHERE " + strings.Join(where, " AND ")
		}

		// Total count for pagination.
		var total int
		if err := db.QueryRowContext(r.Context(),
			"SELECT COUNT(*) FROM local_compliance_events e "+whereSQL, args...).Scan(&total); err != nil {
			logger.Warn("compliance list: count failed", "error", err)
			cmplErr(w, http.StatusInternalServerError, "query failed")
			return
		}

		pageArgs := append(append([]any{}, args...), limit, offset)
		rows, err := db.QueryContext(r.Context(), `
			SELECT e.event_id, e.created_at, COALESCE(e.user_id,''), COALESCE(e.target_model,''),
			       COALESCE(e.scenario,''), e.prompt_length, e.action_taken, COALESCE(e.metadata,'')
			FROM local_compliance_events e `+whereSQL+`
			ORDER BY e.created_at DESC
			LIMIT ? OFFSET ?`, pageArgs...)
		if err != nil {
			logger.Warn("compliance list: events query failed", "error", err)
			cmplErr(w, http.StatusInternalServerError, "query failed")
			return
		}
		defer rows.Close()

		events := make([]complianceAuditEvent, 0, limit)
		ids := make([]any, 0, limit)
		idx := map[string]int{}
		for rows.Next() {
			var e complianceAuditEvent
			var metaRaw string
			if err := rows.Scan(&e.EventID, &e.CreatedAt, &e.UserID, &e.TargetModel,
				&e.Scenario, &e.PromptLength, &e.ActionTaken, &metaRaw); err != nil {
				logger.Warn("compliance list: scan event failed", "error", err)
				cmplErr(w, http.StatusInternalServerError, "query failed")
				return
			}
			// Extension fields live in the metadata JSON column (e.g. detect_latency_ms).
			if metaRaw != "" {
				var meta struct {
					DetectLatencyMs float64 `json:"detect_latency_ms"`
				}
				if err := json.Unmarshal([]byte(metaRaw), &meta); err == nil {
					e.DetectLatencyMs = meta.DetectLatencyMs
				}
			}
			e.Findings = []complianceAuditFinding{}
			idx[e.EventID] = len(events)
			events = append(events, e)
			ids = append(ids, e.EventID)
		}
		if err := rows.Err(); err != nil {
			logger.Warn("compliance list: events iter failed", "error", err)
			cmplErr(w, http.StatusInternalServerError, "query failed")
			return
		}

		if len(ids) > 0 {
			if err := attachComplianceFindings(r.Context(), db, ids, events, idx); err != nil {
				logger.Warn("compliance list: findings query failed", "error", err)
				cmplErr(w, http.StatusInternalServerError, "query failed")
				return
			}
		}

		shared.JSON(w, http.StatusOK, complianceListResponse{Events: events, Total: total, Limit: limit, Offset: offset})
	}
}

// attachComplianceFindings batch-loads findings for the page of events and
// attaches them (ordered by confidence DESC, mirroring master).
func attachComplianceFindings(ctx context.Context, db *sql.DB, ids []any, events []complianceAuditEvent, idx map[string]int) error {
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	rows, err := db.QueryContext(ctx, `
		SELECT event_id, finding_id, COALESCE(rule_id,''), category, entity_type, severity,
		       confidence, COALESCE(detector,''), COALESCE(redacted_snippet,''), COALESCE(context_snippet,'')
		FROM local_compliance_findings
		WHERE event_id IN (`+placeholders+`)
		ORDER BY confidence DESC`, ids...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var eventID string
		var f complianceAuditFinding
		if err := rows.Scan(&eventID, &f.FindingID, &f.RuleID, &f.Category, &f.EntityType,
			&f.Severity, &f.Confidence, &f.Detector, &f.RedactedSnippet, &f.ContextSnippet); err != nil {
			return err
		}
		if i, ok := idx[eventID]; ok {
			events[i].Findings = append(events[i].Findings, f)
		}
	}
	return rows.Err()
}

// defaultProxyPort mirrors aikey-cli's proxy_port (the CLI is the single source;
// override via AIKEY_PROXY_PORT). Same convention as the OAuth relay in
// pkg/userapi/oauth.
const defaultProxyPort = "27200"

func proxyAdminBase() string {
	if p := strings.TrimSpace(os.Getenv("AIKEY_PROXY_PORT")); p != "" {
		return "http://127.0.0.1:" + p
	}
	return "http://127.0.0.1:" + defaultProxyPort
}

// complianceEffectivePacksHandler relays GET /api/user/compliance/packs to the
// live aikey-proxy admin endpoint /admin/compliance/packs, which queries the
// running detector child over the IPC for its currently-effective packs
// (built-in baseline + server-distributed). local-server is the same-origin
// relay — the browser can't reach the proxy directly (CORS + unknown port),
// same posture as the OAuth relay. Proxy unreachable / no filter child →
// {available:false} with 200, never a 5xx (a missing compliance filter is a
// normal state: compliance off / offline).
func complianceEffectivePacksHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, proxyAdminBase()+"/admin/compliance/packs", nil)
		if err != nil {
			shared.JSON(w, http.StatusOK, map[string]any{"available": false})
			return
		}
		resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
		if err != nil {
			logger.Warn("compliance packs: proxy admin unreachable", "error", err.Error())
			shared.JSON(w, http.StatusOK, map[string]any{"available": false})
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(body)
	}
}

// ── small helpers ─────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// cmplErr writes a JSON error envelope via the shared responder (decoupled
// from any package-local writeJSON helper).
func cmplErr(w http.ResponseWriter, status int, msg string) {
	shared.JSON(w, status, map[string]string{"error": msg})
}
