import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';

import { formatApiError, friendlyLabelFor, parseApiError } from './api-error';

/**
 * Envelope fence for parseApiError — THREE server error bodies reach the
 * console, and each must come out with the right code / message / next step.
 *
 *   1. aikey-data          `{code, message}`          (shared.ErrorResponse)
 *   2. control, most modules `{error: <CODE>, message}` (shared/errors.go)
 *   3. control, compliance  `{error: <text>, code: <CODE>, details: <next step>}`
 *                           (service/internal/compliance/handler.go writeError)
 *
 * Shape 3 used to fall into the shape-2 branch, which read the human sentence
 * as the error CODE and again as the message, so every compliance refusal
 * rendered as 「[sentence] sentence」 with no next step (reported 2026-09-21 on
 * the built-in pack 「发布」 refusal).
 * bugfix: workflow/CI/bugfix/2026-09-21-compliance-error-envelope-rendered-as-text-twice.md
 */
function axiosErr(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: {},
  } as unknown as AxiosResponse);
}

describe('parseApiError — the three server envelopes', () => {
  it('shape 1 {code, message} (aikey-data) keeps code and message', () => {
    const e = parseApiError(axiosErr(400, {
      code: 'INVALID_ARGUMENT',
      message: 'seat_keys accepts at most 1000 keys; narrow the search',
    }));
    expect(e.code).toBe('INVALID_ARGUMENT');
    expect(e.message).toBe('seat_keys accepts at most 1000 keys; narrow the search');
  });

  it('shape 2 {error: CODE, message} (control) keeps code, message, suggestion and meta', () => {
    const e = parseApiError(axiosErr(400, {
      error: 'DATA_INVALID_FIELD',
      message: 'alias must be 1-64 characters',
      field: 'alias',
      rule: 'len<=64',
    }));
    expect(e.code).toBe('DATA_INVALID_FIELD');
    expect(e.message).toBe('alias must be 1-64 characters');
    expect(e.suggestion).toMatch(/validation rule/);
    expect(e.field).toBe('alias');
    expect(e.rule).toBe('len<=64');
  });

  // Byte-for-byte what handler_packs.go writes for a built-in pack's tree.
  const COMPLIANCE_BODY = {
    error: 'this is a built-in pack: it is shared by every organization, so its classification '
      + 'tree is read-only and cannot be graded from here',
    code: 'BUILTIN_PACK_CLASSIFICATION_READONLY',
    details: 'grade your own data in a pack of your own (合规包 › 新建), where the levels are your '
      + "organization's to define; a built-in pack's tree would apply to every organization at once",
  };

  it('shape 3 {error: text, code: CODE, details} (compliance) reads code from `code`, message from `error`', () => {
    const e = parseApiError(axiosErr(400, COMPLIANCE_BODY));
    expect(e.code).toBe('BUILTIN_PACK_CLASSIFICATION_READONLY');
    expect(e.message).toBe(COMPLIANCE_BODY.error);
    expect(formatApiError(e)).toBe(`[BUILTIN_PACK_CLASSIFICATION_READONLY] ${COMPLIANCE_BODY.error}`);
    expect(formatApiError(e)).not.toBe(`[${COMPLIANCE_BODY.error}] ${COMPLIANCE_BODY.error}`);
  });

  it('shape 3 without a curated suggestion falls back to the server `details`', () => {
    // handler_packs.go resolvePackTenant — a real compliance refusal with details.
    const e = parseApiError(axiosErr(400, {
      error: "built-in packs are owned by 'system' and shared across tenants",
      code: 'TENANT_MISMATCH',
      details: 'omit tenant_id, or pass "system"',
    }));
    expect(e.code).toBe('TENANT_MISMATCH');
    expect(e.message).toBe("built-in packs are owned by 'system' and shared across tenants");
    expect(e.suggestion).toBe('omit tenant_id, or pass "system"');
  });

  it('shape 3 with no details and no curated entry has no suggestion (not the message twice)', () => {
    const e = parseApiError(axiosErr(404, { error: 'pack does not exist', code: 'PACK_NOT_FOUND' }));
    expect(e.code).toBe('PACK_NOT_FOUND');
    expect(e.message).toBe('pack does not exist');
    expect(e.suggestion).toBeUndefined();
  });

  it('BUILTIN_PACK_CLASSIFICATION_READONLY has a curated next step and a short label', () => {
    const e = parseApiError(axiosErr(400, COMPLIANCE_BODY));
    expect(e.suggestion).toMatch(/Compliance Packs › New Pack/);
    expect(friendlyLabelFor('BUILTIN_PACK_CLASSIFICATION_READONLY')).toBe('Built-in Pack Is Read-only');
  });
});
