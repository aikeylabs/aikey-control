// pool-login.ts — same-origin client for the pool sign-in relay (C10/RW8). The
// local-server forwards these to the local aikey-proxy's memory-store broker,
// which exchanges the code and writes the per-member token back to master. The
// browser only ever sends the pasted code; no token reaches the browser.
//
// (Same-origin: these hit the local-server at /api/user/oauth/pool/*, unlike the
// team reads in api/team/* which cross-origin to the remote master.)

export interface PoolAuthorizeStart {
  session_id: string;
  authorize_url: string;
}

/** PoolLoginError mirrors the relay's {"error":{code,message}} envelope. */
export interface PoolLoginError {
  code: string;
  message: string;
}

async function postPool<T>(path: string, body: unknown): Promise<T | PoolLoginError> {
  try {
    const res = await fetch(`/api/user/oauth/pool/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (data as { error?: PoolLoginError }).error;
      return e ?? { code: 'POOL_LOGIN_FAILED', message: `HTTP ${res.status}` };
    }
    return data as T;
  } catch (e) {
    return { code: 'PROXY_UNAVAILABLE', message: String(e) };
  }
}

/** isPoolLoginError narrows a postPool result. */
export function isPoolLoginError(v: unknown): v is PoolLoginError {
  return typeof v === 'object' && v !== null && 'code' in v && 'message' in v;
}

/** Start the pool sign-in for a specific routed account → {session_id, authorize_url}. */
export function poolAuthorizeURL(provider: string, credentialID: string) {
  return postPool<PoolAuthorizeStart>('authorize-url', { provider, credential_id: credentialID });
}

/** Finish: submit the pasted code; the proxy exchanges + writes the token to master. */
export function poolSubmitCode(sessionID: string, code: string) {
  return postPool<{ status: string }>('submit-code', { session_id: sessionID, code });
}
