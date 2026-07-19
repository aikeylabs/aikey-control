// "AiKey" wordmark as STATIC vector outlines traced from Space Grotesk 700
// (fontTools, wght=700 instance; fontSize 18, x=0, baseline y=15, letter-
// spacing -0.025em; viewBox 0 0 47 19). WHITE = every glyph except the
// lowercase-i dot contour; DOT = the font's REAL i-dot contour.
//
// WHY outlines, not live SVG <text> (2026-07-18 root-cause fix for the user
// bug "刷新时 i 的黄点会错位, 1 秒后归位"): a logo is a fixed graphic, not
// runtime text. The old approach rendered "AiKey" in the async-loaded web
// font and painted a circle at a coordinate measured for THAT font's metrics
// — so during font load (FOUT) the fallback font's "i" sat elsewhere and the
// dot looked misaligned until the web font swapped in. As outlines the
// wordmark needs no font at render time: no async load, no FOUT, no
// misalignment ever, and it renders identically offline / under strict CSP.
// The yellow dot is the font's own i-dot contour recolored, so it is aligned
// to the letterforms BY CONSTRUCTION and can never drift. Trade-off: text is
// no longer selectable — acceptable for a logo; aria-label keeps a11y/copy
// semantics. To regenerate if the brand font/metrics change: instance Space
// Grotesk at wght=700 (fontTools varLib.instancer), draw "AiKey" glyph
// contours via a DecomposingRecordingPen (so composite "i" splits into
// stem + dot), transform each contour by (scale, 0, 0, -scale, penX,
// baselineY) with scale=18/unitsPerEm, x0=0, baselineY=15, +(-0.025*18) px
// per inter-glyph gap; emit the i-dot contour to the DOT path, the rest to
// the white path.
const WORDMARK_PATH =
  'M0.32 15.00 3.64 2.40H7.78L11.09 15.00H8.64L7.96 12.23H3.46L2.77 15.00ZM4.01 10.03H7.40L5.87 3.89H5.54ZM12.22 15.00V6.07H14.49V15.00ZM16.49 15.00V2.40H18.86V7.40H19.19L23.27 2.40H26.32L21.06 8.61L26.50 15.00H23.36L19.19 9.89H18.86V15.00ZM31.45 15.25Q30.11 15.25 29.10 14.69Q28.08 14.12 27.51 13.08Q26.95 12.05 26.95 10.64V10.43Q26.95 9.02 27.50 7.99Q28.06 6.95 29.07 6.39Q30.08 5.82 31.41 5.82Q32.72 5.82 33.70 6.41Q34.67 6.99 35.21 8.03Q35.75 9.06 35.75 10.43V11.20H29.25Q29.29 12.12 29.93 12.70Q30.58 13.27 31.52 13.27Q32.47 13.27 32.92 12.86Q33.37 12.44 33.61 11.94L35.46 12.91Q35.21 13.38 34.73 13.93Q34.25 14.48 33.46 14.87Q32.67 15.25 31.45 15.25ZM29.27 9.51H33.44Q33.37 8.74 32.82 8.27Q32.27 7.80 31.39 7.80Q30.47 7.80 29.93 8.27Q29.39 8.74 29.27 9.51ZM38.29 18.60V16.62H43.15Q43.65 16.62 43.65 16.08V13.83H43.33Q43.18 14.14 42.88 14.44Q42.57 14.75 42.05 14.95Q41.53 15.14 40.72 15.14Q39.67 15.14 38.89 14.67Q38.11 14.19 37.67 13.34Q37.24 12.50 37.24 11.40V6.07H39.51V11.22Q39.51 12.23 40.01 12.73Q40.50 13.24 41.42 13.24Q42.46 13.24 43.04 12.54Q43.61 11.85 43.61 10.61V6.07H45.88V16.58Q45.88 17.50 45.34 18.05Q44.80 18.60 43.90 18.60Z';
const WORDMARK_DOT_PATH =
  'M13.36 5.03Q12.74 5.03 12.32 4.63Q11.90 4.24 11.90 3.59Q11.90 2.94 12.32 2.54Q12.74 2.15 13.36 2.15Q13.99 2.15 14.40 2.54Q14.81 2.94 14.81 3.59Q14.81 4.24 14.40 4.63Q13.99 5.03 13.36 5.03Z';

// "AK" chip letterform as a STATIC vector outline (Space Grotesk 700, letter-
// spacing -0.02em; bbox normalized to viewBox 0 0 121.8 70). Exported so the
// logged-in shells can drop it into their own chip box (same reason as the
// wordmark — 2026-07-18 user request "AK 的 ICON 也换成 svg": no web-font
// dependency, so the "AK" glyphs never flash/reflow during font load).
export const BRAND_AK_PATH =
  'M0.00 70.00 18.40 0.00H41.40L59.80 70.00H46.20L42.40 54.60H17.40L13.60 70.00ZM20.50 42.40H39.30L30.80 8.30H29.00ZM66.20 70.00V0.00H79.40V27.80H81.20L103.90 0.00H120.80L91.60 34.50L121.80 70.00H104.40L81.20 41.60H79.40V70.00Z';
const BRAND_AK_VIEWBOX = '0 0 121.8 70';
const BRAND_AK_ASPECT = 70 / 121.8; // height / width, for proportional sizing

// "AI RUNTIME GOVERNANCE" tagline as a STATIC vector outline (Space Grotesk
// 600, letter-spacing 0.16em; bbox normalized to viewBox 0 0 151.08 7.28).
// WHY (2026-07-18 user report "字体加载完这行字会由长变短"): as live <span>
// text the tagline rendered in a fallback font first, then reflowed narrower
// when Space Grotesk swapped in. As a fixed vector its width never changes.
// Rendered at ~98px wide (matching the previous 6.5px text width) — a fixed
// size, NOT scaled by the lockup `scale`, to preserve the prior appearance.
const TAGLINE_PATH =
  'M0.00 7.14 1.92 0.14H4.02L5.93 7.14H4.70L4.28 5.54H1.66L1.24 7.14ZM1.95 4.44H3.99L3.05 0.89H2.88ZM8.43 7.14V0.14H9.63V7.14ZM16.77 7.14V0.14H19.76Q20.41 0.14 20.90 0.37Q21.40 0.60 21.67 1.02Q21.94 1.43 21.94 2.01V2.12Q21.94 2.77 21.63 3.16Q21.33 3.55 20.88 3.73V3.89Q21.27 3.91 21.50 4.16Q21.72 4.41 21.72 4.83V7.14H20.52V5.00Q20.52 4.75 20.39 4.60Q20.25 4.44 19.95 4.44H17.97V7.14ZM17.97 3.35H19.63Q20.15 3.35 20.45 3.08Q20.74 2.80 20.74 2.34V2.25Q20.74 1.78 20.45 1.51Q20.16 1.23 19.63 1.23H17.97ZM27.35 7.28Q26.50 7.28 25.90 6.97Q25.29 6.67 24.97 6.09Q24.64 5.51 24.64 4.71V0.14H25.85V4.74Q25.85 5.44 26.23 5.82Q26.62 6.20 27.35 6.20Q28.07 6.20 28.46 5.82Q28.85 5.44 28.85 4.74V0.14H30.05V4.71Q30.05 5.51 29.72 6.09Q29.40 6.67 28.79 6.97Q28.19 7.28 27.35 7.28ZM33.00 7.14V0.14H35.29L36.94 6.33H37.11V0.14H38.29V7.14H36.00L34.35 0.95H34.18V7.14ZM42.92 7.14V1.23H40.83V0.14H46.22V1.23H44.12V7.14ZM48.76 7.14V0.14H49.96V7.14ZM52.95 7.14V0.14H55.19L56.56 6.33H56.73L58.10 0.14H60.34V7.14H59.17V1.01H59.00L57.64 7.14H55.64L54.28 1.01H54.11V7.14ZM63.33 7.14V0.14H67.78V1.23H64.53V3.07H67.50V4.16H64.53V6.05H67.84V7.14ZM77.06 7.28Q76.33 7.28 75.74 6.96Q75.15 6.63 74.81 6.00Q74.47 5.38 74.47 4.47V2.81Q74.47 1.45 75.22 0.73Q75.98 0.00 77.27 0.00Q78.54 0.00 79.23 0.68Q79.93 1.37 79.93 2.53V2.57H78.74V2.49Q78.74 2.09 78.58 1.77Q78.42 1.45 78.09 1.26Q77.77 1.08 77.27 1.08Q76.52 1.08 76.09 1.53Q75.67 1.99 75.67 2.79V4.49Q75.67 5.28 76.09 5.75Q76.52 6.22 77.28 6.22Q78.04 6.22 78.39 5.81Q78.74 5.40 78.74 4.76V4.64H76.97V3.62H79.93V7.14H78.82V6.45H78.65Q78.57 6.63 78.40 6.83Q78.24 7.02 77.92 7.15Q77.60 7.28 77.06 7.28ZM85.52 7.28Q84.22 7.28 83.45 6.55Q82.68 5.83 82.68 4.47V2.81Q82.68 1.45 83.45 0.73Q84.22 0.00 85.52 0.00Q86.83 0.00 87.60 0.73Q88.37 1.45 88.37 2.81V4.47Q88.37 5.83 87.60 6.55Q86.83 7.28 85.52 7.28ZM85.52 6.20Q86.31 6.20 86.74 5.75Q87.17 5.29 87.17 4.51V2.77Q87.17 1.99 86.74 1.53Q86.31 1.08 85.52 1.08Q84.75 1.08 84.31 1.53Q83.88 1.99 83.88 2.77V4.51Q83.88 5.29 84.31 5.75Q84.75 6.20 85.52 6.20ZM92.55 7.14 90.69 0.14H91.93L93.52 6.37H93.65L95.24 0.14H96.48L94.62 7.14ZM98.97 7.14V0.14H103.42V1.23H100.17V3.07H103.14V4.16H100.17V6.05H103.48V7.14ZM106.13 7.14V0.14H109.12Q109.77 0.14 110.26 0.37Q110.76 0.60 111.03 1.02Q111.30 1.43 111.30 2.01V2.12Q111.30 2.77 110.99 3.16Q110.69 3.55 110.24 3.73V3.89Q110.63 3.91 110.86 4.16Q111.08 4.41 111.08 4.83V7.14H109.88V5.00Q109.88 4.75 109.75 4.60Q109.61 4.44 109.31 4.44H107.33V7.14ZM107.33 3.35H108.99Q109.51 3.35 109.81 3.08Q110.10 2.80 110.10 2.34V2.25Q110.10 1.78 109.81 1.51Q109.52 1.23 108.99 1.23H107.33ZM114.05 7.14V0.14H116.34L117.99 6.33H118.16V0.14H119.34V7.14H117.05L115.40 0.95H115.23V7.14ZM121.83 7.14 123.75 0.14H125.85L127.76 7.14H126.53L126.11 5.54H123.49L123.07 7.14ZM123.78 4.44H125.82L124.88 0.89H124.71ZM130.26 7.14V0.14H132.55L134.20 6.33H134.37V0.14H135.55V7.14H133.26L131.61 0.95H131.44V7.14ZM141.17 7.28Q139.88 7.28 139.12 6.55Q138.37 5.83 138.37 4.47V2.81Q138.37 1.45 139.12 0.73Q139.88 0.00 141.17 0.00Q142.44 0.00 143.14 0.70Q143.83 1.40 143.83 2.62V2.68H142.65V2.59Q142.65 1.93 142.28 1.50Q141.92 1.08 141.17 1.08Q140.42 1.08 139.99 1.53Q139.57 1.99 139.57 2.79V4.49Q139.57 5.28 139.99 5.74Q140.42 6.20 141.17 6.20Q141.92 6.20 142.28 5.78Q142.65 5.35 142.65 4.69V4.52H143.83V4.66Q143.83 5.88 143.14 6.58Q142.44 7.28 141.17 7.28ZM146.57 7.14V0.14H151.02V1.23H147.77V3.07H150.74V4.16H147.77V6.05H151.08V7.14Z';
const TAGLINE_VIEWBOX = '0 0 151.08 7.28';
const TAGLINE_WIDTH = 98.2; // px — matches the prior 6.5px text width
const TAGLINE_HEIGHT = +(TAGLINE_WIDTH * (7.28 / 151.08)).toFixed(2); // ≈ 4.73

/**
 * BrandWordmark — the sidebar "AiKey" brand column: static vector wordmark
 * with the i-dot in brand yellow + the "AI RUNTIME GOVERNANCE" tagline
 * underneath.
 *
 * 2026-07-18 rev 5 (user-provided brand reference image): layout/colors are
 * aligned to the reference lockup — pure-white wordmark, a yellow i-dot, and
 * the small grey caps tagline. The vertical reference lockup is adapted to
 * the horizontal sidebar as: 32px AK chip ↔ two-line column (wordmark +
 * tagline) of matching height.
 *
 * 2026-07-18 rev 6: `tagline` prop — the logged-in shells render
 * tagline={false} (the "AI RUNTIME GOVERNANCE" line is a marketing lockup,
 * dropped inside the product); login screens keep the full lockup. Also
 * exports BrandMark (the 32px "AK" chip) and BrandLockup (chip + wordmark
 * row) so the login pages reuse the exact sidebar brand treatment.
 *
 * 2026-07-18 rev 7 (root-cause FOUT fix): wordmark is now static vector
 * outlines (see WORDMARK_PATH) instead of font-rendered <text> — no web-font
 * dependency, so the yellow i-dot can never appear misaligned during font
 * load. The tagline stays as display-font text (a FOUT reflow there is
 * invisible — no overlaid dot to misalign).
 *
 * `scale` sizes the 47×19 viewBox via width/height only (viewBox and path
 * geometry untouched). 1.2 = login-screen lockup size; the shells pass 1.
 *
 * DUAL-EDIT MIRROR: this file exists in BOTH aikey-control/web and
 * aikey-control-master/web (UserShell dual-edit rule) — keep the two copies
 * byte-identical.
 */
export function BrandWordmark({
  className = '',
  tagline = true,
  scale = 1.2,
}: {
  className?: string;
  tagline?: boolean;
  scale?: number;
}) {
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <svg
        width={47 * scale}
        height={19 * scale}
        viewBox="0 0 47 19"
        role="img"
        aria-label="AiKey"
        style={{ display: 'block' }}
      >
        <path d={WORDMARK_PATH} fill="#ffffff" />
        <path d={WORDMARK_DOT_PATH} fill="var(--primary)" />
      </svg>
      {tagline && (
        <svg
          width={TAGLINE_WIDTH}
          height={TAGLINE_HEIGHT}
          viewBox={TAGLINE_VIEWBOX}
          role="img"
          aria-label="AI Runtime Governance"
          style={{ display: 'block' }}
        >
          <path d={TAGLINE_PATH} fill="var(--muted-foreground)" />
        </svg>
      )}
    </div>
  );
}

/**
 * BrandMark — the "AK" letterform chip (2026-07-18 brand-reference treatment:
 * solid #0c0c0e fill, yellow outline + yellow "AK", faint amber halo). The
 * "AK" is a STATIC vector (BRAND_AK_PATH), not text, so it needs no web font
 * (rev 7: "AK 的 ICON 也换成 svg" — no FOUT flash). The glyph is sized to
 * ~50% of the chip width, centered; radius keeps the favicon 25% rounding.
 *
 * `className` passes through so the shells can attach `.nav-brand-mark`
 * (collapsed-sidebar hook) and reuse this instead of an inline chip copy.
 */
export function BrandMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const glyphW = size * 0.5;
  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.25),
        background: '#0c0c0e',
        border: '1.5px solid var(--primary)',
        boxShadow: '0 0 10px rgba(250, 204, 21, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      }}
      aria-hidden="true"
    >
      <svg
        width={glyphW}
        height={glyphW * BRAND_AK_ASPECT}
        viewBox={BRAND_AK_VIEWBOX}
        style={{ display: 'block' }}
      >
        <path d={BRAND_AK_PATH} fill="var(--primary)" />
      </svg>
    </div>
  );
}

/**
 * BrandLockup — the full brand lockup as ONE combined SVG (chip + "AiKey"
 * wordmark + "AI RUNTIME GOVERNANCE" tagline), used by the login screens.
 *
 * 2026-07-18 rev 8 (user request "合并到一个 SVG 里面? 和 AiKey? 需要的"):
 * merged the previously-separate chip/wordmark/tagline elements into a single
 * SVG so the login logo is one cohesive vector asset — fixed proportions, one
 * thing to scale, no web font anywhere. The logged-in SIDEBAR keeps chip and
 * wordmark as SEPARATE elements (BrandMark + BrandWordmark) on purpose: the
 * collapsed sidebar hides the wordmark and keeps only the chip, which a single
 * merged SVG can't do cleanly.
 *
 * Layout (base units, scale=1), matching the prior flex row (items-center,
 * gap 7): 32×32 chip at x=0; column at x=39 = wordmark (56.4×22.8) + gap 2 +
 * tagline (98.2×4.73), the 29.53-tall column vertically centered in the chip's
 * 32 (top y=1.24). Total viewBox 137.2×32. `scale` multiplies the rendered
 * size; everything scales together (so unlike the old lockup the tagline now
 * scales with the logo too — intended). Colors are CSS vars so theme/light-
 * dark still apply inside the inline SVG. Regenerate the glyph paths with the
 * fontTools recipe in the wordmark comment above if the brand font changes.
 */
export function BrandLockup({
  tagline = true,
  scale = 1,
}: {
  tagline?: boolean;
  scale?: number;
}) {
  const vbW = 137.2;
  const vbH = 32;
  return (
    <svg
      width={vbW * scale}
      height={vbH * scale}
      viewBox={`0 0 ${vbW} ${vbH}`}
      role="img"
      aria-label="AiKey — AI Runtime Governance"
      style={{ display: 'block' }}
    >
      <defs>
        {/* Approximates the chip's CSS box-shadow amber halo (0 0 10px @10%). */}
        <filter id="brand-chip-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#facc15" floodOpacity="0.25" />
        </filter>
      </defs>
      {/* Chip box: solid fill + yellow outline + amber halo (favicon-aligned). */}
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="7.25"
        fill="#0c0c0e"
        stroke="var(--primary)"
        strokeWidth="1.5"
        filter="url(#brand-chip-glow)"
      />
      {/* "AK" glyph, ~50% chip width, centered. */}
      <svg x="8" y="11.4" width="16" height="9.2" viewBox={BRAND_AK_VIEWBOX}>
        <path d={BRAND_AK_PATH} fill="var(--primary)" />
      </svg>
      {/* "AiKey" wordmark (white) + yellow i-dot. */}
      <svg x="39" y="1.24" width="56.4" height="22.8" viewBox="0 0 47 19">
        <path d={WORDMARK_PATH} fill="#ffffff" />
        <path d={WORDMARK_DOT_PATH} fill="var(--primary)" />
      </svg>
      {/* Tagline. */}
      {tagline && (
        <svg x="39" y="26.04" width="98.2" height="4.73" viewBox={TAGLINE_VIEWBOX}>
          <path d={TAGLINE_PATH} fill="var(--muted-foreground)" />
        </svg>
      )}
    </svg>
  );
}
