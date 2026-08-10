/**
 * Source-level fence for the self-view snippet reveal ("eye"), 2026-08-09.
 *
 * WHAT DECISION THIS PROTECTS
 * ---------------------------
 * The user reversed the 2026-06-03 decision ("the Personal self-view shows the
 * masked form only") on 2026-08-09: the un-redacted matched text is back, but
 * ONLY behind an explicit per-finding eye toggle. That is two rules, and both
 * have failed silently before in this exact page:
 *
 *   R1 — default is MASKED. Before this change the page rendered
 *        `f.context_snippet || f.redacted_snippet`, i.e. raw text unconditionally,
 *        in BOTH the list and the drawer. A regression back to that shape shows
 *        raw values in a list row that has no control to hide them again.
 *   R2 — no dead control. `context_snippet` is legitimately absent for events
 *        recorded between 2026-06-03 and this change (the detector stopped
 *        populating it). Rendering an eye on those rows gives the user a button
 *        that does nothing; they get an explanatory note instead.
 *
 * The project's vitest runs without jsdom (see shared/ui/route-error-boundary
 * .test.tsx), so the page cannot be rendered. Scanning its source is the
 * available technique — same as the master console's
 * compliance/audit/original-turn-wiring.test.ts next door.
 */
// @ts-nocheck — vitest-only file using Node built-ins (fs / path / __dirname).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(webRoot, p), 'utf8');
const page = read('src/pages/user/compliance/index.tsx');
const accessTokens = read('src/pages/user/access-tokens/index.tsx');
const enCatalog = JSON.parse(read('src/shared/i18n/locales/en/common.json'));
const zhCatalog = JSON.parse(read('src/shared/i18n/locales/zh/common.json'));

describe('compliance self-view snippet reveal', () => {
  it('has an eye toggle wired to both i18n labels', () => {
    expect(page, 'the eye glyph itself').toContain('EyeIcon');
    expect(page).toContain('EyeOffIcon');
    expect(page).toContain('compliancePage.revealOriginal');
    expect(page).toContain('compliancePage.hideOriginal');
  });

  it('🔴 R1 — the LIST preview never reads context_snippet', () => {
    // The list has no per-row reveal control, so raw text there cannot be
    // un-shown. The one and only place raw text may appear is behind the eye.
    // Assert on the expression itself, not the block: the surrounding comment
    // names the forbidden field on purpose (it explains WHY it is absent).
    const snipExpr = page
      .split('\n')
      .filter((l) => l.trimStart().startsWith('const snip ='));
    expect(snipExpr, 'list preview expression not found — did the column move?').toHaveLength(1);
    expect(snipExpr[0]).not.toContain('context_snippet');
  });

  it('🔴 R1 — the drawer shows raw only when the toggle is on', () => {
    // `revealed && raw ? raw : masked` is the whole rule. Any shape that yields
    // raw text without consulting the toggle is the 2026-06-02 regression.
    expect(page).toContain('revealed && raw ? raw : masked');
    expect(page, 'the pre-2026-08-09 unconditional-raw shape must not come back')
      .not.toContain('f.context_snippet || f.redacted_snippet');
  });

  it('🔴 R2 — the eye renders only when there is raw text to reveal', () => {
    expect(page).toContain('compliancePage.originalUnavailable');
    // The button lives on the truthy branch of `raw ? … : …`.
    const buttonAt = page.indexOf('onClick={() => toggleReveal(');
    const branchAt = page.lastIndexOf('{raw ? (', buttonAt);
    expect(branchAt, 'the eye button must sit inside the `raw ?` guard').toBeGreaterThan(0);
  });

  it('reveal state is per-look, not sticky across events', () => {
    // openEvent() clears the set, so opening another event never starts
    // pre-revealed.
    expect(page).toContain('setRevealedFindings(new Set())');
    expect(page).toContain('onClick={() => openEvent(e)}');
  });

  it('reuses the console-wide lucide eye path data (no icon library)', () => {
    const EYE = 'M2.06 12.35a1 1 0 010-.7 10.75 10.75 0 0119.88 0 1 1 0 010 .7 10.75 10.75 0 01-19.88 0z';
    const EYE_OFF_LAST = 'M2 2l20 20';
    expect(accessTokens, 'precedent moved — update this fence with it').toContain(EYE);
    expect(page).toContain(EYE);
    expect(page).toContain(EYE_OFF_LAST);
  });

  it('both labels and the unavailable note exist in en AND zh', () => {
    for (const [name, cat] of [['en', enCatalog], ['zh', zhCatalog]] as const) {
      for (const key of ['revealOriginal', 'hideOriginal', 'originalUnavailable']) {
        expect(cat.compliancePage?.[key], `${name}.compliancePage.${key}`).toBeTruthy();
      }
    }
  });
});
