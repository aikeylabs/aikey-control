package userlocal

// Fence test for the PRODUCING half of the delivery-confirmation contract.
//
// WHAT IS BEING FENCED
//
// complianceIngestHandler is per-event lenient: an event missing event_id or
// action_taken, or one whose INSERT errors, is `continue`d past — and the
// handler still answers HTTP 200. That is the right call for this lane (a 4xx
// here is terminal: the detector's uploader drops the batch without retry and
// there is no spool — see the block comment in compliance_handlers.go), but it
// means the ONLY thing separating "the whole batch landed" from "three rows
// vanished" is the length of accepted_ids.
//
// Until 2026-08-10 nothing on the sending side read that list, so the loss was
// invisible end to end. The consuming half of the fix is fenced in
// ai-compliance-detector/internal/intake/delivery_confirmation_test.go. THIS
// file pins the half that must keep being true for that one to mean anything:
//
//   1. a rejected event really is EXCLUDED from accepted_ids (not silently
//      listed, which would re-blind the uploader while looking correct)
//   2. the rejected event really is ABSENT from the DB — asserted by SELECT,
//      because HTTP 200 has never been入库 evidence
//   3. the surviving events really did land, with their fields intact — the
//      leniency must cost only the bad rows
//   4. the response body is byte-for-byte the shape the uploader parses
//
// 能红验证 (how to prove this fails when the behaviour regresses):
//   - append ev.EventID to `accepted` BEFORE the validation `continue`
//       → assertion (1) and (4) FAIL, while the DB assertions stay green.
//         That combination is exactly the pre-fix world: storage was correct,
//         the receipt lied, and the sender had no way to know.
//   - make the handler 400 on the first bad event instead of continuing
//       → assertion (3) FAILS: the two good events never land. That is the
//         regression this lane cannot afford.
//
// SCHEMA: the REAL migration chain (versions.UpgradeTo), same call
// aikey-trial-server's serve.Run makes at startup — reusing the harness
// compliance_wire_drift_test.go already established. No inlined CREATE TABLE.
//
// TRANSPORT: a real net/http server over a real socket, not httptest.NewRecorder
// — the uploader talks to this over TCP, so the test does too.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// shortAcceptedIDsBody is the exact 200 body this handler must produce for a
// two-event batch where "ev_ok" is valid and "ev_bad" is not. The sending side
// asserts against the identical literal (see the CROSS-REPO CONTRACT note in
// ai-compliance-detector/internal/intake/delivery_confirmation_test.go); the
// two copies are what turn a unilateral wire change into a red test instead of
// a silently re-blinded uploader.
const shortAcceptedIDsBody = `{"accepted_ids":["ev_ok"]}`

// TestComplianceIngest_PartialRejectionIsVisibleToUploader posts a mixed batch
// over real HTTP and checks the receipt against the DB, both directions.
func TestComplianceIngest_PartialRejectionIsVisibleToUploader(t *testing.T) {
	db := newComplianceTestDB(t)
	var logs bytes.Buffer
	srv := httptest.NewServer(complianceIngestHandler(db, capturedLogger(&logs)))
	t.Cleanup(srv.Close)

	// Three events: one good, one missing action_taken, one missing event_id.
	// These are the two validation skips the handler actually performs; the
	// insert-failure branch below them shares the same `continue`, so it
	// produces the same short receipt by construction.
	//
	// created_at 相对当下计算,不写死日期。原夹具是 01:00:00…01:00:03,即四条事件
	// 依次相隔 1 秒 —— 这个间隔保留下来(仍是四个互不相同、递增的时间戳),
	// 只是基准点跟着当下走。写死日期的后果与围栏见 fixture_time_fence_test.go:
	// 本机 intake 每次 ingest 都跑一遍 30 天留存清理,老过窗口的夹具会在同一次
	// ingest 里被插入又被删掉,断言看到的是 stored=0 而不是它真正要守的短回执语义。
	ts := func(i int) string { return complianceFixtureCreatedAt(time.Hour - time.Duration(i)*time.Second) }
	batch := fmt.Sprintf(`{"events":[
		{"event_id":"ev_keep_1","created_at":%q,"action_taken":"mask","prompt_length":10,
		 "findings":[{"finding_id":"ev_keep_1_f1","category":"pii","entity_type":"CN_PHONE","severity":"high","confidence":90,"start_offset":0,"end_offset":11,"context_snippet":"13800138000"}]},
		{"event_id":"ev_no_action","created_at":%q,"prompt_length":20},
		{"event_id":"","created_at":%q,"action_taken":"block","prompt_length":30},
		{"event_id":"ev_keep_2","created_at":%q,"action_taken":"allow","prompt_length":40}
	]}`, ts(0), ts(1), ts(2), ts(3))

	resp, err := srv.Client().Post(srv.URL+"/v1/compliance/events", "application/json", strings.NewReader(batch))
	if err != nil {
		t.Fatalf("POST failed: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("partial rejection must stay 200 (a 4xx is terminal on this lane): got %d, body %s", resp.StatusCode, body)
	}

	// (1) The receipt EXCLUDES what was dropped. This is the entire signal the
	// uploader has; if it ever lists a skipped id, the loss goes invisible again.
	var receipt complianceIngestResponse
	if err := json.Unmarshal(body, &receipt); err != nil {
		t.Fatalf("decode receipt: %v (body=%s)", err, body)
	}
	if len(receipt.AcceptedIDs) != 2 {
		t.Fatalf("accepted_ids = %v, want exactly the 2 valid events — a receipt as long as the batch is a lie", receipt.AcceptedIDs)
	}
	accepted := map[string]bool{}
	for _, id := range receipt.AcceptedIDs {
		accepted[id] = true
	}
	for _, id := range []string{"ev_keep_1", "ev_keep_2"} {
		if !accepted[id] {
			t.Errorf("accepted_ids is missing %s, which did land", id)
		}
	}
	if accepted["ev_no_action"] {
		t.Error("accepted_ids lists ev_no_action, which was skipped — the receipt must not confirm what it dropped")
	}

	// (2)+(3) SELECT is the evidence, not HTTP 200. The good rows are present
	// with their fields; the bad ones are genuinely absent.
	var stored int
	if err := db.QueryRow(`SELECT COUNT(*) FROM local_compliance_events`).Scan(&stored); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if stored != 2 {
		t.Fatalf("stored %d events, want 2 — the receipt and the table must agree", stored)
	}
	var action string
	var promptLength int
	if err := db.QueryRow(`SELECT action_taken, prompt_length FROM local_compliance_events WHERE event_id = ?`, "ev_keep_1").
		Scan(&action, &promptLength); err != nil {
		t.Fatalf("ev_keep_1 row missing — one bad event must not cost the good ones: %v", err)
	}
	if action != "mask" || promptLength != 10 {
		t.Errorf("ev_keep_1 = (%q, %d), want (mask, 10)", action, promptLength)
	}
	var snippet string
	if err := db.QueryRow(`SELECT COALESCE(context_snippet,'') FROM local_compliance_findings WHERE finding_id = ?`, "ev_keep_1_f1").
		Scan(&snippet); err != nil {
		t.Fatalf("ev_keep_1's finding missing: %v", err)
	}
	if snippet != "13800138000" {
		t.Errorf("context_snippet = %q, want the un-redacted local text", snippet)
	}
	var missing int
	if err := db.QueryRow(`SELECT COUNT(*) FROM local_compliance_events WHERE event_id = ?`, "ev_no_action").Scan(&missing); err != nil {
		t.Fatalf("count ev_no_action: %v", err)
	}
	if missing != 0 {
		t.Errorf("ev_no_action is in the table (%d rows) — then the short receipt was wrong", missing)
	}

	// The per-event skip is WARN-logged with the id, so the uploader's line
	// (which names the ids but not the cause) can be joined to a cause here.
	if !strings.Contains(logs.String(), "ev_no_action") {
		t.Errorf("the skipped event must be named in the receiver's log — it is the only place the CAUSE exists\nlog:\n%s", logs.String())
	}
}

// TestComplianceIngest_ReceiptWireShapeIsStable pins the exact bytes the
// uploader parses. Kept separate from the behavioural test above so a wire
// change fails with an unmistakable message rather than as a side effect.
func TestComplianceIngest_ReceiptWireShapeIsStable(t *testing.T) {
	db := newComplianceTestDB(t)
	srv := httptest.NewServer(complianceIngestHandler(db, capturedLogger(&bytes.Buffer{})))
	t.Cleanup(srv.Close)

	// created_at 相对当下(见 fixture_time_fence_test.go)。这条用例只断言回执字节,
	// 但夹具纪律按目录统一 —— 留一颗写死日期的种子,下一个人照抄它就又是一颗雷。
	body := fmt.Sprintf(`{"events":[
		{"event_id":"ev_ok","created_at":%q,"action_taken":"allow","prompt_length":1},
		{"event_id":"ev_bad","created_at":%q,"prompt_length":2}
	]}`, complianceFixtureCreatedAt(time.Hour), complianceFixtureCreatedAt(time.Hour-time.Second))
	resp, err := srv.Client().Post(srv.URL+"/v1/compliance/events", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST failed: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	if got := strings.TrimSpace(string(raw)); got != shortAcceptedIDsBody {
		t.Fatalf("receipt wire shape changed.\n got: %s\nwant: %s\n\nThe sending side parses this exact shape (ai-compliance-detector "+
			"internal/intake/delivery_confirmation_test.go, same literal). If this change is intended, update BOTH copies — "+
			"otherwise the uploader silently stops detecting per-event loss.", got, shortAcceptedIDsBody)
	}
}
