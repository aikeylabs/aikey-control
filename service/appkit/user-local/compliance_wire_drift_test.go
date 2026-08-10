package userlocal

// Fence tests for the local compliance ingest's wire-drift detector.
//
// WHAT IS BEING FENCED
//
// Before 2026-08-10 this handler decoded with a plain json.Decoder and NO
// unknown-field check, so a field the detector added but this build lacked was
// dropped into the void: the event still landed, minus data, with zero
// evidence in any log. The master lane surfaces the same drift as a 400, but
// this lane must not copy that (a 4xx here is terminal — the detector's
// uploader drops the batch without retry and there is no dead-letter), so the
// contract is: KEEP the event, LOSE only the unknown field, and SAY SO.
//
// These tests pin all three halves of that contract:
//   1. the event and every KNOWN field still reach the DB (SELECT, not HTTP 200)
//   2. the WARN is emitted with the central event.name + error.code
//   3. the WARN does not flood — one line per drift episode, not per request
//
// 能红验证 (how to prove these fail when the fix is reverted):
//   - make detectComplianceWireDrift return "" unconditionally
//       → TestComplianceIngest_UnknownFieldIsLoudNotSilent FAILS (no WARN)
//       → TestComplianceIngest_DriftWarnIsOneLinePerEpisode FAILS (0 lines)
//     ...while the "event still lands" assertions stay GREEN, which is exactly
//     the point: the pre-fix behaviour passed every storage check and was still
//     wrong. The WARN assertions are the only thing standing between "silently
//     lossy" and "loudly lossy".
//   - add DisallowUnknownFields to the REAL decoder (i.e. copy master's gate)
//       → TestComplianceIngest_UnknownFieldIsLoudNotSilent FAILS on the DB
//         assertions: the event never lands at all. That is the regression this
//         lane cannot afford.
//
// SCHEMA: built by running the REAL migration chain
// (versions.UpgradeTo(SQLite, Personal)) — the same call aikey-trial-server's
// serve.Run makes at startup. No inlined CREATE TABLE: a hand-written fixture
// could not catch a Schema↔Code mismatch, which is the class of bug this file
// exists to police.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AiKeyLabs/aikey-config-tool/pkg/dbmigrate"
	"github.com/AiKeyLabs/aikey-config-tool/pkg/dbmigrate/versions"
	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
	_ "modernc.org/sqlite"
)

// newComplianceTestDB opens a throwaway SQLite file and brings it to the real
// Personal schema through the production migration path.
func newComplianceTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "control.db") + "?_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := versions.UpgradeTo(context.Background(), db, dbmigrate.DialectSQLite, dbmigrate.EditionPersonal, ""); err != nil {
		t.Fatalf("run real migration chain: %v", err)
	}
	return db
}

// capturedLogger returns a logger writing JSON lines into buf so assertions can
// read structured attributes (event.name / error.code) rather than grepping
// prose, which would rot the moment the wording changes.
func capturedLogger(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// logLinesWithEvent returns every captured record whose "event.name" attribute
// equals name.
func logLinesWithEvent(t *testing.T, buf *bytes.Buffer, name string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line is not JSON: %q (%v)", line, err)
		}
		if rec["event.name"] == name {
			out = append(out, rec)
		}
	}
	return out
}

// driftingPayload is a well-formed batch that ALSO carries fields this build
// does not know. `trace_id` is the real F1a field that landed on the master
// wire (aikey-control-master intakeEventWire) and on the detector's shared
// Event struct but never on this local wire — i.e. the concrete drift this
// detector exists to catch. `deep_scan_verdict` stands in for the next
// finding-level addition, proving nested structs are covered too.
func driftingPayload(eventID string) string {
	return fmt.Sprintf(`{"events":[{
		"event_id": %q,
		"created_at": "2026-08-10T01:02:03Z",
		"user_id": "u_local",
		"proxy_version": "1.0.5",
		"target_model": "claude-sonnet-4",
		"scenario": "chat",
		"prompt_length": 128,
		"action_taken": "mask",
		"prompt_hash": "sha256:abc",
		"detect_latency_ms": 0.42,
		"trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
		"findings": [{
			"finding_id": %q,
			"rule_id": "CN_PHONE",
			"category": "pii",
			"entity_type": "CN_PHONE",
			"severity": "high",
			"confidence": 95,
			"start_offset": 10,
			"end_offset": 21,
			"detector": "regex",
			"redacted_snippet": "手机 138****8000",
			"context_snippet": "请联系 13800138000 处理",
			"deep_scan_verdict": "clean"
		}]
	}]}`, eventID, eventID+"_f1")
}

// cleanPayload is the same batch with the unknown fields removed.
func cleanPayload(eventID string) string {
	return fmt.Sprintf(`{"events":[{
		"event_id": %q,
		"created_at": "2026-08-10T01:02:03Z",
		"action_taken": "mask",
		"prompt_length": 64,
		"findings": [{
			"finding_id": %q,
			"category": "pii",
			"entity_type": "CN_PHONE",
			"severity": "low",
			"confidence": 60,
			"start_offset": 0,
			"end_offset": 3
		}]
	}]}`, eventID, eventID+"_f1")
}

func postCompliance(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/compliance/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestComplianceIngest_UnknownFieldIsLoudNotSilent is the core fence: an
// unknown field must cost exactly one field and one WARN — never the event.
func TestComplianceIngest_UnknownFieldIsLoudNotSilent(t *testing.T) {
	db := newComplianceTestDB(t)
	var buf bytes.Buffer
	h := complianceIngestHandler(db, capturedLogger(&buf))

	rec := postCompliance(t, h, driftingPayload("ev_drift_1"))

	// (0) The request is accepted. HTTP 200 is NOT the evidence — it is only
	// the precondition for the DB assertions below.
	if rec.Code != http.StatusOK {
		t.Fatalf("unknown fields must not be rejected: got HTTP %d, body %s", rec.Code, rec.Body.String())
	}
	var resp complianceIngestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.AcceptedIDs) != 1 || resp.AcceptedIDs[0] != "ev_drift_1" {
		t.Fatalf("event must be accepted despite drift, got accepted_ids=%v", resp.AcceptedIDs)
	}

	// (a) The event and every KNOWN field really landed. This is the assertion
	// that a DisallowUnknownFields copy of the master gate would break.
	var (
		userID, proxyVersion, targetModel, scenario, actionTaken, promptHash, metadata string
		promptLength                                                                   int
	)
	err := db.QueryRow(`
		SELECT COALESCE(user_id,''), COALESCE(proxy_version,''), COALESCE(target_model,''),
		       COALESCE(scenario,''), prompt_length, action_taken, COALESCE(prompt_hash,''),
		       COALESCE(metadata,'')
		FROM local_compliance_events WHERE event_id = ?`, "ev_drift_1").
		Scan(&userID, &proxyVersion, &targetModel, &scenario, &promptLength, &actionTaken, &promptHash, &metadata)
	if err != nil {
		t.Fatalf("event row missing after a drifting POST — the drift cost the whole event, not just a field: %v", err)
	}
	for _, c := range []struct{ name, got, want string }{
		{"user_id", userID, "u_local"},
		{"proxy_version", proxyVersion, "1.0.5"},
		{"target_model", targetModel, "claude-sonnet-4"},
		{"scenario", scenario, "chat"},
		{"action_taken", actionTaken, "mask"},
		{"prompt_hash", promptHash, "sha256:abc"},
	} {
		if c.got != c.want {
			t.Errorf("%s = %q, want %q", c.name, c.got, c.want)
		}
	}
	if promptLength != 128 {
		t.Errorf("prompt_length = %d, want 128", promptLength)
	}
	if !strings.Contains(metadata, "detect_latency_ms") {
		t.Errorf("metadata lost detect_latency_ms: %q", metadata)
	}

	// context_snippet specifically: the un-redacted local text is the whole
	// reason this lane exists and the whole reason it must not adopt master's
	// privacy gate. If drift ever starts costing this column, the self-view
	// silently degrades to the redacted placeholder.
	var redacted, contextSnippet string
	if err := db.QueryRow(`
		SELECT COALESCE(redacted_snippet,''), COALESCE(context_snippet,'')
		FROM local_compliance_findings WHERE finding_id = ?`, "ev_drift_1_f1").
		Scan(&redacted, &contextSnippet); err != nil {
		t.Fatalf("finding row missing after a drifting POST: %v", err)
	}
	if contextSnippet != "请联系 13800138000 处理" {
		t.Errorf("context_snippet = %q, want the un-redacted local text", contextSnippet)
	}
	if redacted != "手机 138****8000" {
		t.Errorf("redacted_snippet = %q", redacted)
	}

	// (b) The drop was announced, with the central names.
	lines := logLinesWithEvent(t, &buf, shared.EventUserLocalComplianceWireDriftDetected)
	if len(lines) != 1 {
		t.Fatalf("want exactly 1 %s WARN, got %d\nlog:\n%s",
			shared.EventUserLocalComplianceWireDriftDetected, len(lines), buf.String())
	}
	rc := lines[0]
	if rc["level"] != "WARN" {
		t.Errorf("drift must be WARN, got level=%v", rc["level"])
	}
	if rc["error.code"] != shared.CodeDataUnknownField {
		t.Errorf("error.code = %v, want %s", rc["error.code"], shared.CodeDataUnknownField)
	}
	// The operator must be able to tell WHICH field drifted and WHICH rows are
	// affected, otherwise the WARN is just a different flavour of silence.
	if drift, _ := rc["drift"].(string); !strings.Contains(drift, "trace_id") {
		t.Errorf("drift attr must name the unknown field, got %q", drift)
	}
	if rc["first_event_id"] != "ev_drift_1" {
		t.Errorf("first_event_id = %v, want ev_drift_1 (the correlation key into local_compliance_events)", rc["first_event_id"])
	}
}

// TestComplianceIngest_CleanPayloadIsSilent guards the other direction: a
// payload this build fully understands must produce no drift noise at all.
// Without this, "always WARN" would pass every other test in the file.
func TestComplianceIngest_CleanPayloadIsSilent(t *testing.T) {
	db := newComplianceTestDB(t)
	var buf bytes.Buffer
	h := complianceIngestHandler(db, capturedLogger(&buf))

	for i := 0; i < 3; i++ {
		if rec := postCompliance(t, h, cleanPayload(fmt.Sprintf("ev_clean_%d", i))); rec.Code != http.StatusOK {
			t.Fatalf("clean payload rejected: HTTP %d %s", rec.Code, rec.Body.String())
		}
	}
	if n := len(logLinesWithEvent(t, &buf, shared.EventUserLocalComplianceWireDriftDetected)); n != 0 {
		t.Fatalf("clean payloads must not report drift, got %d WARN(s)\nlog:\n%s", n, buf.String())
	}
	if n := len(logLinesWithEvent(t, &buf, shared.EventUserLocalComplianceWireDriftCleared)); n != 0 {
		t.Fatalf("no episode was ever open, so nothing can clear; got %d\nlog:\n%s", n, buf.String())
	}
}

// TestComplianceIngest_DriftWarnIsOneLinePerEpisode pins the flood control.
// Drift is a STANDING condition — every batch trips it — so per-request
// logging would bury the signal it is supposed to raise. The contract is one
// line on the CLEAN→DRIFT edge, one on DRIFT→CLEAN carrying the damage total,
// and re-arming afterwards.
func TestComplianceIngest_DriftWarnIsOneLinePerEpisode(t *testing.T) {
	db := newComplianceTestDB(t)
	var buf bytes.Buffer
	h := complianceIngestHandler(db, capturedLogger(&buf))

	const drifting = 50
	for i := 0; i < drifting; i++ {
		if rec := postCompliance(t, h, driftingPayload(fmt.Sprintf("ev_flood_%d", i))); rec.Code != http.StatusOK {
			t.Fatalf("drifting POST %d rejected: HTTP %d", i, rec.Code)
		}
	}
	if n := len(logLinesWithEvent(t, &buf, shared.EventUserLocalComplianceWireDriftDetected)); n != 1 {
		t.Fatalf("%d identical drifting requests must produce exactly 1 WARN, got %d — flood control is broken\nlog:\n%s",
			drifting, n, buf.String())
	}

	// Suppression must never cost data: all 50 still landed.
	var stored int
	if err := db.QueryRow(`SELECT COUNT(*) FROM local_compliance_events WHERE event_id LIKE 'ev_flood_%'`).Scan(&stored); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if stored != drifting {
		t.Fatalf("suppressed WARNs must not mean suppressed events: stored %d, want %d", stored, drifting)
	}

	// DRIFT → CLEAN: one line, carrying how many requests were swallowed.
	if rec := postCompliance(t, h, cleanPayload("ev_recovered")); rec.Code != http.StatusOK {
		t.Fatalf("clean POST after drift rejected: HTTP %d", rec.Code)
	}
	cleared := logLinesWithEvent(t, &buf, shared.EventUserLocalComplianceWireDriftCleared)
	if len(cleared) != 1 {
		t.Fatalf("want exactly 1 cleared line, got %d\nlog:\n%s", len(cleared), buf.String())
	}
	if cleared[0]["level"] != "WARN" {
		t.Errorf("the cleared line carries the damage total and must survive a WARN-level filter, got level=%v", cleared[0]["level"])
	}
	if got, _ := cleared[0]["suppressed_requests"].(float64); int(got) != drifting-1 {
		t.Errorf("suppressed_requests = %v, want %d (the %d repeats after the announced first)", cleared[0]["suppressed_requests"], drifting-1, drifting-1)
	}

	// Re-arming: a NEW episode must be announced again, not swallowed by the
	// memory of the old one.
	if rec := postCompliance(t, h, driftingPayload("ev_flood_again")); rec.Code != http.StatusOK {
		t.Fatalf("second-episode POST rejected: HTTP %d", rec.Code)
	}
	if n := len(logLinesWithEvent(t, &buf, shared.EventUserLocalComplianceWireDriftDetected)); n != 2 {
		t.Fatalf("a new drift episode must re-announce: want 2 detected lines total, got %d\nlog:\n%s", n, buf.String())
	}
}

// TestComplianceWireDrift_StateMachine unit-tests the edge logic directly, so a
// regression points at the state machine rather than at the HTTP layer.
func TestComplianceWireDrift_StateMachine(t *testing.T) {
	d := &complianceWireDrift{}

	if _, _, _, emit := d.observe(""); emit {
		t.Fatal("CLEAN → CLEAN must be silent")
	}
	ev, prev, sup, emit := d.observe(`json: unknown field "trace_id"`)
	if !emit || ev != shared.EventUserLocalComplianceWireDriftDetected || prev != "" || sup != 0 {
		t.Fatalf("CLEAN → DRIFT: emit=%v ev=%q prev=%q sup=%d", emit, ev, prev, sup)
	}
	for i := 0; i < 5; i++ {
		if _, _, _, emit := d.observe(`json: unknown field "trace_id"`); emit {
			t.Fatalf("repeat #%d of the same signature must be counted, not logged", i)
		}
	}
	// A DIFFERENT signature is a different episode and must not hide behind
	// the first — it is announced, carrying the previous episode's total.
	ev, prev, sup, emit = d.observe(`json: unknown field "deep_scan_verdict"`)
	if !emit || ev != shared.EventUserLocalComplianceWireDriftDetected {
		t.Fatalf("DRIFT → other DRIFT must re-announce: emit=%v ev=%q", emit, ev)
	}
	if prev != `json: unknown field "trace_id"` || sup != 5 {
		t.Fatalf("superseded episode must carry its total: prev=%q sup=%d, want the trace_id signature and 5", prev, sup)
	}
	ev, prev, sup, emit = d.observe("")
	if !emit || ev != shared.EventUserLocalComplianceWireDriftCleared {
		t.Fatalf("DRIFT → CLEAN must emit cleared: emit=%v ev=%q", emit, ev)
	}
	if prev != `json: unknown field "deep_scan_verdict"` || sup != 0 {
		t.Fatalf("cleared line: prev=%q sup=%d", prev, sup)
	}
	if _, _, _, emit := d.observe(""); emit {
		t.Fatal("CLEAN → CLEAN after recovery must be silent again")
	}
}
