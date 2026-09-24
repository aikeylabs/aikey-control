/**
 * Fences for the shared exit-IP self-check (exit-ip-gate.ts): the verdict both
 * consoles ask before opening an OAuth login page, and the browser-side probe
 * that feeds it.
 *
 * spec: R-master-central-login-4.S1 一致时直接放行
 * spec: R-master-central-login-4.S2 不一致时红色确认
 * spec: R-master-central-login-4.S3 测不出时同样只确认
 * Truth table: roadmap20260320/技术实现/阶段9-商业化版本/master-central-oauth-login/design.md §3.6
 * (FIG-master-central-login-4 in §5.3).
 *
 * The two ways this goes wrong are both invisible to a build, and each is one
 * branch away from correct:
 *  - a probe that could not run is treated MORE strictly than a mismatch — the
 *    2026-09-04 incident, where the login was sealed shut on every air-gapped
 *    deployment (bugfix: workflow/CI/bugfix/2026-09-04-exit-ip-probe-blocks-oauth-login.md);
 *  - a probe that could not run is treated as fine, and the check is silently
 *    skipped.
 * So every cell of the table is pinned, and so is the probe's timeout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_EXIT_IP_ECHO,
  decideExitIpGate,
  fetchBrowserExitIP,
  type ExitIpGateDecision,
  type ExitIpGateInput,
} from './exit-ip-gate';

const X = '203.0.113.7';
const Y = '198.51.100.9';

// design §3.6, row by row. The last table row ("browser unmeasurable × an IP or
// unmeasurable") is listed as its two concrete inputs.
const CELLS: Array<{ row: string; input: ExitIpGateInput; want: ExitIpGateDecision }> = [
  {
    row: 'browser IP × no expectation (member page only) → open',
    input: { browser: { kind: 'measured', ip: X }, expected: { kind: 'none' } },
    want: 'open',
  },
  {
    row: 'browser IP × the same IP → open',
    input: { browser: { kind: 'measured', ip: X }, expected: { kind: 'measured', ip: X } },
    want: 'open',
  },
  {
    row: 'browser IP × a different IP → red confirm',
    input: { browser: { kind: 'measured', ip: Y }, expected: { kind: 'measured', ip: X } },
    want: 'confirm_mismatch',
  },
  {
    row: 'browser IP × expectation unmeasurable (master only) → confirm',
    input: { browser: { kind: 'measured', ip: X }, expected: { kind: 'unmeasurable' } },
    want: 'confirm_unknown',
  },
  {
    row: 'browser unmeasurable × no expectation → confirm (unmeasurable outranks "none")',
    input: { browser: { kind: 'unmeasurable' }, expected: { kind: 'none' } },
    want: 'confirm_unknown',
  },
  {
    row: 'browser unmeasurable × an expected IP → confirm',
    input: { browser: { kind: 'unmeasurable' }, expected: { kind: 'measured', ip: X } },
    want: 'confirm_unknown',
  },
  {
    row: 'browser unmeasurable × expectation unmeasurable → confirm',
    input: { browser: { kind: 'unmeasurable' }, expected: { kind: 'unmeasurable' } },
    want: 'confirm_unknown',
  },
];

describe('decideExitIpGate', () => {
  it('decides every browser × expected cell', () => {
    for (const { row, input, want } of CELLS) {
      expect(decideExitIpGate(input), row).toBe(want);
    }
    // The table must span both browser kinds × all three expectation kinds;
    // a dropped row would leave a cell nobody checks.
    const covered = new Set(CELLS.map(({ input }) => `${input.browser.kind} × ${input.expected.kind}`));
    expect([...covered].sort()).toEqual([
      'measured × measured',
      'measured × none',
      'measured × unmeasurable',
      'unmeasurable × measured',
      'unmeasurable × none',
      'unmeasurable × unmeasurable',
    ]);
  });
});

describe('fetchBrowserExitIP', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetchBrowserExitIP parses the echo and times out at 12s', async () => {
    // Parses `{ip}` (trimmed), asks the URL it is given, sends no credentials.
    const answering = vi.fn(async () => new Response(JSON.stringify({ ip: ` ${X}\n` }), { status: 200 }));
    vi.stubGlobal('fetch', answering);
    await expect(fetchBrowserExitIP('https://echo.internal.example/ip')).resolves.toBe(X);
    expect(answering).toHaveBeenCalledWith(
      'https://echo.internal.example/ip',
      expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) }),
    );

    // Gives up at 12 s: not earlier (a slow but working echo still counts), and
    // not never (a hanging echo must end as a rejection, which callers read as
    // "unmeasurable" and answer with a confirm instead of waiting forever).
    vi.useFakeTimers();
    let abortedAt: number | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              abortedAt = Date.now();
              reject(new DOMException('This operation was aborted', 'AbortError'));
            });
          }),
      ),
    );
    const startedAt = Date.now();
    const outcome = expect(fetchBrowserExitIP(DEFAULT_EXIT_IP_ECHO)).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(11_999);
    expect(abortedAt, 'the probe gave up before 12 s').toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(abortedAt, 'the probe was still waiting at 12 s').toBe(startedAt + 12_000);
    await outcome;
  });

  it('fetchBrowserExitIP rejects an echo answer that carries no IP', async () => {
    // Each of these must reject (→ "unmeasurable"), never resolve to an empty
    // or made-up IP that would then be compared as if it were a measurement.
    const answers: Array<[string, () => Response, string]> = [
      ['non-2xx', () => new Response('busy', { status: 503 }), 'HTTP 503'],
      ['no ip field', () => new Response(JSON.stringify({ addr: X }), { status: 200 }), 'no ip in echo response'],
      ['blank ip', () => new Response(JSON.stringify({ ip: '  ' }), { status: 200 }), 'no ip in echo response'],
      ['not JSON', () => new Response('<html>blocked</html>', { status: 200 }), 'no ip in echo response'],
    ];
    for (const [label, answer, message] of answers) {
      vi.stubGlobal('fetch', vi.fn(async () => answer()));
      await expect(fetchBrowserExitIP(DEFAULT_EXIT_IP_ECHO), label).rejects.toThrow(message);
    }
  });

  it('fetchBrowserExitIP falls back to the default echo for a blank URL', async () => {
    // A caller handing over an unset runtime-config field still probes somewhere,
    // instead of fetching '' (the page's own URL) and reporting its HTML as "no ip".
    const answering = vi.fn(async () => new Response(JSON.stringify({ ip: X }), { status: 200 }));
    vi.stubGlobal('fetch', answering);
    await expect(fetchBrowserExitIP('   ')).resolves.toBe(X);
    expect(answering).toHaveBeenCalledWith(DEFAULT_EXIT_IP_ECHO, expect.anything());
  });
});
