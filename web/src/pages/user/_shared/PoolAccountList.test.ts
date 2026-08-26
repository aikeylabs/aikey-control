// @ts-nocheck — vitest executes this file in Node; the product bundle does not
// need Node ambient types merely for the source-level fences at the bottom.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import en from '@/shared/i18n/locales/en/common.json';
import zh from '@/shared/i18n/locales/zh/common.json';

import { knownEpoch, poolAccountTone, quotaPercent, retryTimeState, showRetryTime } from './pool-account-state';

describe('PoolAccountList display derivations', () => {
  it('uses danger only for exhausted and authentication-failed accounts', () => {
    expect(poolAccountTone('window_exhausted')).toBe('danger');
    expect(poolAccountTone('auth_failed')).toBe('danger');
    expect(poolAccountTone('rate_limited')).toBe('warning');
    expect(poolAccountTone('window_protected')).toBe('warning');
    expect(poolAccountTone('upstream_unavailable')).toBe('warning');
    expect(poolAccountTone()).toBe('muted');
  });

  it('renders auth_failed as an actionable re-login state in both locales', () => {
    expect(en.poolAccount.routeStatus.auth_failed).toBe('Sign in again');
    expect(en.poolAccount.loginStatus.auth_failed).toBe('Sign in again');
    expect(en.oauthContribute.status.auth_failed).toBe('Sign in again');
    expect(en.vault.oauthLoginStatus.auth_failed).toBe('Sign in again');
    expect(zh.poolAccount.routeStatus.auth_failed).toBe('需要重新登录');
    expect(zh.poolAccount.loginStatus.auth_failed).toBe('需要重新登录');
    expect(zh.oauthContribute.status.auth_failed).toBe('需要重新登录');
    expect(zh.vault.oauthLoginStatus.auth_failed).toBe('需要重新登录');
  });

  it('preserves unknown utilization and renders an observed zero honestly', () => {
    expect(quotaPercent()).toBeUndefined();
    expect(quotaPercent(Number.NaN)).toBeUndefined();
    expect(quotaPercent(0)).toBe(0);
    expect(quotaPercent(0.424)).toBe(42);
    expect(quotaPercent(2)).toBe(100);
    expect(quotaPercent(-1)).toBe(0);
  });

  it('distinguishes a future recovery from an elapsed window', () => {
    const nowMs = 2_000_000;
    expect(retryTimeState(undefined, nowMs)).toBe('none');
    expect(retryTimeState(2_001, nowMs)).toBe('future');
    expect(retryTimeState(2_000, nowMs)).toBe('elapsed');
    expect(retryTimeState(1_999, nowMs)).toBe('elapsed');
  });

  it('does not render a stale retry time after the account is routable again', () => {
    expect(showRetryTime(undefined, 'future')).toBe(false);
    expect(showRetryTime('', 'elapsed')).toBe(false);
    expect(showRetryTime('window_exhausted', 'future')).toBe(true);
    expect(showRetryTime('window_protected', 'elapsed')).toBe(true);
  });
});

// Window-reset display (P1-4, 2026-08-20). Two gaps this pins:
//   1. `window_7d_reset_at` reached this component and was never read — the
//      weekly reset was invisible in the personal edition entirely;
//   2. the 5h reset was gated behind `route_status`, so a HEALTHY account never
//      showed a reset time even when master had one.
// And the invariant that must not regress: an absent/zero epoch is "not
// observed", never a rendered timestamp (0 would print 1970 and read as a
// window that already reset).
describe('window reset display', () => {
  it('treats absent, zero and non-finite epochs as not observed', () => {
    expect(knownEpoch(undefined)).toBeUndefined();
    expect(knownEpoch(0)).toBeUndefined();
    expect(knownEpoch(-1)).toBeUndefined();
    expect(knownEpoch(Number.NaN)).toBeUndefined();
    expect(knownEpoch(1_750_000_000)).toBe(1_750_000_000);
  });

  it('shows a reset time for a HEALTHY account, which route_status gating hid', () => {
    // A healthy account carries no route_status, so the recovery line stays
    // hidden — that gate is correct for recovery and wrong for a window fact.
    expect(showRetryTime(undefined, retryTimeState(1_750_000_000, 1_000))).toBe(false);
    // The window fact is independent of it.
    expect(knownEpoch(1_750_000_000)).toBe(1_750_000_000);
  });

  it('carries the reset wording in both locales with window and time slots', () => {
    for (const bundle of [en, zh]) {
      const s = bundle.poolAccount.windowResetAt;
      expect(s).toContain('{{window}}');
      expect(s).toContain('{{time}}');
    }
  });
});


/**
 * Compact window-reset display (2026-08-21 user report: "OAuth 账号池的抽屉,
 * 进度条被挤压了 / 简化一点文字").
 *
 * Root cause this pins: the Access Token drawer wraps this component in
 * `font-mono` (pages/user/access-tokens/index.tsx) inside a 480px
 * DetailDrawer. The sentence form "5h 窗口重置 2026年8月11日 14:40" was the
 * widest string in the card, wrapped the observation block over several lines,
 * and crushed the 4px progress track between them. Two things must not
 * regress, and neither is visible to a rendering test of one component in
 * isolation:
 *
 *   1. The reset fact always reaches the user — on the UsageRow when that row
 *      exists, in the observation block otherwise. A window with a known reset
 *      but no utilization observation renders NO row, so deleting the fallback
 *      would silently hide it on freshly-attached accounts.
 *   2. The compact form keeps a full localized sentence as its accessible name.
 *      An icon + "8月11日 14:40" alone is not self-describing.
 *
 * Fenced by scanning the source (whitespace-collapsed, so a formatter re-wrap
 * cannot quietly turn these assertions green) rather than by asserting on a
 * rendered snapshot: the chain here is JSX prop -> CSS class -> stylesheet, and
 * only the source shows all three hops.
 */
const LIST = path.resolve(process.cwd(), 'src/pages/user/_shared/PoolAccountList.tsx');
const CSS = path.resolve(process.cwd(), 'src/pages/user/_shared/keys-page-css.ts');
const flat = (p: string) => fs.readFileSync(p, 'utf-8').replace(/\s+/g, ' ');

describe('compact window-reset display', () => {
  const listSource = flat(LIST);
  const cssSource = flat(CSS);

  it('renders the reset on the usage row without a year', () => {
    // formatDateShort is month+day only; formatDateTime carries the year and
    // is exactly what this change moved off-screen.
    expect(listSource).toContain('formatDateShort(props.resetAt * 1000)');
    expect(listSource).toContain('formatTime(props.resetAt * 1000)');
    expect(listSource).not.toContain('<span>{t(\'poolAccount.windowResetAt\'');
  });

  it('keeps the full sentence as the hover and accessible name', () => {
    expect(listSource).toContain('title={props.resetTitle} aria-label={props.resetTitle}');
    expect(listSource).toContain("t('poolAccount.windowResetAt', { window, time: formatDateTime(epoch * 1000) })");
  });

  it('guards the value side from wrapping so the track is not crushed', () => {
    expect(listSource).toContain('className="pool-account-usage-value"');
    expect(cssSource).toContain('.vault-page .pool-account-usage-value { display: inline-flex; align-items: baseline; gap: 8px; flex-shrink: 0; white-space: nowrap; }');
  });

  it('shows the compact used/remaining pair but keeps the wording on hover', () => {
    // 2026-08-21 user target line: "(— / 93%) [refresh icon] 8月11日 14:40".
    // The words 已用 / 剩余 (used / remaining) are what made this the second
    // longest string on the row; they survive as the title so the bare number
    // pair is never the only explanation available.
    for (const bundle of [en, zh]) {
      expect(bundle.poolAccount.usedAndRemainingShort).toBe('({{used}}% / {{remaining}}%)');
      // The descriptive sentence must NOT be shortened away — it is the title.
      expect(bundle.poolAccount.usedAndRemaining).toContain('{{used}}');
      expect(bundle.poolAccount.usedAndRemaining).toContain('{{remaining}}');
      expect(bundle.poolAccount.usedAndRemaining).not.toBe(bundle.poolAccount.usedAndRemainingShort);
    }
    expect(listSource).toContain("t('poolAccount.usedAndRemainingShort'");
    expect(listSource).toContain('title={props.valueTitle} aria-label={props.valueTitle}');
  });

  /**
   * ONE layout, always (2026-08-22). Until now a quota window was rendered as a
   * progress row only when its utilization had been observed; its cap and reset
   * fell back to a separate text block otherwise. Same two facts, two entirely
   * different layouts, decided by whether a request had ever been routed to the
   * account — and the "never silently drop a fact" rule lived in the correctness
   * of four interlocking conditions, which this file caught getting wrong twice.
   *
   * Rendering the row whenever the window is KNOWN AT ALL removes the branch, so
   * the rule is now structural. An unobserved window shows an EMPTY track and an
   * em dash — never a 0%-wide fill, which is indistinguishable from a measured
   * zero, and never a hidden row.
   */
  it('renders one row per known window, observed or not — no fallback layout', () => {
    expect(listSource).toContain('.filter((w) => w.percent != null || w.cap != null || w.reset != null)');
    expect(listSource).toContain('windows.length > 0 ?');
    expect(listSource).not.toContain('WindowFactLine');
    expect(listSource).not.toContain('hasUsage');
    expect(listSource).not.toContain('reset5hOnRow');
    expect(listSource).not.toContain('reset7dOnRow');
    expect(cssSource).not.toContain('pool-account-window-facts');
  });

  it('shows an unobserved window as an empty track, not a measured zero', () => {
    expect(listSource).toContain('const observed = props.percent != null;');
    expect(listSource).toContain('{observed && (');
    expect(listSource).toContain('aria-valuetext={observed ? undefined : props.unobservedLabel}');
    for (const bundle of [en, zh]) {
      expect(bundle.poolAccount.noObservationShort).toBeTruthy();
    }
  });

  it('says "not observed" in words, never as a bare dash', () => {
    // 2026-08-22: the usage rendered as `—` next to a cap that looked like the
    // usage, so the eye landed on the cap and read the window as nearly spent.
    // A dash is not a word; the reader has to already know what it means.
    expect(listSource).toContain(': props.unobservedLabel}');
    expect(listSource).not.toContain("const UNOBSERVED = '—'");
  });

  it('never renders a bare cap number — the cap must carry its own noun', () => {
    // 🔴 The regression this file exists to prevent (2026-08-22 user:
    // "看起来像是用了93%"). `5h 已用 · 93%` reads as 93% USED; 93% is the
    // anti-ban protection ceiling (oauthgroup/window.go rolls 5h ∈ [93,97]).
    // 能红: restore the concatenation onto the label, or pass a raw number.
    expect(listSource).not.toContain('${props.cap}%');
    expect(listSource).not.toContain('props.label}{props.cap');
    // The usage reads with its subject on the left ("5h 已用 未观测"); the cap
    // and the reset sit on the right, as the things it is measured against.
    expect(listSource).toContain('pool-account-usage-lead');
    expect(listSource).toContain("capText={w.cap != null ? t('poolAccount.protectionLine', { percent: w.cap }) : undefined}");
    // The wording itself must name the concept, in both languages.
    for (const bundle of [en, zh]) {
      expect(bundle.poolAccount.protectionLine).toContain('{{percent}}');
      expect(bundle.poolAccount.protectionLine.replace('{{percent}}%', '').trim().length).toBeGreaterThan(0);
    }
  });

  it('still reaches the cap and the reset when the window was never observed', () => {
    expect(listSource).toContain('resetAt={w.reset}');
    expect(listSource).toContain('resetTitle={w.reset != null ? resetTitle(w.key, w.reset) : undefined}');
  });

  it('reuses the console refresh glyph rather than drawing a new one', () => {
    // Same Feather refresh-cw path as pages/user/import RefreshIcon —
    // "图标使用在所有页面需要保持一致".
    const REFRESH_CW = 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15';
    expect(listSource).toContain(REFRESH_CW);
    expect(flat(path.resolve(process.cwd(), 'src/pages/user/import/index.tsx'))).toContain(REFRESH_CW);
  });
});
