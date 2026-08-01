/**
 * ToolGlyph — the tool-family icon shown LEFT of a title in list rows.
 *
 * WHY IT EXISTS HERE (2026-08-01): the glyph started as a local helper on the
 * OAuth pools page. It is now used by three lists that must read as one system
 * — OAuth pools, the admin Agents list, and the member's My Agents list — and
 * the third lives in the OTHER repo (aikey-control/web), so a page-local helper
 * could not be shared. One definition, three call sites: adding a tool means
 * editing TOOL_GLYPH once, not hunting three inlined copies that silently drift.
 *
 * ⚠️ DUAL-EDIT FILE — an identical copy lives at
 * `aikey-control/web/src/shared/ui/ToolGlyph.tsx`. `shared/ui/` is inside the
 * must-sync whitelist (the trial composer aliases `@` to master/web, so a
 * single-sided edit silently fails to reach one of the bundles). Edit BOTH and
 * keep them byte-identical; `make -f workflow/CI/Makefile web-drift-check`
 * enforces it.
 *
 * Visual spec (unchanged from the original pools-page glyph): single-stroke,
 * muted, 16px, in the style each tool is commonly simplified to on the web —
 * claude = eight-ray starburst (the Claude spark motif drawn as plain lines),
 * codex = hexagon outline (the common OpenAI-mark simplification). The tooltip
 * carries the tool name. An unknown family renders NOTHING (not a placeholder):
 * a wrong-but-present icon misinforms, an absent one just says "not a tool we
 * draw yet".
 */

import { ENTRY_BY_FAMILY, protocolsForProvider } from '@/shared/generated/provider-registry';

/**
 * Resolves (wire protocol, provider code) → the tool family key TOOL_GLYPH is
 * indexed by. Classification is by WIRE PROTOCOL, not by account supplier, so a
 * Mock Provider pool draws the same glyph as the anthropic/openai traffic it
 * actually serves; provider stays an independent credential attribute.
 *
 * When the protocol is absent (an API-key-sourced agent carries no pool
 * protocol) it falls back to the provider's protocol ONLY when that provider
 * speaks exactly one — an ambiguous provider resolves to nothing rather than
 * guessing, and ToolGlyph then draws nothing.
 */
export function toolGlyphLabel(protocol: string | undefined, providerCode: string | undefined): string {
  let family = '';
  if (protocol === 'anthropic') family = 'anthropic';
  if (protocol === 'openai_compatible' || protocol === 'openai') family = 'openai';
  if (!family) {
    const supported = protocolsForProvider(providerCode ?? '');
    if (supported.length === 1) {
      return toolGlyphLabel(supported[0], '');
    }
  }
  const e = ENTRY_BY_FAMILY.get(family);
  return e?.displayAlias ?? e?.display ?? protocol ?? '';
}

/** Tool family → SVG path list. Keys are provider-registry `displayAlias`
 *  values, which is what toolGlyphLabel() above resolves to. */
const TOOL_GLYPH: Record<string, string[]> = {
  claude: [
    'M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4',
    'm5.64 5.64 2.83 2.83', 'm15.53 15.53 2.83 2.83',
    'm18.36 5.64-2.83 2.83', 'm8.47 15.53-2.83 2.83',
  ],
  codex: ['M12 2 20.66 7v10L12 22 3.34 17V7Z'],
};

export function ToolGlyph({ label }: { label: string }) {
  const paths = TOOL_GLYPH[label];
  if (!paths) return null;
  return (
    <span className="inline-flex shrink-0" title={label}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} style={{ color: 'var(--muted-foreground)' }} aria-hidden="true">
        {paths.map((d) => <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
      </svg>
    </span>
  );
}
