/**
 * Fence for the built-in-engine load badge (2026-08-14, D8).
 *
 * WHAT DECISION THIS PROTECTS
 * ---------------------------
 * `BuiltInEngineDTO.loaded` has THREE meanings, because two backends serve this
 * page and they know different amounts:
 *
 *   true / false — the Personal lane's live detector answering for itself.
 *   ABSENT       — the team lane: master mirrors the detector's shipped assembly
 *                  but cannot see any node's runtime state (it distributes packs,
 *                  receives no engine health, and one org has N enforcing nodes).
 *
 * Two ways to get this wrong, both silent, both shipped-adjacent:
 *
 *   R1 — treating absent as ON. This is the bug D8 fixed: master hand-typed
 *        `true` for four engines, so an engine that failed to come up on the
 *        enforcing node still rendered a green 已启用 badge. Fail-open means a
 *        detector whose CRF model did not load keeps serving and only WARNs to
 *        its own stderr, so nothing else would have contradicted the badge.
 *   R2 — treating absent as OFF (`loaded ?? false`). The obvious "safe default",
 *        and the same lie pointing the other way: every team member would be
 *        told every engine is 未启用 while all of them run.
 *
 * Both are avoided by ONE rule: absence is its own state, `unknown`, rendered
 * with its own badge plus a pointer to the surface that does answer the question
 * (GET /admin/compliance/packs on the enforcing node). Same shape as D7's fix
 * for the CN_ADDRESS enforcement rung one field over.
 *
 * The project's vitest runs without jsdom (see shared/ui/route-error-boundary
 * .test.tsx), so the page cannot be rendered. Hence the split: the DECISION is a
 * pure function this file exercises directly, and the page is checked by source
 * scan for routing through it — the same technique as snippet-reveal.test.ts
 * next door.
 */
// @ts-nocheck — vitest-only file using Node built-ins (fs / path / __dirname).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { engineLoadBadge, engineLoadStateIsUnreadable } from './engine-load-state';

const webRoot = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(webRoot, p), 'utf8');
const page = read('src/pages/user/compliance/index.tsx');
/**
 * Comment-stripped view. 🔴 NOT cosmetic: this file's fences forbid TOKENS
 * (`e.loaded ?`) that the page's own explanatory comments necessarily contain.
 * Without stripping, a fence could not go red — the same trap the cross-repo
 * engine mirror hit (aikey-test/harness/engine_mirror_test.go).
 */
const codeOnly = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (`://` guarded)
const pageCode = codeOnly(page);

describe('engineLoadBadge — the single exit for "did this engine come up?"', () => {
  it('R1: a reported true is ON and green', () => {
    expect(engineLoadBadge(true)).toEqual({
      state: 'on',
      variant: 'green',
      labelKey: 'effectivePacks.engineOn',
    });
  });

  it('R1: a reported false is OFF and gray', () => {
    expect(engineLoadBadge(false)).toEqual({
      state: 'off',
      variant: 'gray',
      labelKey: 'effectivePacks.engineOff',
    });
  });

  it('R1+R2: ABSENT is its own state — neither ON nor OFF', () => {
    const absent = engineLoadBadge(undefined);
    expect(absent.state).toBe('unknown');
    // Explicit inequality on both sides, because the two failure modes are
    // symmetrical and each has been argued for as the "sensible default".
    expect(absent.labelKey).not.toBe('effectivePacks.engineOn');
    expect(absent.labelKey).not.toBe('effectivePacks.engineOff');
    expect(absent.variant).not.toBe('green');
    expect(absent.variant).not.toBe('gray');
    expect(absent).toEqual({
      state: 'unknown',
      variant: 'dim',
      labelKey: 'effectivePacks.engineUnknown',
    });
  });

  it('R2: a JSON null (a backend that emits the key empty) is also unknown, not off', () => {
    expect(engineLoadBadge(null).state).toBe('unknown');
  });

  it('flags the report as unreadable when any engine omits the field', () => {
    expect(engineLoadStateIsUnreadable([{ loaded: true }, { loaded: false }])).toBe(false);
    expect(engineLoadStateIsUnreadable([{ loaded: true }, {}])).toBe(true);
    expect(engineLoadStateIsUnreadable([])).toBe(false);
  });
});

describe('the packs drawer must route through the single exit', () => {
  // Split into one assertion per violation so the failure NAMES what was done,
  // instead of every route back to a two-way branch reporting "missing call".
  it('renders the badge via engineLoadBadge', () => {
    expect(pageCode).toContain('engineLoadBadge(e.loaded)');
  });

  it('never branches on e.loaded inline (R1: absent would read as ON)', () => {
    expect(pageCode).not.toMatch(/e\.loaded\s*\?/);
    expect(pageCode).not.toMatch(/Boolean\(\s*e\.loaded\s*\)/);
    expect(pageCode).not.toMatch(/!!\s*e\.loaded/);
  });

  it('never defaults e.loaded (R2: absent would read as OFF)', () => {
    expect(pageCode).not.toMatch(/loaded\s*\?\?/);
    expect(pageCode).not.toMatch(/loaded\s*\|\|/);
  });

  it('explains the unknown state instead of leaving five bare UNKNOWN badges', () => {
    expect(pageCode).toContain('engineLoadStateIsUnreadable');
    expect(pageCode).toContain('effectivePacks.engineLoadUnknownNote');
  });
});

describe('i18n catalogs carry the new keys in both languages and BOTH web apps', () => {
  // The reused page is served by two apps and each ships its own catalog
  // (they are deliberately divergent supersets, so they are NOT covered by
  // `make web-drift-check`'s whitelist). A key added to one only renders as a
  // raw `effectivePacks.engineUnknown` string on the other console.
  const catalogs: Array<[string, string]> = [
    ['user/en', 'src/shared/i18n/locales/en/common.json'],
    ['user/zh', 'src/shared/i18n/locales/zh/common.json'],
    ['master/en', '../../aikey-control-master/web/src/shared/i18n/locales/en/common.json'],
    ['master/zh', '../../aikey-control-master/web/src/shared/i18n/locales/zh/common.json'],
  ];

  it.each(catalogs)('%s has engineUnknown + engineLoadUnknownNote', (_label, path) => {
    const effectivePacks = JSON.parse(read(path)).effectivePacks;
    expect(effectivePacks.engineUnknown).toBeTruthy();
    // The note is the half that makes UNKNOWN actionable; it must name the
    // readable surface, exactly like the address row's note does for the rung.
    expect(effectivePacks.engineLoadUnknownNote).toContain('/admin/compliance/packs');
  });
});
