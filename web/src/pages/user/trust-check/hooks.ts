/**
 * TanStack Query hooks for the Trust Check page.
 *
 * Why hooks (not direct API calls): every aikey-control page uses
 * useQuery for caching + retry + loading-state-as-data. Sticking to
 * the pattern keeps the page consistent with cost/overview/etc. and
 * gives us cache-keyed background refresh for free.
 */

import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  trustLocalApi,
  TrustLocalUnavailableError,
  type TrustEmptyReason,
  type TrustSummary,
  type VerifyRecord,
  type VerifyRequestBody,
} from './api';
import { deriveMetrics, summaryToRow, type TrustRow, type TrustMetrics } from './derive';

const STATUS_REFETCH_INTERVAL = 30_000; // 30s — matches kickoff §7.2
const VERIFY_POLL_INTERVAL = 1_500; // 1.5s — fast enough for spinner, low enough to spare CPU
const DETAIL_STALE_MS = 5_000; // detail drawer: short stale window so re-opening the same row inside 5s reuses the cache

/**
 * Deadlines for the console's service-control endpoints on 8090.
 *
 * Why these need deadlines at all: same hole as the trust-local client
 * (see api.ts::TRUST_LOCAL_TIMEOUT_MS) — `fetch` has no timeout, so a
 * console whose CLI spawn wedges leaves the Start button stuck on
 * "Starting…" forever and the install-state probe pending forever, with
 * no error to act on. Bugfix:
 * workflow/CI/bugfix/20260814-trust-check-web-infinite-loading-no-fetch-timeout.md
 *
 * Why two different values — this is a layered-deadline stack, each ring
 * sitting ABOVE the one it wraps so the innermost, most-informative
 * error is the one the user sees:
 *
 *   CLI healthz probe   30s  (commands_service/commands.rs PROBE_DEADLINE_SECS)
 *   console exec ctx    40s  (service_handler.go — 30s probe + margin)
 *   START (this file)   45s  ← must outlast 40s
 *   STATUS (this file)  15s  ← independent: see below
 *
 * START at 45s: a cold PyInstaller start legitimately takes ~20s+ under
 * load. Aborting at, say, 10s would report "start failed" for a start
 * that then succeeds — strictly worse than making the user wait, because
 * it sends them debugging a working service.
 *
 * STATUS at 15s: this one is a background probe on a 30s tick, and its
 * failure is harmless (the banner falls back to reactive post-click
 * detection). It must fail well inside the tick rather than ride the
 * 40s server ceiling, so a wedged CLI can never leave the probe
 * permanently in flight.
 */
const START_SERVICE_TIMEOUT_MS = 45_000;
const SERVICE_STATUS_TIMEOUT_MS = 15_000;

/**
 * POST to the console under a deadline.
 *
 * Deliberately NOT shared with api.ts::withTrustLocalDeadline: that one
 * throws TrustLocalUnavailableError, which would tell the page
 * "trust-local is offline" when the truth is "the console that supervises
 * it didn't answer" — two different services, two different remediations.
 * Callers here add their own typed envelope on top.
 *
 * The deadline covers the response body too, so a console that sends
 * headers and then stalls can't hang `resp.json()`.
 */
async function consoleFetch<T>(
  path: string,
  timeoutMs: number,
  handle: (resp: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const asTransportError = (cause: unknown) =>
    new Error(
      controller.signal.aborted
        ? `aikey-local-server did not answer ${path} within ${timeoutMs / 1000}s — ` +
          'the console is running but its service-control call is stuck. ' +
          'Run `aikey service status` in a terminal to see the real state.'
        : `aikey-local-server is unreachable at ${path} (${
            cause instanceof Error ? cause.message : String(cause)
          }) — is the console still running?`,
    );
  try {
    let resp: Response;
    try {
      resp = await fetch(path, { method: 'POST', signal: controller.signal });
    } catch (err) {
      throw asTransportError(err);
    }
    try {
      return await handle(resp);
    } catch (err) {
      // Only a body that died mid-read is a transport failure; errors
      // `handle` raises about the envelope itself must pass through.
      if (controller.signal.aborted) throw asTransportError(err);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * useStartTrustLocalService — POST /api/internal/services/trust-local/start
 *
 * Backs the "Start service" button on the offline banner. The endpoint
 * lives on aikey-local-server (8090), NOT trust-local (8801) — that's
 * the whole point, trust-local is dead and we ask its supervisor to
 * relaunch it. On success the page's 30s refetch picks up the new
 * live data, so we don't manually invalidate here.
 *
 * NOTE: empty `''` baseURL is intentional — when the SPA is served
 * from 8090, fetch('/api/...') is same-origin; if a dev runs Vite
 * on 5173 with VITE_AUTH_MODE=local_bypass, this still works because
 * Vite proxies /api → 8090.
 *
 * Error envelope (preserved from console's JSON response):
 *   `{ ok: false, error: "TRUST_LOCAL_NOT_INSTALLED" | "...", detail: "..." }`
 *
 * Why we throw a typed `StartServiceError` (not bare `Error`): the
 * banner needs to distinguish "not installed" (point user at
 * `aikey app install degrade-detector`) from "installed but launch
 * failed" (point user at `aikey service restart`). Bugfix:
 * 20260525-trust-check-web-uninstalled-vs-offline-confusion.md.
 */
export class StartServiceError extends Error {
  errorCode: string;
  detail: string;
  constructor(errorCode: string, detail: string) {
    super(detail);
    this.name = 'StartServiceError';
    this.errorCode = errorCode;
    this.detail = detail;
  }
}

/**
 * The mutation's request core, exported for the same reason
 * `normalizeServiceStatus` is: the fence test must exercise the code the
 * hook actually runs, not a hand-copied replica that drifts from it.
 * Every failure — envelope, transport, deadline — leaves here as a
 * StartServiceError, because the banner reads `error.detail` and a bare
 * Error would render "Start failed: ." with the reason nowhere on screen.
 */
export async function startTrustLocalService(): Promise<{
  ok: boolean;
  detail?: string;
}> {
  try {
    return await consoleFetch(
      '/api/internal/services/trust-local/start',
      START_SERVICE_TIMEOUT_MS,
      async (resp) => {
        const body = await resp
          .json()
          .catch(() => ({} as Record<string, unknown>));
        if (!resp.ok || (body as { ok?: boolean })?.ok === false) {
          const errorCode =
            ((body as { error?: string })?.error) || `HTTP_${resp.status}`;
          const detail =
            ((body as { detail?: string })?.detail) ||
            `start failed (HTTP ${resp.status})`;
          throw new StartServiceError(errorCode, detail);
        }
        return body as { ok: boolean; detail?: string };
      },
    );
  } catch (err) {
    if (err instanceof StartServiceError) throw err;
    throw new StartServiceError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function useStartTrustLocalService() {
  return useMutation<
    { ok: boolean; detail?: string },
    StartServiceError,
    void
  >({
    mutationFn: startTrustLocalService,
  });
}

/**
 * useTrustLocalServiceStatus — POST /api/internal/services/trust-local/status
 *
 * Proactive install-state probe, served by aikey-local-server (8090) which
 * shells out `aikey service status trust-local --json`. Unlike the liveness
 * query (which hits trust-local :8801 directly and can't tell "not installed"
 * from "installed but stopped" — both just fail), this reports an explicit
 * `installed` bool from the SAME binary-path truth source as `aikey doctor`.
 * The banner uses it to show "not installed → aikey app install" on the very
 * first render instead of the misleading "offline / restart it" default.
 * Bugfix: 20260703-trust-check-web-offline-vs-notinstalled-proactive.md.
 *
 * Never throws on a not-installed/offline result — the console returns
 * `{ok:true, installed:false, running:false}` (HTTP 200) for those; only a
 * genuine transport failure rejects — including the probe blowing its
 * SERVICE_STATUS_TIMEOUT_MS deadline — and the banner degrades to the
 * existing reactive (post-Start-click) detection in that case.
 */
export interface TrustLocalServiceStatus {
  ok: boolean;
  installed: boolean;
  running: boolean;
  detail: string;
}

/**
 * Normalize the console's service-status envelope into a total shape.
 * Exported so the fence test exercises the SAME code the hook runs (not a
 * re-implementation). Defaults are deliberately conservative: a missing
 * `installed` reads as `false` so a malformed/legacy console never makes the
 * banner claim the plugin is present when we can't confirm it.
 */
export function normalizeServiceStatus(
  body: Partial<TrustLocalServiceStatus> | null | undefined,
): TrustLocalServiceStatus {
  return {
    ok: body?.ok ?? false,
    installed: body?.installed ?? false,
    running: body?.running ?? false,
    detail: body?.detail ?? '',
  };
}

/**
 * The probe's request core — exported for the same reason
 * `normalizeServiceStatus` and `startTrustLocalService` are: the fence
 * test must run the shipped code path, deadline included.
 */
export function fetchTrustLocalServiceStatus(): Promise<TrustLocalServiceStatus> {
  return consoleFetch(
    '/api/internal/services/trust-local/status',
    SERVICE_STATUS_TIMEOUT_MS,
    async (resp) => {
      const body = (await resp
        .json()
        .catch(() => ({}))) as Partial<TrustLocalServiceStatus>;
      return normalizeServiceStatus(body);
    },
  );
}

export function useTrustLocalServiceStatus() {
  return useQuery<TrustLocalServiceStatus>({
    queryKey: ['trust-local', 'service-status'],
    queryFn: fetchTrustLocalServiceStatus,
    refetchInterval: STATUS_REFETCH_INTERVAL,
    staleTime: 10_000,
  });
}

export function useTrustStatus() {
  return useQuery({
    queryKey: ['trust-local', 'status'],
    queryFn: () => trustLocalApi.listStatus(),
    refetchInterval: STATUS_REFETCH_INTERVAL,
    // Don't retry on the "trust-local offline" error — that error
    // type is a known cold-state signal; retrying just delays the
    // UI showing its offline banner. For other errors (server
    // returned 5xx, JSON decode fail) the default retry is fine.
    retry: (failureCount, error) => {
      if (error instanceof TrustLocalUnavailableError) return false;
      return failureCount < 2;
    },
    // Keep stale data shown while a refresh is in flight — avoids
    // table flashing empty on the periodic 30s tick.
    staleTime: 10_000,
  });
}

/**
 * useTrustRows + useTrustMetrics work off the same query data via
 * useMemo so the table and metric cards never disagree about counts.
 */
export function useTrustView(): {
  status: ReturnType<typeof useTrustStatus>;
  rows: TrustRow[];
  metrics: TrustMetrics;
  isOffline: boolean;
  /** Why the list is empty, straight from the plugin (spec R7).
   *  `undefined` when the list is NOT empty, and also when the plugin is
   *  older than this console and never sends it — the page treats both
   *  the same way, which is the point. */
  emptyReason: TrustEmptyReason | undefined;
  /** Raw summaries — exposed so consumers (e.g. BAND grouping) can
   *  reach fields the projection drops, like the epoch
   *  `last_verified_at` we need for time-sorting. */
  summaries: TrustSummary[];
} {
  const status = useTrustStatus();
  const items = status.data?.items ?? [];

  const rows = useMemo<TrustRow[]>(() => items.map(summaryToRow), [items]);
  const metrics = useMemo<TrustMetrics>(() => deriveMetrics(items), [items]);

  const isOffline = status.error instanceof TrustLocalUnavailableError;
  const emptyReason = status.data?.empty_reason;

  return { status, rows, metrics, isOffline, emptyReason, summaries: items };
}

/**
 * useTriggerVerify — POST /v1/verify. Caller passes alias + provider +
 * model from a row; on success the page stores `verify_id` against the
 * alias and starts polling via `useVerifyPolling`.
 *
 * Errors are NOT auto-handled here — the page distinguishes 429 (rate
 * limited, offer force-retry) from generic failures. Returning the
 * mutation lets the page introspect `error` directly.
 */
export function useTriggerVerify() {
  return useMutation<VerifyRecord, Error, VerifyRequestBody>({
    mutationFn: (body) => trustLocalApi.triggerVerify(body),
  });
}

/**
 * useVerifyPolling — fan out one polling query per in-flight verify_id.
 *
 * Why useQueries (not N independent useQuery hooks): the set of
 * in-flight verifies changes over time (user clicks Check on row A,
 * then row B); React's hook rules forbid conditional hook counts, so
 * we must call hooks for a STABLE shape every render. useQueries
 * takes a runtime array and handles the variable count internally.
 *
 * The polling stops automatically the first time a query sees a
 * terminal status (refetchInterval returns false). The caller (page)
 * watches the returned results for terminal transitions and (a)
 * removes the verify_id from its in-flight map and (b) invalidates
 * the parent /v1/status query so the row's score/band refresh.
 */
/**
 * useAliasDetail — fetches `GET /v1/status/{alias}` for the drawer.
 * Returns `cascade_history` (up to last 10 verifies) + the same fields
 * the list endpoint returns. Disabled while `alias` is null so closing
 * the drawer doesn't burn a request.
 *
 * Why not cache forever: the latest cascade_history entry might still
 * be `status: "running"` if the user opens the drawer mid-verify; a
 * 5s stale window lets a re-open inside the same drawer session reuse
 * the response while still picking up fresh data on a deliberate
 * re-open after a verify completes.
 */
export function useAliasDetail(alias: string | null) {
  return useQuery({
    queryKey: ['trust-local', 'detail', alias],
    queryFn: () => trustLocalApi.getAliasDetail(alias!),
    enabled: alias != null,
    staleTime: DETAIL_STALE_MS,
    retry: (failureCount, error) => {
      if (error instanceof TrustLocalUnavailableError) return false;
      return failureCount < 2;
    },
  });
}

/**
 * useVerifyDetail — single-shot fetch of one cascade verify's full
 * record (including the `scoring_detail` blob with questions /
 * answers / per-question score that the drawer's inline Q/A panel
 * renders). The list endpoint `/v1/status/{alias}` returns
 * `cascade_history` rows but NOT scoring_detail — the operator team
 * (Day 4 review) decided to keep that payload behind a separate
 * fetch because it can be multi-KB and most users never expand it.
 *
 * Disabled when `verifyId` is null so toggling an expanded history
 * row off doesn't burn a request.
 */
export function useVerifyDetail(verifyId: string | null) {
  return useQuery({
    queryKey: ['trust-local', 'verify', verifyId],
    queryFn: () => trustLocalApi.getVerifyStatus(verifyId!),
    enabled: verifyId != null,
    // Terminal verifies are immutable — once we have the payload it
    // never changes; cache aggressively so re-expanding the same row
    // is instant.
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => {
      if (error instanceof TrustLocalUnavailableError) return false;
      return failureCount < 2;
    },
  });
}

/**
 * useRealtimeDetection — reads + mutates the real-time D-rule scoring
 * toggle on trust-local. The toggle propagates to the proxy via a 5s
 * polling loop (see degrade-detector/proxy-plugin/rhythm/
 * settings_poller.go), so flips here take up to 5s to affect actual
 * chat traffic; the UI shows a hint reflecting that.
 *
 * staleTime 30s — toggle doesn't change often; we still refetch on
 * window focus to catch changes the user made in another tab.
 */
const REALTIME_SETTING_KEY = ['trust-local', 'settings', 'realtime-detection'] as const;

export function useRealtimeDetection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: REALTIME_SETTING_KEY,
    queryFn: () => trustLocalApi.getRealtimeDetection(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof TrustLocalUnavailableError) return false;
      return failureCount < 2;
    },
  });
  const setEnabled = useMutation<
    { enabled: boolean; updated_at: number; updated_by: string },
    Error,
    boolean
  >({
    mutationFn: (enabled) => trustLocalApi.setRealtimeDetection(enabled),
    onSuccess: (data) => {
      // Write-through: avoid a refetch round-trip for the UI's own flip.
      qc.setQueryData(REALTIME_SETTING_KEY, data);
    },
  });
  return { query, setEnabled };
}

/**
 * useResetTracking — POST /v1/status/{alias}/reset-tracking.
 *
 * Wipes the alias's degrade-detection history (events + state) on
 * trust-local; vault credential stays intact. On success the
 * `['trust-local', 'status']` and per-alias detail queries are
 * invalidated so the table + drawer reflect the cleared state
 * without forcing a manual refresh.
 *
 * Why expose as a hook (not call api directly from the drawer):
 * keeps the loading / error model identical to the page's other
 * mutations (Check button) and gives us cache invalidation through
 * the shared QueryClient instead of bespoke event plumbing.
 */
export function useResetTracking() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; alias_name: string; cleared_events: number; cleared_state: number },
    Error,
    string
  >({
    mutationFn: (alias) => trustLocalApi.resetTracking(alias),
    onSuccess: (_data, alias) => {
      qc.invalidateQueries({ queryKey: ['trust-local', 'status'] });
      qc.removeQueries({ queryKey: ['trust-local', 'detail', alias] });
    },
  });
}

export function useVerifyPolling(verifyIds: string[]) {
  return useQueries({
    queries: verifyIds.map((id) => ({
      queryKey: ['trust-local', 'verify', id],
      queryFn: () => trustLocalApi.getVerifyStatus(id),
      // Returning `false` stops further polling — we use it the
      // moment the server reports a terminal status, so the network
      // tab doesn't keep tapping the endpoint after the user has
      // moved on. The polling resumes if the caller resets state and
      // re-enters this hook with the same id (rare).
      refetchInterval: (query: { state: { data?: VerifyRecord } }) => {
        const data = query.state.data;
        if (data && data.status !== 'running') return false;
        return VERIFY_POLL_INTERVAL;
      },
      // 5-min stale buffer: if the user re-clicks a row whose verify
      // already finished, we serve the cached terminal state instead
      // of re-firing /v1/verify/{id} for a record that will never
      // change again.
      staleTime: 5 * 60_000,
    })),
  });
}

