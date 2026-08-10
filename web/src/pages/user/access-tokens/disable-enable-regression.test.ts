// @ts-nocheck — source-level integration fence; production bundle needs no
// Node ambient types for this test.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGE = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/user/access-tokens/index.tsx'), 'utf-8');
const ACCOUNTS_API = fs.readFileSync(path.resolve(process.cwd(), 'src/shared/api/user/accounts.ts'), 'utf-8');
const ZH = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/zh/common.json'), 'utf-8'));
const EN = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/en/common.json'), 'utf-8'));

// Regression fence for the 2026-07-31 user report: "这里停用之后，还需要能够再次启用".
//
// The row's 停用 button was wired to `deleteAgent`, i.e. DELETE /accounts/me/agents/{id},
// which revokes the seat TERMINALLY — the label said "pause", the effect was
// "destroy", and nothing in the product could bring the agent back.
//
// The fix splits the two actions the requirement spec always described
// separately (OA5 治理三层: 可见 + 停用 + 独立归因 + 吊销):
//   停用 → suspend (reversible; the VK survives)
//   吊销 → revoke  (terminal)
//
// 2026-08-10: the member plane DID gain a revoke entry — in the detail DRAWER,
// behind a confirmation (user report: at the token cap, 停用 freed nothing and
// there was no other action, so the member was stuck). This fence therefore
// pins WHERE deleteAgent may be called, not that it is never called: the
// original assertion was `not.toContain('userAccountsApi.deleteAgent')`, which
// states more than the regression it guards and would have blocked the fix.
describe('My Agents disable/enable is reversible', () => {
  it('routes 停用 through the reversible status endpoint, NOT the terminal delete', () => {
    expect(ACCOUNTS_API).toContain('/accounts/me/access-tokens/${seatId}/status');
    expect(ACCOUNTS_API).toContain("setAgentStatus: async (seatId: string, action: 'suspend' | 'resume')");
    // 🔴 The actual regression: the disable button calling deleteAgent. Pinned by
    // WHERE the single call lives — inside the drawer's revoke confirmation —
    // rather than by forbidding the call outright.
    const deleteCalls = PAGE.match(/userAccountsApi\.deleteAgent/g) ?? [];
    expect(deleteCalls, 'revoke must have exactly one call site').toHaveLength(1);
    const revokeFlow = PAGE.slice(PAGE.indexOf('<RevokeConfirmModal'));
    expect(revokeFlow, 'the only deleteAgent call must sit in the revoke confirm flow, not on a row button')
      .toContain('userAccountsApi.deleteAgent');
    expect(PAGE).toContain("userAccountsApi.setAgentStatus(agent.seat_id, action)");
  });

  it('offers 停用 only on an active agent and 启用 only on a suspended one', () => {
    expect(PAGE).toContain("setStatus('suspend')");
    expect(PAGE).toContain("setStatus('resume')");
    expect(PAGE).toContain("{agent.status === 'suspended' && (");
    expect(PAGE).toContain("t('accessTokens.enable')");
  });

  it('tells the member revoked is terminal instead of offering a button that fails', () => {
    expect(PAGE).toContain("{agent.status === 'revoked' && (");
    expect(PAGE).toContain("t('accessTokens.revokedTerminal')");
    // No un-revoke affordance: `revoked` is also what the orphan reconcile
    // writes (OA5/INV-B), so the member plane must not undo it.
    expect(PAGE).not.toContain("setStatus('unrevoke')");
  });

  it('renders the seat status in the same words as the header chips (统一名词字典)', () => {
    // Before the fix the cell printed the raw backend string; `suspended` was
    // unreachable so nobody saw it. Now that pausing is real, an untranslated
    // "suspended" would sit next to a chip already calling that state 停用.
    expect(PAGE).toContain('statusLabel(agent.status, t)');
    expect(PAGE).not.toMatch(/badge-neutral'}`}>\{agent\.status\}/);
  });

  it('defines every new key in BOTH catalogs (i18n dangling-key guard)', () => {
    for (const [lang, cat] of [['zh', ZH], ['en', EN]] as const) {
      expect(cat.accessTokens.enable, `${lang}.accessTokens.enable`).toBeTruthy();
      expect(cat.accessTokens.enableTitle, `${lang}.accessTokens.enableTitle`).toBeTruthy();
      expect(cat.accessTokens.revokedTerminal, `${lang}.accessTokens.revokedTerminal`).toBeTruthy();
      expect(cat.accessTokens.status.active, `${lang}.accessTokens.status.active`).toBeTruthy();
      expect(cat.accessTokens.status.suspended, `${lang}.accessTokens.status.suspended`).toBeTruthy();
      expect(cat.accessTokens.status.revoked, `${lang}.accessTokens.status.revoked`).toBeTruthy();
    }
    // 停用/启用 must read the same here as on the master Agents page and in the
    // header chips — one word per concept across the whole console.
    expect(ZH.accessTokens.disable).toBe('停用');
    expect(ZH.accessTokens.enable).toBe('启用');
  });
});
