// egress-summary — compact, credential-free rendering of an egress proxy value for
// the read-only "当前生效 / 分层明细" rows on /user/settings.
//
// Why this exists (2026-07-17, bug: 复杂代理配置显示错乱):
//
//  1. Correctness. An egress value may be a multi-line mihomo YAML fragment. The rows
//     used to print it raw, which collapsed the newlines (default `white-space`) and
//     wrapped mid-token (`word-break: break-all`) — producing an unreadable run-on
//     blob ("por\nt: 443", "rc4\n-md5").
//  2. Safety. The raw value embeds credentials (socks5 user:pass, node passwords).
//     This panel is read-only STATUS — it has no reason to print secrets on screen and
//     into every screenshot. The full text stays editable in the input above.
//
// So the rows show a fingerprint instead. That answers what the panel is actually for
// — "is the value in effect the one I pasted?", "are ① and ② the same?", "did it
// change?" — without showing the value.

/** FNV-1a 32-bit. A DISPLAY fingerprint, not a security primitive: sync (no crypto
 *  dep / no async in render) and short enough to eyeball. Collisions are irrelevant
 *  here — it identifies, it doesn't authenticate. */
export function egressFingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Mask the userinfo of a proxy URL: `socks5://user:pass@h:1080` → `socks5://…@h:1080`.
 *  Leaves a credential-less URL untouched (`socks5://127.0.0.1:1080`). */
export function maskUrlCredentials(url: string): string {
  return url.replace(/:\/\/[^@/\s]+@/g, '://…@');
}

/**
 * One-line summary of an egress value.
 *  - ""            → "" (caller renders its own unset/direct label)
 *  - multi-line    → `<fragmentLabel> · <linesLabel(n)> · #<fp>`  (mihomo fragment)
 *  - single line   → `<masked url> · #<fp>`
 *
 * Labels are injected (not hardcoded) so this module stays i18n-agnostic and testable.
 */
export function egressSummary(
  raw: string | undefined,
  fragmentLabel: string,
  linesLabel: (n: number) => string,
): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const lines = v.split('\n').filter((l) => l.trim() !== '');
  const fp = `#${egressFingerprint(v)}`;
  if (lines.length > 1) return `${fragmentLabel} · ${linesLabel(lines.length)} · ${fp}`;
  return `${maskUrlCredentials(v)} · ${fp}`;
}
