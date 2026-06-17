import type React from 'react';

/**
 * Translate a raw (code, httpStatus, message) tuple into user-facing
 * error copy. Two purposes — say WHY it failed in plain English, and
 * suggest a NEXT STEP. Unknown codes fall back to a generic "Probe
 * could not run" with the axios message; we never silently hide the
 * raw failure, only re-skin the common transient cases.
 *
 * Matching order — code-based first, http-status fallback last. Why:
 * a known I_* code carries strictly more information than the raw
 * status (the server picks the status from a small table, but the
 * code comes from the cli's actual failure mode). An earlier version
 * matched `if httpStatus 5xx` first, which masked I_PROXY_NOT_RUNNING
 * (server mapped it to 500 fallthrough → UI steered users to restart
 * web, but the real fix was `aikey service start proxy`). The server
 * is now also fixed to return 503 for that code, but keeping
 * code-first here is defense in depth — a future I_* added without a
 * write.go case would still fall through to 500 and the UI must not
 * regress to the same wrong-target message. Bugfix:
 * workflow/CI/bugfix/20260523-test-connection-proxy-down-shows-local-
 * server-error.md.
 *
 * Cases (in match order):
 *   • I_PROXY_NOT_RUNNING    — aikey-proxy isn't running (CLI's
 *                              dedicated error code from handle_test).
 *   • I_CLUSTER_NODE_UNRESOLVED — cluster team-key probe: node resolved
 *                              but no probe target could be built
 *                              (transient hub/control connectivity).
 *   • I_CREDENTIAL_NOT_FOUND — alias / id resolved to nothing (rare,
 *                              implies the row was deleted between
 *                              the test click and the backend run).
 *   • ERR_NETWORK            — local server is fully down / port
 *                              hasn't bound yet (no httpStatus).
 *   • ECONNABORTED + timeout — 60s axios timeout exceeded (suite
 *                              still running on the CLI side).
 *   • httpStatus 5xx         — generic local-server fault, no
 *                              actionable code to dispatch on.
 *                              vaultApi.test already retried once at
 *                              this point.
 *
 * Extracted from vault/index.tsx (the only call-site is
 * TestConnectionPopup in that file) so the fence test in
 * `friendlyTestError.test.tsx` can import the function without
 * dragging the whole page module — page-level imports pull
 * http-client → runtime.ts which dereferences `window` at module init
 * and fails under vitest's default node environment.
 */
export function friendlyTestError(
  err: { code?: string; httpStatus?: number; message: string },
  // Optional i18n translator. When provided, user-facing copy is
  // localised via the 'vault' namespace; when omitted the function
  // returns the original English literals so the fence test in
  // `friendlyTestError.test.tsx` (which pins matching order + English
  // invariants and calls without `t`) keeps passing unchanged.
  t?: (key: string) => string,
): {
  title: string;
  detail: string;
  action?: React.ReactNode;
} {
  const { code, httpStatus, message } = err;
  // Translate-or-fallback helper: `tr(key, english)` returns the
  // localised string when a translator is present, otherwise the raw
  // English so the pure-logic contract (and the fence test) is intact.
  const tr = (key: string, english: string): string => (t ? t(key) : english);
  if (code === 'I_PROXY_NOT_RUNNING') {
    return {
      title: tr('vault.errProxyNotRunningTitle', 'aikey-proxy is not running'),
      detail: tr(
        'vault.errProxyNotRunningDetail',
        'The probe routes through aikey-proxy. Start the proxy and re-run the test.',
      ),
      action: (
        <>
          {tr('vault.errProxyNotRunningActionPrefix', 'Start it in a terminal: ')}
          <code className="font-bold">aikey service start proxy</code>.
        </>
      ),
    };
  }
  if (code === 'I_CLUSTER_NODE_UNRESOLVED') {
    // 2026-06-17: the 2026-06-11 cluster work added this code to write.go
    // (mapped to 503) but NOT here, so a cluster team-key probe whose
    // target couldn't be built fell through to the 5xx "Local server is
    // unavailable" branch — the same wrong-target bug I_PROXY_NOT_RUNNING
    // had. This case keeps it pointed at the cluster, not at restarting
    // web. Bugfix: 20260523-test-connection-proxy-down-shows-local-server-
    // error.md (cluster follow-up).
    return {
      title: tr('vault.errClusterNodeUnresolvedTitle', 'Cluster node not ready'),
      detail: tr(
        'vault.errClusterNodeUnresolvedDetail',
        "This team key's credential lives on the cluster's central node. The node resolved but the connectivity probe target couldn't be built — usually a transient state.",
      ),
      action: tr(
        'vault.errClusterNodeUnresolvedAction',
        'Retry. If it keeps failing, run `aikey use <alias>` to refresh the key, or check control / hub connectivity.',
      ),
    };
  }
  if (code === 'I_CREDENTIAL_NOT_FOUND') {
    return {
      title: tr('vault.errCredNotFoundTitle', 'Key not found'),
      detail: tr(
        'vault.errCredNotFoundDetail',
        'The vault no longer contains a credential with this alias / id. It may have been deleted in another window.',
      ),
      action: tr('vault.errCredNotFoundAction', 'Refresh the list (top-right button) and try again.'),
    };
  }
  if (code === 'ERR_NETWORK' || code === 'ECONNREFUSED') {
    return {
      title: tr('vault.errNetworkTitle', 'Cannot reach aikey-local-server'),
      detail: tr(
        'vault.errNetworkDetail',
        'The browser could not connect to the local server — it&apos;s probably stopped.',
      ),
      action: (
        <>
          {tr('vault.errProxyNotRunningActionPrefix', 'Start it in a terminal: ')}
          <code className="font-bold">aikey service start web</code>.
        </>
      ),
    };
  }
  if (code === 'ECONNABORTED' || /timeout/i.test(message)) {
    return {
      title: tr('vault.errTimeoutTitle', 'Probe timed out'),
      detail: tr(
        'vault.errTimeoutDetail',
        'The connectivity test took longer than 60 seconds. Upstream may be slow, or the key may be bound to many providers.',
      ),
      action: tr(
        'vault.errTimeoutAction',
        'Try again — if it keeps timing out, test one provider at a time via the CLI.',
      ),
    };
  }
  if (httpStatus != null && httpStatus >= 500 && httpStatus < 600) {
    return {
      title: tr('vault.errServerUnavailableTitle', 'Local server is unavailable'),
      detail: tr(
        'vault.errServerUnavailableDetail',
        'The aikey-local-server returned an internal error. The auto-retry already tried once. Usually a quick restart fixes it.',
      ),
      action: (
        <>
          Restart it in a terminal: <code className="font-bold">aikey service restart web</code>{' '}
          (or <code className="font-bold">aikey service start web</code> if it&apos;s already stopped).
        </>
      ),
    };
  }
  // Generic fallback: show the raw axios message so we don't hide real
  // bugs, but keep the title friendly so users know what kind of thing
  // went wrong.
  return {
    title: tr('vault.errFallbackTitle', 'Probe could not run'),
    detail: message,
  };
}
