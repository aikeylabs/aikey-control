import React from 'react';
import { useLocation } from 'react-router-dom';
import { NavGlyph, type GlyphName } from '@/shared/ui/nav-glyphs';
import { pageGlyphFor } from '@/shared/ui/page-icons';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /**
   * An affordance that sits ON the title — in practice an <InfoHint>, for copy
   * that belongs to the page as a whole rather than to any one control on it.
   *
   * 🔴 Rendered here, next to the title, and NOT folded into `actions`: the
   * right-hand group is where the page's primary button lives, and a hint parked
   * beside it reads as a second action. It also has to stay outside any
   * `overflow-hidden` card, or the bubble is clipped the moment it opens.
   */
  titleHint?: React.ReactNode;
  /**
   * Overrides the glyph this page would resolve from its route.
   *
   * 🔴 Prefer NOT passing it. The default is looked up from the same registry
   * the sidebar renders from (see page-icons.tsx), which is the whole point:
   * "the page icon matches the menu icon" stops being a convention someone has
   * to honour. On 2026-08-10 /user/virtual-keys showed a crowd of people in the
   * sidebar and a key in its own title — one page, two glyphs — precisely
   * because each side picked its own component. Pass this only for a page with
   * no nav entry whose parent's glyph would be misleading.
   */
  icon?: GlyphName;
}

/**
 * The current page's glyph, resolved from its route — no props to thread.
 *
 * Exported for the handful of pages that render their own title row (they show
 * counts or a custom layout PageHeader does not model). They should still draw
 * the SAME mark as the sidebar, and asking each of them to name a glyph would
 * put the mapping back in N places — which is the drift this whole registry
 * removed. Renders nothing when the route has no mapping.
 */
export function PageTitleGlyph({ className = 'w-4 h-4' }: { className?: string }) {
  const { pathname } = useLocation();
  const glyph = pageGlyphFor(pathname);
  return glyph ? <NavGlyph name={glyph} className={className} /> : null;
}

/**
 * The tile + title block, for pages that keep their own header markup.
 *
 * Several pages type their own title row because they show counts, a range
 * picker, or a subtitle with different metrics than PageHeader renders.
 * Converting them wholesale would silently restyle copy nobody asked to change
 * (`text-[11.5px] opacity .55` is not `text-xs`), so they keep their markup and
 * wrap it in this instead — they gain the icon, and the tile itself is defined
 * once rather than pasted into each of them.
 */
export function PageTitleRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <PageTitleTile />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Just the tile, for headers whose own layout cannot take PageTitleRow's
 * wrapper — Trust Check's `.tc-header-title` is a flex container whose subtitle
 * relies on `flex-basis: 100%` to wrap, so the tile has to become a sibling
 * flex item rather than swallow the row. Defined once so the tile's look does
 * not get re-typed per page.
 */
export function PageTitleTile() {
  return (
    <div
      className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        color: 'var(--primary-text)',
      }}
    >
      <PageTitleGlyph />
    </div>
  );
}

export function PageHeader({ title, description, actions, titleHint, icon }: PageHeaderProps) {
  const { pathname } = useLocation();
  const glyph = icon ?? pageGlyphFor(pathname);

  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {glyph && (
          // 36px tile, the pattern established by the Team Keys page
          // (pages/user/virtual-keys). --card is the global token whose value
          // (#27272a) is what that page's scoped --surface-2 already resolved
          // to, so this is the same shade without depending on page CSS.
          <div
            className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              // NavGlyph strokes with currentColor, so the accent is set here.
              color: 'var(--primary-text)',
            }}
          >
            <NavGlyph name={glyph} className="w-4 h-4" />
          </div>
        )}
        <div className="min-w-0">
          <h1
            className="text-lg font-bold font-mono tracking-wide flex items-center gap-2"
            style={{ color: 'var(--display-foreground)' }}
          >
            {title}
            {titleHint}
          </h1>
          {description && (
            <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
