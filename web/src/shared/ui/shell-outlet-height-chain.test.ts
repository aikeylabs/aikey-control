// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import { Fragment } from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RouteErrorBoundary } from './RouteErrorBoundary';

// 2026-08-11: /user/import is a full-height two-pane workspace. It renders
// `<div className="import-page h-full …">`, and its own comment (2026-07-26)
// spells out the assumption that rests on:
//
//   "UserShell mounts <Outlet /> inside `<div className="flex-1
//    overflow-y-auto">` — that's a block container [with a definite height],
//    so h-full + min-h-0 lets the body flex to fill it."
//
// On 2026-08-08 RouteErrorBoundary landed between the two and returned
// `<div key={attempt}>{children}</div>` on the happy path. That div's height is
// auto, and A PERCENTAGE HEIGHT AGAINST AN AUTO-HEIGHT PARENT FALLS BACK TO
// CONTENT HEIGHT — so the page collapsed to 594px inside an 836px viewport.
// Nothing failed: no error, no warning, every test green. The user saw it.
//
// The div existed only to carry the remount key, so the fix was a keyed
// Fragment — same behaviour, zero DOM nodes.
//
// RULE: whatever sits between the shell's scroll container and <Outlet/> must
// add no DOM node. A wrapper there silently rewrites the layout contract of
// every `h-full` page underneath, and the only symptom is visual.
//
// This suite has no DOM (the project's vitest runs without jsdom, see
// route-error-boundary.test.tsx), so it inspects the returned element instead:
// a HOST element has a string `type` ('div'), a Fragment does not.
describe('the shell → page height chain stays unbroken', () => {
  it('RouteErrorBoundary adds no DOM node on the happy path', () => {
    const boundary = new RouteErrorBoundary({ children: null });
    boundary.state = { error: null, attempt: 0, showDetail: false };
    const el = boundary.render();

    // 能红: return `<div key={…}>` instead of `<Fragment key={…}>`.
    expect(
      typeof el.type,
      `RouteErrorBoundary renders a <${String(el.type)}> around the page. Any DOM `
        + 'node here has height:auto, so every `h-full` page below it collapses to '
        + 'its content height — the 2026-08-08 /user/import regression. Carry the '
        + 'remount key on a <Fragment>, which needs no DOM node.',
    ).not.toBe('string');
    expect(el.type).toBe(Fragment);

    // …and the key must survive the change, or 重试 stops remounting and a
    // component that threw during mount throws again immediately.
    expect(el.key, 'the remount key was dropped along with the wrapper').toBe('0');
    boundary.state = { error: null, attempt: 1, showDetail: false };
    expect(boundary.render().key).toBe('1');
  });

  it('the page that depends on the chain still declares h-full', () => {
    // The other half of the contract: if /user/import ever stops asking for a
    // percentage height, the assertion above guards nothing and should be
    // re-read rather than left standing as decoration.
    //
    // This file is a byte-identical dual-edit mirror, but only aikey-control/web
    // ships the import page. Read whichever copy exists rather than skipping on
    // master — a skip is not a pass here (AIKEY_REQUIRE_NO_TEST_SKIPS=1).
    const candidates = [
      'src/pages/user/import/index.tsx',
      '../../aikey-control/web/src/pages/user/import/index.tsx',
    ].map((p) => path.resolve(process.cwd(), p));
    const found = candidates.find((p) => fs.existsSync(p));
    expect(found, `import page not found at any of: ${candidates.join(', ')}`).toBeTruthy();
    const src = fs.readFileSync(found!, 'utf-8');
    expect(
      /className="import-page h-full/.test(src),
      '/user/import no longer uses h-full — re-check whether this fence still '
        + 'describes a real dependency before deleting it',
    ).toBe(true);
  });
});
