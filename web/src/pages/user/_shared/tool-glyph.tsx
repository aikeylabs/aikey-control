// ToolGlyph — muted single-stroke tool mark for the two OAuth-era coding tools,
// in the style each is commonly simplified to on the web:
//   claude = eight-ray starburst (the Claude spark motif drawn as plain lines)
//   codex  = hexagon outline (the common OpenAI-mark simplification)
//
// Byte-identical paths to the master console's oauth-groups TOOL_GLYPH
// (aikey-control-master pages/master/orgs/oauth-groups/index.tsx) so member and
// admin surfaces speak one icon language. Extracted here 2026-08-01 on its
// second user/web consumer (oauth-contribute account rows → vault group
// headers) — single source instead of a third drifting copy.
//
// Unknown slugs render NOTHING by design (no claude fallback): a wrong brand
// mark is misinformation. Callers pass the tool slug ('claude' | 'codex'),
// typically a provider display alias or a protocol-derived label.

export const TOOL_GLYPH: Record<string, string[]> = {
  claude: [
    'M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4',
    'm5.64 5.64 2.83 2.83', 'm15.53 15.53 2.83 2.83',
    'm18.36 5.64-2.83 2.83', 'm8.47 15.53-2.83 2.83',
  ],
  codex: ['M12 2 20.66 7v10L12 22 3.34 17V7Z'],
};

// KIND_GLYPH — the credential-kind icon family (key = API key material,
// users = team-managed key, fingerprint = OAuth-flavored). Same heroicons/
// lucide paths the vault + virtual-keys kind tiles draw inline (extracted here
// 2026-08-01 on the third consumer, my-agents' source column). Colorless — the
// caller's .kind-tile slot supplies the muted color.
export const KIND_GLYPH: Record<'key' | 'team' | 'oauth', string[]> = {
  key: [
    'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z',
  ],
  team: [
    'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
  ],
  oauth: [
    'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4 M14 13.12c0 2.38 0 6.38-1 8.88 M17.29 21.02c.12-.6.43-2.3.5-3.02 M2 12a10 10 0 0 1 18-6 M2 16h.01 M21.8 16c.2-2 .131-5.354 0-6 M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2 M8.65 22c.21-.66.45-1.32.57-2 M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2',
  ],
};

export function KindGlyph({
  kind,
  className = 'w-4 h-4',
}: {
  kind: 'key' | 'team' | 'oauth';
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      {KIND_GLYPH[kind].map((d) => (
        <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
      ))}
    </svg>
  );
}

export function ToolGlyph({
  slug,
  title,
  className = 'w-4 h-4',
  inheritColor = false,
}: {
  slug: string;
  title?: string;
  /** svg size classes; default matches the standalone muted mark. */
  className?: string;
  /** true → currentColor from the parent (e.g. inside a colored .gr-chip the
   * glyph goes white with the label); false → standalone muted mark. */
  inheritColor?: boolean;
}) {
  const paths = TOOL_GLYPH[slug];
  if (!paths) return null;
  return (
    <span className="inline-flex shrink-0" title={title ?? slug}>
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={1.8}
        style={inheritColor ? undefined : { color: 'var(--muted-foreground)' }}
        aria-hidden="true"
      >
        {paths.map((d) => (
          <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
        ))}
      </svg>
    </span>
  );
}
