/**
 * exit-ip-gate — the browser-hop exit-IP self-check run before an OAuth login
 * page is opened, shared by both consoles:
 *   - the member Team OAuth page (aikey-control/web), by relative import;
 *   - the master administrator login dialog (aikey-control-master/web), by the
 *     package path `aikey-control-web/shared/utils/exit-ip-gate.ts`.
 *
 * WHY one module (roadmap20260320/技术实现/阶段9-商业化版本/master-central-oauth-login
 * design.md §3.6, DEC-master-central-login-4): both consoles must agree on what
 * "this browser leaves from a different IP than the login will" means, and on
 * what happens when that cannot be measured. Two copies of the comparison would
 * drift, and the drift is invisible to a build.
 *
 * 🔴 This file must import nothing through `@`. The Trial composer resolves `@`
 * to master/web/src, and master reaches this file through the package path, so
 * an `@` import here would resolve against master's tree in both builds. For the
 * same reason it is listed in workflow/CI/scripts/web-drift-check.mjs
 * ALIAS_UNREACHABLE, and master/web keeps no copy
 * (aikey-control-master/web/src/shared/exit-ip-gate-single-source.test.ts).
 *
 * DOM-free on purpose (same reason as seat-banner-decision.ts): the verdict is
 * the part that can be wrong in ways no build catches, so a unit fence must be
 * able to reach it (exit-ip-gate.test.ts beside this file).
 */

/**
 * The echo used when a deployment configures none. api.ipify.org is
 * CORS-enabled and answers `{"ip": "…"}`, so a browser fetch can read it; the
 * master baseline is captured server-side from the same host
 * (egress.DefaultEchoURL), so the two sides do not depend on two providers
 * agreeing.
 *
 * 🔴 Unreachable from private / air-gapped deployments and from networks that
 * block it — most of the target market. That is why callers pass their own
 * runtime-configured echo, and why a probe that cannot answer ends in a confirm
 * rather than a disabled button
 * (bugfix: workflow/CI/bugfix/2026-09-04-exit-ip-probe-blocks-oauth-login.md).
 */
export const DEFAULT_EXIT_IP_ECHO = 'https://api.ipify.org?format=json';

/** How long the browser probe waits before the echo counts as unreachable. */
const BROWSER_PROBE_TIMEOUT_MS = 12000;

/**
 * Measures THIS BROWSER's current public exit IP — the IP an OAuth login opened
 * in this same browser window will come from. If the window routes through the
 * account's egress it equals that egress's exit IP; otherwise it is the user's
 * own IP, which is exactly the divergence the self-check exists to catch.
 *
 * Rejects, with a message the page can show, when the echo cannot answer:
 * unreachable, non-2xx, no `ip` in the body, or no answer within 12 s. Callers
 * read a rejection as "unmeasurable" — never as "not tested yet".
 *
 * A blank `echoUrl` falls back to DEFAULT_EXIT_IP_ECHO, so a caller handing over
 * an unset runtime-config field still probes somewhere.
 */
export async function fetchBrowserExitIP(echoUrl: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BROWSER_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(echoUrl.trim() || DEFAULT_EXIT_IP_ECHO, {
      signal: ctrl.signal,
      credentials: 'omit',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { ip?: string };
    const ip = (data.ip ?? '').trim();
    if (!ip) throw new Error('no ip in echo response');
    return ip;
  } finally {
    clearTimeout(timer);
  }
}

/** One side's exit IP, as far as it could be measured. */
export type ExitIpReading = { kind: 'measured'; ip: string } | { kind: 'unmeasurable' };

export interface ExitIpGateInput {
  /** This browser's exit IP: fetchBrowserExitIP's answer, or `unmeasurable` if it rejected. */
  browser: ExitIpReading;
  /**
   * The exit IP the login itself will leave from.
   * - `none`: nothing to compare against. Only the member page passes it — no
   *   administrator baseline has been recorded yet.
   * - `unmeasurable`: a reference should exist but could not be taken. Only the
   *   master dialog passes it — the server-side probe through the login egress
   *   failed.
   */
  expected: ExitIpReading | { kind: 'none' };
}

/**
 * - `open`: open the login page directly.
 * - `confirm_mismatch`: the IPs differ — a red confirm naming both.
 * - `confirm_unknown`: consistency cannot be checked — the same confirm.
 * There is deliberately no "blocked": the gate informs, it never seals the login.
 */
export type ExitIpGateDecision = 'open' | 'confirm_mismatch' | 'confirm_unknown';

/**
 * The verdict for a probe that has finished (design §3.6 truth table,
 * FIG-master-central-login-4). "Not measured yet" never reaches this function:
 * both pages keep the open button disabled until the browser probe settles.
 *
 * spec: R-master-central-login-4.S1 一致时直接放行
 * spec: R-master-central-login-4.S2 不一致时红色确认
 * spec: R-master-central-login-4.S3 测不出时同样只确认
 */
export function decideExitIpGate({ browser, expected }: ExitIpGateInput): ExitIpGateDecision {
  // 🔴 An unmeasurable browser outranks every expectation, "none" included: with
  // no browser IP there is nothing to vouch for, so the user confirms. This is
  // how the member page behaved before the move, and it must never be stricter
  // than a mismatch (bugfix 2026-09-04-exit-ip-probe-blocks-oauth-login).
  if (browser.kind === 'unmeasurable') return 'confirm_unknown';
  switch (expected.kind) {
    case 'none':
      return 'open';
    case 'unmeasurable':
      return 'confirm_unknown';
    case 'measured':
      return browser.ip === expected.ip ? 'open' : 'confirm_mismatch';
  }
}
