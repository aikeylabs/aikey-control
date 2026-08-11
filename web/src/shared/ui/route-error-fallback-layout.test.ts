// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-11 user request: the page-level error fallback was a 512px card
// floating in the middle of a 1500px content area, wrapped in a red outline. It
// read as a modal someone forgot to dismiss, and the alarm framing argued that
// the console was broken when in fact ONE page was.
//
// Redesigned as a full-width band (SuperDesign project "AiKey Route Error
// Boundary", variant B). Goal in the user's words: 更友好，让用户更容易接受，
// 更好的容忍性 — friendlier, easier to accept, more forgiving.
//
// These are the properties that make it that, each of which a later edit could
// undo without any test noticing.
const SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'src/shared/ui/RouteErrorBoundary.tsx'),
  'utf-8',
);

describe('the route error fallback stays a calm full-width band', () => {
  it('does not go back to a centred fixed-width card', () => {
    // 能红: restore `flex items-start justify-center p-8` + `max-w-lg`.
    expect(SRC, 'the page fallback is centred again — a narrow card adrift in a wide '
      + 'content area is what the 2026-08-11 redesign removed')
      .not.toMatch(/items-start justify-center p-8/);
    expect(SRC, 'the page fallback is width-capped again').not.toMatch(/max-w-lg/);
  });

  it('does not wrap the whole message in alarm colour', () => {
    // The PAGE variant borders with --border; only the small icon carries
    // --destructive. (The inline/modal variant keeps its red edge: inside a
    // dialog the band has no room and the edge is the only framing there is.)
    const pageStyle = /inline\s*$\s*\?\s*\{ backgroundColor: 'var\(--card\)', borderColor: 'var\(--destructive[^}]*\}\s*:\s*\{ backgroundColor: 'var\(--card\)', borderColor: 'var\(--border\)' \}/m;
    expect(pageStyle.test(SRC), 'the page variant outlines itself in --destructive again. '
      + 'One page failing inside a healthy console should not be framed as the console '
      + 'being on fire; the wording carries the severity, not a red box').toBe(true);
  });

  it('keeps the copy bilingual and provider-agnostic', () => {
    // The boundary must render when i18n itself failed to mount, so its copy is
    // inline in both languages by design (see the component's header comment).
    // 能红: replace a literal with a t('…') call.
    for (const phrase of [
      '此页面出现异常 · This page hit an error',
      '此窗口出现异常 · This dialog hit an error',
      '其他页面不受影响',
      'Other pages are unaffected',
    ]) {
      expect(SRC, `the fallback lost its inline bilingual copy: "${phrase}". This component `
        + 'must render when the i18n provider is the thing that crashed').toContain(phrase);
    }
  });

  it('never names console-specific pages', () => {
    // 🔴 This file is a byte-identical dual-edit mirror rendered by BOTH consoles.
    // The SuperDesign draft suggested "go to 供应商账户 or 仪表盘 to check the
    // system" — good instinct, but those are master-console pages and the member
    // console has neither, so half the users would be sent somewhere that does
    // not exist. Recovery guidance here has to be true in both.
    // Scans CODE, not prose: the component's own comment explains why the draft's
    // suggestion was rejected and necessarily names those pages. A fence that
    // cannot tell copy from commentary would force the explanation out of the
    // file, which is where it is most useful.
    // 能红: add any master-only nav label to the rendered copy.
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const label of ['供应商账户', '仪表盘', 'OAuth 账号池', '路由组', '席位与资产']) {
      expect(code, `the fallback tells the user to visit "${label}" — that page exists in only `
        + 'one of the two consoles this component renders in').not.toContain(label);
    }
  });

  it('says what the recovery actions cost', () => {
    // "will this lose my work?" is the actual reason someone hesitates to press
    // either button, so the answer is on screen rather than discoverable by
    // trying it. 能红: delete the line.
    expect(SRC, 'the fallback no longer explains the difference between Retry and Reload — '
      + 'without it the safer action is indistinguishable from the destructive one')
      .toContain('重试只重新加载这一页');
    expect(SRC).toContain('Retry remounts only this page');
  });

  it('offers copy-for-bug-report without opening the stack first', () => {
    // The copy button used to live INSIDE the collapsed detail panel, so
    // reporting a bug required first expanding a wall of stack trace. It is now
    // a first-class action next to Retry.
    expect(SRC).toMatch(/data-testid="route-error-copy"/);
    const copyIdx = SRC.indexOf('data-testid="route-error-copy"');
    const toggleIdx = SRC.indexOf('data-testid="route-error-detail-toggle"');
    expect(copyIdx, 'the copy action is missing').toBeGreaterThan(-1);
    expect(toggleIdx, 'the details toggle is missing').toBeGreaterThan(-1);
    expect(SRC, 'the technical detail should start collapsed — it is secondary')
      .toMatch(/showDetail && \(/);
  });

  it('keeps the dialog variant compact', () => {
    // A full-width band inside a modal would be the same mistake in reverse.
    // 能红: drop the `inline ?` guard on the page padding.
    expect(SRC, 'the inline (modal) variant lost its compact card layout')
      .toMatch(/inline \? 'w-full rounded border p-4 space-y-3'/);
    // Reload is page-scope only: inside a dialog the page is healthy and
    // reloading would discard whatever the operator has on it.
    expect(SRC, 'Reload is no longer gated to the page variant').toMatch(/\{!inline && \(/);
  });
});
