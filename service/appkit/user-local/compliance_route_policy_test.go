package userlocal

// spec: R-compliance-grading-8.S1 · R-compliance-grading-17.S2 · R-compliance-grading-18
// —— TODO-171(DEC-compliance-grading-27,用户 2026-09-18 拍板):请求裁决行上的
// `route_policy{min_level,target_provider,unit_ids}` 与 `escalation.counted_is_lower_bound`
// 在**本机入口**也要接住。
//
// # 为什么本机也要声明
//
// Personal 版没有 master,个人路由的裁决行只写本机(R-compliance-grading-24);团队
// 路由的裁决行也会镜像到这里。本机入口是**宽松解码**:不声明 = 字段被静默丢弃,只打
// 一次漂移 WARN —— 成员自查「我这条请求为什么被拦」时看不到「是路由策略拦的」。
//
// 能红:摘掉 complianceEventWire.RoutePolicy(或 insert 的 meta["route_policy"]、或
// list 元数据解码)⇒ ①红;摘掉 complianceEscalationWire.CountedIsLowerBound ⇒ ②红;
// 任一未声明 ⇒ ③(漂移 WARN)红。
//
// SCHEMA:走真 migration 链(newComplianceTestDB);字段落在既有 metadata 列,无迁移。

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestComplianceIngest_RoutePolicyAndLowerBoundRoundTrip(t *testing.T) {
	db := newComplianceTestDB(t)
	var logBuf bytes.Buffer
	logger := capturedLogger(&logBuf)
	ingest := complianceIngestHandler(db, logger)
	list := complianceListHandler(db, logger)

	body := `{"events":[
	{"event_id":"rv_route_only","created_at":"` + nowRFC3339() + `","scenario":"request_verdict","prompt_length":0,"action_taken":"block",
	 "route_policy":{"min_level":4,"target_provider":"anthropic","unit_ids":["au_p1"]},"findings":[]},
	{"event_id":"rv_both","created_at":"` + nowRFC3339() + `","scenario":"request_verdict","prompt_length":0,"action_taken":"warn",
	 "escalation":{"rule":"min_level=4,min_count=3","counted":3,"unit_ids":["au_p1","au_p2","au_p3"],"counted_is_lower_bound":true},
	 "route_policy":{"min_level":4,"unit_ids":[]},"findings":[]},
	{"event_id":"rv_legacy","created_at":"` + nowRFC3339() + `","scenario":"request_verdict","prompt_length":0,"action_taken":"block",
	 "escalation":{"rule":"min_level=4,min_count=3","counted":3,"unit_ids":["au_p1","au_p2","au_p3"]},"findings":[]}
	]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/compliance/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ingest.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ingest status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	list.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/user/compliance/events?limit=10", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Events []map[string]json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	byID := map[string]map[string]json.RawMessage{}
	for _, e := range out.Events {
		var id string
		_ = json.Unmarshal(e["event_id"], &id)
		byID[id] = e
	}

	// ① route_policy 走完 wire → meta → SQLite → DTO。
	var rp struct {
		MinLevel       int      `json:"min_level"`
		TargetProvider *string  `json:"target_provider"`
		UnitIDs        []string `json:"unit_ids"`
	}
	raw, ok := byID["rv_route_only"]["route_policy"]
	if !ok {
		t.Fatalf("route_policy 在本机手工搬运链上被吞了:%s", rec.Body.String())
	}
	_ = json.Unmarshal(raw, &rp)
	if rp.MinLevel != 4 || rp.TargetProvider == nil || *rp.TargetProvider != "anthropic" || len(rp.UnitIDs) != 1 {
		t.Fatalf("route_policy 走样:%s", raw)
	}
	if _, has := byID["rv_route_only"]["escalation"]; has {
		t.Fatalf("只违反路由策略的行不应带 escalation 键")
	}
	// 目标未知 ⇒ target_provider 键缺席,不是空串。
	raw = byID["rv_both"]["route_policy"]
	if raw == nil || strings.Contains(string(raw), "target_provider") {
		t.Fatalf("目标未知时 target_provider 键必须缺席:%s", raw)
	}

	// ② counted_is_lower_bound:true 读回;老行键缺席。
	if !strings.Contains(string(byID["rv_both"]["escalation"]), `"counted_is_lower_bound":true`) {
		t.Fatalf("counted_is_lower_bound 丢了:%s", byID["rv_both"]["escalation"])
	}
	if strings.Contains(string(byID["rv_legacy"]["escalation"]), "counted_is_lower_bound") {
		t.Fatalf("老报文不应出现 counted_is_lower_bound 键:%s", byID["rv_legacy"]["escalation"])
	}
	if _, has := byID["rv_legacy"]["route_policy"]; has {
		t.Fatalf("老报文不应出现 route_policy 键")
	}
}

// TestComplianceIngest_NewVerdictFieldsRaiseNoWireDrift 守 ③:两个新字段是本
// build 已知的 wire 字段;若报漂移,说明本机根本没声明、一直在静默丢弃。
func TestComplianceIngest_NewVerdictFieldsRaiseNoWireDrift(t *testing.T) {
	db := newComplianceTestDB(t)
	var logBuf bytes.Buffer
	ingest := complianceIngestHandler(db, capturedLogger(&logBuf))
	body := `{"events":[{"event_id":"rv_drift","created_at":"` + nowRFC3339() + `","scenario":"request_verdict","prompt_length":0,"action_taken":"block",
	 "escalation":{"rule":"r","counted":1,"unit_ids":["au_p1"],"counted_is_lower_bound":true},
	 "route_policy":{"min_level":4,"target_provider":"anthropic","unit_ids":["au_p1"]},"findings":[]}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/compliance/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ingest.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ingest status=%d", rec.Code)
	}
	if drift := logLinesWithEvent(t, &logBuf, "userlocal.compliance_ingest.wire_drift_detected"); len(drift) != 0 {
		t.Fatalf("route_policy / counted_is_lower_bound 必须是本 build 已知字段,而不是漂移:%v", drift)
	}
}
