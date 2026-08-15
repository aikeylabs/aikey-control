/**
 * Fence: every trust-local call MUST fail within a bounded time when
 * trust-local is listening but never answers.
 *
 * Why this fence exists
 * ---------------------
 * Bugfix 20260814-trust-check-web-infinite-loading-no-fetch-timeout.md:
 * `fetch` has no timeout of its own, so a trust-local that accepts the
 * connection and then goes silent (killed mid-restart with the socket
 * still open, a keep-alive connection black-holed across a laptop
 * sleep/wake, a wedged worker) left the request pending forever. Every
 * loading state on the Trust Check page derives from that query, so the
 * page sat on "Loading trust signals… / Fetching /v1/status from
 * trust-local" indefinitely — and the Refresh button is disabled while a
 * fetch is in flight, so the user had no error, no retry and no way out
 * short of reloading the page. "Connection refused" was always handled
 * (fetch rejects immediately); "listening but silent" was the hole.
 *
 * The fence locks three contracts:
 *   F1: a request that never answers rejects — it does not hang.
 *   F2: it rejects as TrustLocalUnavailableError, i.e. it lands in the
 *       SAME cold-state lane as "refused" so the page shows its offline
 *       banner instead of a raw error, and `useTrustStatus` does not
 *       burn retries on it.
 *   F3: the deadline also covers the response BODY — a server that
 *       sends `200` and then stalls mid-stream must not hang either.
 *
 * Fake timers are used so the fence asserts the deadline exists without
 * spending its budget in real seconds; a regression that removes the
 * timeout makes these tests hang-then-fail rather than pass silently.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { TrustLocalUnavailableError, trustLocalApi } from './api';

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

/** Advance past any plausible deadline, letting microtasks settle. */
async function runOutTheClock() {
  await vi.advanceTimersByTimeAsync(60_000);
}

describe('trust-local client deadline', () => {
  it('F1+F2: a request that is never answered rejects as unavailable', async () => {
    // Models the real failure: the socket is open (no network error) and
    // the server simply never writes a response. Only the abort signal
    // can end this.
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    const pending = trustLocalApi.listStatus();
    const assertion = expect(pending).rejects.toBeInstanceOf(
      TrustLocalUnavailableError,
    );
    await runOutTheClock();
    await assertion;
  });

  it('F2: the rejection names the stall, not a bare abort', async () => {
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    const pending = trustLocalApi.listStatus().catch((err) => err);
    await runOutTheClock();
    const err = await pending;
    // The operator reading this in a bug report has to be able to tell
    // "nothing is listening" from "listening but not answering".
    expect(String(err.message)).toMatch(/listening but not answering/);
  });

  it('F3: a 200 whose body never arrives also rejects as unavailable', async () => {
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(
                  new DOMException('The operation was aborted.', 'AbortError'),
                ),
              );
            }),
        } as unknown as Response),
    ) as unknown as typeof fetch;

    const pending = trustLocalApi.listStatus();
    const assertion = expect(pending).rejects.toBeInstanceOf(
      TrustLocalUnavailableError,
    );
    await runOutTheClock();
    await assertion;
  });

  it('a non-2xx answer stays a plain Error (not swallowed by the deadline lane)', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('boom'),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    const err = await trustLocalApi.listStatus().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TrustLocalUnavailableError);
    expect(String(err.message)).toContain('returned 500');
  });

  it('a healthy answer still resolves normally', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    await expect(trustLocalApi.listStatus()).resolves.toEqual({ items: [] });
  });
});
