import { describe, it, expect } from 'vitest';
import { isTeamTokenRejected, TEAM_TOKEN_REJECTED_HEADER } from './team-session';

/**
 * Guards the gateway contract (aikey-trial-server internal/gateway/proxy.go:
 * `headerTokenRejected`). The predicate has to stay narrow in both
 * directions:
 *
 *   - too loose → a business 401 (e.g. a seat endpoint refusing an
 *     action) blanks the sidebar and tells the user to re-run
 *     `aikey login` for no reason;
 *   - too strict → the regression this fixes returns: the Overview
 *     header renders `Hi, —` beside a green ACTIVE badge while every
 *     /accounts/* read is 401ing.
 */
const err = (status: number, headers: Record<string, string> = {}) => ({
  response: { status, headers },
});

describe('isTeamTokenRejected', () => {
  it('401 + gateway marker → rejected team token', () => {
    expect(isTeamTokenRejected(err(401, { [TEAM_TOKEN_REJECTED_HEADER]: 'rejected' }))).toBe(true);
  });

  it('401 WITHOUT the marker → business 401, not a dead session', () => {
    expect(isTeamTokenRejected(err(401))).toBe(false);
  });

  it('marker present but non-401 → not a dead session', () => {
    expect(isTeamTokenRejected(err(200, { [TEAM_TOKEN_REJECTED_HEADER]: 'rejected' }))).toBe(false);
    expect(isTeamTokenRejected(err(403, { [TEAM_TOKEN_REJECTED_HEADER]: 'rejected' }))).toBe(false);
  });

  it('marker with an unexpected value → not a dead session', () => {
    expect(isTeamTokenRejected(err(401, { [TEAM_TOKEN_REJECTED_HEADER]: 'injected' }))).toBe(false);
  });

  it('marker casing is ignored (header values are not normalised by axios)', () => {
    expect(isTeamTokenRejected(err(401, { [TEAM_TOKEN_REJECTED_HEADER]: 'REJECTED' }))).toBe(true);
  });

  it('network error / no response → not a dead session (offline is not signed-out)', () => {
    expect(isTeamTokenRejected({ message: 'Network Error' })).toBe(false);
    expect(isTeamTokenRejected(undefined)).toBe(false);
    expect(isTeamTokenRejected(null)).toBe(false);
  });
});
