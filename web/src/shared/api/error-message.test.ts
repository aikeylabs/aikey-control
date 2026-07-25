import { describe, expect, it } from 'vitest';
import { apiErrorMessage, isProxyUnavailable, ERR_PROXY_UNAVAILABLE } from './error-message';

describe('apiErrorMessage', () => {
  // The regression this file exists for: the local-server relay answers with a
  // CODED OBJECT, callers typed the field as `string`, and `data.error ?? fallback`
  // handed React an object that rendered as the literal "[object Object]".
  // The swallowed payload was the most actionable message we produce.
  it('never yields "[object Object]" for the relay coded envelope', () => {
    const relayError = {
      code: 'PROXY_UNAVAILABLE',
      message: 'aikey-proxy is not reachable. Run `aikey proxy start`.',
    };
    const got = apiErrorMessage(relayError, 'HTTP 502');
    expect(got).not.toContain('[object Object]');
    expect(got).toContain('aikey proxy start');
    // The code rides along: it is the stable identifier users quote in reports.
    expect(got).toContain('PROXY_UNAVAILABLE');
  });

  it('passes the proxy flat-string envelope through unchanged', () => {
    expect(apiErrorMessage('invalid request body', 'HTTP 400')).toBe('invalid request body');
  });

  it('falls back when the payload carries nothing usable', () => {
    // Every shape that must NOT become "[object Object]" or "undefined".
    for (const raw of [undefined, null, '', '   ', {}, { code: '' }, { message: '  ' }, [], 42, true]) {
      const got = apiErrorMessage(raw, 'HTTP 502');
      expect(got).toBe('HTTP 502');
    }
  });

  it('degrades to the code when the envelope has no message', () => {
    expect(apiErrorMessage({ code: 'BAD_GATEWAY' }, 'HTTP 502')).toBe('BAD_GATEWAY');
  });

  it('ignores non-string code/message rather than stringifying them', () => {
    // A nested object in `message` must not leak "[object Object]" either.
    expect(apiErrorMessage({ message: { nested: 1 } }, 'fallback')).toBe('fallback');
    expect(apiErrorMessage({ code: 123, message: 456 }, 'fallback')).toBe('fallback');
  });
});

describe('isProxyUnavailable', () => {
  it('detects the relay code so callers can render a dedicated state', () => {
    expect(isProxyUnavailable({ code: ERR_PROXY_UNAVAILABLE, message: 'x' })).toBe(true);
  });

  it('is false for every other shape', () => {
    for (const raw of [undefined, null, 'PROXY_UNAVAILABLE', { code: 'BAD_GATEWAY' }, {}, []]) {
      expect(isProxyUnavailable(raw)).toBe(false);
    }
  });
});
