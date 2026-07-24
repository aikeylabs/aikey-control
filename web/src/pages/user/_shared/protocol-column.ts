/**
 * PROTOCOLS-column label for a key row.
 *
 * A multi-protocol team key renders one row PER protocol group, so spelling the
 * whole comma-joined list into every one of those rows both overflowed the 22%
 * column and just re-stated the group header. Instead the column leads with the
 * protocol of the group this row is rendered under and folds the remainder into
 * a "(+N more)" hint (2026-07-23 user request); the full list stays reachable
 * via the cell's title attribute and the detail drawer.
 *
 * Pure + exported so the collapsing rule is unit-testable without mounting the
 * 7k-line vault page.
 */
export interface ProtocolColumn {
  /** The single protocol to render as the cell's label. */
  primary: string;
  /** How many further protocols this key speaks; 0 → render no hint. */
  extraCount: number;
}

export function protocolColumn(
  protocols: string[],
  groupProvider: string | null | undefined,
  fallback: string,
): ProtocolColumn {
  const list = protocols.filter(Boolean);
  if (list.length === 0) return { primary: fallback, extraCount: 0 };
  // Lead with THIS row's group when the key serves it — otherwise the openai
  // row of an anthropic+openai key would announce itself as "anthropic".
  const primary =
    groupProvider && list.includes(groupProvider) ? groupProvider : list[0];
  return { primary, extraCount: Math.max(0, list.length - 1) };
}
