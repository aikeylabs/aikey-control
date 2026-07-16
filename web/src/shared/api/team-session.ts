/**
 * Team-session rejection detector.
 *
 * In gateway mode the Personal local-server (port 8090) forwards
 * `/accounts/*` to the team server with the vault's
 * `platform_account.jwt_token` injected. When the team server rejects
 * that token the gateway marks the response with
 * `X-Aikey-Team-Token: rejected` — see aikey-trial-server
 * internal/gateway/proxy.go (`headerTokenRejected`). That header exists
 * precisely so the SPA can tell "your team session is dead" apart from a
 * business 401, without the gateway rewriting the upstream body.
 *
 * Nothing read it until now: a rejected token left the `me` query in its
 * error state, every consumer fell through to a placeholder (`—`, `…`,
 * `U`), and the Overview header went on rendering a hardcoded green
 * ACTIVE badge — telling the user their session was fine while every
 * request 401'd.
 */
import type { AxiosError } from 'axios';

/** Lowercase: axios normalises response header names. */
export const TEAM_TOKEN_REJECTED_HEADER = 'x-aikey-team-token';

/**
 * True when `err` is a 401 the gateway attributed to a rejected team
 * token. Deliberately narrow: a 401 *without* the header is a business
 * 401 (or a same-origin call that never went through the gateway) and
 * must not be reported as an expired session.
 */
export function isTeamTokenRejected(err: unknown): boolean {
  const res = (err as AxiosError | undefined)?.response;
  if (!res || res.status !== 401) return false;
  const marker = (res.headers as Record<string, unknown> | undefined)?.[TEAM_TOKEN_REJECTED_HEADER];
  return String(marker ?? '').toLowerCase() === 'rejected';
}
