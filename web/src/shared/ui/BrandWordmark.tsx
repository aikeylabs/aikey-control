/**
 * BrandWordmark — the sidebar "AiKey" brand column: SVG wordmark with the
 * i-dot in brand yellow + the "AI RUNTIME GOVERNANCE" tagline underneath.
 *
 * 2026-07-18 rev 5 (user-provided brand reference image): layout/colors are
 * aligned to the reference lockup — pure-white wordmark, a slightly larger
 * FLOATING yellow i-dot (detached above the stem, like the reference), and
 * the small grey caps tagline. The vertical reference lockup is adapted to
 * the horizontal sidebar as: 32px AK chip ↔ two-line column (wordmark +
 * tagline) of matching height.
 *
 * WHY SVG-text: the wordmark keeps rendering in the display font
 * (--font-display) so no letterform assets are needed; the glyph run is the
 * REAL string "AiKey" so selection/copy yields "AiKey" (rev 2), and the
 * yellow dot is simply PAINTED OVER the font's own i-dot (rev 3, user
 * decision — no mask plumbing). The covering circle must stay large enough
 * to swallow the font dot + anti-alias fringe.
 *
 * Geometry is measured, not guessed (canvas metrics of Space Grotesk 700 at
 * 18px, letter-spacing -0.025em): "A" advance 11.41px → i center x ≈ 13.35;
 * font dot spans y 2.15–4.8 on a baseline of 15. The reference-style dot
 * (r 1.8 @ cy 3.4) fully covers that span while sitting a touch higher /
 * bolder, matching the image. Display scale ×1.2 via svg width/height only
 * (viewBox untouched) — re-measure constants if the font or size changes.
 *
 * DUAL-EDIT MIRROR: this file exists in BOTH aikey-control/web and
 * aikey-control-master/web (UserShell dual-edit rule) — keep the two copies
 * byte-identical.
 */
export function BrandWordmark({ className = '' }: { className?: string }) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <svg
        width="56.4"
        height="22.8"
        viewBox="0 0 47 19"
        role="img"
        aria-label="AiKey"
        style={{ overflow: 'visible', display: 'block' }}
      >
        <text
          x="0"
          y="15"
          fontFamily="var(--font-display)"
          fontWeight="700"
          fontSize="18"
          letterSpacing="-0.025em"
          fill="#ffffff"
        >
          AiKey
        </text>
        <circle cx="13.35" cy="3.4" r="1.8" fill="var(--primary)" />
      </svg>
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 6.5,
          letterSpacing: '0.16em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          color: 'var(--muted-foreground)',
        }}
      >
        AI RUNTIME GOVERNANCE
      </span>
    </div>
  );
}
