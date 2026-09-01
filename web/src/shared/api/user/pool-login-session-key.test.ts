import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPoolLoginError, poolSessionKey, poolSessionKeyCapabilities } from './pool-login';

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('pool session key client', () => {
  it('sends the secret only in the local same-origin POST body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response(200, { status: 'pending', operation_id: 'op-1' }));

    await poolSessionKey('credential-1', 'sk-ant-sid02-fixture', 'operation-123456', false);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe('/api/user/oauth/pool/session-key');
    expect(String(url)).not.toContain('sk-ant-sid02-fixture');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(init?.body))).toEqual({
      credential_id: 'credential-1',
      session_key: 'sk-ant-sid02-fixture',
      operation_id: 'operation-123456',
      confirm: false,
      identity_mismatch_confirmed: false,
    });
  });

  // 拍板 2026-09-01 (supersedes 08-27 "no override"): a plain confirm carries
  // identity_mismatch_confirmed=false — the override is sent ONLY when the
  // member explicitly acknowledged the cross-account warning.
  it('sends the identity-mismatch acknowledgement only when explicitly requested', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response(200, { status: 'ok', operation_id: 'operation-123456' }));

    await poolSessionKey('credential-1', '', 'operation-123456', true);
    let [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ confirm: true, identity_mismatch_confirmed: false });

    await poolSessionKey('credential-1', '', 'operation-123456', true, true);
    [, init] = vi.mocked(globalThis.fetch).mock.calls[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ confirm: true, identity_mismatch_confirmed: true });
  });

  it('preserves stable error code and retry operation id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      response(502, {
        error: {
          code: 'WRITEBACK_FAILED',
          message: 'Master is temporarily unavailable.',
        },
        operation_id: 'operation-123456',
      }),
    );
    const result = await poolSessionKey('credential-1', '', 'operation-123456', true);
    expect(isPoolLoginError(result)).toBe(true);
    if (isPoolLoginError(result)) {
      expect(result).toEqual({
        code: 'WRITEBACK_FAILED',
        message: 'Master is temporarily unavailable.',
        operation_id: 'operation-123456',
      });
    }
  });

  it('reads the externally visible Windows capability endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      response(200, {
        status: 'ok',
        available: true,
        platform: 'windows',
        browser_required: false,
        refresh_supported: false,
      }),
    );
    await expect(poolSessionKeyCapabilities()).resolves.toMatchObject({
      available: true,
      platform: 'windows',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/user/oauth/pool/session-key/capabilities', { credentials: 'same-origin' });
  });
});
