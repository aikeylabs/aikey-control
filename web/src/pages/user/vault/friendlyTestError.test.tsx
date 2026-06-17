import { describe, it, expect } from 'vitest';

import { friendlyTestError } from './friendlyTestError';

/**
 * Fence test for the Vault "Test connection" error-classification
 * function. Bugfix:
 * `workflow/CI/bugfix/20260523-test-connection-proxy-down-shows-local-server-error.md`.
 *
 * The bug: `friendlyTestError` originally matched `httpStatus 5xx`
 * BEFORE the `code === 'I_PROXY_NOT_RUNNING'` branch. When aikey-proxy
 * wasn't running, the server returned 500 + I_PROXY_NOT_RUNNING, the
 * 5xx branch won, and the popup steered users at `aikey service
 * restart web` — wrong target. The server is now also fixed to return
 * 503 for that code, but this fence pins the UI invariant
 * independently so a future regression on either side can't
 * resurrect the wrong-target message.
 *
 * Invariants pinned here:
 *  1. Known I_* codes win over httpStatus (even 5xx).
 *  2. Network-level axios codes (ERR_NETWORK, ECONNABORTED) win over
 *     5xx — these arrive with no httpStatus anyway, but the ordering
 *     matters if a future change sets a synthetic status.
 *  3. 5xx without a known code falls through to the generic
 *     "Local server is unavailable" message.
 *  4. Unknown code + no status → generic "Probe could not run"
 *     fallback that surfaces the raw message (no silent hiding).
 */
describe('friendlyTestError matching order', () => {
  it('I_PROXY_NOT_RUNNING wins over httpStatus 500 (regression pin)', () => {
    // This is the exact shape the bug produced before the server-side
    // 503 fix. The UI must NOT regress to the "restart web" message
    // even if the server forgets to map this code in write.go again.
    const out = friendlyTestError({
      code: 'I_PROXY_NOT_RUNNING',
      httpStatus: 500,
      message: 'Request failed with status code 500',
    });
    expect(out.title).toBe('aikey-proxy is not running');
    expect(out.detail).toContain('aikey-proxy');
    expect(out.action).toBeDefined();
  });

  it('I_PROXY_NOT_RUNNING also classified correctly with the fixed 503', () => {
    // The post-fix wire shape. Same destination as the 500 case — the
    // UI branch is code-based, status-agnostic.
    const out = friendlyTestError({
      code: 'I_PROXY_NOT_RUNNING',
      httpStatus: 503,
      message: 'Request failed with status code 503',
    });
    expect(out.title).toBe('aikey-proxy is not running');
  });

  it('I_CLUSTER_NODE_UNRESOLVED wins over httpStatus 503 (not "Local server is unavailable")', () => {
    // 2026-06-17 cluster follow-up: write.go maps this code to 503 but
    // the UI had no case → it fell through to the 5xx "restart web"
    // message for cluster team keys. Pin the cluster destination.
    const out = friendlyTestError({
      code: 'I_CLUSTER_NODE_UNRESOLVED',
      httpStatus: 503,
      message: 'team key is a cluster key; node resolved but probe target could not be built',
    });
    expect(out.title).toBe('Cluster node not ready');
  });

  it('I_CREDENTIAL_NOT_FOUND wins over httpStatus 500', () => {
    // The credential was deleted between click and probe. Server may
    // wrap this in a 500 (it currently maps to 404, but pin the UI
    // invariant independently from the server's mapping).
    const out = friendlyTestError({
      code: 'I_CREDENTIAL_NOT_FOUND',
      httpStatus: 500,
      message: 'Request failed',
    });
    expect(out.title).toBe('Key not found');
  });

  it('ERR_NETWORK (no httpStatus) routes to "Cannot reach local-server"', () => {
    const out = friendlyTestError({
      code: 'ERR_NETWORK',
      message: 'Network Error',
    });
    expect(out.title).toBe('Cannot reach aikey-local-server');
  });

  it('ECONNABORTED routes to timeout branch', () => {
    const out = friendlyTestError({
      code: 'ECONNABORTED',
      message: 'timeout of 60000ms exceeded',
    });
    expect(out.title).toBe('Probe timed out');
  });

  it('timeout substring in message also triggers timeout branch (no code)', () => {
    const out = friendlyTestError({
      message: 'Request timeout exceeded',
    });
    expect(out.title).toBe('Probe timed out');
  });

  it('httpStatus 500 with NO known code falls through to "Local server is unavailable"', () => {
    // 5xx is still the right fallback when the server emits a code we
    // don't recognise (or no code at all). This pins that the
    // reordering didn't accidentally break the legitimate 5xx case.
    const out = friendlyTestError({
      code: 'I_TOTALLY_UNHANDLED_NEW_CODE',
      httpStatus: 502,
      message: 'Bad Gateway',
    });
    expect(out.title).toBe('Local server is unavailable');
  });

  it('httpStatus 503 with NO code falls through to "Local server is unavailable"', () => {
    // 503 without code → still the 5xx generic branch. (With code
    // I_PROXY_NOT_RUNNING it goes to the proxy branch — covered above.)
    const out = friendlyTestError({
      httpStatus: 503,
      message: 'Service Unavailable',
    });
    expect(out.title).toBe('Local server is unavailable');
  });

  it('completely unknown error → generic fallback surfaces raw message', () => {
    // CLAUDE.md "失败要显眼,不要沉默" — the raw axios message must
    // reach the user when we have no canned response, so real bugs
    // surface instead of being painted over.
    const raw = 'AxiosError: unexpected something';
    const out = friendlyTestError({ message: raw });
    expect(out.title).toBe('Probe could not run');
    expect(out.detail).toBe(raw);
  });

  it('httpStatus 4xx does NOT trigger the 5xx branch', () => {
    // Sanity: the 5xx branch must be tight on the range, not a
    // catch-all "any status".
    const out = friendlyTestError({
      httpStatus: 404,
      message: 'Not Found',
    });
    expect(out.title).toBe('Probe could not run');
  });
});
