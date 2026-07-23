/** PROTOCOL-axis helpers, shared by the key pages.
 *
 *  Sibling of `provider-axis-label.ts` (the PROVIDER axis). Kept apart on
 *  purpose: the recurring bug in this area is one axis rendering the other's
 *  value, and a shared module per axis makes that mixing visible in imports.
 */

/** A protocol code as the PROTOCOL axis should render it: trimmed, lower-cased,
 *  and otherwise untouched.
 *
 *  🚫 Deliberately NOT `displayProtocolFamily`. That helper maps
 *  `openai_compatible` → the `openai` Client Route. Applying it to metadata
 *  printed a selection slot under a field headed PROTOCOL and disagreed with
 *  `aikey list`, which correctly says `openai_compatible` for the same key.
 */
export function normalizeProtocol(protocol: string | null | undefined): string {
  return (protocol ?? '').trim().toLowerCase();
}

/** Every protocol a key speaks, de-duplicated, in binding order.
 *
 *  Binding order (the server emits bindings in priority order) is what makes
 *  the collapsed `x (+N more)` label name the same protocol `aikey list` names:
 *  both read the same list from the same end. Sorting here — alphabetically or
 *  otherwise — is what let the two surfaces disagree.
 *
 *  `legacyProtocolType` is the VK-level scalar that servers predating the
 *  `bindings` read model project as a primary hint; it holds only the FIRST
 *  binding's value, so it is a fallback and never the primary source.
 */
export function protocolsOf(
  bindings: ReadonlyArray<{ protocol?: string | null }> | null | undefined,
  legacyProtocolType?: string | null,
  fallback?: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of Array.isArray(bindings) ? bindings : []) {
    const p = normalizeProtocol(b?.protocol);
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  if (out.length > 0) return out;
  const legacy = normalizeProtocol(legacyProtocolType);
  if (legacy) return [legacy];
  const fb = normalizeProtocol(fallback);
  return fb ? [fb] : [];
}
