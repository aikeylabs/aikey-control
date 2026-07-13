import { describe, it, expect } from 'vitest';
import { hookBannerKind, bannerPolicy, probedReadinessIsAuthoritative } from './index';
import type { HookBannerKind } from './index';

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

  it('fileInstalled wins over failureReason when present (except aikey_no_hook)', () => {
    // Defensive: if a backend bug ever sends file=true with a non-null
    // reason, prefer the file=true branch so we don't show an error
    // banner for a working hook. aikey_no_hook is the deliberate
    // exception — see the opt-out precedence test below.
    expect(
      hookBannerKind({
        fileInstalled: true,
        rcWired: false,
        failureReason: 'io_error',
      }),
    ).toBe('almost-ready');
  });

  it('reason=aikey_no_hook wins over EVERYTHING → disabled (opt-out precedence, 2026-07-10)', () => {
    // The read-only GET /api/user/hook/status probe reports REAL file/rc
    // state alongside reason=aikey_no_hook. Without this precedence an
    // opted-out user with a stale hook file would get the (now
    // non-dismissible) almost-ready banner — the exact opposite of what
    // AIKEY_NO_HOOK=1 promises. Silence is the contract.
    expect(
      hookBannerKind({
        fileInstalled: true,
        rcWired: false,
        failureReason: 'aikey_no_hook',
      }),
    ).toBe('disabled');
    expect(
      hookBannerKind({
        fileInstalled: true,
        rcWired: true,
        failureReason: 'aikey_no_hook',
      }),
    ).toBe('disabled');
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

/**
 * 2026-07-10 escalation: banner persistence policy. Only almost-ready is
 * non-dismissible — it's the one state fixable with a single click, and
 * while unfixed every Web `Use` silently never reaches the CLI.
 * Environment-error kinds stay dismissible: an un-closable banner the user
 * cannot act on trains them to ignore banners entirely.
 */
/**
 * 2026-07-10 (found live on fresh dev5 VM): the read-only GET probe returns
 * (file:false, rc:false, reason:null) on a fresh install BEFORE any use —
 * adopting that shape raised a false "filesystem error" banner. The probe
 * abstains; mutation envelopes with the same shape stay authoritative.
 */
describe('probedReadinessIsAuthoritative', () => {
  it('abstains on the fresh-install pre-use shape (file=false, reason=null)', () => {
    expect(
      probedReadinessIsAuthoritative({ fileInstalled: false, rcWired: false, failureReason: null }),
    ).toBe(false);
  });

  it('adopts real states: file installed, or an explicit failure reason', () => {
    expect(
      probedReadinessIsAuthoritative({ fileInstalled: true, rcWired: false, failureReason: null }),
    ).toBe(true);
    expect(
      probedReadinessIsAuthoritative({
        fileInstalled: false,
        rcWired: false,
        failureReason: 'io_error',
      }),
    ).toBe(true);
    expect(
      probedReadinessIsAuthoritative({
        fileInstalled: false,
        rcWired: false,
        failureReason: 'aikey_no_hook',
      }),
    ).toBe(true);
  });
});

describe('bannerPolicy', () => {
  it('almost-ready is NOT dismissible', () => {
    expect(bannerPolicy('almost-ready').dismissible).toBe(false);
  });

  it('every other kind stays dismissible', () => {
    const others: HookBannerKind[] = [
      'wired',
      'shell-undetectable',
      'env-misconfigured',
      'disabled',
      'io-error',
    ];
    for (const k of others) {
      expect(bannerPolicy(k).dismissible, k).toBe(true);
    }
  });
});
