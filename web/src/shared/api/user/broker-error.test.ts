import { describe, expect, it } from 'vitest';
import { brokerError } from '../error-message';

// Fences for bugfix 2026-07-29: with aikey-proxy down, the add-OAuth-account
// modal showed a bare "Request failed with status code 502" — the relay's
// 502 envelope (code PROXY_UNAVAILABLE + the full `aikey proxy status` /
// `aikey service start all` guidance) was thrown away because axios throws on
// non-2xx before the old unwrap ever ran. brokerError is the unwrap both the
// non-2xx catch and the 2xx-with-error path now share.

describe('brokerError', () => {
  it('surfaces the relay envelope message and code from a non-2xx body', () => {
    // The exact shape the relay's writeProxyUnavailable emits on 502.
    const body = {
      error: {
        code: 'PROXY_UNAVAILABLE',
        message:
          'aikey-proxy is not running (nothing is listening on 127.0.0.1:27200). ' +
          'Check its state with `aikey proxy status`; start it with `aikey service start all`.',
      },
    };
    const err = brokerError(body, 'Request failed with status code 502');
    // 🔴 The whole point: the user must read the relay's guidance, not the
    // axios status-code prose.
    expect(err.message).toContain('aikey proxy status');
    expect(err.message).toContain('aikey service start all');
    expect(err.message).not.toContain('status code 502');
    expect(err.code).toBe('PROXY_UNAVAILABLE');
  });

  it('falls back to the transport message when the body has no envelope', () => {
    for (const body of [undefined, null, {}, { error: {} }, 'gateway timeout']) {
      const err = brokerError(body, 'network down');
      expect(err.message).toBe('network down');
      expect(err.code).toBeUndefined();
    }
  });

  it('keeps the 2xx-with-error path behavior (message + code)', () => {
    const err = brokerError(
      { error: { code: 'SESSION_EXISTS', message: 'already pending' } },
      'OAuth broker error',
    );
    expect(err.message).toBe('already pending');
    expect(err.code).toBe('SESSION_EXISTS');
  });
});
