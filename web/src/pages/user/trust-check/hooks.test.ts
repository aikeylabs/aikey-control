/**
 * Fence: useStartTrustLocalService MUST preserve the console error code
 * (TRUST_LOCAL_NOT_INSTALLED vs others) so the banner can pick the
 * right remediation copy.
 *
 * Why this fence exists
 * ---------------------
 * Bugfix 20260525-trust-check-web-uninstalled-vs-offline-confusion.md:
 * the hook previously did `throw new Error(body?.detail || …)`, which
 * stringified into a generic message and dropped the error code. The
 * banner then defaulted to "trust-local is offline — try aikey service
 * restart", which is misleading when the user actually needs
 * `aikey app install degrade-detector`. Telling a not-installed user
 * to "restart" sends them down a dead-end debug rabbit hole.
 *
 * The fence locks two contracts:
 *   F1: `StartServiceError.errorCode` matches the `error` field from
 *       the JSON envelope returned by the console.
 *   F2: When the console returns `{ok:false, error:"TRUST_LOCAL_NOT_INSTALLED"}`,
 *       the hook throws StartServiceError (not bare Error), so the
 *       `instanceof StartServiceError` discrimination in the banner
 *       keeps working.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  StartServiceError,
  fetchTrustLocalServiceStatus,
  normalizeServiceStatus,
  startTrustLocalService,
  useStartTrustLocalService,
  useTrustLocalServiceStatus,
} from './hooks';

// Tiny inline fetch stub — we don't need MSW for two assertions.
let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Helper: build a Response-like object that resp.json() resolves to. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('StartServiceError', () => {
  it('preserves errorCode and detail separately', () => {
    const err = new StartServiceError('TRUST_LOCAL_NOT_INSTALLED', 'binary not found at /Users/...');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StartServiceError);
    expect(err.errorCode).toBe('TRUST_LOCAL_NOT_INSTALLED');
    expect(err.detail).toBe('binary not found at /Users/...');
    // .message MUST equal detail so existing call sites that read
    // err.message keep working (back-compat from the bare-Error days).
    expect(err.message).toBe('binary not found at /Users/...');
    expect(err.name).toBe('StartServiceError');
  });
});

describe('useStartTrustLocalService — error code preservation', () => {
  // These fences call `startTrustLocalService`, the mutationFn the hook
  // actually installs — NOT a copy of it.
  //
  // They used to hand-roll the mutationFn body inline ("behavior here
  // mirrors the source"), which is exactly how a fence rots: the replica
  // kept asserting a `resp.status === 0 ? 'NETWORK_ERROR'` branch for
  // months after that branch became unreachable, and would have stayed
  // green through any rewrite of the real hook. Rewritten 2026-08-14
  // alongside the deadline work in
  // 20260814-trust-check-web-infinite-loading-no-fetch-timeout.md.
  //
  // The React-rendering objection that motivated the replica no longer
  // applies: the request core is exported precisely so the fence can run
  // it without a component, the same way `normalizeServiceStatus` is.

  it('throws StartServiceError with errorCode="TRUST_LOCAL_NOT_INSTALLED" on console 502', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(502, {
        ok: false,
        error: 'TRUST_LOCAL_NOT_INSTALLED',
        detail: 'trust-local binary not found at /Users/jake/.aikey/bin/trust-local. Install via: aikey app install degrade-detector',
      })
    );

    const caught = await startTrustLocalService().catch((e) => e);

    expect(caught).toBeInstanceOf(StartServiceError);
    const err = caught as StartServiceError;
    expect(err.errorCode).toBe('TRUST_LOCAL_NOT_INSTALLED');
    expect(err.detail).toContain('binary not found');
    // Verify hook is properly exported for the banner to call it.
    expect(useStartTrustLocalService).toBeTypeOf('function');
  });

  it('falls back to HTTP_<status> errorCode when console response omits error field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(500, { ok: false, detail: 'unexpected upstream failure' })
    );

    const err = (await startTrustLocalService().catch(
      (e) => e,
    )) as StartServiceError;
    expect(err.errorCode).toBe('HTTP_500');
    expect(err.detail).toBe('unexpected upstream failure');
  });

  it('treats a 200 whose envelope says ok:false as a failure', async () => {
    // The console passes the CLI's `ok` through as the HTTP status, so a
    // 200 + `ok:false` should not happen — but the real mutationFn checks
    // BOTH, and a replica-based fence never proved that second half.
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(200, { ok: false, error: 'START_FAILED', detail: 'launchctl refused' })
    );

    const err = (await startTrustLocalService().catch(
      (e) => e,
    )) as StartServiceError;
    expect(err).toBeInstanceOf(StartServiceError);
    expect(err.errorCode).toBe('START_FAILED');
    expect(err.detail).toBe('launchctl refused');
  });

  it('resolves with the console envelope on success', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { ok: true, detail: 'start succeeded' }));

    await expect(startTrustLocalService()).resolves.toEqual({
      ok: true,
      detail: 'start succeeded',
    });
  });
});

/**
 * Fence: the PROACTIVE install-state signal that lets the banner show
 * "not installed" on first render (not only reactively after a Start click).
 * Bugfix 20260703-trust-check-web-offline-vs-notinstalled-proactive.md.
 *
 * F1: an explicit `installed:false` from the console (same truth source as
 *     `aikey doctor`) is preserved → banner picks the not-installed copy.
 * F2: `installed:true, running:false` stays "installed but offline" → banner
 *     keeps the Start button.
 * F3: a malformed/legacy envelope defaults `installed` to false — we never
 *     claim the plugin is present when we can't confirm it.
 */
describe('normalizeServiceStatus — proactive install-state', () => {
  it('preserves installed:false so the banner shows not-installed upfront', () => {
    const s = normalizeServiceStatus({
      ok: true,
      installed: false,
      running: false,
      detail: 'not installed',
    });
    expect(s.installed).toBe(false);
    expect(s.running).toBe(false);
  });

  it('keeps installed:true + running:false as "offline, not uninstalled"', () => {
    const s = normalizeServiceStatus({
      ok: true,
      installed: true,
      running: false,
      detail: 'not running',
    });
    expect(s.installed).toBe(true);
    expect(s.running).toBe(false);
  });

  it('defaults installed to false on a malformed/empty envelope', () => {
    expect(normalizeServiceStatus({}).installed).toBe(false);
    expect(normalizeServiceStatus(null).installed).toBe(false);
    expect(normalizeServiceStatus(undefined).installed).toBe(false);
  });

  it('exports the hook for the page to call', () => {
    expect(useTrustLocalServiceStatus).toBeTypeOf('function');
  });
});

/**
 * Fence: the console's service-control calls (8090) MUST fail within a
 * bounded time when the console accepts the request and then goes silent.
 *
 * Why this fence exists
 * ---------------------
 * Bugfix 20260814-trust-check-web-infinite-loading-no-fetch-timeout.md,
 * second half. `fetch` has no timeout, so a console whose
 * `aikey service …` spawn wedges left the Start button stuck on
 * "Starting…" forever and the install-state probe pending forever, with
 * no error for the user to act on. Same hole as the trust-local client,
 * different service.
 *
 * NOTE — unlike the two describes above, these fences call the REAL
 * request core (`startTrustLocalService`) rather than a hand-copied
 * replica of `mutationFn`, so a regression in the shipped code actually
 * turns them red. `SERVICE_STATUS_TIMEOUT_MS` is covered through the
 * exported `fetchTrustLocalServiceStatus` core for the same reason.
 *
 * F1: a start request that is never answered rejects, and does so as
 *     StartServiceError — the banner renders `error.detail`, so a bare
 *     Error would show "Start failed: ." with the reason nowhere.
 * F2: the deadline is generous enough to outlast the console's own 40s
 *     exec ceiling — aborting earlier would report "start failed" for a
 *     cold start that then succeeds.
 * F3: the status probe's deadline stays INSIDE its 30s refetch tick, so
 *     a wedged CLI can't leave the probe permanently in flight.
 */
describe('console service-control deadlines', () => {
  /** A fetch that never answers; only an abort signal can end it. */
  const silentFetch = () =>
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('F1: a start that is never answered rejects as StartServiceError', async () => {
    vi.useFakeTimers();
    globalThis.fetch = silentFetch();

    const pending = startTrustLocalService().catch((e) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const err = await pending;

    expect(err).toBeInstanceOf(StartServiceError);
    expect(err.errorCode).toBe('NETWORK_ERROR');
    // The detail is what the banner prints — it has to name the stall
    // and give the user a next step.
    expect(err.detail).toMatch(/did not answer/);
    expect(err.detail).toMatch(/aikey service status/);
  });

  it('F2: the start deadline outlasts the console 40s exec ceiling', async () => {
    vi.useFakeTimers();
    globalThis.fetch = silentFetch();

    const pending = startTrustLocalService().catch((e) => e);
    // A cold PyInstaller start can legitimately run ~20s+, and the
    // console kills its own spawn at 40s. Aborting before that would
    // fail a start that is still succeeding.
    await vi.advanceTimersByTimeAsync(40_000);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(80_000);
    expect(await pending).toBeInstanceOf(StartServiceError);
  });

  it('F3: the status probe fails inside its 30s refetch tick', async () => {
    vi.useFakeTimers();
    globalThis.fetch = silentFetch();

    const pending = fetchTrustLocalServiceStatus().catch((e) => e);
    // Must already be rejected by the time the next 30s tick fires,
    // otherwise a wedged CLI leaves the probe permanently in flight.
    await vi.advanceTimersByTimeAsync(29_000);
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toMatch(/did not answer/);
  });

  it('a healthy console answer still resolves normally', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse(200, { ok: true, installed: true, running: true, detail: 'ok' }),
      );
    await expect(fetchTrustLocalServiceStatus()).resolves.toEqual({
      ok: true,
      installed: true,
      running: true,
      detail: 'ok',
    });
  });
});
