/**
 * 「内容命中行」与「请求裁决行」——本机自查页（/user/compliance）的判据。
 *
 * 需求包 roadmap20260320/技术实现/阶段9-商业化版本/博时基金合规能力融合,
 * task-execution TODO-24（4.9 划出的范围外项 + 5.1 只读核证的结论）
 * spec: R-compliance-grading-18.S2（页面区分两类行）
 *       R-compliance-grading-18.S3（历史片段靠 unit_ids 关联）
 *
 * # 这两类行到底差在哪
 *
 * 一次请求里可能有好几段内容分别命中规则，每一段各写一条**内容命中事件**
 * （`action_taken` 是它自己的处置，通常 `mask`）。当命中累计触发组织配置的升级
 * 规则时，另外记一条**请求裁决事件**：它不属于任何一个片段，说的是「整条请求被
 * 怎么处置了」，`scenario` = `request_verdict`，`action_taken` 是升级后的动作
 * （通常 `block`），并携带 `escalation` 明细。团队线的裁决事件会被
 * filter_dispatch.go 的 MirrorComplianceEventsLocally 镜像到本机，所以本页也看
 * 得到它。
 *
 * 🔴 页面在这条改动之前完全没有 `scenario` 的概念，于是裁决行按内容行渲染：
 * 显示 `BLOCK` + 「×0」+ 一条长横线——一条「说自己拦截了、却什么都没命中、也不
 * 说为什么」的记录。服务端 compliance_handlers.go 的注释一字不差地预言过这个
 * 现象。这个模块就是那条判据的唯一出口。
 *
 * # 为什么放在 pages/user/compliance/ 而不是 @/shared/compliance/
 *
 * 本仓的 `src/shared/compliance/*` 是**跨仓单一真相源**：master 通过 vite alias
 * 引的就是这几个文件（master vite.config.ts）。往那里加文件等于同时改了 master
 * 的模块图，而 master 已经有一份自己的 `pages/master/compliance/request-verdict
 * .ts`（4.10 交付，DTO 类型不同：`AuditEventDTO`）。两份同名文件挂在同一个别名
 * 空间下只会让人读不懂谁是谁。判据本身（`scenario` 的字面量、按 unit_ids 关联）
 * 与 master 那份逐字一致，两边各自钉住，合并成一份需要同时改隔壁仓——记在报告
 * 的「遗留项」里，不在本次范围内。
 *
 * # 为什么是纯函数模块
 *
 * 本仓 vitest 没有 jsdom（见 shared/ui/route-error-boundary.test.tsx），渲染断言
 * 写不了。把「这一行是哪一类、这一格该说什么」抽成纯函数，
 * request-verdict.test.ts 就能可执行地钉住它；页面只剩接线，由
 * request-verdict-wiring.test.ts 的源码扫描守。
 */
import type { ComplianceEscalationDTO, ComplianceEventDTO } from '@/shared/api/user/compliance';

/**
 * `compliance_events.scenario` 里标记请求裁决行的值。
 *
 * 🔴 跨仓孪生常量，与 aikey-proxy `internal/proxy/request_verdict.go` 和
 * aikey-control-master `storage.ScenarioRequestVerdict` 逐字一致。一边改了另一边
 * 不改，页面会静默把裁决行当成普通命中行——不报错，只是又变回「×0 + 长横线」。
 */
export const SCENARIO_REQUEST_VERDICT = 'request_verdict';

/**
 * 一条事件是不是请求裁决行。
 *
 * 🔴 判据只有 `scenario` 一个。不能看 `action_taken === 'block'`：阶梯本来就可以
 * 把某一级直接判成 block（那仍是「这个片段被拦了」），而升级动作也未必是 block。
 * 按动作认行，两边都会认错。
 *
 * 未知的 scenario 值按**内容行**处理：本机 lane 入库对未知 scenario 是宽容的
 * （落库 + WARN，不拒收），页面遇到没见过的值应当照常展示，而不是当成裁决行。
 */
export function isRequestVerdict(e: Pick<ComplianceEventDTO, 'scenario'>): boolean {
  return e.scenario === SCENARIO_REQUEST_VERDICT;
}

/**
 * 裁决行携带的升级明细；不是裁决行、或更早版本的代理没带，都返回 `null`。
 *
 * 「没带」是一种正常状态，不是错误：页面要说得出「这条没有明细」，而不是崩掉，
 * 更不能假装列出了证据。wire 上这个字段是 `T | null | undefined` 三态，这里归一
 * 成 `null`，让调用点只需要判一次。
 */
export function eventEscalation(
  e: Pick<ComplianceEventDTO, 'scenario' | 'escalation'>,
): ComplianceEscalationDTO | null {
  if (!isRequestVerdict(e)) return null;
  return e.escalation ?? null;
}

/**
 * 这条裁决行关联到的内容命中行 id 列表。
 *
 * 🔴 关联走 `escalation.unit_ids`，**绝不从 trace 派生**。内容事件 id 是内容派生
 * 的、入库 `ON CONFLICT(event_id) DO NOTHING`（compliance_handlers.go，bugfix
 * 2026-09-08-compliance-audit-unit-id-parasitic-on-cache）；某段内容上一轮已经入
 * 过库，本轮命中判定走缓存并参与累计时，那次 INSERT 被吞掉——库里那一行保留的仍
 * 是**首次入库**的 trace。所以「本轮参与计数的」和「trace 等于本轮 trace 的」是
 * 两个不同的集合，按 trace 关联恰好漏掉历史片段（R-compliance-grading-18.S3）。
 *
 * 本机 lane 的 wire 上**根本没有 trace_id**（complianceAuditEvent 不带该字段，
 * compliance_handlers.go:308 说明了原因），但裁决行的 `event_id` 是 `rv_` + trace
 * 派生的哈希，所以「从 event_id 反推 trace 再关联」是这条 lane 上真实够得着的错
 * 法。围栏钉的就是它。
 */
export function linkedContentEventIds(
  e: Pick<ComplianceEventDTO, 'scenario' | 'escalation'>,
): string[] {
  return eventEscalation(e)?.unit_ids ?? [];
}

/**
 * 表格里「命中」那一格该说什么。
 *
 * 两类行在这里彻底分叉，且分叉点只有这一个：
 *   · `content` —— 照旧数这条事件自己的 findings（页面在这个分支里继续渲染
 *     severity / category chips 和 ×N）。
 *   · `verdict` —— 它没有自己的 findings，`count` 恒为 0，渲染 ×0 是在说
 *     「什么都没命中」，与同一行的 `BLOCK` 直接打架。改说触发的升级规则和参与
 *     计数的命中数，也就是这一行**唯一**要回答的问题：整条请求为什么被拦。
 *
 * 返回判别联合而不是布尔，是为了让「裁决行被当成内容行渲染」这件事有可执行断言：
 * 退回旧写法时 `kind` 会是 `'content'`，测试直接红。
 */
export type ComplianceFindingsCell =
  | { kind: 'content'; count: number }
  | { kind: 'verdict'; escalation: ComplianceEscalationDTO | null };

export function findingsCell(
  e: Pick<ComplianceEventDTO, 'scenario' | 'escalation' | 'findings'>,
): ComplianceFindingsCell {
  if (isRequestVerdict(e)) return { kind: 'verdict', escalation: eventEscalation(e) };
  return { kind: 'content', count: e.findings.length };
}
