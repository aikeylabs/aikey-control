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
  provider_code: string;
  flow: 'setup_token' | 'auth_code';
  expected_identity?: string;
}

/** PoolLoginError mirrors the relay's {"error":{code,message}} envelope. */
export interface PoolLoginError {
  code: string;
  message: string;
  operation_id?: string;
}

export const SESSION_KEY_IDENTITY_MISMATCH = 'SESSION_KEY_IDENTITY_MISMATCH';

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
      const operationID = (data as { operation_id?: string }).operation_id;
      return e
        ? { ...e, operation_id: operationID }
        : {
            code: 'POOL_LOGIN_FAILED',
            message: `HTTP ${res.status}`,
            operation_id: operationID,
          };
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

/** Start sign-in for one credential. Provider + flow are resolved by master and
 * bound server-side; the browser never chooses or defaults the provider model. */
export function poolAuthorizeURL(credentialID: string) {
  return postPool<PoolAuthorizeStart>('authorize-url', {
    credential_id: credentialID,
  });
}

/**
 * Submit the pasted code. Two-step confirm:
 *   - confirm=false (step 1): the proxy EXCHANGES only and returns {status:"pending",
 *     identity} — the resolved Claude account email, for review — WITHOUT writing to
 *     master. (`identity` is not a secret; the token never comes back.)
 *   - confirm=true (step 2): the proxy replays the held token and WRITES it back
 *     (status:"ok"). Idempotent per session, so re-sending the same code is safe.
 */
export function poolSubmitCode(sessionID: string, code: string, confirm = false) {
  return postPool<{
    status: string;
    identity?: string;
    expected_identity?: string;
    provider_code?: string;
    sync_status?: 'ok' | 'pending';
    sync_error?: string;
  }>('submit-code', {
    session_id: sessionID,
    code,
    confirm,
  });
}

export interface PoolSessionKeyResult {
  status: 'pending' | 'ok' | 'canceled';
  operation_id?: string;
  identity?: string;
  expected_identity?: string;
  provider_code?: string;
  identity_mismatch?: boolean;
  sync_status?: 'ok' | 'pending';
  sync_error?: string;
}

/** Exchange a Claude web session key locally on Windows or macOS. The first call keeps
 * the resulting OAuth token inside aikey-proxy for identity review; the second
 * call writes that held token to the existing member-token endpoint. Neither
 * call returns token material to the browser. */
export function poolSessionKey(
  credentialID: string,
  sessionKey: string,
  operationID: string,
  confirm = false,
  identityMismatchConfirmed = false,
) {
  return postPool<PoolSessionKeyResult>('session-key', {
    credential_id: credentialID,
    session_key: sessionKey,
    operation_id: operationID,
    confirm,
    identity_mismatch_confirmed: identityMismatchConfirmed,
  });
}

export interface PoolSessionKeyCapabilities {
  status: 'ok';
  available: boolean;
  platform: string;
  browser_required: false;
  refresh_supported: false;
  reason_code?: string;
}

export async function poolSessionKeyCapabilities(): Promise<PoolSessionKeyCapabilities | PoolLoginError> {
  try {
    const res = await fetch('/api/user/oauth/pool/session-key/capabilities', {
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (data as { error?: PoolLoginError }).error;
      return e ?? { code: 'POOL_LOGIN_FAILED', message: `HTTP ${res.status}` };
    }
    return data as PoolSessionKeyCapabilities;
  } catch (e) {
    return { code: 'PROXY_UNAVAILABLE', message: String(e) };
  }
}

/** Session progress for callback-based flows (codex): pending / success / failed /
 * expired (+ provider error text). No token material ever appears here. */
export interface PoolLoginStatus {
  status: string;
  error_detail?: string;
}

/**
 * Poll the pool sign-in session (codex/auth_code flows, R34): OpenAI redirects to
 * the broker's own localhost callback — there is no code to paste — so the page
 * polls this until the session flips to success, then calls poolSubmitCode with an
 * EMPTY code (the broker replays the cached exchange idempotently).
 */
export async function poolStatus(sessionID: string): Promise<PoolLoginStatus | PoolLoginError> {
  try {
    const res = await fetch(`/api/user/oauth/pool/status?session_id=${encodeURIComponent(sessionID)}`, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (data as { error?: PoolLoginError }).error;
      return e ?? { code: 'POOL_LOGIN_FAILED', message: `HTTP ${res.status}` };
    }
    return data as PoolLoginStatus;
  } catch (e) {
    return { code: 'PROXY_UNAVAILABLE', message: String(e) };
  }
}
