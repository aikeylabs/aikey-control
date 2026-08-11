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
// Comment-stripped view. Fences that forbid a TOKEN (rather than an expression)
// must not trip on the comment that explains why the token is forbidden — the
// same trap R1 sidesteps by asserting on the `const snip =` line only.
const codeOnly = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (`://` guarded)
const pageCode = codeOnly(page);
const accessTokens = read('src/pages/user/access-tokens/index.tsx');
/**
 * Index of the `)` that closes `selected.findings.map( … )`, by paren matching
 * on the comment-stripped source. Used by R5 to decide whether a render site is
 * inside the per-finding loop or after it. Returns -1 when the call cannot be
 * found or the parens do not balance — R5 treats that as a failure, because a
 * fence that silently answers "-1 < everything" would pass forever.
 */
function endOfFindingsMap(src: string): number {
  const call = src.indexOf('selected.findings.map(');
  if (call < 0) return -1;
  let depth = 0;
  for (let i = src.indexOf('(', call); i < src.length && i >= 0; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return i;
  }
  return -1;
}
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

  it('🔴 R2 — the eye renders only when something can actually be revealed', () => {
    // The button lives on the truthy branch of the ONE guard, `canReveal`.
    const buttonAt = page.indexOf('onClick={() => toggleReveal(');
    const branchAt = page.lastIndexOf('{canReveal && (', buttonAt);
    expect(branchAt, 'the eye button must sit inside the `canReveal` guard').toBeGreaterThan(0);
  });

  // ── R4 (2026-08-10): the team lane's eye ───────────────────────────────────
  // 用户需求「在命中项的每一项可点击眼睛图标显示原文」applies to master too, but
  // the team lane has no `context_snippet` to show — the original lives in
  // conversation_records on the team server and is fetched per event. So "what
  // can be revealed" stopped being a property of the finding row and became a
  // property of the LANE. This fence keeps the dispatch in one place:
  // `canReveal` must consult the injected source when there is one and fall back
  // to the local raw text otherwise.
  //
  // 能红 check: hard-code `canReveal = !!raw`, or branch on the lane at the
  // button instead of at this single definition, and this fails.
  it('🔴 R4 — what can be revealed is the injected source’s decision', () => {
    // ONE named function is the dispatch point (2026-08-10: it grew a second
    // caller — the event-level note in R5 — and two hand-spelled copies of the
    // lane branch are exactly how the note and the eye would start disagreeing).
    expect(pageCode, 'single dispatch point for "can this be revealed"')
      .toContain('return source.originalTurn ? source.originalTurn.canReveal(event) : !!finding.context_snippet;');
    expect(pageCode, 'the per-finding eye must go through that one function')
      .toContain('const canReveal = canRevealOriginal(source, selected, f);');
    // Optional on the interface: the LOCAL lane must keep working without it.
    expect(pageCode).toContain('originalTurn?: ComplianceOriginalTurnSource;');
  });

  // ── R6 (2026-08-11): 原地替换 — one slot, two states ────────────────────────
  // 用户: 「改成原地替换」. Until now the team lane APPENDED: the masked snippet
  // stayed put and the fetched turn opened below it, so an expanded card showed
  // the same content twice over and the reader had to work out which of the two
  // blocks answered the question they clicked to ask. The stated reason for
  // appending — "the snippet must survive as the anchor for the placeholder
  // highlight" — does not survive the swap: expanded, the raw values are on
  // screen and there is no placeholder left to point at (`focus` goes null).
  //
  // These rules pin the REPLACEMENT rather than merely dropping the old
  // assertions. The failure mode is specific and easy to reintroduce: two
  // sibling `&&` guards render BOTH blocks the moment the eye opens, and it
  // looks correct in the collapsed state that most reviewers check.
  //
  // 能红 check: restore `{teamOriginal && revealed && <…Panel/>}` as a sibling of
  // the snippet guard, and both assertions below fail.
  describe('🔴 R6 — the eye replaces the snippet, it does not append to it', () => {
    /** The reveal branch: the panel arm of the one ternary that owns the slot. */
    const revealArm = (() => {
      const at = pageCode.indexOf('{showOriginalInPlace ? (');
      expect(at, 'the slot must be owned by ONE ternary, not two sibling guards')
        .toBeGreaterThan(-1);
      const end = pageCode.indexOf(') : shown ? (', at);
      expect(end, 'the masked snippet must be the ELSE arm of that same ternary')
        .toBeGreaterThan(at);
      return pageCode.slice(at, end);
    })();

    it('mounts the fetched turn where the snippet would have been', () => {
      // `.Panel` reached off the narrowed source, so the branch that renders it
      // is the branch that proved the lane exists — no non-null assertion.
      expect(revealArm).toContain('<showOriginalInPlace.Panel event={selected} />');
    });

    it('leaves the masked snippet unreachable while the turn is shown', () => {
      // The snippet's own render must NOT appear inside the reveal arm: if it
      // does, the ternary has been reopened into the append shape.
      expect(revealArm, 'the snippet must not render alongside the revealed turn')
        .not.toContain('renderMaskedSnippet');
    });

    it('the panel still mounts only while an eye is open (recorded read)', () => {
      // The team read writes an access record, so it must be triggered by the
      // click and not by the drawer opening. `revealed` is the only gate.
      expect(pageCode)
        .toContain('const showOriginalInPlace = revealed ? teamOriginal : undefined;');
    });

    it('the local lane swaps text inside the one box, same as before', () => {
      // LOCAL was already in-place; the change must not have made it a lane
      // special case. One expression, no `teamOriginal` in it.
      expect(pageCode).toContain('const shown = revealed && raw ? raw : masked;');
    });

    it('🔴 masked and revealed are the SAME box, drawn from the shared source', () => {
      // 2026-08-11 用户:「显示原文的样式，需要也有背景框框，和 mask 后的保持一致性
      // 的样式」. The user's acceptance test is an overlay: put the collapsed and
      // expanded screenshots side by side and the box outline must coincide,
      // with only the text differing.
      //
      // 🔴 ONE render site, one style call. This lane has always used a single
      // box for both states, so the way it regresses is not a second box — it is
      // a second STYLE: someone adds `revealed ? {...} : {...}` inline and the
      // two states drift. Asserting the shared symbols makes that impossible to
      // do quietly, and keeps this lane in step with the admin drawer and the
      // team panel, which now draw the same box from the same function.
      //
      // 能红 check: inline the old
      // `borderLeft: revealed && raw ? '2px solid var(--primary-dim)' : …` and
      // the literal scan below fails.
      // 🔴 Scoped to the SLOT (the whole ternary), not the page: these literals
      // legitimately appear on the table borders, the compliance switch and the
      // sequence badge, and a page-wide scan would fail on code that has nothing
      // to do with the snippet box.
      const at = pageCode.indexOf('{showOriginalInPlace ? (');
      const slot = pageCode.slice(at, pageCode.indexOf(') : null}', at));
      expect(slot.length, 'the slot must terminate at the ternary, not run to EOF').toBeGreaterThan(0);
      expect(slot).toContain('SNIPPET_BOX_CLASS');
      expect(slot).toContain("snippetBoxStyle(revealed && raw ? 'raw' : 'masked')");
      for (const literal of ['rgba(0,0,0,0.28)', '1px solid var(--border)', 'primary-dim']) {
        expect(
          slot.includes(literal),
          `${literal}: the box is spelled in mask-highlight.tsx, not here — an inline copy is ` +
            'how the masked and revealed outlines stop matching',
        ).toBe(false);
      }
    });

    it('🔴 the reveal arm mounts the panel and NOTHING else', () => {
      // 2026-08-11 用户: 「这段话不需要了」+「能不能在原框框内显示，不要在下方！！！」.
      // The team panel briefly rendered a heading and an audit notice above its
      // text; both are gone (fenced at the panel itself in the master repo,
      // .../user/compliance/original-turn-eye.test.ts §B). This page owns the
      // SLOT, so the way the shape regresses HERE is different and needs its own
      // rule: wrap the panel in a caption, a label row or a hint and the copy is
      // back on screen without the panel's own fence noticing a thing.
      //
      // 能红 check: add `<p>{t('compliancePage.originalWholeTurn')}</p>` next to
      // the panel inside this arm, and this fails on the t() count.
      expect(
        [...revealArm.matchAll(/\bt\(/g)].length,
        'the reveal arm must render the injected panel bare — no caption, no notice',
      ).toBe(0);
      expect(
        [...revealArm.matchAll(/<[A-Za-z]/g)].map((m) => m.index).length,
        'exactly one element in the arm: the panel',
      ).toBe(1);
    });
  });

  // ── R3 (2026-08-10): the note must not hard-code the LOCAL reason ──────────
  // This page is reused verbatim by the team-member self-view on the master
  // console (master .../pages/user/compliance injects `teamSource`). There, raw
  // text is absent BY DESIGN (DC5) and no detector upgrade can ever produce it,
  // so the local "recorded by an older detector — upgrade it" wording is a fix
  // instruction that can never work. The reason therefore travels on the
  // injected source, exactly like titleKey/descriptionKey already do.
  //
  // Fenced by CONCEPT, not by line: the concept "why is there no eye" has three
  // exits — the render site here, LOCAL_SOURCE's declaration, and (fenced in the
  // master repo) teamSource's declaration.
  //
  // 能红 check: hard-code `t('compliancePage.originalUnavailable')` back into the
  // render site, or point LOCAL_SOURCE at the team key, and this fails.
  it('🔴 R3 — the no-eye note comes from the injected source, not a literal', () => {
    expect(pageCode, 'single exit: the render site must read the injected key')
      .toContain('t(source.originalUnavailableKey)');

    // Exactly one occurrence of the local key, and it must be the LOCAL_SOURCE
    // declaration — not the render site.
    const hits = pageCode.split('compliancePage.originalUnavailable').length - 1;
    expect(hits, 'the local key must appear once, in LOCAL_SOURCE only').toBe(1);
    const localSourceAt = pageCode.indexOf('const LOCAL_SOURCE');
    const keyAt = pageCode.indexOf("originalUnavailableKey: 'compliancePage.originalUnavailable'");
    expect(keyAt, 'LOCAL_SOURCE must declare the local-lane key').toBeGreaterThan(localSourceAt);
    expect(pageCode.indexOf('export default function ComplianceSelfViewPage'))
      .toBeGreaterThan(keyAt);

    // Required (not optional): a future source that forgets to declare its own
    // reason must fail to COMPILE rather than silently inherit the local one.
    expect(pageCode, 'originalUnavailableKey must stay non-optional on the interface')
      .toContain('originalUnavailableKey: string;');
    expect(pageCode).not.toContain('originalUnavailableKey?: string');
  });

  // ── R5 (2026-08-10): the no-original note is EVENT-level, shown ONCE ───────
  // 用户反馈:「这段话，只需要在抽屉显示一次即可」— a real event carried 8 findings
  // and the paragraph rendered 8 times in one drawer. The fix is not "dedupe the
  // output": "is there an original I can look at" is a property of the EVENT
  // (the team lane's canReveal does not even take a finding), so the render site
  // belongs outside the findings map. This fence pins the LAYER.
  //
  // ⚠️ LIMIT OF THIS FENCE — read before trusting it. The project's vitest runs
  // without jsdom, so nothing here renders the page; "appears once" is asserted
  // as "the one render site is lexically outside `selected.findings.map(...)`",
  // by paren-matching the map call in the source. That is a source-level proxy,
  // NOT a rendered-DOM count: it cannot catch a future second render site added
  // in another component, and it would be fooled by an unbalanced parenthesis
  // inside a string literal in the map body (the sanity assertions below exist
  // to make that failure loud rather than silent).
  //
  // 能红 check: move the `<p>{t(source.originalUnavailableKey)}</p>` back inside
  // the findings map (its pre-2026-08-10 home) and this test fails.
  it('🔴 R5 — the no-original note renders once per DRAWER, not per finding', () => {
    const mapEnd = endOfFindingsMap(pageCode);
    expect(mapEnd, 'could not paren-match `selected.findings.map(` — fence is blind, fix it')
      .toBeGreaterThan(0);

    // Sanity: the paren match must actually span the finding card, otherwise a
    // stray parenthesis could make every position look "after the map".
    const eyeAt = pageCode.indexOf('onClick={() => toggleReveal(');
    const mapStart = pageCode.indexOf('selected.findings.map(');
    expect(eyeAt, 'the PER-FINDING eye must stay inside the map (local lane: one眼睛 per finding)')
      .toBeGreaterThan(mapStart);
    expect(eyeAt, 'paren match ended before the finding card — fence is blind, fix it')
      .toBeLessThan(mapEnd);

    // Exactly one render site, and it is after the map closes.
    const renderSites = pageCode.split('t(source.originalUnavailableKey)').length - 1;
    expect(renderSites, 'exactly one place may print the note').toBe(1);
    const noteAt = pageCode.indexOf('t(source.originalUnavailableKey)');
    expect(noteAt, '🔴 the note must NOT sit inside the per-finding map')
      .toBeGreaterThan(mapEnd);

    // …and still inside the EVENT drawer (the next drawer is the packs one).
    const packsDrawerAt = pageCode.indexOf('open={packsOpen}');
    expect(packsDrawerAt).toBeGreaterThan(0);
    expect(noteAt, 'the note must stay in the event detail drawer').toBeLessThan(packsDrawerAt);

    // The event-level condition: no finding anywhere in the event can be
    // revealed. `.some(...)` over the findings is what makes it event-level;
    // a per-finding `canReveal` here would be the old shape wearing a new hat.
    expect(pageCode, 'the note must be gated on an event-wide check')
      .toContain('const anyRevealable = selected.findings.some((f) => canRevealOriginal(source, selected, f));');
  });

  // The masquerade rule, restated where it can bite: the gateway patches
  // forwarded team pages to authMode:'local_bypass', so authMode cannot tell the
  // two lanes apart. (principles/gateway-local-bypass-masquerade.md; the repo-wide
  // net is shared/usage/no-raw-authmode-scope.test.ts.)
  it('🔴 R3 — the lane is never inferred from authMode', () => {
    expect(pageCode).not.toContain('local_bypass');
    expect(pageCode).not.toContain('authMode');
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

  // The LOCAL note keeps the "older detector → upgrade it" attribution, which is
  // only correct on this lane. Pinning the semantics (not the exact sentence)
  // keeps the two lanes from converging into one vague message that is wrong for
  // both. The team-lane counterpart is fenced in aikey-control-master/web.
  it('🔴 R3 — the local note keeps the detector-upgrade attribution', () => {
    expect(enCatalog.compliancePage.originalUnavailable).toMatch(/older detector/i);
    expect(enCatalog.compliancePage.originalUnavailable).toMatch(/upgrade/i);
    expect(zhCatalog.compliancePage.originalUnavailable).toMatch(/旧版检测器/);
    expect(zhCatalog.compliancePage.originalUnavailable).toMatch(/升级/);
  });
});
