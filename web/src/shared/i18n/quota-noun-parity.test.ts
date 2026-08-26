// @ts-nocheck — vitest-only test file using Node built-ins.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 🔴 One field, one noun, in both consoles.
 *
 * `window_max_util_pct` is the anti-ban utilization ceiling master rolls per
 * account per window (5h ∈ [93,97], 7d ∈ [87,89] — see
 * aikey-control-master/service/internal/oauthgroup/window.go). It is NOT the
 * account's quota limit: the quota is 100%, and we voluntarily stop lower so
 * every account does not sit pinned to the wall in a pattern an upstream can
 * fingerprint.
 *
 * Until 2026-08-22 the two consoles called it two different things —
 * member: 「保护线」, master: 「额度上限 / quota limit」 — and BOTH rendered it as
 * a bare percentage next to the usage. The member row read `5h 已用 · 93%` for
 * an account whose usage had never been observed at all, and the user read it
 * the only way it can be read: "看起来像是用了93%".
 *
 * 「额度上限」was the more dangerous of the two names, because it is not merely
 * a different word — it asserts something false (that this account's quota IS
 * 93%), which is exactly the misreading. So the name was unified onto
 * 「保护线 / Protection line」 and this fence pins the two catalogs together.
 *
 * Why a fence and not just a convention: the two strings live in different
 * trees, different namespaces, and are edited by different pages. Nothing else
 * in the build compares them — they would drift silently, and the drift is
 * invisible until someone reads one console after the other.
 *
 * 能红: change either console's wording without the other.
 *
 * See workflow/CI/bugfix/20260822-quota-cap-reads-as-usage.md.
 */
const USER = resolve(process.cwd(), 'src/shared/i18n/locales');
const MASTER = resolve(process.cwd(), '../../aikey-control-master/web/src/shared/i18n/locales');
const load = (root: string, lng: string) => JSON.parse(readFileSync(`${root}/${lng}/common.json`, 'utf-8'));

describe('quota protection-line noun parity', () => {
  it('the master catalog exists (fence is not vacuous)', () => {
    expect(existsSync(`${MASTER}/zh/common.json`)).toBe(true);
  });

  for (const lng of ['en', 'zh']) {
    it(`${lng}: both consoles name the cap identically`, () => {
      const user = load(USER, lng).poolAccount.protectionLine;
      const master = load(MASTER, lng).oauthGroups.accounts.protectionLine;
      expect(user, `${lng}: user console lost the protection-line wording`).toBeTruthy();
      expect(master, `${lng}: master console lost the protection-line wording`).toBeTruthy();
      expect(master, `${lng}: the two consoles now call window_max_util_pct different things`).toBe(user);
    });

    it(`${lng}: the cap is never called a quota limit`, () => {
      // The old master wording. It asserts the account's quota IS the cap,
      // which is the false statement this whole fix removed.
      const aria = load(MASTER, lng).oauthGroups.accounts.usageMeterAria;
      expect(aria).not.toMatch(/额度上限|quota limit/i);
    });

    it(`${lng}: "not observed" reads the same everywhere it appears`, () => {
      const master = load(MASTER, lng).oauthGroups.accounts;
      const user = load(USER, lng).poolAccount;
      expect(master.usageUnknown).toBe(user.noObservationShort);
      // The master meter prints the usage and the window reset side by side. Two
      // different words for "we have no measurement" landing on ONE row
      // (未观测 · … · 暂无观测) reads as two different states, not one repeated.
      expect(master.resetUnknown).toBe(master.usageUnknown);
    });
  }
});
