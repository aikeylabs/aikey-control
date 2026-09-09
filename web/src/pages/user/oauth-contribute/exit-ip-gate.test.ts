// exit-ip-gate.test.ts — the Team OAuth login gate must never be sealed shut by
// a self-check that cannot run.
//
// 🔴 WHAT WENT WRONG (2026-09-04). The login button was
// `disabled={startMut.isPending || !ipTested}`, and `ipTested` only turns true
// when the browser successfully reaches a HARDCODED public echo
// (api.ipify.org). On a private / air-gapped deployment — this product's main
// delivery model — or any network that blocks it, the probe can never succeed,
// so the button was permanently dead with no path forward. The comment above
// the constant claimed it was "overridable for air-gapped deployments" while no
// override existed.
//
// 🔴 WHY THE SHAPE MATTERS, not just the URL. Making the endpoint configurable
// is not the fix on its own: an air-gapped site may have no echo at all. The
// invariant is that a probe which RAN AND FAILED degrades to a warning — the
// same escape hatch a MISMATCHED ip already had. "Measured and wrong" must not
// be more permissive than "could not measure".
//
// bugfix: workflow/CI/bugfix/2026-09-04-exit-ip-probe-blocks-oauth-login.md
import { describe, it, expect } from 'vitest';

const source = await import('./index.tsx?raw').then((m) => m.default);

describe('Team OAuth exit-IP login gate', () => {
  it('treats a failed probe as its own state, not as "not tested yet"', () => {
    expect(source).toContain('const ipProbeFailed = !ipTested && !!ipErr;');
  });

  it('does not disable the login button when the probe could not run', () => {
    const disabledExpr = source.match(/disabled=\{startMut\.isPending[^}]*\}/);
    expect(disabledExpr, 'the login button disabled= expression moved or was renamed').not.toBeNull();
    // The whole point: a failed probe must not keep the button disabled.
    expect(disabledExpr![0]).toContain('ipProbeFailed');
    expect(disabledExpr![0]).toBe('disabled={startMut.isPending || (!ipTested && !ipProbeFailed)}');
  });

  it('routes a failed probe through the same confirm dialog a mismatch uses', () => {
    expect(source).toContain('if (ipMismatch || ipProbeFailed) {');
    expect(source).toContain('oauthContribute.loginProbeFailedTitle');
    expect(source).toContain('oauthContribute.loginProbeFailedBody');
  });

  it('lets a deployment point the echo at its own endpoint', () => {
    // The promise the old comment made and never kept.
    expect(source).toContain('runtimeConfig.exitIpEchoUrl');
    expect(source).toMatch(/const EXIT_IP_ECHO = .*DEFAULT_EXIT_IP_ECHO/);
  });
});
