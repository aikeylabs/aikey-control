package userlocal

// spec: R-compliance-grading-18.S1 · 18.S3 —— 请求级裁决事件在**本机自视图**上也要
// 看得见它关联了哪几条内容行
// (roadmap20260320/技术实现/阶段9-商业化版本/博时基金合规能力融合/openspec/changes/
//  add-compliance-grading-fusion/specs/compliance-grading/spec.md)
//
// # 为什么本机这条线也要接住 escalation(2026-09-11 用户拍板授权)
//
// 累计升级("三个片段各命中一条 L4 → 整条请求被拦")的结论,团队线是另开一条
// `scenario:"request_verdict"` 的事件记账,并用定型字段 `escalation.unit_ids` 指回
// 参与计数的内容行。团队路由的合规事件会被 proxy **镜像**一份到本机自视图
// (MirrorComplianceEventsLocally,2026-09-03 用户决定),所以这条裁决事件也会到这儿。
//
// 不接住的后果不是报错,是**看不出发生了什么**:本机页面会显示三条 `mask` 命中,外加
// 一条孤零零的 `block`,而"这三条就是把它顶上去的那三条"这个信息被静默丢掉了。
// 本机自视图存在的意义就是成员自查「我这条请求为什么被拦」—— 丢了它等于没答。
//
// # 🔴 为什么修法是"声明字段",不是"改成严格解码"
//
// 本机 intake 刻意用宽松解码 + 漂移 WARN(见 compliance_handlers.go 的 wire-drift
// 段):团队线的 400 有 dead_letter 兜底,是「迟到」;本机的 4xx 是**终态** ——
// 探测器本地上传器遇 4xx 直接返回不重试,flush 随即 `batch = batch[:0]`,没有 spool、
// 没有 WAL、没有死信。改严格 = 把「丢一个字段」换成「丢整条事件」,更糟。
// 所以正确做法就是在宽松结构体上把字段声明出来,与团队线同形。
//
// # 能红
//
// 摘掉 complianceEventWire.Escalation 字段声明(或 insertComplianceEvent 里的
// meta["escalation"],或 complianceListHandler 元数据解码里的 e.Escalation)→
// 第一条断言红。这条链有四跳(wire → meta map → SQLite metadata 列 → 扫描结构体 →
// DTO),任何一跳漏掉都不报错、只是变成零值,所以围栏按**整条链**写,断言落在
// HTTP 响应上而不是数据库列上。
//
// SCHEMA:走真 migration 链(newComplianceTestDB),不手搓 CREATE TABLE ——
// 这同时证明了本次没有 schema 变更(字段落在既有 metadata JSON 列里)。

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 🔴 created_at 一律用**相对当下**的时间戳,不写死日期。
//
// 本机 intake 每次 ingest 都会顺手跑一遍 30 天留存清理(purgeOldComplianceEvents,
// 事件驱动、无 cron)。写死日期的 fixture 会在它自己老过 30 天的那一天开始红:
// 事件在**同一次 ingest 里**被插入又被清掉,现象是"HTTP 200、accepted_ids 有它、
// 行却查不到"。同目录的 compliance_wire_drift_test.go 就是这样在 2026-09-09 前后
// 自己红掉的(created_at 写死 2026-08-10,已 33 天)。别再种一颗。
func escalationVerdictPayload() string {
	return `{"events":[{
	"event_id": "rv_8d8dba041f2262deb4d671f2193e298e",
	"created_at": "` + nowRFC3339() + `",
	"scenario": "request_verdict",
	"prompt_length": 0,
	"action_taken": "block",
	"route_source": "team",
	"escalation": {"rule":"min_level=4,min_count=3","counted":3,"unit_ids":["au_p1","au_p2","au_p3"]},
	"findings": []
}]}`
}

// 一条普通内容命中事件:完全不带 escalation —— 存量探测器发的就是这个形状。
func escalationAbsentPayload() string {
	return `{"events":[{
	"event_id": "au_p1",
	"created_at": "` + nowRFC3339() + `",
	"scenario": "chat",
	"prompt_length": 57,
	"action_taken": "mask",
	"detect_latency_ms": 1.0,
	"findings": [{
		"finding_id": "au_p1-f1","rule_id":"ner.char.ID","category":"pii",
		"entity_type":"CN_ID_CARD","severity":"high","confidence":95,
		"start_offset":0,"end_offset":18
	}]
}]}`
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

func TestComplianceIngest_EscalationRoundTrip(t *testing.T) {
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
	post(escalationAbsentPayload())
	post(escalationVerdictPayload())

	rec := httptest.NewRecorder()
	list.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/user/compliance/events?limit=10", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Events []struct {
			EventID     string `json:"event_id"`
			Scenario    string `json:"scenario"`
			ActionTaken string `json:"action_taken"`
			Escalation  *struct {
				Rule    string   `json:"rule"`
				Counted int      `json:"counted"`
				UnitIDs []string `json:"unit_ids"`
			} `json:"escalation"`
		} `json:"events"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list: %v\n%s", err, rec.Body.String())
	}
	if out.Total != 2 || len(out.Events) != 2 {
		t.Fatalf("两条事件都应入库(ingest 的 HTTP 200 不是证据,读回才是):total=%d n=%d\n%s",
			out.Total, len(out.Events), rec.Body.String())
	}

	byID := map[string]int{}
	for i, e := range out.Events {
		byID[e.EventID] = i
	}
	verdict := out.Events[byID["rv_8d8dba041f2262deb4d671f2193e298e"]]
	if verdict.Scenario != "request_verdict" || verdict.ActionTaken != "block" {
		t.Fatalf("裁决行的 scenario/action 没读回:%+v", verdict)
	}
	if verdict.Escalation == nil {
		t.Fatalf("裁决行的 escalation 在 wire→metadata→DB→DTO 这条手工搬运链上被吞了。\n"+
			"本机页面于是只能显示一条孤零零的 block,看不出是哪三条命中把它顶上去的 —— "+
			"而这正是成员自查「我这条请求为什么被拦」要的答案。\n%s", rec.Body.String())
	}
	if verdict.Escalation.Rule != "min_level=4,min_count=3" {
		t.Fatalf("escalation.rule 丢了:%q", verdict.Escalation.Rule)
	}
	if verdict.Escalation.Counted != 3 {
		t.Fatalf("escalation.counted 丢了:%d want 3", verdict.Escalation.Counted)
	}
	if len(verdict.Escalation.UnitIDs) != 3 ||
		verdict.Escalation.UnitIDs[0] != "au_p1" ||
		verdict.Escalation.UnitIDs[1] != "au_p2" ||
		verdict.Escalation.UnitIDs[2] != "au_p3" {
		t.Fatalf("escalation.unit_ids 丢了或变形:%v —— 关联走这个列表,不走 trace", verdict.Escalation.UnitIDs)
	}

	// 不带该字段的事件必须照常入库,并且读回时**没有** escalation ——
	// "存量探测器什么都没说"和"本轮升级计数为 0"是两种状态,不能被抹平成同一种。
	content := out.Events[byID["au_p1"]]
	if content.Escalation != nil {
		t.Fatalf("普通内容命中事件不应读出 escalation:%+v", *content.Escalation)
	}

	// 这是一次扩展,不是 schema 变更,更不该被当成 wire 漂移 —— 若它报漂移,
	// 说明本机根本没声明这个字段,镜像过来的裁决信息一直在被静默丢弃。
	if drift := logLinesWithEvent(t, &logBuf, "userlocal.compliance_ingest.wire_drift_detected"); len(drift) != 0 {
		t.Fatalf("escalation 必须是本 build 已知的 wire 字段,而不是漂移:%v", drift)
	}
}
