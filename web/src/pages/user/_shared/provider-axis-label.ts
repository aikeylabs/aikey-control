/**
 * providerAxisLabel — THE provider-axis label, `brand(alias)` e.g. `zhipu(GLM)`.
 *
 * Extracted 2026-07-22 for the same reason as its neighbour providerBrandColor:
 * the label was being computed independently per surface and drifted. In alpha.9
 * on staging, the Team-keys table row rendered `zhipu(GLM)` while the detail
 * drawer — same screen, two inches away — rendered a bare `zhipu`. Cause: the
 * drawer read the binding's `provider_display_alias` and fell through to the raw
 * code when it was empty, which it ALWAYS is: the alias is cosmetic, the master
 * has no brand registry, and the mapping is web-owned. The row cell went through
 * the registry, the drawer did not.
 *
 * Lookup is by exact code first, then by family, so both `zhipu` and a concrete
 * `glm-*` code land on GLM.
 *
 * 🚫 Alias only. The protocol axis is NEVER derived from a provider (前端 §7) —
 * protocol comes from the binding's own protocol, which is the whole point of
 * the two-axis work (P1f / design D-12).
 */
import { familyOfProviderCode } from '@/shared/api/user/protocolFamily';
import { ENTRY_BY_CODE, ENTRY_BY_FAMILY } from '@/shared/generated/provider-registry';

export function providerAxisLabel(code: string | null | undefined): string {
  const raw = (code ?? '').toString().trim().toLowerCase();
  if (!raw) return '';
  const brand = familyOfProviderCode(raw);
  const alias = ENTRY_BY_CODE.get(raw)?.displayAlias
    ?? ENTRY_BY_FAMILY.get(brand)?.displayAlias;
  return alias ? `${brand}(${alias})` : brand;
}
