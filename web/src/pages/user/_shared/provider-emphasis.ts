import type { KeySummaryDTO } from '@/shared/api/user/delivery';
import { displayProtocolFamily } from '@/shared/api/user/protocolFamily';

/** What the drawer's PROVIDER field should emphasise for one provider.
 *
 *  'primary'  — bold: this provider is the protocol's primary target
 *  'fallback' — muted: it is a fallback for that protocol
 *  'unknown'  — neutral: we don't know yet (summary still loading, or the
 *               server predates the summary contract). Renders like every other
 *               entry — 🚫 never guess, a wrong bold is worse than no bold.
 *
 *  Why this exists (2026-07-22): the field used to bold whichever provider
 *  string equalled `groupFamily`. Since 1f.8 `groupFamily` carries the
 *  PROTOCOL, so that compared a provider against a protocol — it could only
 *  ever match when the provider's code is spelled like the protocol's name.
 *  `anthropic(claude)` went bold on an anthropic row by pure homonym, and
 *  `zhipu(GLM)` was greyed with no input able to change that. The two are
 *  peers; what actually ranks them is the summary's fallback_role.
 */
export type ProviderEmphasis = 'primary' | 'fallback' | 'unknown';

export function providerEmphasis(
  providerCode: string,
  rowProtocol: string | undefined,
  summary: KeySummaryDTO | null | undefined,
): ProviderEmphasis {
  if (!summary || !Array.isArray(summary.slots)) return 'unknown';
  const proto = (rowProtocol ?? '').toLowerCase();
  const slot = summary.slots.find(
    (s) => displayProtocolFamily(s.protocol_type).toLowerCase() === proto,
  );
  if (!slot) return 'unknown';
  const target = slot.targets?.find(
    (tg) => (tg.provider_code ?? '').toLowerCase() === providerCode.toLowerCase(),
  );
  if (!target) return 'unknown';
  return target.fallback_role === 'primary' ? 'primary' : 'fallback';
}
