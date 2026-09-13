/**
 * 处置列上那个词——本机自查页把 `action_taken` 显示成什么。
 *
 * 需求包 roadmap20260320/技术实现/阶段9-商业化版本/博时基金合规能力融合,
 * task-execution TODO-24（4.9 在 master 侧交付了同一个出口，自视图这条线当时被
 * 划出范围外，见 pages/master/compliance/action-label.ts 的注释）
 * spec: R-compliance-canned-answer-7（代答在审计上与阻断可区分）
 *
 * # 为什么需要这么一个出口
 *
 * 处置列原本渲染 `action_taken.toUpperCase()`，于是同一页上出现两套说法：筛选下
 * 拉里写「拦截 / 脱敏 / 代答」（走 `complianceActionFilterOptions`），表格和抽屉
 * 里写 `BLOCK / MASK / ANSWER`。代答上线之后这不只是别扭：
 * R-compliance-canned-answer-7.S1 要求两行的取值是「代答」/「拦截」，而大写原始
 * 值给的是两个英文单词。
 *
 * 词表本身早就有了：`@/shared/compliance/action-taken` 的
 * `COMPLIANCE_ACTION_LABEL_KEY`（单一真相源，master 通过 vite alias 引同一份）。
 * 缺的只是「wire 上是 string、词表按枚举索引」这一步的收口：**认识就翻译，不认
 * 识就原样大写**。
 *
 * 🔴 不认识时为什么保留大写原始值，而不是「未知处置」之类的友好词：这是
 * action-taken.ts 里「未知动作画中性灰、chip 上带原始值」的同一个姿态。服务端比
 * 控制台新一个版本时，用户必须看到一个**陌生的**词，而不是一个被本地化过、看起
 * 来像我们支持的词。
 *
 * # 为什么是本页私有而不是 @/shared/compliance/
 *
 * scope 不同：自视图从 `compliancePage.` 取词，master 两个页面从
 * `complianceAudit.` 取词。master 那份把 scope 写死在文件里（比让每个调用点各传
 * 一次更难传错），这份照做，只是写死的是另一个 scope。要合并成一份带 scope 参数
 * 的共享出口就得同时改隔壁仓——记在报告的「遗留项」里，不在本次范围内。
 */
import {
  COMPLIANCE_ACTION_LABEL_KEY,
  type ComplianceActionTaken,
} from '@/shared/compliance/action-taken';

/** 自视图（/user/compliance）的 i18n 命名空间。本树没有 `complianceAudit.` 块。 */
const SELF_VIEW_SCOPE = 'compliancePage' as const;

/**
 * 一个 `action_taken` 值在处置列上显示的词。
 *
 * @param action wire 上的原始字符串（可能是本版本不认识的取值）
 * @param t      i18next 的翻译函数
 */
export function complianceActionText(action: string, t: (key: string) => string): string {
  const key = COMPLIANCE_ACTION_LABEL_KEY[SELF_VIEW_SCOPE][action as ComplianceActionTaken];
  return key ? t(key) : action.toUpperCase();
}
