// @ts-nocheck — vitest-only file using Node built-ins (fs/path/process.cwd);
// same pragma rationale as UserShell.dual-edit.test.ts.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Composing-gateway link-base fence (2026-07-03).
 *
 * User-mandated invariant: the login/non-login MENU SCOPE must keep the
 * ORIGINAL implementation. The gateway may change where a click NAVIGATES,
 * but never what is VISIBLE:
 *
 *   1. Visibility / menu-sync / composed-detection keep reading the REAL
 *      team URL (`otherBaseUrl`) — NOT the navigation base. If someone
 *      "simplifies" UserShell to gate rendering on crossAppLinkBase, the
 *      logged-out sidebar could grow/lose entries. These greps pin it.
 *   2. Every cross-app NAVIGATION goes through crossAppLinkBase (relative
 *      under the gateway, real URL otherwise).
 *   3. Both other-base-url copies carry the gateway flag helpers, and the
 *      personal side persists the flag from /system/team-url's answer.
 *
 * See roadmap 技术实现/update/20260703-web统一origin-本地网关方案.md.
 */

const APP_SRC = path.resolve(process.cwd(), 'src');
const MASTER_SRC = path.resolve(process.cwd(), '../../aikey-control-master/web/src');

function read(rel: string, root = APP_SRC): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

describe('composing-gateway link base', () => {
  const shells = [
    { name: 'user/web', src: read('layouts/UserShell.tsx') },
    { name: 'master/web', src: read('layouts/UserShell.tsx', MASTER_SRC) },
  ];

  it('menu visibility still keys on the REAL team URL, not the link base', () => {
    for (const s of shells) {
      expect(s.src, `${s.name}: crossAppItems gating`).toMatch(
        /const crossAppItems = otherBaseUrl\b/,
      );
      expect(s.src, `${s.name}: composed detection must compare the REAL URL`).toMatch(
        /new URL\(otherBaseUrl\)\.origin === window\.location\.origin/,
      );
      expect(s.src, `${s.name}: visibility must not gate on crossAppLinkBase`).not.toMatch(
        /const crossAppItems = crossAppLinkBase/,
      );
    }
  });

  it('every cross-app navigation goes through crossAppLinkBase', () => {
    for (const s of shells) {
      const navs = s.src.match(/buildCrossAppUrl\(crossAppLinkBase/g) ?? [];
      expect(navs.length, `${s.name}: nav sites via link base`).toBeGreaterThanOrEqual(5);
      expect(s.src, `${s.name}: no nav may bypass the link base`).not.toMatch(
        /buildCrossAppUrl\(otherBaseUrl/,
      );
    }
  });

  it('gateway flag helpers exist on both sides; personal side persists it', () => {
    const a = read('shared/cross-app-menu/other-base-url.ts');
    const b = read('shared/cross-app-menu/other-base-url.ts', MASTER_SRC);
    for (const [name, src] of [['user/web', a], ['master/web', b]] as const) {
      expect(src, `${name}: gateway storage key`).toContain("'aikey-cross-app:team-gateway'");
      expect(src, `${name}: link-base helper`).toMatch(/export function getCrossAppLinkBase/);
    }
    expect(a, 'personal refresh must persist the authoritative gateway answer').toMatch(
      /setTeamGatewayActive\(data\.gateway === true\)/,
    );
    expect(a, 'logged-out must clear the gateway flag (R6 lifecycle)').toMatch(
      /setTeamGatewayActive\(false\)/,
    );
  });
});
