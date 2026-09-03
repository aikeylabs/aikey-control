import { describe, expect, it } from 'vitest';

const source = await import('./index.tsx?raw').then((module) => module.default);

/**
 * Fence for the "当前路由" label (2026-09-03).
 *
 * The routed row always HAD a visual treatment — a 3px --primary left stripe and
 * a 6% green wash — but no words. A member whose pool held several accounts
 * signed into the wrong one twice in a row, each time getting the proxy's
 * LOGIN_REQUIRED back, because nothing on the page said which row traffic
 * actually goes to. Styling alone is a decoration; only the label makes it
 * actionable, so the label is what gets fenced.
 *
 * bugfix: workflow/CI/bugfix/2026-09-03-登录提示不说是哪个账号.md
 */
describe('Member pool page routed-account label', () => {
  it('labels the routed row in words, not only with a stripe', () => {
    expect(source).toContain("t('oauthContribute.routedChip')");
    expect(source).toContain('{isRouted && (');
  });

  it('explains what "routed" means to someone who has to act on it', () => {
    // The hint carries the instruction ("this is the row to sign in on"); a bare
    // noun label would still leave the member guessing which row to use.
    expect(source).toContain("t('oauthContribute.routedChipHint')");
  });

  it('keeps the label with the identity, where the eye already is', () => {
    const identity = source.indexOf('{account.identity || account.credential_id}');
    const chip = source.indexOf("t('oauthContribute.routedChip')");
    expect(identity).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(identity);
    // Same cell as the egress chip — one chip cluster, not a new column.
    const egress = source.indexOf("t('oauthContribute.egressChip')");
    expect(chip).toBeLessThan(egress);
  });
});
