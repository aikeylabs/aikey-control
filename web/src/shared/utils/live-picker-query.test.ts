// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-11 user report: an operator removed an OAuth account from one pool,
// immediately opened another pool's attach dialog, and the account was still
// greyed out as "already in another pool". No request had been made — the
// app-wide `staleTime: 30_000` served a 30-second-old answer.
//
// What a picker shows is not information, it is THE SET OF THINGS THE USER MAY
// DO, computed from relationship state another surface can change at any
// moment. Those must refetch on open (LIVE_PICKER_QUERY). Page-level lists
// should keep the global staleTime — this fence is deliberately scoped to a
// named list rather than "every useQuery in a dialog file".
// 🔴 This file is a byte-identical dual-edit mirror, so it runs in BOTH repos —
// but most of the components it pins live in master/web only. Resolve each path
// against the local repo first, then the peer, instead of assuming a cwd.
//
// The first version used bare `src/pages/master/...` relative paths and was
// committed green: in the member repo vitest failed at COLLECTION, which it
// reports on the "Test Files" line, and the check that cleared it only read the
// "Tests" line. A file-level failure was invisible to the very grep that was
// supposed to catch it (2026-08-11).
const PEERS = ['.', '../../aikey-control/web', '../../aikey-control-master/web'];

const R = (p: string): string => {
  for (const base of PEERS) {
    const full = path.resolve(process.cwd(), base, p);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf-8');
  }
  throw new Error(
    `${p} not found in this repo or its peer (looked in ${PEERS.join(', ')}). `
    + 'This fence is mirrored into both consoles; use a repo-agnostic path.',
  );
};

/** component → file. Both consoles; the member path is relative to master/web. */
const PICKERS: Array<[string, string]> = [
  ['AttachAccountDialog', 'src/pages/master/orgs/oauth-groups/dialogs.tsx'],
  ['AttachKeyDialog', 'src/pages/master/orgs/oauth-groups/dialogs.tsx'],
  ['BindSeatsDialog', 'src/pages/master/orgs/oauth-groups/dialogs.tsx'],
  ['EditGroupDrawer', 'src/pages/master/orgs/oauth-groups/EditGroupDrawer.tsx'],
  ['InviteDialog', 'src/pages/master/orgs/seats/index.tsx'],
  ['AddAccountModal', 'src/pages/user/oauth-contribute/index.tsx'],
  ['AddAppModal', 'src/pages/user/apps/AddAppModal.tsx'],
  ['IssueKeyDialog', 'src/pages/master/orgs/virtual-keys/index.tsx'],
  ['SwitchKeyModal', 'src/pages/user/apps/SwitchKeyModal.tsx'],
];

/**
 * Source of the named component, up to the next top-level `function`.
 *
 * 🔴 The boundary pattern MUST include `export default function`. Omitting it
 * makes a component's body run on into the page component declared after it,
 * which is not a cosmetic slip: the survey that produced this fence made
 * exactly that mistake and attributed twelve PAGE-level queries to the dialogs
 * above them — nearly giving page lists the picker preset, and putting a
 * component with no queries at all (BatchSwitchDialog, whose data arrives as
 * props) on the list below.
 */
const TOP_LEVEL_FN = /^(?:export\s+)?(?:default\s+)?function\s+\w+\s*\(/m;

function componentBody(src: string, name: string): string {
  const start = src.search(new RegExp(`^(?:export\\s+)?(?:default\\s+)?function\\s+${name}\\s*\\(`, 'm'));
  expect(start, `component ${name} not found — it was renamed or removed`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(TOP_LEVEL_FN);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('dialog pickers refetch on open', () => {
  for (const [name, file] of PICKERS) {
    it(`${name} uses LIVE_PICKER_QUERY on every query`, () => {
      const body = componentBody(R(file), name);
      const queries = (body.match(/useQuery\(\{/g) ?? []).length;
      const live = (body.match(/\.\.\.LIVE_PICKER_QUERY,/g) ?? []).length;
      expect(queries, `${name} has no useQuery — the list above is stale`).toBeGreaterThan(0);
      // 能红: drop the spread from any one query in any listed component.
      expect(
        live,
        `${name}: ${queries - live} of ${queries} queries still inherit the app-wide `
          + '30s staleTime. Re-opening the dialog then serves a stale answer about what '
          + 'the user is ALLOWED to do — the 2026-08-11 "account I just freed is still '
          + 'greyed out" report.',
      ).toBe(queries);
    });
  }

  it('the preset is defined once and says what it is for', () => {
    const src = R('src/shared/utils/query-options.ts');
    expect(src).toMatch(/staleTime: 0/);
    expect(src).toMatch(/refetchOnMount: 'always'/);
    // The comment is the reason anyone will know NOT to sprinkle it on page
    // lists; a bare constant would get copied everywhere within a month.
    expect(src, 'the preset lost the note explaining where it does and does not belong')
      .toMatch(/Do NOT use it for page-level lists/);
  });
});

describe('the API KEY picker got the same treatment as the OAuth one', () => {
  // AttachAccount runs FindAccountByCredential for EVERY credential type, so a
  // KEY already held by another pool answers 409 too. Only the OAuth half was
  // fixed first; this pins the sibling (user decision 2026-08-11).
  const DIALOGS = R('src/pages/master/orgs/oauth-groups/dialogs.tsx');

  it('greys out, sorts down and explains held KEY credentials', () => {
    const body = componentBody(DIALOGS, 'AttachKeyDialog');
    expect(body, 'held KEY credentials are offered again').toMatch(/disabled: !!heldBy/);
    expect(body, 'held KEY credentials no longer sort last')
      .toMatch(/\.sort\(\(x, y\) => Number\(x\.disabled\) - Number\(y\.disabled\)\)/);
    expect(body, 'the KEY picker no longer names the holding pool')
      .toMatch(/heldByPool/);
    expect(body, 'the caption must fall back to the pool id for an alias-less pool')
      .toMatch(/c\.oauth_group_alias \|\| c\.oauth_group_id/);
    expect(body, 'the KEY picker has no dead-end hint').toMatch(/noOptionsHint=\{allHeld/);
  });
});
