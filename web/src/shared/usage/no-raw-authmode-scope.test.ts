// @ts-nocheck — vitest-only test using Node built-ins (fs/path/__dirname); the
// project ships no @types/node so tsc rejects these, but vitest runs it fine.
// Same convention as UserShell.dual-edit.test.ts.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// SYSTEMIC FENCE (2026-07-04) — the composing gateway masquerades forwarded
// TEAM pages as `authMode === 'local_bypass'` (its index.html patch), so any
// PAGE that branches DATA SCOPE / IDENTITY on `authMode === 'local_bypass'`
// silently queries local/org_id=personal against the team server → empty
// (team-usage-ledger and 4 sibling pages, incl. one a manual scan missed).
//
// Rule: page components must NOT read `authMode` for scope. They go through an
// explicit injected discriminator instead:
//   - usage identity (org_id=personal vs account_id) → isLocalUsageScope()
//   - which usage backend                            → runtimeConfig.usageApiBase
//   - which /accounts/me backend                     → runtimeConfig.vaultBridgeApiBase
// See workflow/CI/.../principles/gateway-local-bypass-masquerade.md.
//
// This fence would have caught all five original offenders. Adding a NEW raw
// `authMode` scope check in pages/ turns this red — use a helper, or if the
// use is a genuine AUTH-flow gate (not data scope), move it out of pages/ into
// the sanctioned auth layer (guards / http-client / main), which this fence
// does not scan.

const PAGES_DIR = join(__dirname, '..', '..', 'pages');
const FORBIDDEN = /runtimeConfig\.authMode\s*===\s*['"]local_bypass['"]/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no raw authMode scope checks in page components', () => {
  it('every pages/**/*.tsx uses the sanctioned discriminators, not raw authMode', () => {
    const offenders: string[] = [];
    for (const file of walk(PAGES_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${file.replace(PAGES_DIR, 'pages')}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Raw authMode scope checks found in page components. The gateway ` +
        `masquerades forwarded team pages as local_bypass — use isLocalUsageScope() ` +
        `(usage identity) / runtimeConfig.usageApiBase / vaultBridgeApiBase instead:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
