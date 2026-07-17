import { describe, it, expect } from 'vitest';
import { egressSummary, egressFingerprint, maskUrlCredentials } from './egress-summary';

// Fence for the /user/settings "当前生效 / 分层明细" rows (2026-07-17).
//
// The bug this guards: the rows printed the raw egress value. For a multi-line mihomo
// fragment that (a) rendered as an unreadable run-on blob, and (b) dumped socks5
// user:pass + node passwords onto the screen (and into every screenshot).
//
// 能红: revert either half — make egressSummary return the raw value, or drop the
// userinfo mask — and the "never leaks a credential" cases below go red.

const KIND = 'mihomo 片段';
const LINES = (n: number) => `${n} 行`;
const sum = (raw?: string) => egressSummary(raw, KIND, LINES);

// A fragment shaped like the real thing: residential socks5 exit reached via a relay.
const FRAGMENT = `proxies:
  - name: "住宅出口-经前置A"
    type: socks5
    server: RESIDENTIAL_HOST
    port: 443
    username: SECRET_USER
    password: SECRET_PASS
    dialer-proxy: "前置A"
    udp: true

  - name: "前置A"
    type: hysteria2
    server: RELAY_HOST
    port: 8093
    password: "RELAY_SECRET"
proxy-groups:
  - name: EGRESS
    type: fallback
    proxies: ["住宅出口-经前置A"]
    url: "http://www.gstatic.com/generate_204"`;

describe('egressSummary', () => {
  it('summarizes a multi-line fragment as kind · line count · fingerprint (never the body)', () => {
    const out = sum(FRAGMENT);
    // 19 = FRAGMENT's non-blank lines; the blank line inside it is NOT counted.
    expect(out).toBe(`${KIND} · 19 行 · #${egressFingerprint(FRAGMENT)}`);
    expect(FRAGMENT.split('\n').length).toBe(20); // 20 raw lines − 1 blank = 19
  });

  it('masks the userinfo of a single-line proxy URL', () => {
    const out = sum('socks5://HeUser:HePass@203.0.113.7:443');
    expect(out).toBe(`socks5://…@203.0.113.7:443 · #${egressFingerprint('socks5://HeUser:HePass@203.0.113.7:443')}`);
  });

  it('leaves a credential-less URL readable', () => {
    expect(sum('socks5://127.0.0.1:1080')).toContain('socks5://127.0.0.1:1080');
  });

  it('returns "" for empty/blank so the caller can render its own unset label', () => {
    expect(sum('')).toBe('');
    expect(sum('   \n  ')).toBe('');
    expect(sum(undefined)).toBe('');
  });

  // THE point of this module: a secret must never reach the read-only row.
  it('never leaks a credential from a fragment', () => {
    const out = sum(FRAGMENT);
    for (const secret of ['SECRET_USER', 'SECRET_PASS', 'RELAY_SECRET', 'RESIDENTIAL_HOST', 'RELAY_HOST']) {
      expect(out, `summary leaked ${secret}`).not.toContain(secret);
    }
  });

  it('never leaks a credential from a single-line URL', () => {
    const out = sum('socks5://HeYPZuUser:UfyqPass@203.0.113.7:443');
    expect(out).not.toContain('HeYPZuUser');
    expect(out).not.toContain('UfyqPass');
  });
});

describe('egressFingerprint', () => {
  it('is stable for the same value (so "is ① the same as ②" is answerable)', () => {
    expect(egressFingerprint(FRAGMENT)).toBe(egressFingerprint(FRAGMENT));
  });

  it('changes on any edit (so "did it change" is answerable)', () => {
    expect(egressFingerprint(FRAGMENT)).not.toBe(egressFingerprint(FRAGMENT.replace('443', '444')));
  });

  it('is always 8 hex chars', () => {
    for (const s of ['', 'a', FRAGMENT, 'socks5://127.0.0.1:1080']) {
      expect(egressFingerprint(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('maskUrlCredentials', () => {
  it('masks userinfo, keeps host:port', () => {
    expect(maskUrlCredentials('socks5://u:p@h.example:1080')).toBe('socks5://…@h.example:1080');
  });

  it('masks every hop of a chain', () => {
    expect(maskUrlCredentials('socks5://a:b@front:1080,socks5://c:d@exit:1080')).toBe(
      'socks5://…@front:1080,socks5://…@exit:1080',
    );
  });

  it('leaves a URL without userinfo untouched', () => {
    expect(maskUrlCredentials('socks5://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080');
  });
});
