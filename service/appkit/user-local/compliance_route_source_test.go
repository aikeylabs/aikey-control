package userlocal

// spec: R-compliance-local-ledger-completeness-1.S3 本机库存储并透出 route_source
// (workflow/CI/requirements/2026-09-03-compliance-local-ledger-completeness.md)
//
// Live-event acceptance for the wire change of 2026-09-03: an ingested event
// carrying `route_source:"team"` (the proxy's local MIRROR of a team-routed
// compliance event) must come back from GET /api/user/compliance/events with
// `route_source:"team"`, and an event without the field (every event the
// detector's own local lane ever sent) must come back without it. HTTP 200 on
// ingest is not the evidence — the read-back is.
//
// SCHEMA: the REAL migration chain (newComplianceTestDB → versions.UpgradeTo),
// no inlined CREATE TABLE — the field lives in the existing metadata JSON
// column, so this also proves no schema change was needed.
//
// 能红: drop `e.RouteSource = meta.RouteSource` from complianceListHandler's
// metadata decode (or `meta["route_source"]` from insertComplianceEvent) → the
// first assertion fails.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func routeSourcePayload(eventID, routeSource string) string {
	rs := ""
	if routeSource != "" {
		rs = fmt.Sprintf(`"route_source": %q,`, routeSource)
	}
	return fmt.Sprintf(`{"events":[{
		"event_id": %q,
		"created_at": "2026-09-03T08:19:31Z",
		"user_id": "u_local",
		"target_model": "gpt-4o-mini",
		"scenario": "chat",
		"prompt_length": 57,
		"action_taken": "mask",
		"detect_latency_ms": 1.0,
		%s
		"findings": [{
			"finding_id": %q,
			"rule_id": "ner.char.PHONE",
			"category": "pii",
			"entity_type": "CN_PHONE",
			"severity": "high",
			"confidence": 70,
			"start_offset": 6,
			"end_offset": 17,
			"redacted_snippet": "我的手机号是 {{PHONE}}",
			"context_snippet": "我的手机号是 13812345678"
		}]
	}]}`, eventID, rs, eventID+"-f1")
}

func TestComplianceIngest_RouteSourceRoundTrip(t *testing.T) {
	db := newComplianceTestDB(t)
	var logBuf bytes.Buffer
	logger := capturedLogger(&logBuf)
	ingest := complianceIngestHandler(db, logger)
	list := complianceListHandler(db, logger)

	post := func(body string) {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/v1/compliance/events", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		ingest.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("ingest status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
	// One mirrored team event, one plain local-lane event (no field at all).
	post(routeSourcePayload("ev-team-mirror", "team"))
	post(routeSourcePayload("ev-local-lane", ""))

	rec := httptest.NewRecorder()
	list.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/user/compliance/events?limit=10", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Events []struct {
			EventID     string `json:"event_id"`
			RouteSource string `json:"route_source"`
			ActionTaken string `json:"action_taken"`
		} `json:"events"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v\n%s", err, rec.Body.String())
	}
	if out.Total != 2 || len(out.Events) != 2 {
		t.Fatalf("expected both events stored (HTTP 200 on ingest is not the evidence — this is): total=%d n=%d\n%s",
			out.Total, len(out.Events), rec.Body.String())
	}
	got := map[string]string{}
	for _, e := range out.Events {
		got[e.EventID] = e.RouteSource
	}
	if got["ev-team-mirror"] != "team" {
		t.Fatalf("mirrored team event lost its route_source on the read side: got %q (the page cannot label the row)\n%s",
			got["ev-team-mirror"], rec.Body.String())
	}
	if got["ev-local-lane"] != "" {
		t.Fatalf("a local-lane event must read back WITHOUT route_source (backward compatible), got %q", got["ev-local-lane"])
	}
	// The field is an extension, not a schema change: it must not trip the
	// wire-drift detector (which would mean an older local-server would have
	// dropped it — the mirror must degrade gracefully, never poison ingest).
	if drift := logLinesWithEvent(t, &logBuf, "userlocal.compliance_ingest.wire_drift_detected"); len(drift) != 0 {
		t.Fatalf("route_source must be a KNOWN wire field on this build, not drift: %v", drift)
	}
}
