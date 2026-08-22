// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const r = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const EN = JSON.parse(r('src/shared/i18n/locales/en/common.json')).trustCheck;
const ZH = JSON.parse(r('src/shared/i18n/locales/zh/common.json')).trustCheck;
const PAGE = r('src/pages/user/trust-check/index.tsx');
const API = r('src/pages/user/trust-check/api.ts');

/** Strip comments before matching source.
 *
 * 🔴 Learned the hard way on 2026-08-21: the first version of the fallback
 * assertion below matched `?? EMPTY_FALLBACK_COPY` anywhere in the branch,
 * and the branch contains a COMMENT explaining why that fallback matters.
 * Deleting the actual code left the comment behind, so the fence stayed
 * green through the exact deletion it exists to catch. A source-level fence
 * must read code, never the prose written about it. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Phase 1 of spec 2026-08-21-trust-check-empty-state-attribution.
//
// WHY THIS FENCE EXISTS
// =====================
// `isEmpty` is reached whenever trust-local answers successfully with zero
// rows, and that happens for FOUR different reasons: vault unreadable, no
// credentials at all, every credential filtered out of detection scope, or
// credentials that exist but were never `aikey use`d. One copy string covered
// all four, and it asserted one of them:
//
//   "No sources observed yet. Send a request through aikey-proxy — once
//    trust-local sees one observation it shows up here automatically."
//
// On 2026-08-21 a machine hit the third case (a trust-local binary built
// before `openai` entered scope dropped both of the user's credentials). The
// page rendered that sentence over a database that already held scored
// observations for both aliases, and the remedy it offered — send more
// traffic — could never have worked. A component version skew was displayed
// as an ordinary empty result, with every request logging 200.
//
// Until Phase 2 ships `empty_reason` on the API, this view genuinely cannot
// know which of the four it is, so the copy must not pick one.
//
// 🔴 This fence must survive Phase 2, not be deleted by it. The web bundle and
// trust-local are upgraded SEPARATELY — that skew is the whole incident — so a
// console that has `empty_reason` handling will still meet plugins that never
// send the field. The no-reason fallback is that path, and it has to stay
// honest or the same failure returns wearing the same face.
describe('Trust Check empty state does not assert a cause it cannot know', () => {
  const locales: [string, Record<string, string>][] = [
    ['en', EN],
    ['zh', ZH],
  ];

  it.each(locales)('%s: offers no single remedy that presumes one cause', (_name, C) => {
    const copy = `${C.emptyTitle} ${C.emptyNote}`;
    // The exact false remedy from the incident, in both languages. "Send
    // traffic" is right for at most one of the four causes and is actively
    // misleading for the other three.
    expect(copy).not.toMatch(/aikey-proxy/);
    expect(copy).not.toMatch(/[Ss]end a request/);
    expect(copy).not.toMatch(/发起一次请求/);
  });

  it.each(locales)('%s: does not claim the observation state it cannot see', (_name, C) => {
    // "No sources OBSERVED yet" is a claim about trust-local's data, made by a
    // view that only knows the merged list came back empty. The two are not the
    // same thing — that gap is exactly what the incident walked through.
    expect(C.emptyTitle).not.toMatch(/observed/i);
    expect(C.emptyTitle).not.toMatch(/观测/);
  });

  it.each([
    ['en', EN, [/credential/i, /aikey use/, /scope/i]],
    ['zh', ZH, [/凭据/, /aikey use/, /范围/]],
  ])('%s: names more than one possibility, so no single cause reads as settled', (_n, C, markers) => {
    const hits = (markers as RegExp[]).filter((m) => m.test(C.emptyNote)).length;
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it.each(locales)('%s: still gives one real next step', (_name, C) => {
    // Cause-neutral must not mean useless. `aikey list` is the one command that
    // separates "no credentials" from "none selected", and it is already the
    // established way this page names CLI actions (removeInUseHint et al).
    expect(C.emptyNote).toMatch(/aikey list/);
  });

  it('keeps the no-reason fallback wired in the page', () => {
    // Pins the branch itself, so a refactor that routes every known
    // `empty_reason` but forgets the unknown/absent case goes red here rather
    // than silently regressing older plugins to a blank panel.
    //
    // Phase 2 moved the copy behind a lookup; this assertion moved WITH it
    // rather than being deleted. It went red when the branch was rewritten,
    // which is the only reason we know it was ever load-bearing.
    const branch = codeOnly(
      PAGE.slice(PAGE.indexOf('if (isEmpty) {'), PAGE.indexOf('if (isFilteredEmpty) {')),
    );
    expect(branch).toMatch(/\?\?\s*EMPTY_FALLBACK_COPY/);
    expect(PAGE).toMatch(/EMPTY_FALLBACK_COPY = \{[\s\S]*?trustCheck\.emptyTitle[\s\S]*?trustCheck\.emptyNote[\s\S]*?\}/);
  });
});

// Phase 2 of spec R7: the plugin now names the cause and the page looks it up.
//
// Everything here guards the SEAM, because that is where this feature can
// fail quietly: a wire value with no copy renders nothing, a copy key with
// no catalog entry renders the key itself, and a union that has drifted from
// the plugin's constants means the lookup misses for a cause that IS being
// reported.
describe('Trust Check empty-reason lookup covers the whole wire contract', () => {
  /** The four values the plugin can send, read off the TS union itself. */
  const unionMembers = (() => {
    const block = API.slice(API.indexOf('export type TrustEmptyReason'));
    const decl = block.slice(0, block.indexOf(';'));
    return [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  })();

  it('matches the wire values the plugin declares', () => {
    // Independently pinned on the Python side by
    // test_in_use_scope.py::test_empty_reason_wire_values_are_frozen. Two
    // repos, one literal set: a rename on either side turns one of them red.
    // (Not a live cross-repo read — CI clones one repo, and a fence that
    // SKIPs when the sibling is missing would protect nothing.)
    expect(unionMembers).toEqual([
      'all_out_of_scope',
      'never_used',
      'no_credentials',
      'vault_unreachable',
    ]);
  });

  it('gives every wire value its own copy row', () => {
    const table = PAGE.slice(PAGE.indexOf('const EMPTY_REASON_COPY'), PAGE.indexOf('EMPTY_FALLBACK_COPY'));
    for (const member of unionMembers) {
      expect(table).toContain(`${member}: {`);
    }
  });

  it('resolves every referenced copy key in BOTH locales', () => {
    // A missing catalog entry renders the raw key to the user — the failure
    // mode i18n libraries produce instead of an error.
    const keys = [...PAGE.matchAll(/'trustCheck\.(empty[A-Za-z]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of new Set(keys)) {
      for (const [name, C] of [['en', EN], ['zh', ZH]] as [string, Record<string, string>][]) {
        expect(typeof C[key], `${name}.trustCheck.${key}`).toBe('string');
        expect((C[key] || '').trim().length, `${name}.trustCheck.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('tells the user what to do — except where there is nothing to do', () => {
    // Each cause must carry its own next step, or naming the cause bought
    // nothing. The exception is deliberate: when every provider is out of
    // scope the user genuinely has no action, and inventing one would be the
    // dead-end R4 exists to remove.
    const withAction: [string, RegExp, RegExp][] = [
      ['emptyVaultUnreachableNote', /unlocked|refresh/i, /解锁|刷新/],
      ['emptyNoCredentialsNote', /aikey add/, /aikey add/],
      ['emptyNeverUsedNote', /aikey use/, /aikey use/],
    ];
    for (const [key, en, zh] of withAction) {
      expect(EN[key], `en.${key}`).toMatch(en);
      expect(ZH[key], `zh.${key}`).toMatch(zh);
    }
    expect(EN.emptyAllOutOfScopeNote).toMatch(/no action for you/i);
    expect(ZH.emptyAllOutOfScopeNote).toMatch(/不需要你做任何操作/);
  });
});
