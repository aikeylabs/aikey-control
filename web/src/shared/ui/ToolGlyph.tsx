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
 * Visual spec: muted, 16px, one mark per tool family —
 *   claude = the OFFICIAL Claude mark (Simple Icons, CC0-1.0), a filled
 *            silhouette. See the note on the entry itself for why it replaced
 *            the hand-drawn eight-ray starburst on 2026-08-11.
 *   codex  = hexagon outline (the common OpenAI-mark simplification), stroked
 *   kimi   = crescent moon (the Moonshot motif), stroked
 * Stroked vs filled is per-family, see FILLED_GLYPH. The tooltip carries the
 * tool name. An unknown family renders NOTHING (not a placeholder): a
 * wrong-but-present icon misinforms, an absent one just says "not a tool we
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
export const TOOL_GLYPH: Record<string, string[]> = {
  // Official Claude mark, single-colour simplification.
  // Source: Simple Icons `icons/claude.svg` (https://simpleicons.org),
  // licensed CC0-1.0. The Claude name and mark are trademarks of Anthropic;
  // CC0 covers the SVG data, not the trademark. See NOTICE.
  //
  // 🔴 Replaced an eight-ray starburst on 2026-08-11 (user report). That
  // drawing was eight EQUAL rays at EQUAL 45° spacing around an EMPTY centre —
  // which is not merely similar to a loading spinner, it is the standard way
  // one is drawn. It sat at the left edge of list rows, exactly where a loading
  // indicator would appear. The official mark has many rays of unequal length
  // with tapered ends and no rotational symmetry, so it cannot be read that way.
  claude: [
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  ],
  codex: ['M12 2 20.66 7v10L12 22 3.34 17V7Z'],
  // kimi = crescent moon (2026-08-01 user request): the Moonshot「月之暗面」
  // motif as a plain lucide-style stroke.
  kimi: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
};

/**
 * Families drawn as a FILLED silhouette instead of a stroke.
 *
 * Kept as a separate set rather than changing TOOL_GLYPH's value type: the
 * table is `Record<string, string[]>` in three files and reshaping it would
 * touch every one of them for a property that today applies to a single entry.
 *
 * 🔴 This is a real visual inconsistency, not a preference: `claude` is the
 * official mark (a filled silhouette) while `codex` and `kimi` are hand
 * simplifications drawn as outlines, so the three do not carry the same visual
 * weight side by side. Accepted on 2026-08-11 in exchange for brand accuracy on
 * the one mark a user actually recognises. Switching the other two to their
 * Simple Icons equivalents would even it out and is the open follow-up.
 */
export const FILLED_GLYPH: ReadonlySet<string> = new Set(['claude']);

/**
 * Props (2026-08-01 second pass, aligned with the vault chip usage):
 *  - slug: the tool family key (preferred name; `label` kept as an alias for
 *    the original call sites — the two are interchangeable).
 *  - className: icon size override (default w-4 h-4).
 *  - inheritColor: render in the parent's currentColor (e.g. white inside a
 *    colored brand chip) instead of the default muted stroke.
 */
export function ToolGlyph({ slug, label, className = 'w-4 h-4', inheritColor }: { slug?: string; label?: string; className?: string; inheritColor?: boolean }) {
  const key = slug ?? label ?? '';
  const paths = TOOL_GLYPH[key];
  if (!paths) return null;
  const filled = FILLED_GLYPH.has(key);
  return (
    <span className="inline-flex shrink-0" title={key}>
      <svg className={className} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} viewBox="0 0 24 24" strokeWidth={1.8} style={inheritColor ? undefined : { color: 'var(--muted-foreground)' }} aria-hidden="true">
        {paths.map((d) => <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />)}
      </svg>
    </span>
  );
}
