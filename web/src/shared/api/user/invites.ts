/**
 * Invite local-API client (Phase 4F).
 *
 * Talks to /local-api/csrf-token + /local-api/invite/{create,revoke} on
 * the same-origin local web server (aikey-local-server / aikey-full-trial).
 * Spec: aikeylabs/roadmap20260320/技术实现/阶段4-增值版/AiKey主站与安装统计方案.md §6.14.2.
 *
 * Why a hand-rolled fetch wrapper (not the shared axios client):
 *   - /local-api/* is NOT JWT-authenticated. The shared httpClient injects
 *     an Authorization header that would be ignored at best, leaked in
 *     audit logs at worst. Cleaner to keep the local-api surface entirely
 *     separate.
 *   - CSRF cookie + X-Aikey-Local-CSRF header are the only auth signals;
 *     we manage them explicitly here.
 *   - Same-origin only — no need for `baseURL` config.
 */

/** Snapshot fields the inviter may optionally include with create. */
export interface CreateInviteRequest {
  creator_channel?: string;
  creator_version?: string;
  creator_lang?: string;
  creator_edition?: string;
}

export interface CreateInviteResponse {
  code: string;
  url: string;
  created_at: string;
}

export interface RevokeInviteResponse {
  status: 'revoked' | 'not_found' | 'forbidden' | string;
  code?: string;
  message?: string;
}

/**
 * Cached CSRF token for the current page session. Issued once via
 * /local-api/csrf-token and re-used until 403 (which triggers a refresh).
 *
 * Why module-level cache (not React state): every POST goes through the
 * same browser fetch path. A module-level mutable cache keeps the
 * happy-path single-request and survives unmount of the Invites tab.
 */
let cachedCSRFToken: string | null = null;

async function ensureCSRFToken(forceRefresh = false): Promise<string> {
  if (cachedCSRFToken && !forceRefresh) {
    return cachedCSRFToken;
  }
  const res = await fetch('/local-api/csrf-token', {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`CSRF token issue failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) {
    throw new Error('CSRF token response missing `token` field');
  }
  cachedCSRFToken = body.token;
  return cachedCSRFToken;
}

async function postLocalAPI<TBody, TResp>(
  path: '/local-api/invite/create' | '/local-api/invite/revoke',
  body: TBody,
): Promise<{ status: number; body: TResp }> {
  let token = await ensureCSRFToken();
  // One auto-retry on CSRF reject: stale cached token after a server
  // restart would otherwise force the user to refresh manually.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Aikey-Local-CSRF': token,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: TResp;
    try {
      parsed = text ? (JSON.parse(text) as TResp) : ({} as TResp);
    } catch {
      throw new Error(`Local API ${path} returned non-JSON body: ${text.slice(0, 120)}`);
    }
    if (res.status === 403 && attempt === 0) {
      // Possibly stale CSRF — refresh once and retry.
      token = await ensureCSRFToken(true);
      continue;
    }
    return { status: res.status, body: parsed };
  }
  // Unreachable: the for-loop returns in both branches above. Keeps tsc happy.
  throw new Error(`Local API ${path} exhausted CSRF retries`);
}

export const inviteLocalAPI = {
  async create(req: CreateInviteRequest = {}): Promise<CreateInviteResponse> {
    const { status, body } = await postLocalAPI<CreateInviteRequest, CreateInviteResponse & { message?: string }>(
      '/local-api/invite/create',
      req,
    );
    if (status !== 200) {
      throw new Error(`Create invite failed (HTTP ${status}): ${body.message ?? 'unknown'}`);
    }
    return body;
  },

  async revoke(code: string): Promise<RevokeInviteResponse> {
    const trimmed = code.trim();
    if (!trimmed) {
      throw new Error('Code is required');
    }
    const { status, body } = await postLocalAPI<{ code: string }, RevokeInviteResponse>(
      '/local-api/invite/revoke',
      { code: trimmed },
    );
    // We surface 200 / 403 / 404 outcomes via the body.status field; the
    // page renders specific UI for each. Only 5xx + unexpected codes
    // throw.
    if (status >= 500) {
      throw new Error(`Revoke invite failed (HTTP ${status}): ${body.message ?? 'server error'}`);
    }
    return body;
  },
};
