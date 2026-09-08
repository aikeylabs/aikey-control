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
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

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
      //
      // 🔴 A keyed Fragment, NOT a <div>. The key is the only thing this
      // wrapper was ever for, and a Fragment carries one just as well — but a
      // div is a real DOM node, and inserting one between the shell's scroll
      // container and the page BREAKS every `h-full` page underneath: the new
      // parent has height:auto, and a percentage height against an auto-height
      // parent falls back to content height. /user/import is built as a
      // full-height two-pane workspace and had been collapsing to its content
      // height (594px inside an 836px viewport) since this boundary landed on
      // 2026-08-08 — its own comment (written 2026-07-26) still says "UserShell
      // mounts <Outlet /> inside `flex-1 overflow-y-auto`", which stopped being
      // true the moment a node appeared in between.
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
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

  const ghostButton = 'text-[11px] font-mono px-3 py-1.5 rounded border transition-colors';

  const details = (
    <>
      <button
        onClick={onToggleDetail}
        data-testid="route-error-detail-toggle"
        aria-expanded={showDetail}
        className={`w-full flex items-center justify-between gap-3 rounded border px-3 py-2 text-[11px] font-mono ${inline ? '' : 'max-w-3xl'}`}
        style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}
      >
        <span>异常堆栈详情 · Technical details</span>
        <span aria-hidden="true">{showDetail ? '−' : '+'}</span>
      </button>
      {showDetail && (
        <div className={`space-y-2 ${inline ? '' : 'max-w-3xl'}`}>
          <pre
            className="text-[10px] font-mono p-3 rounded overflow-auto max-h-64 whitespace-pre-wrap break-all"
            style={{ backgroundColor: 'rgba(var(--sink-rgb), 0.25)', color: 'var(--muted-foreground)' }}
            data-testid="route-error-detail"
          >
            {detail}
          </pre>
        </div>
      )}
    </>
  );

  return (
    // 🔴 The page variant is a FULL-WIDTH band, not a centred card (2026-08-11,
    // user request + SuperDesign project "AiKey Route Error Boundary"). A 512px
    // box floating in the middle of a 1500px content area reads as a modal
    // someone forgot to dismiss; the band reads as a state the page is in.
    //
    // The framing is deliberately calmer than what it replaced: no red outline
    // around the whole thing, just one small destructive-coloured icon. The
    // point is that ONE page failed inside a console that is otherwise fine —
    // surrounding the message in alarm colour argues the opposite. What stays
    // loud is the wording, which says plainly that something broke.
    <div className={inline ? '' : 'w-full'} data-testid="route-error-boundary">
      <div
        className={inline ? 'w-full rounded border p-4 space-y-3' : 'w-full px-8 py-7 space-y-5 border-b'}
        style={
          inline
            ? { backgroundColor: 'var(--card)', borderColor: 'var(--destructive, #ef4444)' }
            : { backgroundColor: 'var(--card)', borderColor: 'var(--border)' }
        }
        role="alert"
      >
        <div className="flex items-start gap-3">
          <span
            className="flex-shrink-0 mt-[1px]"
            style={{ color: 'var(--destructive, #ef4444)' }}
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5" />
              <path d="M12 16.2v.3" />
            </svg>
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-mono font-bold" style={{ color: 'var(--display-foreground, var(--foreground))' }}>
              {inline ? '此窗口出现异常 · This dialog hit an error' : '此页面出现异常 · This page hit an error'}
            </h2>
            <p className="text-[11px] font-mono leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
              {inline
                ? '页面本身不受影响，关闭本窗口即可继续操作。 · The page itself is fine — close this dialog to continue.'
                : '其他页面不受影响，可直接从左侧导航继续操作。 · Other pages are unaffected — use the navigation to continue.'}
            </p>
          </div>
        </div>

        <div className={`flex flex-wrap items-center gap-2 ${inline ? '' : 'pl-7'}`}>
          <button
            onClick={onRetry}
            data-testid="route-error-retry"
            className={ghostButton}
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
              className={ghostButton}
              style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
            >
              刷新页面 · Reload
            </button>
          )}
          <button
            onClick={() => { void navigator.clipboard?.writeText(detail); }}
            data-testid="route-error-copy"
            className={ghostButton}
            style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}
          >
            复制以便反馈 · Copy for a bug report
          </button>
        </div>

        {/* 🔴 Says what the recovery buttons DO, because "will this lose my
            work?" is the actual reason someone hesitates to press either one.
            Deliberately NOT the SuperDesign draft's "go to 供应商账户 or 仪表盘":
            those are master-console pages, and this component is a byte-identical
            mirror that also renders in the member console, which has neither. */}
        {!inline && (
          <p className="text-[11px] font-mono leading-relaxed pl-7" style={{ color: 'var(--muted-foreground)', opacity: 0.8 }}>
            重试只重新加载这一页，不影响其他页面上的内容；刷新页面会重新加载整个控制台。
            <br />
            Retry remounts only this page; Reload restarts the whole console.
          </p>
        )}

        {inline && details}
      </div>

      {!inline && <div className="px-8 py-5 space-y-2">{details}</div>}
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
