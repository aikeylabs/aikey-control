/**
 * 围栏：本机自查页分得清「内容命中行」和「请求裁决行」。
 *
 * 需求包 …/博时基金合规能力融合, task-execution TODO-24
 * spec: R-compliance-grading-18.S2（页面区分两类行）
 *       R-compliance-grading-18.S3（历史片段靠 unit_ids 关联）
 *
 * 守的是 request-verdict.ts。两条「能红」：
 *   1. 把裁决行按内容行渲染（判据退回 action_taken、或干脆不分）→
 *      `findingsCell` 返回 kind: 'content' → 本文件红。
 *   2. 关联从 trace 派生（本 lane 上真实够得着的错法：`rv_` 前缀的 event_id 反推
 *      trace）→ `linkedContentEventIds` 返回的不是 unit_ids → 本文件红。
 */
import { describe, it, expect } from 'vitest';
import type { ComplianceEventDTO } from '@/shared/api/user/compliance';
import {
  SCENARIO_REQUEST_VERDICT,
  eventEscalation,
  findingsCell,
  isRequestVerdict,
  linkedContentEventIds,
} from './request-verdict';

function event(over: Partial<ComplianceEventDTO> = {}): ComplianceEventDTO {
  return {
    event_id: 'ev_content_1',
    created_at: '2026-09-12T01:00:00Z',
    prompt_length: 128,
    action_taken: 'mask',
    findings: [],
    ...over,
  } as ComplianceEventDTO;
}

/** 一条真实形状的裁决行：rv_ 前缀 id、无 findings、带升级明细。 */
function verdict(over: Partial<ComplianceEventDTO> = {}): ComplianceEventDTO {
  return event({
    event_id: 'rv_9f2c1ab34de5f6079f2c1ab34de5f607',
    scenario: SCENARIO_REQUEST_VERDICT,
    action_taken: 'block',
    findings: [],
    escalation: { rule: 'cumulative_level>=4', counted: 3, unit_ids: ['u_a', 'u_b', 'u_c'] },
    ...over,
  });
}

describe('scenario 是唯一判据', () => {
  it('scenario=request_verdict 是裁决行', () => {
    expect(isRequestVerdict(verdict())).toBe(true);
  });

  it('缺 scenario 的老事件是内容行', () => {
    expect(isRequestVerdict(event())).toBe(false);
  });

  // 🔴 阶梯本来就可以把某一级直接判成 block，那仍是「这个片段被拦了」。
  it('action_taken=block 的内容行不是裁决行', () => {
    expect(isRequestVerdict(event({ action_taken: 'block' }))).toBe(false);
  });

  // 入库对未知 scenario 宽容（落库 + WARN），页面照常按内容行展示。
  it('没见过的 scenario 值按内容行处理', () => {
    expect(isRequestVerdict(event({ scenario: 'something_new' }))).toBe(false);
  });
});

describe('findingsCell —— 裁决行不能按内容行渲染', () => {
  // 能红 ①：这就是改动前页面的行为（×0 + 长横线）。
  it('裁决行给出 verdict 格，而不是 count=0 的内容格', () => {
    const cell = findingsCell(verdict());
    expect(cell.kind).toBe('verdict');
    expect(cell).not.toMatchObject({ kind: 'content' });
    if (cell.kind !== 'verdict') throw new Error('unreachable');
    expect(cell.escalation).toEqual({
      rule: 'cumulative_level>=4',
      counted: 3,
      unit_ids: ['u_a', 'u_b', 'u_c'],
    });
  });

  it('更早版本代理上报的裁决行没有明细，仍是 verdict 格', () => {
    const cell = findingsCell(verdict({ escalation: undefined }));
    expect(cell).toEqual({ kind: 'verdict', escalation: null });
  });

  it('escalation 显式为 null 与缺省同义', () => {
    expect(findingsCell(verdict({ escalation: null }))).toEqual({ kind: 'verdict', escalation: null });
  });

  it('内容行照旧数自己的 findings', () => {
    const e = event({
      findings: [
        { finding_id: 'f1', category: 'pii', entity_type: 'CN_PHONE', severity: 'high', confidence: 90 },
        { finding_id: 'f2', category: 'pii', entity_type: 'CN_NAME', severity: 'medium', confidence: 80 },
      ],
    });
    expect(findingsCell(e)).toEqual({ kind: 'content', count: 2 });
  });

  it('内容行是 block 也仍是内容格', () => {
    expect(findingsCell(event({ action_taken: 'block' })).kind).toBe('content');
  });
});

describe('eventEscalation —— 只有裁决行说得出升级结论', () => {
  it('内容行即便 wire 上带了 escalation 也不认', () => {
    // 内容事件不应该带这个字段；万一带了，把它当成「整条请求被拦」是把一行的
    // 处置读成另一件事（与 bugfix 2026-09-04-warn-rows-look-masked 同型）。
    const e = event({ escalation: { rule: 'x', counted: 1, unit_ids: ['u_a'] } });
    expect(eventEscalation(e)).toBeNull();
  });

  it('三态 wire 归一成 null', () => {
    expect(eventEscalation(verdict({ escalation: null }))).toBeNull();
    expect(eventEscalation(verdict({ escalation: undefined }))).toBeNull();
  });
});

describe('linkedContentEventIds —— 关联走 unit_ids，不从 trace 派生', () => {
  // 能红 ②：unit_ids 与这条裁决行的 event_id（rv_ + trace 派生哈希）没有任何
  // 字面关系。任何「从 event_id 反推 trace 再关联」的实现都拿不到这三个 id。
  it('原样返回 unit_ids，与 rv_ 前缀的 event_id 无关', () => {
    const v = verdict();
    const ids = linkedContentEventIds(v);
    expect(ids).toEqual(['u_a', 'u_b', 'u_c']);
    for (const id of ids) {
      expect(v.event_id).not.toContain(id);
      expect(id).not.toContain(v.event_id.replace(/^rv_/, ''));
    }
  });

  // 历史片段：上一轮就已入库、本轮走缓存参与累计的那一段。它的 id 在 unit_ids
  // 里，但它库里那行保留的是首次入库的 trace——按 trace 关联恰好漏掉它。
  it('unit_ids 里的历史片段一个都不能少', () => {
    const v = verdict({ escalation: { rule: 'r', counted: 2, unit_ids: ['u_this_turn', 'u_earlier_turn'] } });
    expect(linkedContentEventIds(v)).toContain('u_earlier_turn');
  });

  it('没有明细就是空列表，不是崩溃', () => {
    expect(linkedContentEventIds(verdict({ escalation: undefined }))).toEqual([]);
  });

  it('内容行没有关联列表', () => {
    expect(linkedContentEventIds(event())).toEqual([]);
  });
});

describe('跨仓孪生常量', () => {
  // aikey-proxy internal/proxy/request_verdict.go 与 master
  // storage.ScenarioRequestVerdict 都写死这个字面量。
  it('scenario 字面量逐字钉住', () => {
    expect(SCENARIO_REQUEST_VERDICT).toBe('request_verdict');
  });
});
