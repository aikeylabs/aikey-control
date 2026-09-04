// main-flow-gate-registry.test.ts — the commit-time half of the "user can see
// the gate but cannot pass it" defence.
//
// 🔴 WHY A REGISTRY AND NOT A HEURISTIC. Five times in six weeks a member or an
// administrator reached a main-flow gate and had no way through, each time by a
// different mechanism: hidden by CSS (2026-08-22, an incident), a confirm box
// whose value never entered the request (2026-08-31), a button disabled by a
// server verdict the user could not change (2026-09-04), a self-check that could
// not run sealing the gate shut (2026-09-04), a disabled button with no reason
// at all (2026-09-04 sweep). No heuristic recognises all five. What they share
// is that ONE line decided whether the user could proceed — and that line was
// changed, or written, without anyone re-asking "can the user still get out of
// here?".
//
// So this fence does not try to be clever. It PINS the exact gating expression
// of each registered main-flow control. Change the expression and this test goes
// red with the question attached. That is the whole mechanism: it does not judge
// your new expression, it makes you answer for it. `190dd2f` — which appended
// `|| emailMismatch` and killed the OAuth confirm button for a week — would have
// turned this red on the commit that introduced it.
//
// The LIVE half (is it visible, labelled, and accepting clicks in a real layout)
// is aikey-tray/tools/reachability/check.mjs, which gained a disabled assertion
// on 2026-09-04. Neither half replaces the other: this one runs on every commit
// and cannot see CSS; that one sees the real layout but needs the app running.
//
// bugfix: workflow/CI/bugfix/2026-09-04-exit-ip-probe-blocks-oauth-login.md
// bugfix: workflow/CI/bugfix/2026-09-04-browser-oauth-cross-account-confirm-disabled.md
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * A registered main-flow gate: a control the user MUST pass to finish a flow.
 * `gate` is the exact expression that decides whether they can.
 *
 * Rule for `gate`: every term must be something the user can clear WITHOUT
 * leaving the page — their own input, their own acknowledgement, or an
 * in-flight request that will end. A term derived from a server verdict or an
 * external probe belongs here only when the flow ALSO offers a way past it
 * (documented in `escape`).
 */
const GATES: Array<{
  flow: string;
  file: string;
  control: string;
  gate: string;
  escape: string;
}> = [
  {
    flow: 'Team OAuth 贡献账号 → 开始浏览器登录',
    file: '/src/pages/user/oauth-contribute/index.tsx',
    control: 'oauthContribute.startSignIn',
    gate: 'disabled={startMut.isPending || (!ipTested && !ipProbeFailed)}',
    escape:
      'A probe that RAN AND FAILED (ipProbeFailed) leaves the button live and opens the ' +
      'same confirm dialog a mismatched IP does. Removing that term reseals the gate for ' +
      'every air-gapped deployment — bugfix 2026-09-04-exit-ip-probe-blocks-oauth-login.',
  },
  {
    flow: 'Team OAuth 贡献账号 → 确认提交换取到的 token',
    file: '/src/pages/user/oauth-contribute/index.tsx',
    control: 'oauthContribute.confirmSubmit / confirmSubmitMismatch',
    gate: 'disabled={confirmMut.isPending}',
    escape:
      'A cross-account identity is an acknowledged branch, never a block: the click carries ' +
      'identityMismatch as the acknowledgement. Re-adding an identity term here is exactly ' +
      'what 190dd2f did — bugfix 2026-09-04-browser-oauth-cross-account-confirm-disabled.',
  },
];

describe('main-flow gates (member console)', () => {
  for (const g of GATES) {
    it(`${g.flow} — gating expression is unchanged`, () => {
      const source = SOURCES[g.file];
      expect(source, `registered gate file is gone: ${g.file}`).toBeTruthy();
      expect(
        source,
        `The gating expression for「${g.control}」changed.\n` +
          `Expected: ${g.gate}\n\n` +
          `Answer before updating this registry: after your change, can a user who has done ` +
          `everything the page asks STILL get through — or, if not, does the page tell them why ` +
          `and offer a way out?\n\nWhy this gate is shaped the way it is:\n${g.escape}`,
      ).toContain(g.gate);
    });
  }

  it('registry is not silently empty', () => {
    expect(GATES.length).toBeGreaterThan(0);
  });
});
