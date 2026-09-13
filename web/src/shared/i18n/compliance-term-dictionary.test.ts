// @ts-nocheck — vitest-only file using Node built-ins (fs / path / process.cwd).
// The project ships no @types/node dev dep, so the strict project-wide
// `tsc --noEmit` would reject these imports; vitest has the Node types ambient.
// Same pragma + rationale as privacy-claim-scope.test.ts next door.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 合规名词字典 —— 一个概念，两个控制台，一个词。
 *
 * spec: R-compliance-grading-7（名词字典——「敏感等级」与既有四种"档/级"互不混用）
 * 需求包 roadmap20260320/技术实现/阶段9-商业化版本/博时基金合规能力融合, task 4.7
 *
 * ══ 为什么需要这个文件 ══════════════════════════════════════════════════════
 *
 * 分类分级这批功能横跨两个控制台：管理员在 master 看审计台账与复核页
 * （`complianceAudit.*`），员工在自视图看同一批事件（`compliancePage.*`）。
 * **同一个概念在两边是两个 i18n key**，没有任何东西把它们拴在一起——
 * `i18n-key-coverage.test.ts` 只问「key 解析得出来吗」「en/zh 数量对得上吗」，
 * 它对「两个 key 的值是不是同一个词」完全不设防。
 *
 * 实测这就是 4.7 收口时找到的实际状态（2026-09-12，§4 十条任务落地之后）：
 *   · 请求裁决 chip：master `REQUEST VERDICT` / 自视图 `Request verdict`
 *   · 触发的升级规则：master `Escalation rule fired` / 自视图 `Escalation rule`
 *   · 裁决无明细：master `This verdict row carries…` / 自视图 `This verdict carries…`
 *   · 裁决行提示：两边是同一句中文的两种英译
 * 四处的**中文逐字相同**，英文各写各的——因为两边由不同任务、不同时间落地，
 * 而中文那侧碰巧是复制过去的。中文用户看不出问题，英文用户在两个控制台之间
 * 来回时看到的是两套说法。这正是 `quota-noun-parity.test.ts`（2026-08-22
 * 「保护线」）那次的同型问题，只是换了一个功能域。
 *
 * ══ 这个文件守什么 ═════════════════════════════════════════════════════════
 *
 * D1 跨树同名 key 同值 —— `compliance*` 命名空间下两棵树都有的 key，值必须逐字
 *    相同。master 会**原样挂载**自视图那个页面（`compliancePage.*` 因此在两棵
 *    catalog 里各有一份），一侧改字 = 同一个页面在两个控制台读起来不一样。
 * D2 概念对 —— 两个控制台给同一个概念起的两个 key，值必须相同。
 * D3 词条钉死 —— 「敏感等级 / Sensitivity level」「代答 / Answered」「待接线 /
 *    Pending wiring」「分类分级 / Classification」「未分级 / Ungraded」。
 * D4 禁止串档 —— R-compliance-grading-7 的 SHALL NOT：等级轴不得与「隐私档
 *    privacy tier」「密码档 简易级/高级级」「地址档位」「授权档位」「健康
 *    severity」共用词；R-7.S1 另要求等级徽标的 key 不落在 `wireLabel /
 *    forwardedAs` 这两个既有徽标位上。
 *
 * ══ 「代答」在英文里为什么是两个词，而这不算违反字典 ═══════════════════════
 *
 * 中文「代答」一个词兼两个角色；英文按时态分成了两个，而且是**成系统**的：
 *   · 结果（审计台账里「当时做了什么」）→ `Answered`，与 Block / Mask /
 *     Allow / Warn 同列，全是过去式结果词。
 *   · 配置（策略表与规则表里「要做什么」）→ `Canned answer`，与 Allow / Record
 *     / Warn / Mask / Block 这些动作名同列。
 * 两列本来就是两种语气，硬把 `Answered` 塞进动作列会写出 "Action: Answered"。
 * 所以字典钉的是「结果列只准 Answered、配置面只准 Canned answer」，而不是
 * 「全树只准一个词」——下面 D3 就是按这个口径断言的。
 *
 * ══ 能红（每一条都必须让这个文件变红）══════════════════════════════════════
 *   - 只改一个控制台的裁决 chip / 升级规则 / 无明细文案 → D2 红。
 *   - 把等级徽标前缀从「敏感等级」改成「分级」「等级档」「隐私档」→ D3/D4 红。
 *   - 在分级 / 分类 / 审计文案里写「档」「档位」「severity」「privacy tier」
 *     来指等级 → D4 红。
 *   - 审计结果列的「代答」英文改成 `Canned answer`，或策略动作列改成
 *     `Answered` → D3 红（两列的语气各自钉死）。
 *   - 「未分级」在一处写 Ungraded、另一处写 unrated → D3 红。
 *   - 只在一个仓改这个文件 → 末尾 dual-edit 断言红。
 */

// ── 两棵树的 catalog ─────────────────────────────────────────────────────────

const WEB_ROOT = process.cwd();
const SELF = 'src/shared/i18n/compliance-term-dictionary.test.ts';

/**
 * 这个文件双写进 aikey-control/web 与 aikey-control-master/web，必须逐字节相同，
 * 所以两个 root 都是**推导**出来的（写死字面量会让两个仓的文件不同，dual-edit
 * 断言就失去意义）。
 */
const IS_MASTER = WEB_ROOT.includes('aikey-control-master');
const MASTER_WEB = IS_MASTER
  ? WEB_ROOT
  : WEB_ROOT.replace(`${path.sep}aikey-control${path.sep}`, `${path.sep}aikey-control-master${path.sep}`);
const USER_WEB = IS_MASTER ? WEB_ROOT.replace('aikey-control-master', 'aikey-control') : WEB_ROOT;

const read = (root: string, p: string) => fs.readFileSync(path.join(root, p), 'utf-8');

function flatten(node: unknown, prefix = '', out: Record<string, string> = {}) {
  if (typeof node === 'string') out[prefix] = node;
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

const catalog = (root: string, lng: 'en' | 'zh') =>
  flatten(JSON.parse(read(root, `src/shared/i18n/locales/${lng}/common.json`)));

const CAT: Record<'user' | 'master', Record<'en' | 'zh', Record<string, string>>> = {
  user: { en: catalog(USER_WEB, 'en'), zh: catalog(USER_WEB, 'zh') },
  master: { en: catalog(MASTER_WEB, 'en'), zh: catalog(MASTER_WEB, 'zh') },
};

const LOCALES = ['en', 'zh'] as const;

describe('the fence is not vacuous', () => {
  it('🔴 both consoles’ catalogs are readable and carry the compliance namespace', () => {
    // A missing peer checkout would silently turn every parity assertion below
    // into a comparison of a catalog with itself.
    expect(fs.existsSync(path.join(MASTER_WEB, 'src/shared/i18n/locales/zh/common.json'))).toBe(true);
    expect(MASTER_WEB).not.toBe(USER_WEB);
    for (const side of ['user', 'master'] as const) {
      const n = Object.keys(CAT[side].zh).filter((k) => k.startsWith('compliance')).length;
      expect(n, `${side} console has no compliance* keys — wrong root?`).toBeGreaterThan(20);
    }
  });
});

// ── D1: 跨树同名 key 同值 ────────────────────────────────────────────────────

/**
 * 已知的、**先于本需求包存在**的跨树差异。每条必须写清为什么两边说法不同；
 * 「顺手统一」不是这个文件的权限——改它们要动本包范围之外的既有文案。
 */
const KNOWN_CROSS_TREE_DRIFT: { key: string; why: string }[] = [
  {
    key: 'compliancePacks.kind.tenantCustom',
    why:
      '2026-09-12 实测的既有差异（自视图「租户自定义 / Tenant Custom」，master「自定义 / Custom」），' +
      '不是本包引入的。本项目是单租户部署（feedback_single_tenant_org_hardcoded），管理员台账里说' +
      '「租户」没有意义，所以 master 那侧当年把它去掉了；自视图那侧保留了 wire 值 `tenant_custom` 的直译。' +
      '统一到哪一侧是产品用词决定，已在 task 4.7 报告的「名词不一致清单」里交回控制者，未自行改动。',
  },
];
const DRIFT_EXEMPT = new Set(KNOWN_CROSS_TREE_DRIFT.map((d) => d.key));

describe('D1 — a compliance key present in both consoles says the same thing', () => {
  it('every drift exemption carries a reason, and still drifts', () => {
    for (const { key, why } of KNOWN_CROSS_TREE_DRIFT) {
      expect(why.length, `KNOWN_CROSS_TREE_DRIFT[${key}].why must say why the two consoles differ`).toBeGreaterThan(80);
      const stillDrifts = LOCALES.some(
        (lng) => CAT.user[lng][key] !== undefined && CAT.master[lng][key] !== undefined && CAT.user[lng][key] !== CAT.master[lng][key],
      );
      // An exemption whose two sides now agree is a standing permission for a
      // future one-sided edit. Prune it instead.
      expect(stillDrifts, `${key} no longer drifts — drop it from KNOWN_CROSS_TREE_DRIFT`).toBe(true);
    }
  });

  for (const lng of LOCALES) {
    it(`${lng}: no compliance* key drifts between the two catalogs`, () => {
      const drift: string[] = [];
      for (const [k, v] of Object.entries(CAT.user[lng])) {
        if (!k.startsWith('compliance') || DRIFT_EXEMPT.has(k)) continue;
        const peer = CAT.master[lng][k];
        if (peer !== undefined && peer !== v) drift.push(`${k}\n    user  : ${v}\n    master: ${peer}`);
      }
      expect(
        drift,
        'master mounts the member self-view verbatim, so a one-sided edit means the SAME page\n' +
          'reads differently depending on which console served it. Edit both catalogs.',
      ).toEqual([]);
    });
  }
});

// ── D2: 概念对 ───────────────────────────────────────────────────────────────

/**
 * 同一个概念，管理员台账一份 key、员工自视图一份 key。左边是 master 的
 * `complianceAudit.*`（只住在 master 的 catalog），右边是自视图的
 * `compliancePage.*`（真相源在 aikey-control/web —— 自视图那个页面就住在那儿，
 * master 把它整页挂载并在 main.tsx 里 addResourceBundle 合并那棵树的 catalog，
 * 所以 master 自己的 JSON 里并没有 `compliancePage.verdict*` 这些 key）。
 * 因此左值取 master catalog、右值取 user catalog；D1 再保证两棵树都有的那半不漂。
 */
const CONCEPT_PAIRS: { concept: string; audit: string; selfView: string }[] = [
  { concept: '请求裁决 chip', audit: 'complianceAudit.verdictBadge', selfView: 'compliancePage.verdictBadge' },
  { concept: '裁决行是整条请求的结论', audit: 'complianceAudit.verdictRowHint', selfView: 'compliancePage.verdictRowHint' },
  { concept: '触发的升级规则', audit: 'complianceAudit.verdictRule', selfView: 'compliancePage.verdictRule' },
  { concept: '裁决行没带明细', audit: 'complianceAudit.verdictNoDetail', selfView: 'compliancePage.verdictNoDetail' },
  { concept: '处置=代答', audit: 'complianceAudit.actionAnswer', selfView: 'compliancePage.actionAnswer' },
  { concept: '处置=拦截', audit: 'complianceAudit.actionBlock', selfView: 'compliancePage.actionBlock' },
  { concept: '处置=脱敏', audit: 'complianceAudit.actionMask', selfView: 'compliancePage.actionMask' },
  { concept: '处置=告警', audit: 'complianceAudit.actionWarn', selfView: 'compliancePage.actionWarn' },
  { concept: '处置=只记账', audit: 'complianceAudit.actionAudit', selfView: 'compliancePage.actionAudit' },
  { concept: '处置=放行', audit: 'complianceAudit.actionAllow', selfView: 'compliancePage.actionAllow' },
];

describe('D2 — one concept, one word, in both consoles', () => {
  for (const lng of LOCALES) {
    for (const { concept, audit, selfView } of CONCEPT_PAIRS) {
      it(`${lng}: ${concept} — ${audit} === ${selfView}`, () => {
        const a = CAT.master[lng][audit];
        const b = CAT.user[lng][selfView];
        expect(a, `${audit} missing from the master catalog`).toBeTruthy();
        expect(b, `${selfView} missing from the user catalog`).toBeTruthy();
        expect(b, `the two consoles now call 「${concept}」 different things`).toBe(a);
      });
    }
  }
});

// ── D3: 词条钉死 ─────────────────────────────────────────────────────────────

describe('D3 — the package’s agreed nouns', () => {
  it('zh/en: the level axis is 「敏感等级 / Sensitivity level」', () => {
    for (const side of ['user', 'master'] as const) {
      expect(CAT[side].zh['complianceGrading.levelBadge.prefix'], `${side} zh`).toBe('敏感等级');
      expect(CAT[side].en['complianceGrading.levelBadge.prefix'], `${side} en`).toBe('Sensitivity level');
    }
    // 同一根轴在策略表与审计筛选里也必须用同一个词，不能退化成裸「等级 / Level」。
    expect(CAT.master.zh['complianceGradingPolicy.table.level']).toBe('敏感等级');
    expect(CAT.master.en['complianceGradingPolicy.table.level']).toBe('Sensitivity level');
    expect(CAT.master.zh['complianceAudit.dimMinLevel']).toContain('敏感等级');
    expect(CAT.master.en['complianceAudit.dimMinLevel']).toMatch(/sensitivity level/i);
  });

  it('zh/en: 「未分级」is one word, not Ungraded here and unrated there', () => {
    expect(CAT.master.zh['complianceClassification.levelUnset']).toBe('未分级');
    expect(CAT.master.en['complianceClassification.levelUnset']).toBe('Ungraded');
    for (const side of ['user', 'master'] as const) {
      expect(CAT[side].zh['complianceGrading.levelBadge.unrated'], `${side} zh`).toBe('敏感等级 未分级');
      // Mid-sentence after the prefix, so lower-case — but the SAME lemma.
      expect(CAT[side].en['complianceGrading.levelBadge.unrated'], `${side} en`).toBe('Sensitivity level ungraded');
    }
  });

  it('zh/en: 「代答」— Answered on the outcome column, Canned answer on the config surfaces', () => {
    // 结果列（当时做了什么）。
    for (const k of ['complianceAudit.actionAnswer', 'compliancePage.actionAnswer']) {
      expect(CAT.master.zh[k], `${k} zh`).toBe('代答');
      expect(CAT.master.en[k], `${k} en`).toBe('Answered');
    }
    // 配置面（要做什么）。中文同一个词，英文是动作名。
    for (const k of ['complianceGradingPolicy.action.answer', 'complianceRuleForm.ruleColAnswer']) {
      expect(CAT.master.zh[k], `${k} zh`).toBe('代答');
      expect(CAT.master.en[k], `${k} en`).toBe('Canned answer');
    }
    // 出现在长句里的也必须是同一个词，不能写成 "Answer" / "auto-reply" 之类。
    expect(CAT.master.en['complianceRuleForm.answerTextHint']).toMatch(/Canned answer/);
    expect(CAT.master.zh['complianceRuleForm.answerTextHint']).toContain('代答');
  });

  it('zh/en: 「待接线」is Pending wiring, and 「分类分级」is the Tab name', () => {
    expect(CAT.master.zh['complianceClassification.import.pendingWiring']).toBe('待接线');
    expect(CAT.master.en['complianceClassification.import.pendingWiring']).toBe('Pending wiring');
    expect(CAT.master.zh['complianceClassification.import.rowCreated']).toContain('待接线');
    expect(CAT.master.en['complianceClassification.import.rowCreated']).toMatch(/pending wiring/i);
    expect(CAT.master.zh['complianceClassification.tabLabel']).toBe('分类分级');
    expect(CAT.master.en['complianceClassification.tabLabel']).toBe('Classification');
  });
});

// ── D4: 禁止串档 ─────────────────────────────────────────────────────────────

/**
 * R-compliance-grading-7 的 SHALL NOT。四个既有「档/级」轴各有自己的页面与
 * 徽标位；把它们的词借来指敏感等级，客户会把「高级级」（密码档）读成「高敏感
 * 等级」，这是拍板点 24 写下的原话。
 *
 * 扫描范围刻意排除 `compliancePage.passwordTier.*`：那一块**就是**密码档，
 * 它当然要说「档」。等级轴的地盘是下面这四个前缀。
 */
const LEVEL_AXIS_PREFIXES = [
  'complianceGrading.',
  'complianceGradingPolicy.',
  'complianceClassification.',
  'complianceAudit.',
];

/**
 * 另一条轴**自己的**槽位，不是等级轴借词。
 *
 * 规则严重度（critical / high / medium / low）是探测器规则自带的属性，审计页
 * 用它做筛选维度，与「敏感等级 L1–L5」是两根轴、两个筛选器、两列。R-7 禁的是
 * 「等级轴去用 severity / 档 这些词」，不是「severity 不许出现在合规页面上」——
 * 后者会逼着把一个真实存在的轴改名，那才是制造混乱。
 *
 * 🔴 两根轴并排出现在同一页，本身就是易混点。它们在 zh 侧是分开的（严重度 /
 * 敏感等级），en 侧是分开的（Severity / Sensitivity level），这就是分辨的全部
 * 依据——任何一侧改字都会把两根轴撞到一起。
 */
const OTHER_AXIS_OWN_SLOTS = new Set([
  'complianceAudit.dimSeverity',
  'complianceAudit.sevCritical',
  'complianceAudit.sevHigh',
  'complianceAudit.sevMedium',
  'complianceAudit.sevLow',
]);

const FOREIGN_TIER_WORDS: { id: string; re: RegExp }[] = [
  { id: 'zh:档', re: /档/ },
  { id: 'en:privacy-tier', re: /privacy tier/i },
  { id: 'en:password-tier', re: /password tier/i },
  { id: 'en:severity', re: /\bseverity\b/i },
];

describe('D4 — the level axis never borrows another tier’s word', () => {
  for (const lng of LOCALES) {
    it(`${lng}: no grading/classification/audit string names 档 / privacy tier / severity`, () => {
      const offenders: string[] = [];
      for (const side of ['user', 'master'] as const) {
        for (const [k, v] of Object.entries(CAT[side][lng])) {
          if (!LEVEL_AXIS_PREFIXES.some((p) => k.startsWith(p))) continue;
          if (OTHER_AXIS_OWN_SLOTS.has(k)) continue;
          const hits = FOREIGN_TIER_WORDS.filter((w) => w.re.test(v)).map((w) => w.id);
          if (hits.length) offenders.push(`${side}.${lng}.${k} [${hits.join(',')}] → ${v.slice(0, 120)}`);
        }
      }
      expect(
        offenders,
        '「敏感等级 L1–L5」must not share a word with 隐私档 / 密码档 / 地址档位 / 授权档位 / 健康 severity\n' +
          '(R-compliance-grading-7). A customer reading 「高级级」as 「高敏感等级」is the failure this forbids.',
      ).toEqual([]);
    });
  }
});

describe('D4 — the rule-severity axis keeps its own word', () => {
  it('严重度 / Severity and 敏感等级 / Sensitivity level stay two different words', () => {
    // They are two filter dimensions on the SAME audit toolbar. The only thing
    // keeping them apart for the reader is that they are named differently.
    expect(CAT.master.zh['complianceAudit.dimSeverity']).toBe('严重度');
    expect(CAT.master.en['complianceAudit.dimSeverity']).toBe('Severity');
    expect(CAT.master.zh['complianceAudit.dimMinLevel']).not.toBe(CAT.master.zh['complianceAudit.dimSeverity']);
    expect(CAT.master.en['complianceAudit.dimMinLevel']).not.toBe(CAT.master.en['complianceAudit.dimSeverity']);
  });
});

describe('D4 — the level badge occupies its own slot (R-compliance-grading-7.S1)', () => {
  it('no complianceGrading key is spelled as one of the wire-label badge slots', () => {
    const clashing = Object.keys(CAT.master.zh)
      .filter((k) => k.startsWith('complianceGrading'))
      .filter((k) => /wireLabel|forwardedAs/i.test(k));
    expect(clashing, 'the level badge must not reuse the wire-state badge keys').toEqual([]);
  });
});

// ── dual-edit ────────────────────────────────────────────────────────────────

describe('dual-edit', () => {
  it('🔴 this fence is byte-identical in aikey-control/web and aikey-control-master/web', () => {
    const peerRoot = IS_MASTER ? USER_WEB : MASTER_WEB;
    expect(read(peerRoot, SELF), `${SELF} drifted between the two web repos — dual-edit it`).toBe(
      read(WEB_ROOT, SELF),
    );
  });
});
