/**
 * [回归] The MEMBER console has no device routing token — no type to pick, no
 * row that can be one, no wire field with which to ask for one.
 *
 * spec: R-device-routing-token-dispatch-9.S3 成员端没有该类型
 *       (需求包 roadmap20260320/技术实现/阶段9-商业化版本/codex-pool-anti-linkage, task 5.1)
 *
 * ── Why this fence ──────────────────────────────────────────────────────────
 * A device routing token's credential IS a whole customer account pool, and its
 * public address carries that pool's id. 单一管理入口 (§5.1) means only an
 * administrator, in the master console, may mint one; the member self-service
 * page must not offer it, and `POST /accounts/me/access-tokens` with
 * `kind=device_routing_token` answers 403 (the server leg is task 4.1).
 *
 * ── 🔴 Why the forbidden value is READ from the master repo ─────────────────
 * Restating the literal `'device_routing_token'` here would fence a STRING this
 * file happens to know. The value is declared once, in the payload module that
 * owns the create wire shape, and this fence derives it from there — the same
 * technique console-ia-term-regression.test.ts uses to derive the Access Token
 * glyph from the registry rather than re-typing its path data. Rename the kind
 * and this fence follows it; delete the declaration and this fence says so.
 *
 * 能红 (proved 2026-09-21, before task 5.1 was implemented): the first case
 * failed because the master payload module declared no such kind yet. Let the
 * member page or its API client grow the field and the later cases fail.
 */
// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const R = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');

const PAGE = R('src/pages/user/access-tokens/index.tsx');
const ACCOUNTS_API = R('src/shared/api/user/accounts.ts');
const API_ERROR = R('src/shared/utils/api-error.ts');
// The master console's create-payload module is the single declaration of the
// kind (and of the fields it is exclusive with). Reading the sibling repo is how
// api-error.dual-edit.test.ts and the shells' mirror fences already work.
const MASTER_PAYLOAD = R('../../aikey-control-master/web/src/shared/api/master/create-agent-payload.ts');

describe('member console has no device routing token', () => {
  it('derives the forbidden kind from its single declaration', () => {
    const declared = /DEVICE_ROUTING_TOKEN_KIND = '([a-z_]+)'/.exec(MASTER_PAYLOAD);
    expect(declared, 'the master console declares no DEVICE_ROUTING_TOKEN_KIND — '
      + 'this fence has nothing to forbid, so it would pass vacuously').toBeTruthy();
    expect(declared[1]).toBe('device_routing_token');
  });

  it('offers only the agent type in the add dialog, and cannot express the kind on the wire', () => {
    const kind = /DEVICE_ROUTING_TOKEN_KIND = '([a-z_]+)'/.exec(MASTER_PAYLOAD)[1];
    expect(PAGE).not.toContain(kind);
    expect(ACCOUNTS_API).not.toContain(kind);
    // The member create body is (alias, provider_code, oauth_group_id) — no
    // `kind`. The absence IS the guarantee: there is no control to hide.
    const body = /createAgent: async \(body: \{([^}]*)\}\)/.exec(ACCOUNTS_API);
    expect(body, 'the member createAgent signature moved — re-anchor this fence').toBeTruthy();
    expect(body[1]).not.toMatch(/\bkind\b/);
    // …and the list it renders is the member's own agents, never a kind-filtered
    // admin list. 🔴 Matched as a QUERY PARAMETER (`[?&]kind=`), not as the text
    // `kind=`: this page renders <KindGlyph kind={…}/> for the credential shape,
    // which is a JSX prop and has nothing to do with the token kind.
    expect(PAGE).not.toMatch(/[?&]kind=/);
    expect(ACCOUNTS_API).not.toMatch(/[?&]kind=/);
  });

  it('still explains the two device-routing refusals, because the dictionary is dual-edited', () => {
    // A member never mints one, but api-error.ts is byte-identical across both
    // consoles (fence: aikey-control-master/web/.../api-error.dual-edit.test.ts).
    // A code added on one side only is how one console ends up rendering a bare
    // code with no next step (bugfix 2026-09-21-compliance-error-envelope-…).
    for (const code of ['DEVICE_ROUTING_TOKEN_POOL_TAKEN', 'BIZ_DEVICE_ROUTING_TOKEN_PAIR_MISMATCH']) {
      expect((API_ERROR.match(new RegExp(`${code}:`, 'g')) ?? []).length,
        `${code} must be in BOTH SUGGESTIONS and LABELS of the member copy too`).toBe(2);
    }
  });
});
