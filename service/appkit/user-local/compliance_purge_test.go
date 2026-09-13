package userlocal

// Fence for the Personal local ledger's 30-day retention purge.
//
// spec: R-compliance-audit-retention-1.S2 —— Personal 本机 30 天清理不变
// (roadmap20260320/技术实现/阶段9-商业化版本/博时基金合规能力融合/openspec/changes/
//  add-compliance-grading-fusion/specs/compliance-audit-retention/spec.md)
//
// # WHAT IS BEING FENCED, AND WHY IT NEEDS A FENCE AT ALL
//
// This file guards behaviour that ALREADY WORKS. That is the point: the
// 分类分级 requirement package adds a team-side retention policy
// (organizations.compliance_event_retention_days, default 1826 days ≈ 5 years,
// versions_master v1_0_1_alpha9_org_compliance_event_retention.go). Personal has
// no master and no org row — its window is the fixed
// localComplianceRetentionDays constant, enforced by purgeOldComplianceEvents on
// every ingest (event-driven, no cron).
//
// The failure this file exists to catch is the two windows being WIRED
// TOGETHER: someone makes the local purge read a retention value that arrives
// from the team side, and Personal's disposal policy silently becomes something
// a remote console can rewrite. Personal's whole premise is that it does not
// depend on master; a purge that can be widened (or narrowed) from there breaks
// that premise without breaking any other test — every existing case would stay
// green because the DEFAULT still looks like 30 days on a box that never talked
// to a master.
//
// So the fence has three arms, and only the first is about the window itself:
//
//	1. window        — 31 days old is deleted WITH its findings, 29 days old is
//	                   kept WITH its findings. The pair brackets the boundary, so
//	                   any change to the number moves one of them.
//	2. org row       — planting an organizations row carrying
//	                   compliance_event_retention_days = 1826 in the SAME database
//	                   must not save a 31-day-old event. This is the negative
//	                   control for "the local purge reads no config".
//	3. no surface    — the real Personal migration chain must not even CARRY that
//	                   column (or an organizations table). Arm 2 proves the code
//	                   ignores the value; arm 3 proves the value cannot get here
//	                   in the first place. Both matter: arm 2 alone would still
//	                   pass on the day a migration mirrors the org table locally.
//
// # 能红 (how to prove this file fails when the behaviour changes)
//
//	- widen the window: localComplianceRetentionDays 30 → 90
//	    → arm 1 FAILS (the 31-day event survives) and arm 2 FAILS.
//	- narrow it: 30 → 7  → arm 1 FAILS (the 29-day event is gone).
//	- couple it to the team policy: make purgeOldComplianceEvents read
//	  `SELECT compliance_event_retention_days FROM organizations` and fall back to
//	  the constant
//	    → arm 1 stays GREEN (no org row in that database — this is exactly the
//	      blind spot), arm 2 FAILS (the 1826-day policy keeps the old event).
//	- mirror the org table into the Personal chain → arm 3 FAILS.
//
// Verified red in an isolated worktree (see task-5.2-report.md); the shared tree
// was never mutated for the witness.
//
// SCHEMA: built by the REAL migration chain (newComplianceTestDB → the same
// versions.UpgradeTo(SQLite, Personal) call aikey-trial-server's serve.Run makes
// at startup). A hand-written CREATE TABLE could not catch arm 3 at all.
//
// TIME: every timestamp is relative to now (complianceFixtureCreatedAt's
// discipline) — an absolute date in a retention test is a bomb with a fuse the
// length of the window.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// purgeFenceAgedEvent builds one event, aged `age` before now, carrying exactly
// one finding. The finding is what makes the cascade half of the requirement
// observable: "旧事件与其 findings 被删除" is two DELETEs, and an event-only
// assertion would pass on a build that orphans finding rows forever.
func purgeFenceAgedEvent(eventID string, age time.Duration) complianceEventWire {
	return complianceEventWire{
		EventID:      eventID,
		CreatedAt:    time.Now().UTC().Add(-age),
		Scenario:     "chat",
		PromptLength: 57,
		ActionTaken:  "mask",
		Findings: []complianceFindingWire{{
			FindingID:   eventID + "-f1",
			RuleID:      "ner.char.ID",
			Category:    "pii",
			EntityType:  "CN_ID_CARD",
			Severity:    "high",
			Confidence:  95,
			StartOffset: 0,
			EndOffset:   18,
		}},
	}
}

// seedAgedComplianceEvent writes an aged event straight through the production
// insert path and PROVES it landed. Without that proof a later "it is gone"
// assertion is vacuous: an INSERT that never happened looks identical to a row
// the purge removed.
func seedAgedComplianceEvent(t *testing.T, db *sql.DB, eventID string, age time.Duration) {
	t.Helper()
	if err := insertComplianceEvent(context.Background(), db, purgeFenceAgedEvent(eventID, age)); err != nil {
		t.Fatalf("seed %s (aged %s): %v", eventID, age, err)
	}
	if events, findings := countComplianceRows(t, db, eventID); events != 1 || findings != 1 {
		t.Fatalf("seed %s did not land (events=%d findings=%d); every later assertion would be vacuous",
			eventID, events, findings)
	}
}

// countComplianceRows returns how many event rows and finding rows this
// event_id still owns.
func countComplianceRows(t *testing.T, db *sql.DB, eventID string) (events, findings int) {
	t.Helper()
	if err := db.QueryRow(
		`SELECT count(*) FROM local_compliance_events WHERE event_id = ?`, eventID).Scan(&events); err != nil {
		t.Fatalf("count events %s: %v", eventID, err)
	}
	if err := db.QueryRow(
		`SELECT count(*) FROM local_compliance_findings WHERE event_id = ?`, eventID).Scan(&findings); err != nil {
		t.Fatalf("count findings %s: %v", eventID, err)
	}
	return events, findings
}

// ingestFreshComplianceEvent posts one brand-new event through the REAL HTTP
// handler, which is the only thing that runs the purge (event-driven, no cron).
// Returns the accepted ids so the caller can tell "the trigger ran" apart from
// "the request was rejected".
func ingestFreshComplianceEvent(t *testing.T, db *sql.DB, eventID string) []string {
	t.Helper()
	var logBuf bytes.Buffer
	body := fmt.Sprintf(`{"events":[{
		"event_id": %q,
		"created_at": %q,
		"scenario": "chat",
		"prompt_length": 12,
		"action_taken": "mask",
		"findings": []
	}]}`, eventID, freshComplianceCreatedAt())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/compliance/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	complianceIngestHandler(db, capturedLogger(&logBuf)).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ingest status=%d body=%s log=%s", rec.Code, rec.Body.String(), logBuf.String())
	}
	var out struct {
		AcceptedIDs []string `json:"accepted_ids"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode ingest response %q: %v", rec.Body.String(), err)
	}
	return out.AcceptedIDs
}

func TestPurgeOldComplianceEvents_ThirtyDayWindowUnchanged(t *testing.T) {
	// 31 vs 29 days brackets the boundary from both sides. One-sided coverage
	// ("old rows go away") passes on a purge that deletes everything.
	const expired = 31 * 24 * time.Hour
	const inWindow = 29 * 24 * time.Hour

	t.Run("window", func(t *testing.T) {
		db := newComplianceTestDB(t)
		seedAgedComplianceEvent(t, db, "au_expired", expired)
		seedAgedComplianceEvent(t, db, "au_in_window", inWindow)

		accepted := ingestFreshComplianceEvent(t, db, "au_fresh")
		if len(accepted) != 1 || accepted[0] != "au_fresh" {
			t.Fatalf("the purge trigger did not accept the new event: accepted_ids=%v", accepted)
		}

		if events, findings := countComplianceRows(t, db, "au_expired"); events != 0 || findings != 0 {
			t.Errorf("an event %d days old survived the %d-day window (events=%d findings=%d).\n"+
				"    Personal disposes of its local compliance ledger on a FIXED window enforced by\n"+
				"    purgeOldComplianceEvents on every ingest. If the window moved, the customer's\n"+
				"    stated local retention policy moved with it — that is a spec change\n"+
				"    (R-compliance-audit-retention-1.S2), not an implementation detail.",
				int(expired.Hours()/24), localComplianceRetentionDays, events, findings)
		}
		if events, findings := countComplianceRows(t, db, "au_in_window"); events != 1 || findings != 1 {
			t.Errorf("an event %d days old was purged inside the %d-day window (events=%d findings=%d).\n"+
				"    Deleting early is the worse half of a retention bug: the evidence a compliance\n"+
				"    audit asks for is gone, and nothing reports that it went.",
				int(inWindow.Hours()/24), localComplianceRetentionDays, events, findings)
		}
		if events, _ := countComplianceRows(t, db, "au_fresh"); events != 1 {
			t.Errorf("the newly ingested event is not in the ledger (events=%d) — the purge ate its own trigger", events)
		}
	})

	t.Run("org_retention_row_does_not_widen_the_window", func(t *testing.T) {
		db := newComplianceTestDB(t)
		// The team-side policy column, planted in this database on purpose. This
		// is a NEGATIVE CONTROL, not a schema claim: arm 3 asserts the real
		// Personal chain does not create it. If the local purge ever learns to
		// read a retention value from a table like this one, 1826 days would
		// keep the expired event and this arm goes red.
		if _, err := db.Exec(`CREATE TABLE organizations (
			org_id TEXT PRIMARY KEY,
			compliance_event_retention_days INTEGER NOT NULL DEFAULT 1826
		)`); err != nil {
			t.Fatalf("plant org retention table: %v", err)
		}
		if _, err := db.Exec(
			`INSERT INTO organizations (org_id, compliance_event_retention_days) VALUES ('org_local', 1826)`); err != nil {
			t.Fatalf("plant org retention row: %v", err)
		}

		seedAgedComplianceEvent(t, db, "au_expired_with_org_policy", expired)
		ingestFreshComplianceEvent(t, db, "au_fresh_with_org_policy")

		if events, findings := countComplianceRows(t, db, "au_expired_with_org_policy"); events != 0 || findings != 0 {
			t.Errorf("a 1826-day org retention policy in the same database kept a %d-day-old local event alive "+
				"(events=%d findings=%d).\n"+
				"    Personal has no master: its disposal window must be the local constant\n"+
				"    localComplianceRetentionDays and nothing else. A local purge that reads a\n"+
				"    team-side policy means a remote console can rewrite what a Personal box keeps,\n"+
				"    which contradicts the premise that Personal does not depend on master\n"+
				"    (R-compliance-audit-retention-1.S2 BUT NOT 不受团队留存期配置影响).",
				int(expired.Hours()/24), events, findings)
		}
	})

	t.Run("personal_schema_carries_no_org_retention_column", func(t *testing.T) {
		db := newComplianceTestDB(t)
		var schema sql.NullString
		if err := db.QueryRow(
			`SELECT group_concat(sql, ';\n') FROM sqlite_master WHERE sql IS NOT NULL`).Scan(&schema); err != nil {
			t.Fatalf("read migrated schema: %v", err)
		}
		// The exact master-side column name (versions_master
		// v1_0_1_alpha9_org_compliance_event_retention.go, Order 11092). Matching
		// the literal name rather than "retention" keeps this from tripping on
		// prose in some future migration's SQL comment.
		if strings.Contains(schema.String, "compliance_event_retention_days") {
			t.Errorf("the Personal migration chain now carries compliance_event_retention_days.\n" +
				"    That column is the TEAM org's retention policy (versions_master, Order 11092).\n" +
				"    Mirroring it into the Personal chain gives the local purge something to read and\n" +
				"    turns Personal's fixed window into a remotely configurable one. If this is\n" +
				"    intended, it is a spec decision for R-compliance-audit-retention-1.S2, not a\n" +
				"    migration detail.")
		}
	})
}
