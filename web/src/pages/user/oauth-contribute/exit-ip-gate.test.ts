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
// 2026-09-24 — the verdict moved into the shared module
// src/shared/utils/exit-ip-gate.ts, which the master administrator login dialog
// uses too (master-central-oauth-login design §3.6), so the two consoles cannot
// drift on what "mismatch" or "could not measure" means. Its truth table is
// pinned beside it in src/shared/utils/exit-ip-gate.test.ts. This file keeps
// pinning what only the PAGE can get wrong: it asks the shared verdict (by a
// path the Trial build can resolve) and acts on it, no private IP comparison
// survives beside it, a failed probe still leaves the button live, and the
// deployment's echo is what the probe asks. The former literal assertions
// (`if (ipMismatch || ipProbeFailed) {`) had to go: after the move they would be
// red for no reason, or green forever.
// spec: R-master-central-login-10.S2 成员本机浏览器 OAuth 照常
//
// bugfix: workflow/CI/bugfix/2026-09-04-exit-ip-probe-blocks-oauth-login.md
import { describe, it, expect } from 'vitest';

const source = await import('./index.tsx?raw').then((m) => m.default);

// The page with comments removed: a rationale comment may NAME what the code
// must not do, and a fence that fires on its own explanation cannot be kept.
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The brace-matched `{ … }` body of `function <name>(` in `text`. */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`);
  expect(start, `function ${name} is gone from the page`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces after function ${name}`);
}

describe('Team OAuth exit-IP login gate', () => {
  it('member page imports decideExitIpGate by relative path and branches on it', () => {
    // 🔴 Relative, never through `@`: the Trial composer resolves `@` to
    // master/web/src, which holds no copy of this module and must not grow one.
    expect(code).toMatch(
      /import\s*\{[^}]*\bdecideExitIpGate\b[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/shared\/utils\/exit-ip-gate';/,
    );

    // A failed probe reaches the verdict as "unmeasurable" (mapped any other way,
    // the click would log in without a word — the check silently skipped), and a
    // missing administrator baseline as "no expectation" (the member logs in
    // directly, exactly as before the move).
    expect(code).toMatch(
      /browser:\s*ipTested\s*\?\s*\{\s*kind:\s*'measured',\s*ip:\s*currentIP\s*\}\s*:\s*\{\s*kind:\s*'unmeasurable'\s*\}/,
    );
    expect(code).toMatch(
      /expected:\s*baselineIP\s*\?\s*\{\s*kind:\s*'measured',\s*ip:\s*baselineIP\s*\}\s*:\s*\{\s*kind:\s*'none'\s*\}/,
    );

    // The click acts on the verdict alone: BOTH confirm verdicts open the same
    // dialog (could-not-measure is never stricter than a mismatch), anything
    // else logs in.
    const click = functionBody(code, 'onLoginClick');
    expect(click).toContain("'confirm_mismatch'");
    expect(click).toContain("'confirm_unknown'");
    expect(click).toContain('setLoginConfirmOpen(true)');
    expect(click).toContain('startMut.mutate()');
    expect(click, 'the click must branch on the shared verdict, not re-derive it').not.toMatch(
      /ipMismatch|ipProbeFailed|currentIP|baselineIP/,
    );
    // …and that dialog still explains a probe that could not run in its own words.
    expect(code).toContain('oauthContribute.loginProbeFailedTitle');
    expect(code).toContain('oauthContribute.loginProbeFailedBody');
  });

  it('member page has no inline IP comparison left', () => {
    // Anti-vacuous: stripping comments must have left the page's code in place.
    expect(code).toContain('function onLoginClick()');
    // Any `==` / `!=` / `===` / `!==` with an IP value on either side. The verdict
    // is the shared module's job; a comparison here is a second definition of
    // "mismatch", free to drift from the one the master dialog uses.
    const inline = code.match(/[\w.?]*(?:IP|Ip|_ip)\b\s*[!=]==?|[!=]==?\s*[\w.?]*(?:IP|Ip|_ip)\b/g) ?? [];
    expect(inline, 'compare exit IPs through decideExitIpGate, not inline').toEqual([]);
    // The red styling still keys off ipMismatch — now read from the verdict.
    expect(code).toContain("const ipMismatch = exitIpGate === 'confirm_mismatch';");
  });

  it('does not disable the login button when the probe could not run', () => {
    // A probe that RAN AND FAILED is its own state, not "not tested yet" — the
    // escape hatch below is only as good as this definition.
    expect(code).toContain('const ipProbeFailed = !ipTested && !!ipErr;');
    const disabledExpr = source.match(/disabled=\{startMut\.isPending[^}]*\}/);
    expect(disabledExpr, 'the login button disabled= expression moved or was renamed').not.toBeNull();
    // The whole point: a failed probe must not keep the button disabled.
    expect(disabledExpr![0]).toContain('ipProbeFailed');
    expect(disabledExpr![0]).toBe('disabled={startMut.isPending || (!ipTested && !ipProbeFailed)}');
  });

  it('lets a deployment point the echo at its own endpoint', () => {
    // The promise the old comment made and never kept.
    expect(source).toContain('runtimeConfig.exitIpEchoUrl');
    expect(source).toMatch(/const EXIT_IP_ECHO = .*DEFAULT_EXIT_IP_ECHO/);
    // 🔴 …and the configured echo is what the probe asks. The shared probe takes
    // its URL as an argument; handing it anything else would make the override
    // above dead code again — the exact 2026-09-04 failure.
    expect(code).toContain('fetchBrowserExitIP(EXIT_IP_ECHO)');
  });
});
