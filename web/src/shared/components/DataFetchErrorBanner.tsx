/**
 * DataFetchErrorBanner — the global safety net for silently-failing reads.
 *
 * ## Why this exists (2026-07-26)
 *
 * The console's common read pattern discards query errors:
 *
 *     const { data: rawKeys } = useQuery({...});   // error never read
 *     const allKeys = rawKeys ?? [];               // failure → empty list
 *
 * so a 401 / CORS block / 500 renders as "暂无数据" — visually identical to an
 * account that genuinely has no data. Two July-2026 production defects hid
 * behind exactly this: the poisoned cross-app peer URL (every Overview chart
 * empty on 401s nobody could see) and a Production-only 500 in PersonalRecent
 * that stayed invisible until a probe asserted on the network log. Project
 * rule: 失败要显眼，不要沉默.
 *
 * Per-page `{error && <ApiErrorDisplay …/>}` blocks (the master-side pattern)
 * give precise, actionable messages — but they depend on every page author
 * remembering. This banner is the layer that does NOT depend on memory: ANY
 * query living in the shared QueryClient that settles into error state
 * surfaces here, including in pages written next year.
 *
 * ## Why it derives state instead of accumulating events
 *
 * Deliberately NOT `queryCache.onError` + component state: that is an event
 * stream (background refetches re-fire it, entries need dedupe and expiry — a
 * little stateful machine that can drift from reality). "Which queries are in
 * error state RIGHT NOW" is a stateless projection of the query cache itself:
 * `useSyncExternalStore` over `queryClient.getQueryCache()`. When a refetch
 * succeeds, the failing entry leaves the cache's error set and the banner
 * updates or disappears on its own — self-healing, nothing to reconcile.
 *
 * ## Visibility tiers — reuses the hook-wiring visibility rules
 * (CI/requirements/2026-07-10-hook-wiring-visibility.md), not new policy:
 *
 *  - AUTH class (401/419…): the user can fix it in one action (sign in again)
 *    → persistent, NOT dismissible (rule 1: one-click-fixable may be stubborn).
 *  - everything else (network / CORS / 5xx): nothing the user can do from the
 *    browser → dismissible (rule 6: "不可行动的顽强提示会训练用户忽略提示").
 *    Dismissal is keyed by the current error-set fingerprint and held in
 *    sessionStorage — NEW failures re-show the banner, the same failure set
 *    stays dismissed for the session.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { parseApiError, type ApiError } from '@/shared/utils/api-error';

const DISMISS_KEY = 'aikey:data-fetch-error-banner:dismissed';

interface ErrorSummary {
  /** Deduped by error code, worst-first (auth outranks the rest). */
  errors: ApiError[];
  /** True when at least one error is the sign-in-again class. */
  hasAuth: boolean;
  /** Stable fingerprint of the current error set, for dismissal keying. */
  fingerprint: string;
}

const AUTH_CODES = /^(HTTP_401|HTTP_419|BIZ_AUTH_)/;

function summarize(errs: unknown[]): ErrorSummary | null {
  if (errs.length === 0) return null;
  const byCode = new Map<string, ApiError>();
  for (const e of errs) {
    const parsed = parseApiError(e);
    if (!byCode.has(parsed.code)) byCode.set(parsed.code, parsed);
  }
  const errors = [...byCode.values()].sort(
    (a, b) => Number(AUTH_CODES.test(b.code)) - Number(AUTH_CODES.test(a.code)),
  );
  return {
    errors,
    hasAuth: errors.some((e) => AUTH_CODES.test(e.code)),
    fingerprint: errors.map((e) => e.code).sort().join('|'),
  };
}

export function DataFetchErrorBanner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  // Subscribe to the cache; snapshot is the JOINED code list so React only
  // re-renders when the SET of failing codes changes, not on every cache event.
  const codesKey = React.useSyncExternalStore(
    React.useCallback((onChange) => cache.subscribe(onChange), [cache]),
    () => {
      const codes = new Set<string>();
      for (const q of cache.getAll()) {
        if (q.state.status === 'error' && q.state.error) codes.add(parseApiError(q.state.error).code);
      }
      return [...codes].sort().join('|');
    },
  );

  const summary = React.useMemo(() => {
    if (!codesKey) return null;
    const errs = cache
      .getAll()
      .filter((q) => q.state.status === 'error' && q.state.error)
      .map((q) => q.state.error as unknown);
    return summarize(errs);
  }, [codesKey, cache]);

  const [dismissedFp, setDismissedFp] = React.useState<string>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) ?? ''; } catch { return ''; }
  });

  if (!summary) return null;
  // Auth errors are one-click fixable → never dismissible. Anything else may be
  // dismissed, but only for THIS exact failure set: a new code re-shows it.
  if (!summary.hasAuth && dismissedFp === summary.fingerprint) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, summary.fingerprint); } catch { /* private mode */ }
    setDismissedFp(summary.fingerprint);
  };

  const first = summary.errors[0];
  const extra = summary.errors.length - 1;

  return (
    <div
      className="mx-6 mt-4 px-4 py-3 rounded border text-xs font-mono flex items-start justify-between gap-3"
      style={{
        // Same alert palette the compliance/audit pages use for failure text
        // (#f87171) — no new colors, red family because data on screen may be
        // INCOMPLETE, which outranks a mere notice.
        borderColor: 'rgba(248,113,113,0.4)',
        backgroundColor: 'rgba(248,113,113,0.06)',
        color: 'var(--foreground)',
      }}
      role="alert"
    >
      <div className="space-y-1 min-w-0">
        <div className="font-bold" style={{ color: '#f87171' }}>
          {summary.hasAuth ? t('dataFetchError.titleAuth') : t('dataFetchError.title')}
        </div>
        <div style={{ color: 'var(--muted-foreground)' }} className="break-words">
          [{first.code}] {first.message}
          {extra > 0 && ` · ${t('dataFetchError.more', { count: extra })}`}
        </div>
        {first.suggestion && (
          <div style={{ color: 'var(--muted-foreground)' }}>{first.suggestion}</div>
        )}
      </div>
      {!summary.hasAuth && (
        <button
          onClick={dismiss}
          className="shrink-0 px-2 py-0.5 rounded border text-[10px]"
          style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
        >
          {t('dataFetchError.dismiss')}
        </button>
      )}
    </div>
  );
}
