/**
 * RouteErrorBoundary — keeps a render crash inside ONE page instead of taking
 * the whole console down.
 *
 * WHY THIS EXISTS (2026-07-30, after the seats-page incident)
 *
 * A single unguarded field read — `g.members.length` where the API sent
 * `members: null` — replaced the entire admin console with React Router's raw
 * fallback ("Unexpected Application Error!" plus a minified stack). Three things
 * made that outcome much worse than the bug itself:
 *
 *   1. The blast radius was the WHOLE app: navigation disappeared, so the admin
 *      could not even move to a working page — only a manual reload escaped it.
 *   2. The message was addressed to us, not to them. `at Je (index-xxx.js:1:22046)`
 *      tells an operator nothing about what to do next.
 *   3. It looked like the product was broken, when one page's data had one null.
 *
 * Mounted around the shell's <Outlet/>, this boundary turns all three around:
 * the shell (nav, org switcher, language) survives, the failure is stated in the
 * user's language with actions attached, and the technical detail is available
 * but folded away for a bug report.
 *
 * WHAT IT DOES NOT DO — deliberately: it does not "recover" the broken render.
 * React cannot resume a subtree that threw; the honest options are retry (remount
 * the page) and navigate away, which is exactly what the fallback offers. It is a
 * blast-radius limiter and a diagnostics surface, NOT a licence to leave null
 * handling unfixed — every fallback shown is still a defect to fix at the source
 * (see 20260730-列表字段空集合必须序列化为空数组.md).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface RouteErrorBoundaryProps {
  children: ReactNode;
  /**
   * Changes whenever the user navigates. The boundary resets on a new value, so
   * moving to another page clears the fallback — without it React keeps the
   * error state forever and every subsequent route renders the fallback too,
   * which would be indistinguishable from "the whole app is broken".
   */
  resetKey?: string;
  /** Optional reporter (telemetry / logging). Never allowed to throw. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * 'page'   — full content-area card (a routed page died; the area is empty
   *            anyway, so something must occupy it).
   * 'inline' — compact panel that replaces only the crashed subtree, used
   *            INSIDE a modal whose own chrome (title bar + close X + footer)
   *            survives. The user dismisses with the control they already know.
   */
  variant?: 'page' | 'inline';
}

interface RouteErrorBoundaryState {
  error: Error | null;
  /** Bumped by 重试 so the child subtree remounts from scratch. */
  attempt: number;
  lastResetKey?: string;
  showDetail: boolean;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null, attempt: 0, showDetail: false };

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { error };
  }

  /**
   * Drop the error when the route changes. Implemented as a derived-state check
   * (not an effect) because the fallback must not paint for even one frame on
   * the new route.
   */
  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    if (props.resetKey !== state.lastResetKey) {
      return { lastResetKey: props.resetKey, error: null, showDetail: false };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console record: the fallback folds the stack away, and a support
    // ticket is written from what the browser console shows.
    console.error('[aikey] page render failed', error, info.componentStack);
    try {
      this.props.onError?.(error, info);
    } catch {
      // A failing reporter must never mask the original error.
    }
  }

  private retry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1, showDetail: false }));
  };

  render() {
    const { error } = this.state;
    if (!error) {
      // `attempt` in the key: 重试 must REMOUNT the subtree, not just re-render
      // it — a component that threw during mount would otherwise keep its
      // broken state and throw again immediately.
      return <div key={this.state.attempt}>{this.props.children}</div>;
    }
    return (
      <RouteErrorFallback
        variant={this.props.variant ?? 'page'}
        error={error}
        showDetail={this.state.showDetail}
        onToggleDetail={() => this.setState((s) => ({ showDetail: !s.showDetail }))}
        onRetry={this.retry}
      />
    );
  }
}

/**
 * The fallback is a plain function component so the copy can use hooks-free
 * i18n-agnostic text: this file is imported by BOTH consoles (dual-edit scope),
 * and a hard i18n dependency here would make the boundary itself a crash source
 * when the failure happened before the i18n provider mounted.
 *
 * Text is bilingual inline for the same reason — a boundary that needs working
 * infrastructure to render is not a boundary.
 */
function RouteErrorFallback({
  error,
  showDetail,
  onToggleDetail,
  onRetry,
  variant,
}: {
  error: Error;
  showDetail: boolean;
  onToggleDetail: () => void;
  onRetry: () => void;
  variant: 'page' | 'inline';
}) {
  const detail = [error.name, error.message, error.stack].filter(Boolean).join('\n');
  const inline = variant === 'inline';
  return (
    <div className={inline ? '' : 'flex items-start justify-center p-8'} data-testid="route-error-boundary">
      <div
        className={(inline ? 'w-full rounded border p-4 space-y-3' : 'w-full max-w-lg rounded border p-6 space-y-4')}
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--destructive, #ef4444)' }}
        role="alert"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-mono font-bold" style={{ color: 'var(--destructive, #ef4444)' }}>
            {inline ? '此窗口出现异常 · This dialog hit an error' : '此页面出现异常 · This page hit an error'}
          </h2>
          <p className="text-[11px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
            {inline
              ? '页面本身不受影响，关闭本窗口即可继续操作。 · The page itself is fine — close this dialog to continue.'
              : '其他页面不受影响，可直接从左侧导航继续操作。 · Other pages are unaffected — use the navigation to continue.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onRetry}
            data-testid="route-error-retry"
            className="text-[11px] font-mono px-3 py-1.5 rounded border"
            style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
          >
            重试 · Retry
          </button>
          {/* No "reload" inside a dialog: the PAGE is healthy, and reloading
              would throw away whatever the operator has on it. Closing the
              dialog is both cheaper and sufficient. */}
          {!inline && (
            <button
              onClick={() => window.location.reload()}
              className="text-[11px] font-mono px-3 py-1.5 rounded border"
              style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
            >
              刷新页面 · Reload
            </button>
          )}
          <button
            onClick={onToggleDetail}
            data-testid="route-error-detail-toggle"
            className="text-[11px] font-mono px-3 py-1.5 rounded border"
            style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}
          >
            {showDetail ? '隐藏详情 · Hide details' : '技术详情 · Details'}
          </button>
        </div>

        {showDetail && (
          <div className="space-y-2">
            <pre
              className="text-[10px] font-mono p-3 rounded overflow-auto max-h-64 whitespace-pre-wrap break-all"
              style={{ backgroundColor: 'rgba(0,0,0,0.25)', color: 'var(--muted-foreground)' }}
              data-testid="route-error-detail"
            >
              {detail}
            </pre>
            <button
              onClick={() => { void navigator.clipboard?.writeText(detail); }}
              className="text-[10px] font-mono px-2 py-1 rounded border"
              style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}
            >
              复制以便反馈 · Copy for a bug report
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ModalErrorBoundary — the same limiter at the DIALOG granularity.
 *
 * WHY A SECOND GRANULARITY (2026-07-30, owner decision A): without it a crash
 * inside a dialog propagates to the route boundary, which replaces the ENTIRE
 * content area — the operator loses the page they were working on to fix a
 * dialog. Placed inside the shared modal primitives, every dialog built on them
 * gets containment for free, and new dialogs inherit it with no extra work.
 *
 * The fallback deliberately renders IN PLACE rather than auto-closing with a
 * toast: auto-closing removes the explanation before it can be read and
 * discards the operator's in-progress input, while the dialog's own close
 * control is already the familiar way out. It stays until dismissed, and the
 * technical detail is copyable for a bug report.
 *
 * 🚫 Known gap: dialogs that hand-roll `fixed inset-0` instead of using these
 * primitives are NOT covered. Bringing them onto the primitives is tracked
 * separately — this boundary cannot reach code that never calls it.
 */
export function ModalErrorBoundary({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  return (
    <RouteErrorBoundary variant="inline" resetKey={resetKey}>
      {children}
    </RouteErrorBoundary>
  );
}
