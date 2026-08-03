/** ORDER-axis helpers for the PROVIDER cell of the key list.
 *
 *  Sibling of `provider-axis-label.ts` (which brand) and `protocol-axis.ts`
 *  (which wire protocol). This module answers a third question that neither of
 *  them can: of the providers behind one Client Route, WHICH ONE is being used
 *  right now, and which are the fallbacks behind it.
 *
 *  🔴 Why the cell needed this at all. `bindingProviderLabels` already returned
 *  the providers in try-order — the server emits bindings `ORDER BY
 *  protocol_type, priority ASC` — but the cell joined them with ", ", and a
 *  comma-separated list reads as a SET. "openai(codex), zhipu(GLM), deepseek"
 *  looks like three peers; it is actually a primary and two fallbacks, and the
 *  only surface that said so was the drawer, one key at a time.
 *
 *  🔴 Why the role is not simply "the first one". Two hops at the SAME priority
 *  is reachable: `AddBindingToVirtualKey` defaults an omitted priority to 1 and
 *  nothing rejects a second primary, so a lane can hold two rows the runtime
 *  cannot order (`ORDER BY priority ASC` ties; the database breaks it). Labelling
 *  position 0 "primary" there would answer a question that has no answer — and it
 *  would answer it CONFIDENTLY, which is the failure mode this project keeps
 *  paying for. Ties get their own state and say what they are.
 */

import { displayProtocolFamily } from '@/shared/api/user/protocolFamily';
import type { ProtocolProviderBinding } from '@/shared/api/user/protocolFamily';

/** What the chip beside a provider says.
 *
 *  `unknown` is a first-class outcome, 🚫 never folded into `primary`: a CLI or a
 *  control plane predating the order fields sends no priority at all, and a chip
 *  invented from that would name a primary nobody checked.
 */
export type ProviderRole = 'primary' | 'fallback' | 'tied' | 'unknown';

export interface ProviderCell {
  /** `code(alias)` — the same label the cell rendered before. */
  label: string;
  /** Brand code, lower-cased. */
  code: string;
  role: ProviderRole;
  /** 1-based position among the fallbacks, so a chain can say 备2 / 备3 rather
   *  than three identical 备 chips. 0 for anything that is not a fallback. */
  fallbackIndex: number;
}

/**
 * The providers behind one Client Route, in try-order, each with its role.
 *
 * Order comes from the server (priority ASC) and is preserved as given. 🚫 This
 * function does not re-sort: re-sorting would silently repair a payload that
 * arrived in the wrong order, and then the one bug this cell exists to make
 * visible — a chain whose order is not what the operator thinks — would be
 * invisible again.
 */
export function providerCells(
  bindings: ProtocolProviderBinding[] | null | undefined,
  clientRoute?: string | null,
): ProviderCell[] {
  const wanted = displayProtocolFamily(clientRoute);
  const lane = (bindings ?? []).filter((b) => {
    if (!(b.provider ?? '').trim()) return false;
    return !wanted || displayProtocolFamily(b.protocol) === wanted;
  });

  // A priority every other hop in this lane also claims cannot order anything.
  const seenPriority = new Map<number, number>();
  for (const b of lane) {
    if (typeof b.priority !== 'number') continue;
    seenPriority.set(b.priority, (seenPriority.get(b.priority) ?? 0) + 1);
  }

  const out: ProviderCell[] = [];
  const seenLabel = new Set<string>();
  let fallbackIndex = 0;
  for (const b of lane) {
    const code = (b.provider ?? '').trim().toLowerCase();
    const alias = (b.provider_display_alias ?? '').trim();
    const label = alias ? `${code}(${alias})` : code;
    // De-duplicated on the LABEL, matching bindingProviderLabels — one provider
    // may appear once per (lane, protocol), so a repeat is the same hop reached
    // through a second protocol row and not a second position in this chain.
    if (seenLabel.has(label)) continue;
    seenLabel.add(label);

    let role: ProviderRole = 'unknown';
    if (typeof b.priority === 'number' && (seenPriority.get(b.priority) ?? 0) > 1) {
      role = 'tied';
    } else if (b.fallback_role === 'primary') {
      role = 'primary';
    } else if (b.fallback_role === 'fallback') {
      role = 'fallback';
      fallbackIndex += 1;
    }
    out.push({ label, code, role, fallbackIndex: role === 'fallback' ? fallbackIndex : 0 });
  }
  return out;
}

/** Does this lane have an order the runtime can actually follow?
 *
 *  False when two hops share a priority — the row then shows the tie instead of
 *  pretending one of them is the primary. */
export function laneOrderIsDefined(cells: readonly ProviderCell[]): boolean {
  return !cells.some((c) => c.role === 'tied');
}
