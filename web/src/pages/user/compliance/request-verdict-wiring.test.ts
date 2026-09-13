// @ts-nocheck — vitest-only file using Node built-ins (fs / path / process.cwd).
// Same pragma + rationale as i18n-key-coverage.test.ts next door.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 围栏：自查页**真的**把这两类行接到了 request-verdict.ts 上。
 *
 * 需求包 …/博时基金合规能力融合, task-execution TODO-24
 * spec: R-compliance-grading-18.S2（页面区分两类行）
 *
 * 为什么要一条源码扫描：本仓 vitest 没有 jsdom，渲染断言写不了。判据本身由
 * request-verdict.test.ts 钉住，但「页面有没有用它」只有扫源码能答——判据全绿而
 * 页面退回 `×{e.findings.length}` 的写法，用户看到的还是那条「BLOCK + ×0 + 长横
 * 线」的记录，而所有单测依然是绿的。
 *
 * 处置列同理：词表（COMPLIANCE_ACTION_LABEL_KEY）早就有了，页面照样可以退回
 * `action_taken.toUpperCase()`，于是筛选下拉写「拦截」、表格写 `BLOCK`。
 */
const PAGE = path.resolve(process.cwd(), 'src/pages/user/compliance/index.tsx');

/** 只读代码，不读注释——否则把理由写进注释就能骗过扫描。 */
function code(): string {
  return fs
    .readFileSync(PAGE, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('自查页的行类别接线', () => {
  it('从 ./request-verdict 取判据，而不是自己判 scenario', () => {
    const src = code();
    expect(/from '\.\/request-verdict'/.test(src), '页面没有引入 request-verdict').toBe(true);
    expect(/findingsCell\(/.test(src), '页面没有调用 findingsCell —— 两类行又合流了').toBe(true);
    // 判据字面量只能住在 request-verdict.ts 里：页面里再写一份就是第二个真相源。
    expect(
      /'request_verdict'/.test(src),
      "页面里出现了 'request_verdict' 字面量 —— 判据必须只有 request-verdict.ts 一份",
    ).toBe(false);
  });

  it('命中数从 findingsCell 的内容分支来，不再无条件数 findings', () => {
    const src = code();
    expect(
      /×\{e\.findings\.length\}/.test(src),
      '表格又在无条件渲染 ×{e.findings.length} —— 裁决行会重新显示 ×0',
    ).toBe(false);
    expect(/×\{cell\.count\}/.test(src), '内容行的 ×N 没有走 findingsCell').toBe(true);
  });

  it('裁决行说得出触发的升级规则', () => {
    const src = code();
    for (const key of ['compliancePage.verdictRule', 'compliancePage.verdictNoDetail', 'compliancePage.verdictBadge']) {
      expect(src.includes(key), `裁决行不再渲染 ${key}`).toBe(true);
    }
    // 明细来自事件自己的 escalation，不是从 event_id / trace 反推的。
    expect(/cell\.escalation/.test(src), '裁决行没有渲染 escalation').toBe(true);
    expect(
      /replace\(\/\^rv_\//.test(src),
      '页面在从 rv_ 前缀的 event_id 反推 trace —— 关联只能走 escalation.unit_ids',
    ).toBe(false);
  });
});

describe('自查页的处置列词表接线', () => {
  it('处置显示走 complianceActionText，不再是大写原始值', () => {
    const src = code();
    expect(/from '\.\/action-label'/.test(src), '页面没有引入 action-label').toBe(true);
    expect(
      /action_taken\.toUpperCase\(\)/.test(src),
      '处置列又在渲染 action_taken.toUpperCase() —— 筛选下拉写「拦截」而表格写 BLOCK',
    ).toBe(false);
    // 列表行 + 抽屉，两处都必须走同一个出口。
    expect((src.match(/complianceActionText\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
