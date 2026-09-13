package userlocal

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// The local self-view grading chain: wire → column → SELECT → response JSON.
//
// # Why this is fenced as a CHAIN and not as three fields
//
// This lane is a hand-copied relay: a wire struct, an INSERT column list, a
// SELECT column list, a scan target and a read DTO, each maintained by hand.
// Nothing errors when a field is dropped at one of those hops — it silently
// becomes a zero value, and the page renders "there is nothing here". That
// failure has now happened NINE times in this project; the eighth was this very
// feature on the MASTER side (1.5 wrote level / max_level into the master store
// and not one of the three read SQLs SELECTed them, so the value was written
// and never readable).
//
// So the assertions below deliberately go all the way to the RESPONSE BODY.
// "It is in the database" is the claim that has been true every single time
// this broke.
//
// # NULL must be ABSENT, not zero
//
// R-compliance-grading-1.S2: a hit that maps to no classification leaf has no
// grade. On the wire that is the key being missing, not `"level": 0` — 0 is a
// grade. A test that only checked the graded case would pass against an
// implementation that renders 0 for every ungraded hit, which is the specific
// wrong answer the whole design guards against.
//
// SCHEMA: the REAL migration chain (newComplianceTestDB → versions.UpgradeTo),
// never a hand-written CREATE TABLE.
//
// spec: R-compliance-grading-1.S2 · R-compliance-grading-23.S1
// 需求包 博时基金合规能力融合 任务 5.1 · 验收细则 5.A1
// ---------------------------------------------------------------------------

// gradedIngestPayload is one batch carrying BOTH shapes at once: a graded event
// (max_level, and a finding with level + leaf_path) and an ungraded one that
// omits all three. One batch rather than two so the "absent" case is proven
// against a build that demonstrably CAN write the fields.
//
// created_at comes from freshComplianceCreatedAt() rather than a literal: the
// ingest lane prunes events past the retention window, so a hardcoded date
// silently starts producing "HTTP 200, accepted, but SELECT finds nothing" once
// it ages out. Fenced by fixture_time_fence_test.go.
func gradedIngestPayload() string {
	return fmt.Sprintf(`{"events":[
	  {
	    "event_id": "evt-graded",
	    "created_at": %q,
	    "prompt_length": 42,
	    "action_taken": "block",
	    "max_level": 4,
	    "findings": [{
	      "finding_id": "fnd-graded",
	      "category": "secret",
	      "entity_type": "project_codename",
	      "severity": "high",
	      "confidence": 90,
	      "start_offset": 0,
	      "end_offset": 5,
	      "level": 4,
	      "leaf_path": "公司信息/研发/项目代号"
	    }]
	  },
	  {
	    "event_id": "evt-ungraded",
	    "created_at": %q,
	    "prompt_length": 7,
	    "action_taken": "mask",
	    "findings": [{
	      "finding_id": "fnd-ungraded",
	      "category": "pii",
	      "entity_type": "CN_PHONE",
	      "severity": "low",
	      "confidence": 30,
	      "start_offset": 0,
	      "end_offset": 11
	    }]
	  }
	]}`, freshComplianceCreatedAt(), freshComplianceCreatedAt())
}

// TestComplianceIngest_LevelRoundTripAndAbsentWhenNull is the 5.A1 fence.
//
// 能红 (any one of the four hops):
//   - drop Level/LeafPath/MaxLevel from the wire structs → values arrive as nil
//   - drop them from either INSERT → columns stay NULL
//   - drop them from either SELECT → response keys vanish
//   - drop `omitempty` / render 0 for NULL → the "absent" assertions fail
func TestComplianceIngest_LevelRoundTripAndAbsentWhenNull(t *testing.T) {
	db := newComplianceTestDB(t)
	var logBuf bytes.Buffer
	logger := capturedLogger(&logBuf)

	// --- hop 1+2: wire → columns -------------------------------------------
	rec := httptest.NewRecorder()
	complianceIngestHandler(db, logger).ServeHTTP(rec,
		httptest.NewRequest(http.MethodPost, "/v1/compliance/events", strings.NewReader(gradedIngestPayload())))
	if rec.Code != http.StatusOK {
		t.Fatalf("ingest returned %d, body: %s", rec.Code, rec.Body.String())
	}

	// 🔴 Assert the COLUMNS, not just the HTTP 200. A rejected row still
	// answers 200 here (the lane reports per-event acceptance in the body), so
	// the status code is not evidence of a write.
	assertColumn(t, db, `SELECT max_level FROM local_compliance_events WHERE event_id='evt-graded'`, "4")
	assertColumn(t, db, `SELECT level FROM local_compliance_findings WHERE finding_id='fnd-graded'`, "4")
	assertColumn(t, db, `SELECT leaf_path FROM local_compliance_findings WHERE finding_id='fnd-graded'`, "公司信息/研发/项目代号")
	assertColumnNull(t, db, `SELECT max_level FROM local_compliance_events WHERE event_id='evt-ungraded'`)
	assertColumnNull(t, db, `SELECT level FROM local_compliance_findings WHERE finding_id='fnd-ungraded'`)
	assertColumnNull(t, db, `SELECT leaf_path FROM local_compliance_findings WHERE finding_id='fnd-ungraded'`)

	// --- hop 3+4: SELECT → response JSON -----------------------------------
	// Decoded into map[string]any on purpose: a typed struct would silently
	// tolerate a missing key, and "is the key present" is half of what this
	// test asserts.
	listRec := httptest.NewRecorder()
	complianceListHandler(db, logger).ServeHTTP(listRec,
		httptest.NewRequest(http.MethodGet, "/api/user/compliance/events?limit=10", nil))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list returned %d, body: %s", listRec.Code, listRec.Body.String())
	}
	var body struct {
		Events []map[string]any `json:"events"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode list response: %v\nbody: %s", err, listRec.Body.String())
	}
	byID := map[string]map[string]any{}
	for _, e := range body.Events {
		id, _ := e["event_id"].(string)
		byID[id] = e
	}

	graded, ok := byID["evt-graded"]
	if !ok {
		t.Fatalf("graded event missing from the self-view response entirely\nbody: %s", listRec.Body.String())
	}
	assertJSONNumber(t, graded, "max_level", 4,
		"the event's max_level must be READABLE from the self-view, not merely stored — this is the hop that was missed on the master side (task 4.5)")

	gf := firstFinding(t, graded)
	assertJSONNumber(t, gf, "level", 4, "the finding's level must reach the page")
	if got, _ := gf["leaf_path"].(string); got != "公司信息/研发/项目代号" {
		t.Errorf("finding leaf_path in the response = %q, want %q — same name and meaning as the master column (决策点 41 = A)", got, "公司信息/研发/项目代号")
	}

	ungraded, ok := byID["evt-ungraded"]
	if !ok {
		t.Fatalf("ungraded event missing from the self-view response\nbody: %s", listRec.Body.String())
	}
	// 🔴 ABSENT, not 0. R-compliance-grading-1.S2.
	assertJSONKeyAbsent(t, ungraded, "max_level",
		"an event with no graded finding has NO maximum grade; emitting 0 would invent one and the page would show the lowest grade instead of 未分级")
	uf := firstFinding(t, ungraded)
	assertJSONKeyAbsent(t, uf, "level",
		"a hit that maps to no classification leaf has NO grade; 0 is a grade, not an absence")
	assertJSONKeyAbsent(t, uf, "leaf_path",
		"no leaf matched, so there is no path to report")
}

// --- helpers ---------------------------------------------------------------

func firstFinding(t *testing.T, event map[string]any) map[string]any {
	t.Helper()
	raw, ok := event["findings"].([]any)
	if !ok || len(raw) == 0 {
		t.Fatalf("event %v carries no findings in the response", event["event_id"])
	}
	f, ok := raw[0].(map[string]any)
	if !ok {
		t.Fatalf("finding is not an object: %#v", raw[0])
	}
	return f
}

func assertJSONNumber(t *testing.T, obj map[string]any, key string, want float64, why string) {
	t.Helper()
	v, present := obj[key]
	if !present {
		t.Errorf("response key %q is ABSENT but the value was stored — %s", key, why)
		return
	}
	n, ok := v.(float64)
	if !ok {
		t.Errorf("response key %q is %#v, want the number %v", key, v, want)
		return
	}
	if n != want {
		t.Errorf("response key %q = %v, want %v — %s", key, n, want, why)
	}
}

func assertJSONKeyAbsent(t *testing.T, obj map[string]any, key, why string) {
	t.Helper()
	if v, present := obj[key]; present {
		t.Errorf("response key %q is PRESENT with value %#v, but it must be ABSENT — %s", key, v, why)
	}
}

// assertColumn reads one column straight out of SQLite and compares it as a
// string, so an INTEGER 4 and a TEXT "4" are both accepted — the assertion is
// about the VALUE arriving, and the column's declared type is fenced separately
// in the migration package.
func assertColumn(t *testing.T, db *sql.DB, query, want string) {
	t.Helper()
	var got sql.NullString
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	if !got.Valid {
		t.Errorf("%s returned NULL, want %q — the value did not survive the wire→column hop", query, want)
		return
	}
	if got.String != want {
		t.Errorf("%s = %q, want %q", query, got.String, want)
	}
}

// assertColumnNull is the other half: a field the uploader omitted must land as
// NULL, never as a zero value. 0 is a grade (R-compliance-grading-1.S2), and an
// empty-string leaf_path would claim a leaf named "".
func assertColumnNull(t *testing.T, db *sql.DB, query string) {
	t.Helper()
	var got sql.NullString
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	if got.Valid {
		t.Errorf("%s = %q, want NULL — an omitted grade must stay absent, not become a zero value that looks like a real verdict", query, got.String)
	}
}
