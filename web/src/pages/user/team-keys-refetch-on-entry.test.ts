// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-24 user report, /user/virtual-keys (Team Keys):
//   "this page when switched to it from other tabs does not request api and
//    show data. but when refresh on this page then it calls api and show data"
//
// Reproduced on the composed gateway (127.0.0.1:8090 → team server): landing on
// the page issues GET /accounts/me/all-keys, navigating to another sidebar item
// and back within 30s issues NOTHING, and the page renders purely from cache.
// Two app-wide defaults in app/providers/index.tsx produce that together:
//   staleTime: 30_000          → a re-mount inside the window never refetches
//   refetchOnWindowFocus:false → returning to the browser tab never refetches
// So the only thing that can correct a cache entry captured at a bad moment —
// e.g. an empty list read before the first key sync landed — is F5.
//
// Team Keys is not the user's own state: every writer (admin on the team
// console, CLI on claim, expiry on the server) lives on another surface, so the
// page cannot be kept correct by invalidation from its own mutations. It has to
// re-ask on arrival.
//
// 能红: drop either option from the ['my-keys'] query and this file goes red.
const PEERS = ['.', '../../aikey-control/web', '../../aikey-control-master/web'];

const R = (p: string): string => {
  for (const base of PEERS) {
    const full = path.resolve(process.cwd(), base, p);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf-8');
  }
  throw new Error(
    `${p} not found in this repo or its peer (looked in ${PEERS.join(', ')}). `
    + 'The Team Keys page is imported by master/web through the aikey-control-web '
    + 'file: dep, so this fence must resolve from either console.',
  );
};

/** The `useQuery({ ... })` call whose queryKey is `key`, body text only. */
function queryBlockFor(src: string, key: string): string {
  const at = src.indexOf(`queryKey: ['${key}']`);
  expect(at, `no useQuery with queryKey ['${key}'] — it was renamed or removed`).toBeGreaterThan(-1);
  const open = src.lastIndexOf('useQuery({', at);
  expect(open, `queryKey ['${key}'] is not inside a useQuery({ ... }) literal`).toBeGreaterThan(-1);
  const close = src.indexOf('\n  });', open);
  expect(close, `could not find the end of the ['${key}'] query literal`).toBeGreaterThan(open);
  return src.slice(open, close);
}

describe('Team Keys re-reads the team server on every arrival', () => {
  const PAGE = 'src/pages/user/virtual-keys/index.tsx';

  it("the ['my-keys'] list refetches on mount and on tab focus", () => {
    const block = queryBlockFor(R(PAGE), 'my-keys');

    expect(
      block,
      'the Team Keys list inherits the app-wide staleTime again: navigating back '
        + 'to the page from another sidebar item within 30s renders from cache and '
        + 'issues no request, so a stale or empty snapshot sticks until F5.',
    ).toMatch(/refetchOnMount: 'always'/);

    expect(
      block,
      'the Team Keys list inherits refetchOnWindowFocus:false again: returning to '
        + 'the browser tab never revalidates, which is the literal 2026-08-24 report.',
    ).toMatch(/refetchOnWindowFocus: true/);
  });

  it('the app-wide defaults this fix compensates for are still what we think', () => {
    // Not a rule about what the defaults SHOULD be — a tripwire. If someone
    // relaxes them globally, the per-page overrides above stop being the
    // interesting part of the story and this reasoning needs re-deriving
    // rather than silently surviving as cargo.
    const providers = R('src/app/providers/index.tsx');
    expect(
      providers,
      'the app-wide staleTime changed — re-derive whether Team Keys still needs '
        + "refetchOnMount:'always' (see the comment on its useQuery).",
    ).toMatch(/staleTime: 30_000/);
    expect(
      providers,
      'the app-wide refetchOnWindowFocus changed — re-derive whether Team Keys '
        + 'still needs its own refetchOnWindowFocus:true.',
    ).toMatch(/refetchOnWindowFocus: false/);
  });
});
