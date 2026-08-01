/**
 * kind-glyphs — the shared single-stroke classifier icons (2026-08-01).
 *
 * One vocabulary across the master console (user decision, iterated 07-29 →
 * 08-01: colorless single-stroke, muted, 1.8 stroke width):
 *   fingerprint = OAuth domain (OAuth credential / account-pool key / pool source)
 *   plug        = direct-credential domain
 *   shieldCheck = official (catalog) provider credential
 *   ban         = unbound / cannot route
 *
 * Extracted on the third usage (provider-accounts kind icons, virtual-keys
 * source icons, bindings source icons) so the path data and the muted-stroke
 * rendering stay single-source. The fingerprint path is the same multi-arc
 * lucide compilation the AppShell compliance nav icon uses.
 */

export type KindGlyph = 'fingerprint' | 'plug' | 'shieldCheck' | 'ban';

export const KIND_GLYPH_PATHS: Record<KindGlyph, string[]> = {
  fingerprint: [
    'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4 M14 13.12c0 2.38 0 6.38-1 8.88 M17.29 21.02c.12-.6.43-2.3.5-3.02 M2 12a10 10 0 0 1 18-6 M2 16h.01 M21.8 16c.2-2 .131-5.354 0-6 M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2 M8.65 22c.21-.66.45-1.32.57-2 M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2',
  ],
  plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'],
  shieldCheck: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z',
    'm9 12 2 2 4-4',
  ],
  ban: ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'm4.9 4.9 14.2 14.2'],
};

export function StrokeGlyph({ glyph, title, className = 'w-4 h-4' }: { glyph: KindGlyph; title?: string; className?: string }) {
  return (
    <span className="inline-flex shrink-0" title={title}>
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--muted-foreground)' }} aria-hidden="true">
        {KIND_GLYPH_PATHS[glyph].map((d) => <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
      </svg>
    </span>
  );
}
