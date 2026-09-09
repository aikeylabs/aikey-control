import { describe, expect, it } from 'vitest';

const source = await import('./index.tsx?raw').then((module) => module.default);

/**
 * Fence for the member pool page's token-expiry column (2026-09-02).
 *
 * Same defect class as the Master drawer's: `MyPoolAccount.expires_at` arrived on
 * every row and the table rendered only `last_login_at`, so a member could not
 * tell a 7-day token from a 1-hour one — exactly the evidence the 2026-08-31
 * "登录成功一会儿就失效" report needed.
 *
 * bugfix: workflow/CI/bugfix/2026-09-02-token到期时间到达前端却从不显示.md
 */
describe('Member pool page token-expiry surface', () => {
  it('renders the expiry cell from the wire field', () => {
    expect(source).toContain('<TokenExpiryBadge expiresAtUnixSeconds={account.expires_at} />');
  });

  it('gives it a header on BOTH tables (grouped and ungrouped)', () => {
    // The page renders two thead blocks. A column added to one of them only is
    // the classic half-landed change — the other table silently keeps the old
    // shape and its rows shift under mismatched headers.
    const headers = source.split("t('oauthContribute.colTokenExpiry')").length - 1;
    expect(headers).toBe(2);
  });

  it('keeps the expiry adjacent to last-login (time-column affinity)', () => {
    const lastLogin = source.indexOf('{fmtDate(account.last_login_at)}');
    const expiry = source.indexOf('<TokenExpiryBadge expiresAtUnixSeconds={account.expires_at} />');
    expect(lastLogin).toBeGreaterThan(-1);
    expect(expiry).toBeGreaterThan(lastLogin);
  });
});
