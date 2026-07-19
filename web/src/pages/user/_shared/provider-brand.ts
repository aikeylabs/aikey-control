/**
 * providerBrandColor — canonical brand color for a provider family, matching
 * the 3.1 template's `--chart-*` palette (defined in keys-page-css under
 * `.vault-page`, so callers must render inside that wrapper).
 *
 * Extracted 2026-07-19 (rule of three): vault + virtual-keys carried
 * byte-identical private copies, and team-oauth became the third consumer
 * (provider chip beside the account email, user request "和保管库 provider
 * chip 颜色和样式保持一致") — one source so the brand palette can't drift.
 *
 * Unknown / unmapped providers fall through to a neutral gray rather than
 * inventing new colors (keeps the chip system disciplined the way
 * import-page chips are).
 */
export function providerBrandColor(provider: string | null | undefined): string {
  const p = (provider ?? '').toLowerCase();
  if (p.includes('anthropic') || p.includes('claude')) return 'var(--chart-anthropic)';
  if (p.includes('openai')) return 'var(--chart-openai)';
  if (p.includes('codex')) return 'var(--chart-codex)';
  if (p.includes('kimi') || p.includes('moonshot')) return 'var(--chart-kimi)';
  if (p.includes('gemini') || p.includes('google')) return 'var(--chart-gemini)';
  return 'var(--chart-neutral)';
}
