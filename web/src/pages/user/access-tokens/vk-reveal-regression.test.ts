// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGE = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/user/access-tokens/index.tsx'), 'utf-8');
const API = fs.readFileSync(path.resolve(process.cwd(), 'src/shared/api/user/accounts.ts'), 'utf-8');
const EN = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/en/common.json'), 'utf-8'));
const ZH = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/zh/common.json'), 'utf-8'));

// 2026-08-10, bugfix 2026-08-10-member-cannot-reveal-own-agent-vk.
//
// The defect: the master console could reveal a member's in-use agent VK while
// the member who OWNS it could not — their console only ever showed a mask. The
// only member-side way back to a usable value was 轮换, which instantly breaks
// the third-party agent they already configured.
//
// 能红:
//   - point getVK() back at getAgentVK → the "reveal first" assertion fails.
//   - drop the ensure fallback → the first-issue assertion fails (an agent whose
//     pool just got its first account could never mint a VK from this button).
//   - restore the "shown only once / cannot be retrieved later" copy → the
//     honest-copy assertions fail.
describe('My Agents — the owner can re-read their own agent VK', () => {
  it('exposes a non-destructive reveal action on the existing /vk endpoint', () => {
    // Reuses the endpoint rather than adding one (慎重新建 API): the body already
    // discriminates behavior, and the admin twin took the same shape.
    expect(API).toContain('revealAgentVK');
    expect(API).toContain("{ action: 'reveal' }");
  });

  it('reveals first and only falls back to ensure when there is nothing to reveal', () => {
    expect(PAGE).toContain('userAccountsApi.revealAgentVK(agent.seat_id)');
    // `vk_pending && !pool_empty` = the pool can mint but no VK exists yet, i.e.
    // a first issue. Reveal never mints (fenced server-side in
    // onlineagent/reveal_mine_test.go), so this fallback is what keeps the
    // first-issue affordance working.
    expect(PAGE).toContain('r.vk_pending && !r.pool_empty');
    expect(PAGE).toContain('userAccountsApi.getAgentVK(agent.seat_id)');
  });

  it('renders the masked-hint dead end instead of an empty modal', () => {
    // 2026-07-28 staging finding: 1 of 3 agent VKs had an empty hint. Without a
    // noHint branch the modal renders blank and the member has no next step.
    expect(PAGE).toContain("t('accessTokens.vk.noHint')");
    expect(PAGE).toContain("t('accessTokens.vk.revealedNote')");
  });

  for (const [name, dict] of [['en', EN], ['zh', ZH]] as const) {
    it(`${name} copy stops claiming the key is unrecoverable`, () => {
      const vk = dict.accessTokens.vk;
      const create = dict.accessTokens.create;
      expect(vk.revealedNote).toBeTruthy();
      expect(vk.noHint).toBeTruthy();
      // The retired "shown only once" warning must not come back: agent VKs are
      // minted with encrypted retention, so telling the member to panic-copy a
      // value they can reopen trains them to distrust the UI.
      expect(create.vkOnce).toBeUndefined();
      expect(create.vkLabel).not.toMatch(/once|仅显示一次/);
      expect(vk.hint).not.toMatch(/Shown once|仅显示一次/);
      // existingHint now describes the ONE case where the plaintext really is
      // gone (pre-retention keys), not every case.
      expect(vk.existingHint).toMatch(/retention|留存/);
    });
  }
});
