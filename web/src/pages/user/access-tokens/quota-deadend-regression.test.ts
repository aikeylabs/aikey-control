// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGE = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/user/access-tokens/index.tsx'), 'utf-8');
const EN = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/en/common.json'), 'utf-8'));
const ZH = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/shared/i18n/locales/zh/common.json'), 'utf-8'));
const LIMIT_MSG = fs.readFileSync(
  path.resolve(process.cwd(), '../../aikey-control-master/service/internal/accesstoken/service.go'), 'utf-8');
const ZH_ERRORS = fs.readFileSync(
  path.resolve(process.cwd(), '../service/pkg/shared/errors.go'), 'utf-8');

// User report 2026-08-10: at 5/5 tokens, disabling existing ones freed nothing
// and there was no other action available — the member could not create a token
// at all without an admin.
//
// TWO designs combined into a dead end:
//   1. suspended still counts toward agent_limit_per_member. That is deliberate
//      (OA5b) and sound: if disabling freed the slot, a member could disable
//      five, create five, then be unable to RESUME any of the old ones.
//   2. the member console had no revoke entry. The 2026-07-31 fix removed the
//      only caller of deleteAgent (the mis-wired 停用 button) without adding a
//      proper one — so nothing on the member plane could free a slot.
//
// …and the error text said "Remove an agent first", pointing at an action the
// UI did not offer. Fix: revoke lives in the detail DRAWER (terminal ⇒ not a row
// button, user decision), and the message names what actually frees a slot.
describe('token-limit dead end (2026-08-10)', () => {
  it('gives the member a revoke action, in the drawer and behind a confirmation', () => {
    expect(PAGE).toContain('RevokeConfirmModal');
    expect(PAGE).toContain("t('accessTokens.revoke.button')");
    // In the drawer, not the row: the row already carries 停用/启用, and a
    // terminal action one mis-click away from a reversible one is the shape of
    // the ORIGINAL 2026-07-31 bug.
    const drawer = PAGE.slice(PAGE.indexOf('function AgentRoutingDrawer'), PAGE.indexOf('function CopyField'));
    expect(drawer, 'the revoke section must live inside AgentRoutingDrawer').toContain("t('accessTokens.revoke.sectionTitle')");
    const rowActions = PAGE.slice(PAGE.indexOf('function AgentRowActions'));
    expect(rowActions, 'revoke must NOT be a row button').not.toContain("t('accessTokens.revoke.button')");
  });

  it('tells the member that disabling does not free a slot', () => {
    // The whole reason the user got stuck. If this sentence disappears, the
    // dead end silently returns — the button alone does not explain itself.
    expect(ZH.accessTokens.revoke.explain).toMatch(/停用/);
    expect(ZH.accessTokens.revoke.explain).toMatch(/不会.*释放|不释放/);
    expect(EN.accessTokens.revoke.explain).toMatch(/does NOT free a slot/);
  });

  it('states all three consequences before revoking', () => {
    // Terminal + value unrecoverable + third-party agent must be re-pointed.
    for (const [lang, body] of [['zh', ZH.accessTokens.revoke.confirmBody], ['en', EN.accessTokens.revoke.confirmBody]] as const) {
      expect(body, `${lang}: must say it is irreversible`).toMatch(/不可撤销|cannot be undone/);
      expect(body, `${lang}: must say the value is unrecoverable`).toMatch(/无法找回|cannot be recovered/);
      expect(body, `${lang}: must say the third-party agent needs a new token`).toMatch(/第三方 Agent|third-party agent/);
    }
  });

  it('no longer tells the member to do something the UI does not offer', () => {
    // The retired text. "Remove an agent first" is what sent the user to 停用.
    // Strip comments first: the fix's own comment quotes the old wording to
    // explain what went wrong, and a naive substring check flags that prose as
    // if it were live code (the same trap the seat_type fence hit earlier today).
    const code = LIMIT_MSG.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('Remove an agent first');
    expect(LIMIT_MSG).toContain('Disabling a token does NOT free a slot');
    // zh users must not get an English wall of text (code-and-ui-language).
    expect(ZH_ERRORS).toContain('CodeBizAgentLimitReached:');
    expect(ZH_ERRORS).toMatch(/已达访问令牌上限/);
  });
});
