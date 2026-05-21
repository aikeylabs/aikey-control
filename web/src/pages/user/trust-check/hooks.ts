/**
 * TanStack Query hooks for the Trust Check page.
 *
 * Why hooks (not direct API calls): every aikey-control page uses
 * useQuery for caching + retry + loading-state-as-data. Sticking to
 * the pattern keeps the page consistent with cost/overview/etc. and
 * gives us cache-keyed background refresh for free.
 */

import { useMemo } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';

import {
  trustLocalApi,
  TrustLocalUnavailableError,
  type TrustSummary,
  type VerifyRecord,
  type VerifyRequestBody,
} from './api';
import { deriveMetrics, summaryToRow, type TrustRow, type TrustMetrics } from './derive';

const STATUS_REFETCH_INTERVAL = 30_000; // 30s — matches kickoff §7.2
const VERIFY_POLL_INTERVAL = 1_500; // 1.5s — fast enough for spinner, low enough to spare CPU
const DETAIL_STALE_MS = 5_000; // detail drawer: short stale window so re-opening the same row inside 5s reuses the cache

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

  return { status, rows, metrics, isOffline, summaries: items };
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

