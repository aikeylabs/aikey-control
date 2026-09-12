// compliance_audit_unit_dedupe_test.go — 同一个审计单元重复上报时,findings 不得累加
// (2026-09-08,用户拍板)。
//
// 守的规则:R-compliance-filter-scope-2「审计单元 = "一个会话内的一段违规内容",
// 不是"每个请求"」(workflow/CI/requirements/2026-06-04-compliance-filter-direction-and-scope.md)。
//
// 背景(为什么这条围栏是必需的,不是锦上添花):
// 2026-09-08 起 proxy 把 event_id 改写成内容派生的审计单元 id,于是同一段内容被重扫时,
// 事件本身会被 ON CONFLICT(event_id) DO NOTHING 吸收 —— 但 **findings 的 finding_id 仍然是
// detector 侧 randomFindingID() 的 CSPRNG**,重扫会得到一整套全新 id,ON CONFLICT(finding_id)
// 一条都拦不住,于是它们会原样追加到那个已存在的事件上。
// 用户在合规页面看到的直接后果:那一行的命中计数从「×12」涨成「×24」「×36」——
// 事件层去重了,证据层没有,反而比修复前更难看出问题。
//
// 正确边界:事件没有真正插入(RowsAffected==0)= 这个审计单元已经记过账 = findings 不再写。
// master 侧(aikey-control-master storage.IngestBatch)本来就有等价守卫(按 findings 计数),
// 本地自视图这条路径一直缺,这里补上并固化。
package userlocal

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestComplianceIngest_DuplicateAuditUnitDoesNotAccumulateFindings 模拟"同一段内容
// 被重扫两次":event_id 相同(proxy 派生,内容不变则不变),findings 的 id 全新。
func TestComplianceIngest_DuplicateAuditUnitDoesNotAccumulateFindings(t *testing.T) {
	db := newComplianceTestDB(t)
	srv := httptest.NewServer(complianceIngestHandler(db, capturedLogger(&bytes.Buffer{})))
	t.Cleanup(srv.Close)

	post := func(t *testing.T, body string) {
		t.Helper()
		resp, err := srv.Client().Post(srv.URL+"/v1/compliance/events", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatalf("POST failed: %v", err)
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, resp.Body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("ingest must stay 200, got %d", resp.StatusCode)
		}
	}

	// 同一个审计单元 id(内容+会话不变),但两轮的 finding_id 完全不同 —— 这正是
	// detector CSPRNG 的真实行为。
	// created_at 相对当下计算,不写死日期(理由与围栏见 fixture_time_fence_test.go):
	// 写死的夹具老过 30 天留存窗口就会在同一次 ingest 里被插入又被删掉,
	// 于是这条围栏会莫名其妙地断言成 events=0 而不是它真正要守的去重语义。
	createdAt := freshComplianceCreatedAt()
	batch := func(f1, f2 string) string {
		return `{"events":[{"event_id":"au_same_unit","created_at":"` + createdAt + `",
			"action_taken":"mask","prompt_length":42,
			"findings":[
			  {"finding_id":"` + f1 + `","category":"pii","entity_type":"CN_PHONE","severity":"high","confidence":90,"start_offset":0,"end_offset":11},
			  {"finding_id":"` + f2 + `","category":"pii","entity_type":"CN_PHONE","severity":"high","confidence":90,"start_offset":20,"end_offset":31}
			]}]}`
	}

	post(t, batch("rand_a1", "rand_a2")) // 第 1 轮:真扫
	post(t, batch("rand_b1", "rand_b2")) // 第 2 轮:缓存失效后重扫,detector 铸了全新 finding_id

	var events, findings int
	if err := db.QueryRow(`SELECT COUNT(*) FROM local_compliance_events WHERE event_id='au_same_unit'`).Scan(&events); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM local_compliance_findings WHERE event_id='au_same_unit'`).Scan(&findings); err != nil {
		t.Fatalf("count findings: %v", err)
	}

	if events != 1 {
		t.Errorf("同一个审计单元存成了 %d 行事件,want 1", events)
	}
	if findings != 2 {
		t.Errorf("findings = %d, want 2 —— 重扫用全新 finding_id 把证据又追加了一遍,"+
			"页面上的命中计数会从「×2」涨成「×4」。事件层去重了、证据层没有,"+
			"违反 R-compliance-filter-scope-2「一个审计单元 = 一组 findings」", findings)
	}

	// 首次写入路径必须逐字不变:换一个审计单元照常落库(守卫不能把正常写入也吞了)。
	post(t, strings.Replace(batch("rand_c1", "rand_c2"), "au_same_unit", "au_other_unit", 1))
	var other int
	if err := db.QueryRow(`SELECT COUNT(*) FROM local_compliance_findings WHERE event_id='au_other_unit'`).Scan(&other); err != nil {
		t.Fatalf("count other findings: %v", err)
	}
	if other != 2 {
		t.Errorf("新审计单元的 findings = %d, want 2 —— 守卫把首次写入也拦掉了(过度收紧)", other)
	}
}
