package userlocal

// Fence for R-compliance-grading-16.S3 — the LOCAL MIRROR STORED ROWS half.
//
// Scenario (stable spec, option A decided by the user 2026-09-15): a request-level
// cumulative escalation SHALL NOT add any hit substring or content-derived value
// (hash / fingerprint) to the wire, the master stored rows or the local mirror
// rows. `context_snippet` is the one explicit, user-approved exception: on this
// store it is the self-view's raw column (compliance_handlers.go header, DC5 as
// it applies here; migration v1_0_0_rc10_local_compliance_context.go).
//
// The proxy side (aikey-proxy/internal/proxy/escalation_wiring_test.go:713)
// checks the mirror REQUEST BODY. This file checks what the real local ingest
// (complianceIngestHandler → insertComplianceEvent) actually PERSISTS in the
// migration-built SQLite store. The batch is shaped like the proxy's mirror
// (MirrorComplianceEventsLocally copies the team event bytes and stamps
// route_source="team"): three content rows plus a `request_verdict` row whose
// `escalation` lands in the metadata JSON column.
//
// Asserted:
//   (1) none of the content derivations of any hit value (sha256 hex, truncated
//       hex, std/url base64 — the same set as escalation_wiring_test.go:888)
//       appears in ANY stored column of ANY table, context_snippet included;
//   (2) the raw hit value appears in no column other than
//       local_compliance_findings.context_snippet — the verdict row and its
//       metadata `escalation` included;
//   anti-vacuity: each raw value IS in context_snippet, and the verdict row's
//   metadata really carries the escalation.
//
// This store has no privacy tier (the tier arms are master-only; see
// aikey-control-master handler_escalation_storage_16s3_test.go).
//
// Columns are NOT hard-coded: every table in sqlite_master and every column of
// every row is scanned.
//
// 能红 (verified in an isolated copy, see
// task-execution/runs/task-todo-103-a-report.md「## 16.S3」):
//   - store sha256(hit) into prompt_hash in insertComplianceEvent → (1) red;
//   - write ContextSnippet into redacted_snippet in insertComplianceEvent → (2) red.
//
// spec: R-compliance-grading-16.S3

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Obviously fake hit values; none is a real identifier.
var grading16S3Hits = []string{
	"FAKEHIT-ALPHA-0000000001",
	"FAKEHIT-BRAVO-0000000002",
	"FAKEHIT-CHARLIE-000000003",
}

func grading16S3MirrorBatch() string {
	now := nowRFC3339()
	const trace = "16s3aaaabbbbccccddddeeeeffff0000"
	var events []string
	var unitIDs []string
	for i, hit := range grading16S3Hits {
		piece := "please review record " + hit + " before noon"
		start := strings.Index(piece, hit)
		eventID := "au_16s3_piece" + strconv.Itoa(i+1)
		unitIDs = append(unitIDs, `"`+eventID+`"`)
		events = append(events, `{
			"event_id":"`+eventID+`","created_at":"`+now+`","tenant_id":"t1",
			"user_id":"u-16s3","proxy_version":"fixture","target_model":"fixture-model",
			"scenario":"anthropic.messages","prompt_length":`+strconv.Itoa(len(piece))+`,
			"action_taken":"mask","prompt_hash":"fixture-salted-prompt-hash-`+strconv.Itoa(i+1)+`",
			"trace_id":"`+trace+`","route_source":"team",
			"findings":[{
				"finding_id":"f-16s3-`+strconv.Itoa(i+1)+`","rule_id":"fixture-rule","category":"pii",
				"entity_type":"FIXTURE_ID","severity":"high","confidence":90,
				"start_offset":`+strconv.Itoa(start)+`,"end_offset":`+strconv.Itoa(start+len(hit))+`,
				"detector":"fixture","level":4,"confirmed":true,
				"redacted_snippet":"please review record {{FIXTURE_ID}} before noon",
				"wire_label":"{{FIXTURE_ID_`+strconv.Itoa(i+1)+`}}",
				"context_snippet":"`+piece+`"
			}]
		}`)
	}
	events = append(events, `{
		"event_id":"rv_16s3_verdict","created_at":"`+now+`","tenant_id":"t1","user_id":"u-16s3",
		"scenario":"request_verdict","prompt_length":0,"action_taken":"block",
		"trace_id":"`+trace+`","route_source":"team",
		"escalation":{"rule":"min_level=4,min_count=3","counted":3,"unit_ids":[`+strings.Join(unitIDs, ",")+`]},
		"findings":[]
	}`)
	return `{"events":[` + strings.Join(events, ",") + `]}`
}

// grading16S3Derivations mirrors derivations() in
// aikey-proxy/internal/proxy/escalation_wiring_test.go:888 (different module,
// so it cannot be imported). Keep the two lists in step.
func grading16S3Derivations(value string) []struct{ what, text string } {
	sum := sha256.Sum256([]byte(value))
	return []struct{ what, text string }{
		{"sha256 hex", hex.EncodeToString(sum[:])},
		{"sha256 hex, truncated to 16 bytes", hex.EncodeToString(sum[:16])},
		{"sha256 hex, truncated to 8 bytes", hex.EncodeToString(sum[:8])},
		{"sha256 base64 (std)", base64.StdEncoding.EncodeToString(sum[:])},
		{"sha256 base64 (url)", base64.RawURLEncoding.EncodeToString(sum[:])},
	}
}

type grading16S3Cell struct{ table, column, value string }

// grading16S3StoredCells returns every non-NULL cell of every table, read from
// the real schema (sqlite_master), so no column list can go stale.
func grading16S3StoredCells(t *testing.T, db *sql.DB) []grading16S3Cell {
	t.Helper()
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan table name: %v", err)
		}
		tables = append(tables, name)
	}
	_ = rows.Close()
	if len(tables) == 0 {
		t.Fatal("no tables found — the scan would inspect nothing")
	}

	var cells []grading16S3Cell
	for _, table := range tables {
		r, err := db.Query(`SELECT * FROM "` + table + `"`)
		if err != nil {
			t.Fatalf("scan table %s: %v", table, err)
		}
		cols, _ := r.Columns()
		for r.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := r.Scan(ptrs...); err != nil {
				_ = r.Close()
				t.Fatalf("scan row of %s: %v", table, err)
			}
			for i, v := range vals {
				var s string
				switch x := v.(type) {
				case nil:
					continue
				case []byte:
					s = string(x)
				case string:
					s = x
				case time.Time:
					s = x.Format(time.RFC3339Nano)
				default:
					s = fmt.Sprint(x)
				}
				cells = append(cells, grading16S3Cell{table: table, column: cols[i], value: s})
			}
		}
		_ = r.Close()
	}
	return cells
}

func TestComplianceIngest_Grading16S3_MirrorStoresNoContentDerivedValue(t *testing.T) {
	db := newComplianceTestDB(t)
	ingest := complianceIngestHandler(db, capturedLogger(&bytes.Buffer{}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/compliance/events", strings.NewReader(grading16S3MirrorBatch()))
	req.Header.Set("Content-Type", "application/json")
	ingest.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ingest: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	// Anti-vacuity: the verdict row really landed with its escalation in metadata.
	var meta sql.NullString
	if err := db.QueryRow(`SELECT metadata FROM local_compliance_events WHERE event_id = 'rv_16s3_verdict'`).Scan(&meta); err != nil {
		t.Fatalf("verdict row not stored (HTTP 200 is not storage evidence): %v", err)
	}
	if !meta.Valid || !strings.Contains(meta.String, `"escalation"`) || !strings.Contains(meta.String, `"counted":3`) {
		t.Fatalf("verdict row metadata does not carry the escalation: %v", meta)
	}

	inSnippet := map[string]bool{}
	for _, c := range grading16S3StoredCells(t, db) {
		for _, hit := range grading16S3Hits {
			for _, d := range grading16S3Derivations(hit) {
				if strings.Contains(c.value, d.text) {
					t.Errorf("(1) %s.%s stores the %s of hit %q — no content-derived value may land in "+
						"any row, context_snippet included (R-compliance-grading-16.S3). value: %s",
						c.table, c.column, d.what, hit, c.value)
				}
			}
			if strings.Contains(c.value, hit) {
				if c.table == "local_compliance_findings" && c.column == "context_snippet" {
					inSnippet[hit] = true
				} else {
					t.Errorf("(2) %s.%s stores the raw hit %q — only context_snippet may hold it "+
						"(R-compliance-grading-16.S3). value: %s", c.table, c.column, hit, c.value)
				}
			}
		}
	}
	for _, hit := range grading16S3Hits {
		if !inSnippet[hit] {
			t.Errorf("raw hit %q is not in local_compliance_findings.context_snippet — the exception "+
				"was never exercised, so assertion (2) would pass vacuously", hit)
		}
	}
}
