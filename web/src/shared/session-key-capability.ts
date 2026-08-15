export type SessionKeyProviderKind = 'claude' | 'codex';

/**
 * Presentation capability for the desktop Session Key login surface. The proxy
 * remains authoritative and re-validates the Master login context before any
 * secret is exchanged. Known real providers may tolerate a missing protocol
 * from an older list projection; Mock Provider accounts require an explicit
 * protocol because the provider brand alone cannot choose a wire contract.
 */
export function sessionKeyProviderKind(providerCode: string, protocolType: string): SessionKeyProviderKind | null {
  const provider = providerCode.trim().toLowerCase();
  const protocol = protocolType.trim().toLowerCase();
  if (provider === 'anthropic' && (protocol === '' || protocol === 'anthropic')) return 'claude';
  if (provider === 'openai' && (protocol === '' || protocol === 'openai_compatible')) return 'codex';
  if (provider === 'mock' && protocol === 'anthropic') return 'claude';
  if (provider === 'mock' && protocol === 'openai_compatible') return 'codex';
  return null;
}

export function supportsSessionKeyLogin(providerCode: string, protocolType: string): boolean {
  return sessionKeyProviderKind(providerCode, protocolType) !== null;
}
