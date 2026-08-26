/**
 * 🔴 The three licensed-identity states, and the two ways they get confused.
 *
 * `@/shared/license/identity` is the ONE place any SPA turns a licence lookup
 * into bytes on a screen. The failures worth fencing are not typos in the
 * strings — they are the two directions in which two states get collapsed into
 * one, and both of them read as sensible code:
 *
 *   * "no name came back, so this must be Personal"  → tells the operator of an
 *     unactivated Production server that there is nothing to activate.
 *   * "the request failed, so this must be Personal" → tells the operator of a
 *     Cluster whose control plane is down that it has no licence.
 *
 * Both replace a fault with a resting state, which is the one substitution a
 * status row must never make.
 */
import { describe, it, expect } from 'vitest';

import {
  ERROR_LINE,
  LICENSED_TO_LABEL,
  UNLICENSED_LINE,
  causeFor,
  lineFor,
  stateFromBody,
  stateFromFailure,
} from './identity';

// Deliberately awkward. A name that survives an ASCII round trip proves nothing
// about 逐字节相同: the ways two surfaces diverge in practice are case folding,
// whitespace trimming and full-width normalisation. Byte-for-byte the same
// literal as the Go and Rust suites.
const LEGAL_NAME = '深圳示例科技有限公司  (Shenzhen Example Ltd.)　';

describe('the row a person reads', () => {
  it('renders the signed name verbatim', () => {
    const rendered = lineFor({ kind: 'licensed', companyName: LEGAL_NAME });
    expect(rendered.startsWith(LICENSED_TO_LABEL)).toBe(true);
    expect(
      rendered.slice(LICENSED_TO_LABEL.length),
      'the name was altered on its way to the screen; ID-02 requires the bytes ' +
        'the issuance desk typed, unchanged',
    ).toBe(LEGAL_NAME);
  });

  it('gives the three states three distinct lines', () => {
    const licensed = lineFor({ kind: 'licensed', companyName: LEGAL_NAME });
    const unlicensed = lineFor({ kind: 'unlicensed' });
    const failed = lineFor({ kind: 'error', cause: 'x' });
    expect(new Set([licensed, unlicensed, failed]).size).toBe(3);
    for (const row of [licensed, unlicensed, failed]) {
      expect(row.startsWith(LICENSED_TO_LABEL), `${row} lost the label`).toBe(true);
      // 🚫 No state may render a bare label — that was the shape design D9's
      // "show nothing" rule existed to prevent, and it is still wrong.
      expect(row.length).toBeGreaterThan(LICENSED_TO_LABEL.length);
    }
  });

  // 能红: return UNLICENSED_LINE from the blank-name branch of lineFor.
  it('treats a licensed deployment with no name as an error, not as Personal', () => {
    for (const blank of ['', '   ', '　']) {
      const rendered = lineFor({ kind: 'licensed', companyName: blank });
      expect(
        rendered,
        'a licensed deployment that answered with a blank name rendered as the ' +
          'UNLICENSED row — that reports a broken licensed deployment as a Personal install',
      ).not.toBe(UNLICENSED_LINE);
      expect(rendered).toBe(ERROR_LINE);
    }
  });

  it('carries a cause only where there is something to explain', () => {
    expect(causeFor({ kind: 'unlicensed' })).toBeNull();
    expect(causeFor({ kind: 'licensed', companyName: LEGAL_NAME })).toBeNull();
    expect(causeFor({ kind: 'error', cause: 'the control plane is on fire' })).toContain(
      'the control plane is on fire',
    );
  });
});

describe('what the wire is allowed to mean', () => {
  it('maps a name to the licensed state', () => {
    expect(stateFromBody({ schema_version: 1, company_name: LEGAL_NAME })).toEqual({
      kind: 'licensed',
      companyName: LEGAL_NAME,
    });
  });

  // 能红: return { kind: 'unlicensed' } from stateFromBody's empty-name branch.
  it('maps 200-with-no-name to an error that names the next step', () => {
    const state = stateFromBody({ schema_version: 1, company_name: '' });
    expect(
      state.kind,
      'an unactivated licensed deployment was reported as a Personal install, so ' +
        'the operator is told there is nothing to activate',
    ).toBe('error');
    expect(causeFor(state)).toMatch(/activat/i);
  });

  it('maps a missing body to an error, not to Personal', () => {
    expect(stateFromBody(null).kind).toBe('error');
    expect(stateFromBody(undefined).kind).toBe('error');
  });

  // 🔴 404 is design D9 speaking: a Personal control plane mounts no licensing
  // route at all, so the route's absence IS the answer.
  //
  // 能红: drop the 404 branch from stateFromFailure.
  it('maps 404 to unlicensed, because the absent route is the answer', () => {
    expect(stateFromFailure(404, 'Not Found')).toEqual({ kind: 'unlicensed' });
  });

  // 能红: widen the 404 branch to any failure.
  it('maps every other failure to an error', () => {
    for (const status of [401, 403, 500, 502, 503] as const) {
      const state = stateFromFailure(status, 'boom');
      expect(state.kind, `HTTP ${status} was reported as "not licensed"`).toBe('error');
      expect(causeFor(state)).toContain(String(status));
    }
    const offline = stateFromFailure(undefined, 'Network Error');
    expect(
      offline.kind,
      'an unreachable control plane read as "no licence here" — the operator is ' +
        'told a fact that was never established',
    ).toBe('error');
    expect(causeFor(offline)).toMatch(/reach/i);
  });
});
