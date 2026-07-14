/**
 * Client-platform probe for platform-specific copy in the local-edition UI.
 *
 * Why this is legitimate here (and only here): the Personal / Trial SPA is
 * served from a local server running ON the user's own machine, so the
 * browser's platform IS the platform the CLI bridge mutates ($PROFILE vs
 * ~/.zshrc). Production (cloud) pages must not use this to make behavioral
 * decisions — copy only.
 *
 * Parity audit 2026-07-07 P2-7: the hook-wiring modal showed Windows users a
 * zsh/.zshrc preview while the bridge actually wrote $PROFILE + hook.ps1 —
 * informed consent was wrong and the "run manually" fallback command failed
 * verbatim.
 */
export function isWindowsClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  // userAgentData is Chromium-only; fall back to the legacy strings.
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const p = uaData?.platform ?? navigator.platform ?? navigator.userAgent ?? '';
  return /win/i.test(p);
}
