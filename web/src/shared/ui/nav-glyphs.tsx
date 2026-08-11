import React from 'react';

// nav-glyphs.tsx — the SINGLE source of every console navigation glyph.
//
// WHY THIS EXISTS (2026-08-10). Glyph path data used to live in three shell
// files, and each page that wanted an icon in its title imported whichever
// component it liked. "The page icon matches the menu icon" was therefore a
// convention, and conventions drift: /user/virtual-keys showed a crowd of
// people in the sidebar (<TeamKindIcon/>) and a key in its own title
// (<KeyRoundIcon/>) — one page, two glyphs. Same disease as the pipe protocol's
// five hand-copied codecs and the icon mirrored byte-wise into three shells:
// a contract held together by everyone remembering.
//
// Both shells AND PageHeader now resolve from this table, so an icon mismatch
// between a page and its menu entry is no longer possible to express.
//
// SHAPE: `d` is a string ARRAY — one entry per subpath, rendered as separate
// <path> elements. That is deliberate. Concatenating a multi-path lucide glyph
// into one `d` makes any later RELATIVE moveto chain off the previous subpath
// instead of the origin; that is exactly how the Compliance Audit balance lost
// its left pan to y=32 and rendered one-armed for weeks (fixed 2026-08-10,
// fenced by nav-icon-viewbox-regression.test.ts).
//
// viewBox / strokeWidth are per-glyph and default to the console norm. A tighter
// viewBox scales a small glyph up to match its neighbours, and strokeWidth is
// then compensated so the ON-SCREEN stroke stays 1.2px — enlarging an icon must
// not also fatten it (2026-08-10 sidebar size normalisation).
//
// 🔴 Dual-edit: shared/ui is on the web-drift-check mirror whitelist. This file
// must stay BYTE-IDENTICAL in aikey-control/web and aikey-control-master/web,
// which is why it carries master-only glyphs the personal console never renders.

export interface Glyph {
  /** One `d` per <path>. Never concatenate these into a single string. */
  d: string[];
  /**
   * Circles the glyph also needs (a magnifier lens, a needle hub). Modelled
   * explicitly because two console icons draw them, and an extraction that
   * only understood <path> silently dropped them — a glyph missing its lens
   * still renders, just wrong.
   */
  circles?: Array<{ cx: number; cy: number; r: number; filled?: boolean }>;
  /** Defaults to the 24-grid. A tighter box scales the glyph up. */
  viewBox?: string;
  /** Compensates a tightened viewBox so the rendered stroke stays constant. */
  strokeWidth?: number;
}

export const NAV_GLYPH = {
  'activity': { d: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h4.27'] },
  'apps': { d: ['M6 7 H18 a2 2 0 0 1 2 2 V20 a2 2 0 0 1 -2 2 H6 a2 2 0 0 1 -2 -2 V9 a2 2 0 0 1 2 -2 Z M8 3 H16 M12 3 V7 M2 14 H4 M20 14 H22 M9 13 V16 M15 13 V16'] },
  'bot': { d: ['M12 3 V5 M8 9 H16 a2 2 0 0 1 2 2 V17 a2 2 0 0 1 -2 2 H8 a2 2 0 0 1 -2 -2 V11 a2 2 0 0 1 2 -2 Z M9 13 H9.01 M15 13 H15.01 M10 16 H14'] },
  'channels': { d: ['M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5'] },
  'chevron-down': { d: ['M19.5 8.25l-7.5 7.5-7.5-7.5'], strokeWidth: 2.0 },
  'cloud': { d: ['M12 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M4.2 15.1A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.7 8.1 M12 13.5V14 M12 20v.5 M14.6 15.5l-.3.4 M14.6 18.5l-.3-.4 M9.4 18.5l.3-.4 M9.4 15.5l.3.4'] },
  'conversation': { d: ['M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z'] },
  'dashboard': { d: ['M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z'], viewBox: '2.10 2.10 19.80 19.80', strokeWidth: 1.49 },
  'dollar': { d: ['M12 2a10 10 0 100 20 10 10 0 000-20zM8 14.5c.5 1.5 2 2.5 4 2.5s4-1 4-2.5-1-2-3-2.5l-2-.5c-2-.5-3-1-3-2.5s2-2.5 4-2.5 3.5 1 4 2.5M12 6v12'] },
  'fingerprint': { d: ['M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4 M14 13.12c0 2.38 0 6.38-1 8.88 M17.29 21.02c.12-.6.43-2.3.5-3.02 M2 12a10 10 0 0 1 18-6 M2 16h.01 M21.8 16c.2-2 .131-5.354 0-6 M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2 M8.65 22c.21-.66.45-1.32.57-2 M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2'] },
  'gauge': { d: ['m12 14 4-4 M3.34 19a10 10 0 1 1 17.32 0'] },
  'history': { d: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2'] },
  'key': { d: ['M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z'] },
  'layers': { d: ['M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'] },
  'library': { d: ['M16 6l4 14 M12 6v14 M8 8v12 M4 4v16'], viewBox: '2.40 2.40 19.20 19.20', strokeWidth: 1.44 },
  'link': { d: ['M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244'] },
  'master-bot': { d: ['M12 3v2m-4 4h8a2 2 0 012 2v5a2 2 0 01-2 2H8a2 2 0 01-2-2v-5a2 2 0 012-2zm1 4h.01M15 13h.01M9 17h6'] },
  'master-gauge': { d: ['M5.64 18.36a9 9 0 1112.72 0', 'M12 12l4-4'], circles: [{ cx: 12, cy: 12, r: 1.2, filled: true }], viewBox: '1.20 -0.12 21.60 21.60', strokeWidth: 1.62 },
  'master-receipt': { d: ['M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185zM9.75 9h.008v.008H9.75V9zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 4.5h.008v.008h-.008V13.5zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z'] },
  'overview': { d: ['M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z'] },
  'puzzle': { d: ['M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z'] },
  'radar': { d: ['M19.07 4.93A10 10 0 0 0 6.99 3.34', 'M4 6h.01', 'M2.29 9.62A10 10 0 1 0 21.31 8.35', 'M16.24 7.76A6 6 0 1 0 19.4 12.91', 'M14 12a2 2 0 1 0-4 0', 'M11.55 21.95A10 10 0 0 0 21.55 12', 'M4.05 14a10 10 0 0 0 1.92 5.99'] },
  'receipt': { d: ['M3 3v18h18M7 16v-4M12 16V8M17 16v-6'] },
  'scale': { d: ['m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z M7 21h10 M12 3v18 M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'] },
  'server': { d: ['M5 4h14a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zm0 9h14a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 012-2zm1-5.5h.01M6 17.5h.01'], viewBox: '1.20 1.20 21.60 21.60', strokeWidth: 1.62 },
  'settings': { d: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'] },
  'share': { d: ['M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98'] },
  'shield': { d: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'] },
  'team-kind': { d: ['M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z'] },
  'team-usage': { d: ['M22 7 13.5 15.5 8.5 10.5 2 17 M16 7h6v6'] },
  'token-tally': { d: ['M12 2L21 7L21 17L12 22L3 17L3 7Z M12 2l2.6 5 -5.2 5 5.2 5 -2.6 5'] },
  'unlock': { d: ['M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z'], strokeWidth: 2.0 },
  'upload-cloud': { d: ['M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3'] },
  'usage-audit': { d: ['M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z', 'M11 16l1.75 1.75'], circles: [{ cx: 9, cy: 14, r: 2.25 }] },
  'user': { d: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'] },
  'user-plus': { d: ['M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z'] },
  'users': { d: ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'] },
} as const satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof NAV_GLYPH;

const DEFAULT_VIEWBOX = '0 0 24 24';
const DEFAULT_STROKE = 1.8;

/**
 * Renders a registry glyph. `className` follows the console convention
 * (`w-4 h-4` in the sidebar, same in the page-title tile) so a page title and
 * its menu entry are the same mark at the same size.
 */
export function NavGlyph({ name, className = 'w-4 h-4' }: { name: GlyphName; className?: string }) {
  const g: Glyph = NAV_GLYPH[name];
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox={g.viewBox ?? DEFAULT_VIEWBOX}
      strokeWidth={g.strokeWidth ?? DEFAULT_STROKE}
    >
      {g.d.map((d) => (
        <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
      ))}
      {g.circles?.map((c) => (
        <circle
          key={`${c.cx},${c.cy},${c.r}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          {...(c.filled ? { fill: 'currentColor', stroke: 'none' } : {})}
        />
      ))}
    </svg>
  );
}
