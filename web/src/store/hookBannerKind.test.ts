import { describe, it, expect } from 'vitest';
import { hookBannerKind } from './index';

/**
 * Hook coverage v1 §2.4 banner state machine. Pure-function tests pin
 * each row of the decision table — a refactor that swaps a precedence
 * (e.g. evaluating failure_reason before fileInstalled) gets caught here
 * before the user sees the wrong banner copy.
 */
describe('hookBannerKind', () => {
  it('null readiness → wired (no banner before any vault op observed)', () => {
    expect(hookBannerKind(null)).toBe('wired');
  });

  it('fileInstalled + rcWired → wired', () => {
    expect(
      hookBannerKind({ fileInstalled: true, rcWired: true, failureReason: null }),
    ).toBe('wired');
  });

  it('fileInstalled + !rcWired → almost-ready (typical Web-only case)', () => {
    expect(
      hookBannerKind({ fileInstalled: true, rcWired: false, failureReason: null }),
    ).toBe('almost-ready');
  });

  it('fileInstalled wins over failureReason when present', () => {
    // Defensive: if a backend bug ever sends file=true with a non-null
    // reason, prefer the file=true branch so we don't show an error
    // banner for a working hook.
    expect(
      hookBannerKind({
        fileInstalled: true,
        rcWired: false,
        failureReason: 'io_error',
      }),
    ).toBe('almost-ready');
  });

  it('!fileInstalled + reason=shell_undetectable → shell-undetectable', () => {
    expect(
      hookBannerKind({
        fileInstalled: false,
        rcWired: false,
        failureReason: 'shell_undetectable',
      }),
    ).toBe('shell-undetectable');
  });

  it('!fileInstalled + reason=aikey_no_hook → disabled (suppress banner)', () => {
    expect(
      hookBannerKind({
        fileInstalled: false,
        rcWired: false,
        failureReason: 'aikey_no_hook',
      }),
    ).toBe('disabled');
  });

  it('!fileInstalled + reason=io_error → io-error', () => {
    expect(
      hookBannerKind({
        fileInstalled: false,
        rcWired: false,
        failureReason: 'io_error',
      }),
    ).toBe('io-error');
  });

  it('!fileInstalled + reason=home_unset → env-misconfigured (NOT io-error)', () => {
    // Hook coverage v1 review round 2 (2026-04-27): home_unset gets its
    // own banner kind because the remediation is "fix service $HOME"
    // not "chmod ~/.aikey/". Folding it into io-error sent users to the
    // wrong troubleshooting path.
    expect(
      hookBannerKind({
        fileInstalled: false,
        rcWired: false,
        failureReason: 'home_unset',
      }),
    ).toBe('env-misconfigured');
  });

  it('!fileInstalled + reason=null → io-error (unknown failure)', () => {
    // Backend returned file=false without a reason — unusual but
    // non-fatal; treat as io-error so user sees a "check perms" hint.
    expect(
      hookBannerKind({
        fileInstalled: false,
        rcWired: false,
        failureReason: null,
      }),
    ).toBe('io-error');
  });
});
