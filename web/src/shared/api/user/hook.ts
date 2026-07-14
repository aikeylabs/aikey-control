/**
 * Hook coverage v1 — Web-modal "Allow" path API client.
 *
 * Endpoints:
 *   POST /api/user/hook/install   (Personal + Trial only — see edition guard
 *                                  in aikey-control-master/service/internal/api/router.go)
 *   GET  /api/user/hook/status    (same guard; read-only readiness probe,
 *                                  2026-07-10 — lets the banner survive a
 *                                  page refresh instead of waiting for the
 *                                  next vault mutation envelope)
 *
 * Per 20260507-web-hook-rc-modal-自动注入.md.
 *
 * Distinct from vault.ts: these endpoints do NOT require vault unlock and
 * never derive a vault key. install writes ~/.aikey/hook.{zsh,bash} and
 * the v3 marker block in the user's shell rc; status writes NOTHING.
 */

import { httpClient } from '../http-client';
import type { HookFailureReason } from './vault';

/** Response data from POST /api/user/hook/install. Mirrors the Web envelope
 *  three-field shape so the SPA's existing setReadiness handler is symmetric
 *  — pickHookReadiness from vault.ts works on this response unchanged. */
export interface HookInstallResponse {
  hook_file_installed: boolean;
  hook_rc_wired: boolean;
  hook_failure_reason: HookFailureReason | null;
}

interface OkEnvelope<T> {
  status: 'ok';
  data: T;
  request_id?: string;
}

interface ErrEnvelope {
  status: 'error';
  error_code: string;
  error_message: string;
}

function unwrap<T>(env: OkEnvelope<T> | ErrEnvelope): T {
  if (env.status !== 'ok') {
    const err = env as ErrEnvelope;
    const e = new Error(err.error_message) as Error & { code?: string };
    e.code = err.error_code;
    throw e;
  }
  return env.data;
}

export const hookApi = {
  /**
   * Wire the shell-hook rc bootstrap on behalf of the user (one-time).
   *
   * Renders ~/.aikey/hook.{zsh,bash} (Layer 1) and writes the v3 marker
   * block into the user's shell rc (Layer 2). The endpoint is mounted
   * only on Personal / Trial editions; Production returns 404 (no route).
   *
   * Always returns the three-field readiness envelope so the caller can
   * feed setReadiness even on partial failure (e.g. file_installed=true
   * but rc_wired=false because of an io_error mid-write).
   */
  install: async (): Promise<HookInstallResponse> => {
    const res = await httpClient.post<OkEnvelope<HookInstallResponse> | ErrEnvelope>(
      '/api/user/hook/install',
      {},
    );
    return unwrap(res.data);
  },

  /**
   * Read-only readiness probe (2026-07-10). Same three-field envelope as
   * install, so pickHookReadiness consumes both. Backed by a guaranteed
   * read-only CLI probe — safe to call on page load / tab focus.
   */
  status: async (): Promise<HookInstallResponse> => {
    const res = await httpClient.get<OkEnvelope<HookInstallResponse> | ErrEnvelope>(
      '/api/user/hook/status',
    );
    return unwrap(res.data);
  },
};
