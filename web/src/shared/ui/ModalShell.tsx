/**
 * ModalShell / ModalPortal — the single source of truth for mounting dialogs.
 *
 * WHY THIS EXISTS (2026-07-08, root-caused on team-oauth + bindings):
 * dialogs rendered INLINE become direct children of whatever container the
 * page happens to use. Two ancestor traps then break `position:fixed`
 * overlays:
 *
 *   1. Tailwind `space-y-*` — its sibling rule (`> * + * { margin-top: N }`)
 *      applies margin to position:fixed boxes too, shoving the full-screen
 *      mask N px down and leaving an uncovered strip at the top of the
 *      viewport (observed: 20px gap under `space-y-5` page roots on
 *      bindings / seats / virtual-keys / team-oauth).
 *   2. Any transformed/filtered ancestor becomes the containing block for
 *      fixed descendants (the reason provider-accounts / oauth-groups
 *      dialogs already used createPortal).
 *
 * Portaling to document.body escapes BOTH traps by construction. Every new
 * dialog must go through one of the two primitives below — do not hand-roll
 * `<div className="fixed inset-0">` inline in a page.
 *
 * Two layers, pick by situation:
 *   - `ModalShell`  — the opinionated overlay + centered card + header/body/
 *     footer (promoted verbatim from oauth-groups' DialogShell). Use for NEW
 *     dialogs so they inherit the canonical look.
 *   - `ModalPortal` — a thin escape hatch that ONLY fixes the mounting
 *     (children render inside document.body verbatim). Use when migrating an
 *     existing bespoke dialog whose markup must not change, or when a page
 *     needs its scoped-CSS class re-established on the portaled subtree
 *     (`scopeClassName`, e.g. the user-web's `.vault-page`-scoped styles —
 *     the portal moves the DOM out of the page wrapper, so scoped selectors
 *     stop matching unless the scope class is re-applied here).
 */
import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Thin portal: mounts children on document.body, nothing else. */
export function ModalPortal({
  children,
  scopeClassName,
}: {
  children: ReactNode;
  /** Re-establish a scoped-CSS class (e.g. "vault-page") on the portaled
   *  subtree. The wrapper div carries no layout of its own — `display:
   *  contents` keeps the children's fixed positioning untouched. */
  scopeClassName?: string;
}) {
  return createPortal(
    scopeClassName ? <div className={scopeClassName} style={{ display: 'contents' }}>{children}</div> : <>{children}</>,
    document.body,
  );
}

/** Opinionated modal: overlay + centered card + header/body/footer.
 *  Markup promoted verbatim from oauth-groups' DialogShell (the visual
 *  anchor) — change it there-and-here as one. */
export function ModalShell({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 z-[60] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div className="px-6 py-4 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-mono font-bold" style={{ color: 'var(--foreground)' }}>
            {title}
          </h3>
          {/* Header close X (2026-07-08, user request): every other master
              dialog (bindings / packs / seats / provider-accounts) carries
              this same X — ModalShell consumers were the odd ones out.
              Overlay-click already closes, but that affordance is invisible. */}
          <button type="button" onClick={onClose} aria-label="Close" className="flex-shrink-0" style={{ color: 'var(--muted-foreground)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          {footer}
        </div>
      </div>
    </>,
    document.body,
  );
}
