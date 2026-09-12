package userlocal

// 本目录测试夹具的「时间纪律」:时间戳一律相对当下计算,不写死绝对日期。
// 本文件既提供那个helper,也提供强制它的围栏。
//
// # 这是一类问题,不是几个个案
//
// 本机合规 intake 每收一批事件就顺手跑一遍留存清理(purgeOldComplianceEvents,
// 事件驱动、无 cron,窗口 = localComplianceRetentionDays 天)。夹具里写死的
// created_at 在写下那天是「新鲜事件」,但日历会走:老过窗口的那一天起,这一行会在
// **同一次 ingest 里**被插入又被删掉。
//
// 症状极具误导性,也是这条围栏存在的全部理由:
//   HTTP 200 ✅  accepted_ids 里有它 ✅  SELECT 查不到 ❌
// 读起来像「写入失败却报成功」(会把人引去查 INSERT / 事务 / ON CONFLICT),
// 实际是「写进去又被自己删了」。
//
// 已经发生过:compliance_wire_drift_test.go 与 compliance_partial_reject_test.go
// 的 created_at 写死 2026-08-10,在 2026-09-09 前后自己红掉(33 天),
// 与任何在途改动都无关 —— 这类夹具是定时炸弹:今天绿,某天自己变红,
// 而变红的那天没有人改过它,归因成本极高。
//
// # 为什么围栏是「扫源码」而不是「多加一个断言」
//
// 断言只能守住已经存在的那几处;下一条新用例照样可以再种一颗。这个失败模式的
// 单位是「写下一个日期字面量」这个动作本身,所以围栏也按这个动作写:扫本目录
// 全部 *_test.go 的**字符串字面量**(注释不算 —— 注释里写日期是正常的溯源信息),
// 命中形如 20xx-xx-xx 的绝对日期即红。

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// complianceFixtureCreatedAt 返回「距当下 age 之前」的 RFC3339 UTC 时间戳。
//
// 想造一条**故意过期**的事件(测留存清理本身)时,传一个大于留存窗口的 age,
// 例如 complianceFixtureCreatedAt(40 * 24 * time.Hour) —— 过期语义照样是相对
// 计算出来的,不会随日历漂移。
func complianceFixtureCreatedAt(age time.Duration) string {
	return time.Now().UTC().Add(-age).Format(time.RFC3339)
}

// freshComplianceCreatedAt 是「一条刚刚发生的事件」的默认取值:1 小时前。
// 既稳稳落在留存窗口内,也稳稳落在当下之前(不会因时钟抖动变成未来时间)。
func freshComplianceCreatedAt() string { return complianceFixtureCreatedAt(time.Hour) }

// absoluteDateLiteral 匹配时间字面量形态的绝对日期(20xx-xx-xx)。
var absoluteDateLiteral = regexp.MustCompile(`20\d{2}-\d{2}-\d{2}`)

// fenceFileName 是本文件自己的名字(见扫描循环里的跳过理由)。
const fenceFileName = "fixture_time_fence_test.go"

// dateLiteralWaiver 豁免一处**确实不是**喂给时间敏感代码的日期字面量。
// Why 必填:一条没写理由的豁免,和没有围栏是一回事。
type dateLiteralWaiver struct {
	File string // 文件名(不含路径)
	Date string // 被豁免的日期字面量,例如 "2026-05-18"
	Why  string // 为什么它不会随日历失效
}

var dateLiteralWaivers = []dateLiteralWaiver{
	{
		File: "invite_local_api_test.go",
		Date: "2026-05-18",
		Why: "fakeMainSite 的 canResp —— 主站邀请接口的**罐头响应体**,本地 API 原样转发, " +
			"没有任何一跳把它和当下比较(不入合规库、不参与留存清理、断言也只看 code/url)。" +
			"它是一段不透明的上游 payload,不是本机时间轴上的事件,因此不会随日历失效。",
	},
}

// TestFixtureTimestampsAreRelative 是这条纪律的围栏。
//
// 能红:把任意一处 created_at 改回绝对日期(例如 "2026-08-10T01:02:03Z")→
// 本测试立刻红,并点名文件:行号 + 那个日期。
func TestFixtureTimestampsAreRelative(t *testing.T) {
	files, err := filepath.Glob("*_test.go")
	if err != nil {
		t.Fatalf("glob test files: %v", err)
	}

	waived := map[string]string{}
	for _, w := range dateLiteralWaivers {
		if strings.TrimSpace(w.Why) == "" {
			t.Errorf("豁免 %s:%s 没写理由 —— 豁免必须说明为什么这个日期不会随日历失效", w.File, w.Date)
		}
		waived[w.File+":"+w.Date] = w.Why
	}
	used := map[string]bool{}

	fset := token.NewFileSet()
	scanned := 0
	for _, path := range files {
		// 本文件自己不扫:它里面唯一的日期字面量是 dateLiteralWaivers 的**键**
		// (在描述别处的日期),不是夹具。它也不含任何夹具,所以跳过不留缺口。
		if filepath.Base(path) == fenceFileName {
			continue
		}
		scanned++
		// mode 0(不带 parser.ParseComments):注释根本不进 AST,所以下面只可能
		// 看到代码里的字符串字面量 —— 注释里写日期是合法的溯源信息,不该被拦。
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		base := filepath.Base(path)
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			for _, m := range absoluteDateLiteral.FindAllStringIndex(lit.Value, -1) {
				date := lit.Value[m[0]:m[1]]
				key := base + ":" + date
				if _, ok := waived[key]; ok {
					used[key] = true
					continue
				}
				// 反引号原始字符串可能跨很多行,把行号算到日期真正所在那一行。
				line := fset.Position(lit.Pos()).Line + strings.Count(lit.Value[:m[0]], "\n")
				t.Errorf("%s:%d: 测试夹具里写死了绝对日期 %q。\n"+
					"    本机合规 intake 每次 ingest 都跑一遍 %d 天留存清理(purgeOldComplianceEvents),\n"+
					"    这个日期老过窗口的那一天起,这一行会在同一次 ingest 里被插入又被删掉:\n"+
					"    HTTP 200、accepted_ids 里有它、SELECT 却查不到 —— 看着像「写入失败却报成功」。\n"+
					"    改用 freshComplianceCreatedAt();想要一条故意过期的事件就用\n"+
					"    complianceFixtureCreatedAt(40 * 24 * time.Hour),过期语义照样相对计算。\n"+
					"    这个字面量确实不是喂给时间敏感代码的,就往 fixture_time_fence_test.go 的\n"+
					"    dateLiteralWaivers 加一条,并写清理由。",
					base, line, date, localComplianceRetentionDays)
			}
			return true
		})
	}

	// fail-open 的围栏比没有围栏更危险:扫到 0 个文件说明 glob / 排除逻辑坏了,
	// 而它会安静地报绿。
	if scanned == 0 {
		t.Fatal("围栏一个测试文件都没扫到 —— 它自己坏了")
	}

	// 豁免必须还活着。一条不再命中任何东西的豁免 = 理由已经过期却还挂在表上,
	// 下一次它会被当成「这里可以写死日期」的先例。
	for _, w := range dateLiteralWaivers {
		if !used[w.File+":"+w.Date] {
			t.Errorf("豁免 %s:%s 已经不匹配任何字面量了 —— 请把它从 dateLiteralWaivers 删掉"+
				"(留着会变成「这里可以写死日期」的假先例)", w.File, w.Date)
		}
	}
}
