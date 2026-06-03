package userlocal

// Phase 3 — local compliance self-view store (Personal/Trial).
//
// Two HTTP handlers backed by the local data SQLite (control.db), tables
// local_compliance_events + local_compliance_findings (rc.9 ComponentData
// migration). They mirror the master-side intake wire + audit-log read shape
// (aikey-control-master/service/internal/compliance/{handler.go,storage/audit.go})
// MINUS the tenant dimension — this is a single-user local store.
//
// DC5: original prompt text never reaches here. The detector sends only
// metadata + a redacted snippet; we store + serve exactly that, never原文.
//
// Ingest (POST /v1/compliance/events) is a machine endpoint — the local
// detector POSTs to it. It is unauthenticated by design: the local-server
// binds 127.0.0.1 only (decision D2), so reachability IS the gate. Writes are
// idempotent (ON CONFLICT(event_id/finding_id) DO NOTHING) so a detector retry
// can't double-count.
//
// Read (GET /api/user/compliance/events) is a local_bypass browser endpoint
// drained by the /user/compliance page; metadata + redacted snippet only.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
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
	EventID      string                  `json:"event_id"`
	CreatedAt    time.Time               `json:"created_at"`
	UserID       string                  `json:"user_id,omitempty"`
	ProxyVersion string                  `json:"proxy_version,omitempty"`
	TargetModel  string                  `json:"target_model,omitempty"`
	Scenario     string                  `json:"scenario,omitempty"`
	PromptLength int                     `json:"prompt_length"`
	ActionTaken  string                  `json:"action_taken"`
	PromptHash   string                  `json:"prompt_hash,omitempty"`
	Findings     []complianceFindingWire `json:"findings"`
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

// complianceIngestHandler writes incoming events + findings to control.db.
func complianceIngestHandler(db *sql.DB, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req complianceIntakeRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
			logger.Warn("compliance ingest: decode body failed", "error", err)
			cmplErr(w, http.StatusBadRequest, "invalid JSON body")
			return
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
	_, err := db.ExecContext(ctx, `
		INSERT INTO local_compliance_events
			(event_id, created_at, user_id, proxy_version, target_model, scenario, prompt_length, action_taken, prompt_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(event_id) DO NOTHING`,
		ev.EventID, created.UTC().Format(time.RFC3339), nullStr(ev.UserID), nullStr(ev.ProxyVersion),
		nullStr(ev.TargetModel), nullStr(ev.Scenario), ev.PromptLength, ev.ActionTaken, nullStr(ev.PromptHash))
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
	EventID      string                   `json:"event_id"`
	CreatedAt    string                   `json:"created_at"`
	UserID       string                   `json:"user_id,omitempty"`
	TargetModel  string                   `json:"target_model,omitempty"`
	Scenario     string                   `json:"scenario,omitempty"`
	PromptLength int                      `json:"prompt_length"`
	ActionTaken  string                   `json:"action_taken"`
	Findings     []complianceAuditFinding `json:"findings"`
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
		if cat := q.Get("category"); cat != "" {
			where = append(where, "EXISTS (SELECT 1 FROM local_compliance_findings f WHERE f.event_id = e.event_id AND f.category = ?)")
			args = append(args, cat)
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
			       COALESCE(e.scenario,''), e.prompt_length, e.action_taken
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
			if err := rows.Scan(&e.EventID, &e.CreatedAt, &e.UserID, &e.TargetModel,
				&e.Scenario, &e.PromptLength, &e.ActionTaken); err != nil {
				logger.Warn("compliance list: scan event failed", "error", err)
				cmplErr(w, http.StatusInternalServerError, "query failed")
				return
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
