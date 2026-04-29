import { describe, it, expect } from 'vitest';
import { mapUseError } from './mapUseError';

/**
 * Reviewer round-3 fix (2026-04-27): the active-state cross-shell sync
 * Stage 7-2 review flagged that the new "Set as active" UI path had no
 * frontend tests. mapUseError is the most logic-heavy piece of that flow
 * and worth pinning per branch — it dictates what the user actually sees
 * when the backend returns a CLI error envelope.
 *
 * These tests cover every documented branch of the decision tree. If a
 * future refactor reorders the precedence (e.g. routing 401 through the
 * switch instead of the early return) the behavioural fix will surface
 * here, not as a confused-looking message in production.
 *
 * Pure-function tests; no DOM / React deps.
 */
describe('mapUseError', () => {
  it('routes HTTP 401 to the unlock-vault hint regardless of error_code', () => {
    const out = mapUseError({ response: { status: 401 } });
    expect(out).toBe(
      'Vault is locked. Unlock it on the Vault page first, then retry.',
    );
  });

  it('routes I_VAULT_LOCKED in the envelope to the same unlock hint', () => {
    // Same destination but different signal — some clients see the code
    // before they see the status (e.g. when the bridge layer returns a
    // 200 with an error envelope instead of a transport-layer 401).
    const out = mapUseError({ error_code: 'I_VAULT_LOCKED' });
    expect(out).toContain('Vault is locked');
  });

  it('reads error_code from the nested response.data shape', () => {
    // axios-like wrapping: the backend envelope sits on response.data.
    const out = mapUseError({
      response: { data: { error_code: 'I_KEY_DISABLED' } },
    });
    expect(out).toContain('disabled');
  });

  it('I_KEY_DISABLED → revoked / out-of-scope hint', () => {
    expect(mapUseError({ error_code: 'I_KEY_DISABLED' })).toBe(
      'This key is disabled (revoked or out of scope) and cannot be activated.',
    );
  });

  it('I_KEY_STALE → run aikey key sync hint', () => {
    expect(mapUseError({ error_code: 'I_KEY_STALE' })).toContain(
      'aikey key sync',
    );
  });

  it('I_CREDENTIAL_NOT_FOUND → run aikey key sync hint', () => {
    expect(mapUseError({ error_code: 'I_CREDENTIAL_NOT_FOUND' })).toContain(
      'aikey key sync',
    );
  });

  it('I_KEY_NO_PROVIDER → no provider assignment hint', () => {
    expect(mapUseError({ error_code: 'I_KEY_NO_PROVIDER' })).toContain(
      'no provider assignment',
    );
  });

  it('falls back to error_message when code is unknown', () => {
    const out = mapUseError({
      error_code: 'I_NEW_FUTURE_CODE',
      error_message: 'something exotic happened',
    });
    expect(out).toBe('something exotic happened');
  });

  it('falls back to e.message when no envelope is present', () => {
    // Generic JS Error / network-thrown errors don't have the envelope.
    const out = mapUseError({ message: 'Network Error' });
    expect(out).toBe('Network Error');
  });

  it('uses a safe default when the error has no recognisable shape', () => {
    expect(mapUseError({})).toBe('Failed to set as active.');
    expect(mapUseError(null)).toBe('Failed to set as active.');
    expect(mapUseError(undefined)).toBe('Failed to set as active.');
  });

  it('401 short-circuits before the switch — does NOT route to I_KEY_DISABLED', () => {
    // Edge case: a misconfigured backend could pair a 401 with a
    // disabled-key code. The 401 path should win because that's the
    // actionable fix (unlock first); the disabled-key suggestion would
    // be misleading until the user is past the unlock gate.
    const out = mapUseError({
      response: { status: 401 },
      error_code: 'I_KEY_DISABLED',
    });
    expect(out).toContain('Vault is locked');
    expect(out).not.toContain('disabled');
  });

  it('top-level error_code wins over response.data.error_code', () => {
    // Both shapes are populated → the nullish-coalescing chain prefers
    // top-level. Pin this so a future refactor doesn't silently swap
    // the priority.
    const out = mapUseError({
      error_code: 'I_KEY_STALE',
      response: { data: { error_code: 'I_KEY_DISABLED' } },
    });
    expect(out).toContain('aikey key sync');
    expect(out).not.toContain('disabled');
  });
});
