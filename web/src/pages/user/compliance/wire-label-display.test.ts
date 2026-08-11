/**
 * Source-level fence for the 「发出形态」 display (`wire_label`), 2026-08-11.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * 方案 L «结果回填» (update doc 20260810-合规事件携带命中片段原文 §16.3) back-fills
 * onto each masked finding the placeholder it was ACTUALLY forwarded under
 * (`{{PHONE_1}}`). It deliberately leaves `redacted_snippet` byte-for-byte
 * unchanged — renumbering that string would drift every downstream tier-2
 * judgement built on it — so the numbers reach the reader ONLY through this
 * field. Two views of one finding:
 *
 *   redacted_snippet → the DETECTOR's view    → `{{PHONE}}`   (numberless)
 *   wire_label       → what the PROXY sent    → `{{PHONE_1}}` (request-scoped)
 *
 * HOW IT IS SHOWN (2026-08-11 用户拍板, replacing the row this file first fenced)
 * ---------------------------------------------------------------------------
 * 「编号直接在脱敏片段里显示，不要单独一行」+「多片段，只有当前片段用黄色，其他用
 * 默认颜色即可」. So the number is substituted INTO the snippet, on the one token
 * that belongs to this card, and the neighbouring tokens — which belong to the
 * cards above and below — drop to plain body text. The short-lived
 * 「发出形态: {{PHONE_1}}」 row under the snippet is gone, and so is its copy: this
 * feature now owns NO i18n key at all (rules L1/L2 below keep it that way, and
 * the orphan-key rule R4 in shared/i18n/i18n-key-coverage.test.ts backs them).
 *
 * 🔴 THE LOAD-BEARING RULES, and where each is enforced
 * ----------------------------------------------------
 *  A. The highlighted token is THIS finding's own — never "the first one".
 *     Getting it wrong is 张冠李戴: the reader concludes 张先生's number went out
 *     as `{{PHONE_2}}`. That is BEHAVIOUR, so it is fenced by behaviour, in
 *     shared/utils/mask-highlight.test.ts (dual-edited into both trees — rule D
 *     below asserts the copies stay identical, so neither console can drift).
 *  B. Unresolvable renders the snippet AS-IS — no note, no hint, no version
 *     warning. Absence is normal and permanent: the Personal lane never has a
 *     wire_label at all (local events go detector → control.db without passing
 *     the proxy — 方案 L's accepted asymmetry, §16.3「方案 L 拿不到的东西」#1), and
 *     on the team lane it is absent for every audit-only finding (recorded,
 *     bytes forwarded UNCHANGED), ceiling-capped piece and restore degrade.
 *     Both wrong readings have a track record here:
 *       (a) 「没有值 = 版本太旧，去升级」 — shipped 2026-08-10 and sent the user to
 *           perform a fix that can never work (workflow/CI/bugfix/
 *           20260810-team-compliance-selfview-blames-old-detector.md).
 *       (b) its mirror, asserting a redaction that did not happen — the
 *           false-safety signal §16.2/核查 2 exists to prevent (fenced
 *           server-side by aikey-control-master/service/internal/compliance/
 *           wire_label_test.go).
 *     Rules W3/L1/L2 below make (a) unwritable from the render sites AND from
 *     the catalogs.
 *
 * FENCED BY CONCEPT, NOT BY LINE (principles/documented-contract-needs-
 * enforcement.md). The concept 「show what this finding was forwarded as」 has
 * these exits, and this file asserts all of them:
 *   E1  aikey-control        shared/api/user/compliance.ts     ComplianceFindingDTO
 *   E2  aikey-control-master shared/api/master/compliance.ts   AuditFindingDTO
 *   E3  aikey-control        pages/user/compliance             (shared self-view,
 *                                                               both lanes)
 *   E4  aikey-control-master pages/master/compliance/audit     (admin drawer)
 *   E5  aikey-control-master pages/master/compliance/triage    (review drawer)
 *   E6  shared/utils/mask-highlight.tsx — the ONE place that decides which token
 *       is focal and how a focal/non-focal token is painted, in BOTH trees
 *   E7  the catalogs of both consoles: no copy for this feature, in either
 *       locale
 *
 * Reading the sibling tree is the established shape for this page family — see
 * shared/compliance/action-taken.contract.test.ts, which fences master's audit
 * page from here for the same reason: the self-view page lives in aikey-control
 * and is RENDERED by both consoles, so a fence that stops at the repo boundary
 * stops halfway through the concept.
 *
 * The project's vitest runs without jsdom (see shared/ui/route-error-boundary
 * .test.tsx), so nothing here renders; scanning source is the available
 * technique, same as snippet-reveal.test.ts next door.
 */
// @ts-nocheck — vitest-only file using Node built-ins (fs / path / __dirname).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const USER_WEB = path.resolve(process.cwd(), '.');
const MASTER_WEB = path.resolve(process.cwd(), '../../aikey-control-master/web');
const read = (p: string) => readFileSync(p, 'utf8');

/**
 * Comment-stripped view. Every rule below forbids a TOKEN, and the comments at
 * each render site NAME the forbidden readings on purpose (they explain why the
 * degrade path is silent) — so they must not trip their own fence.
 */
const codeOnly = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (`://` guarded)

/** E1 / E2 — the two DTO declarations. */
const DTOS = [
  {
    name: 'aikey-control ComplianceFindingDTO (self-view, both lanes)',
    file: path.join(USER_WEB, 'src/shared/api/user/compliance.ts'),
  },
  {
    name: 'aikey-control-master AuditFindingDTO (admin audit + triage + member self-view)',
    file: path.join(MASTER_WEB, 'src/shared/api/master/compliance.ts'),
  },
];

/** E3 / E4 / E5 — the three surfaces that render a finding's snippet. */
const RENDER_SITES = [
  {
    name: 'aikey-control user/compliance (self-view, reused by master)',
    file: path.join(USER_WEB, 'src/pages/user/compliance/index.tsx'),
  },
  {
    name: 'aikey-control-master master/compliance/audit (admin drawer)',
    file: path.join(MASTER_WEB, 'src/pages/master/compliance/audit/index.tsx'),
  },
  {
    name: 'aikey-control-master master/compliance/triage (review drawer)',
    file: path.join(MASTER_WEB, 'src/pages/master/compliance/triage/index.tsx'),
  },
];

/** E6 — the shared renderer, which must be the same file in both trees. */
const MASK_HIGHLIGHT = 'src/shared/utils/mask-highlight.tsx';
const MASK_HIGHLIGHT_TEST = 'src/shared/utils/mask-highlight.test.ts';

/** E7 — the catalogs that must NOT carry copy for this feature. */
const CATALOGS = [
  { name: 'aikey-control (self-view)', root: USER_WEB },
  { name: 'aikey-control-master (self-view copy + admin audit + triage)', root: MASTER_WEB },
] as const;

const catalog = (root: string, lng: 'en' | 'zh') =>
  JSON.parse(read(path.join(root, `src/shared/i18n/locales/${lng}/common.json`)));

/** Every leaf key of a catalog, dotted. */
function flatKeys(obj: unknown, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatKeys(v, key, out);
    else out.push(key);
  }
  return out;
}

describe('wire_label (发出形态) display', () => {
  // ── W1 (E1+E2) ────────────────────────────────────────────────────────────
  // Optional on BOTH DTOs. Required would be wrong twice over: every row written
  // before the alpha.5 migration has NULL here, and the Personal lane never
  // produces one at all — a required field would make "normal" unrepresentable.
  //
  // 能红: drop the field from either DTO, or spell it `wire_label: string;`.
  describe.each(DTOS)('🔴 W1 — declared, and OPTIONAL, on $name', ({ file }) => {
    const src = read(file);
    it('declares wire_label?: string', () => {
      expect(src, 'the field must exist — the resolver reads it').toContain('wire_label?: string;');
    });
    it('never makes it required', () => {
      expect(src, 'absent is a normal state; a required field cannot express it')
        .not.toMatch(/^\s*wire_label:\s*string;/m);
    });
  });

  // ── W2 (E3+E4+E5) — the number goes INTO the snippet, via the ONE resolver ──
  // Each surface must hand `renderMaskedSnippet` a focus resolved from the
  // finding AND its siblings. The siblings argument is load-bearing: the group
  // rule is the only thing that can tell two same-code tokens apart, and a site
  // that passed `[f]` (or nothing) would silently fall back to "single token
  // only", i.e. no number on exactly the multi-hit events that need one.
  //
  // 能红: call `renderMaskedSnippet(f.redacted_snippet)` with one argument, or
  // hand-roll the substitution at the site, or pass `[f]` as the siblings.
  describe.each(RENDER_SITES)('🔴 W2 — $name substitutes it into the snippet', ({ file }) => {
    const code = codeOnly(read(file));
    it('resolves the focus from the finding AND the whole event', () => {
      expect(code, 'the focus must come from the shared resolver, not from a local guess')
        .toContain('resolveWireLabelFocus(f, selected.findings)');
      expect(code, 'import it from the console-wide single source')
        .toMatch(/import \{[^}]*resolveWireLabelFocus[^}]*\} from '@\/shared\/utils\/mask-highlight'/);
    });
    it('passes that focus to renderMaskedSnippet', () => {
      expect(code, 'the focus is useless unless the renderer receives it')
        .toMatch(/renderMaskedSnippet\([^)]*resolveWireLabelFocus\(f, selected\.findings\)|renderMaskedSnippet\(\w+, focus\)/);
    });
  });

  // ── W3 (E3+E4+E5) — THE 2026-08-10 BUG STAYS UNWRITABLE ───────────────────
  // The pages no longer touch `wire_label` themselves at all: they hand the
  // finding to the resolver and the resolver answers or returns null. So the
  // rule is an exact count of ZERO, which is stronger than the old "exactly 2"
  // — there is no longer any legitimate reason for a page to name the field,
  // and every illegitimate one (a `!f.wire_label` note, a ternary else-branch,
  // an event-level `findings.some((f) => !f.wire_label)` banner, a `|| '—'`
  // fallback) needs it.
  //
  // 能红: add `{!f.wire_label && <p>{t('…outdatedProxy')}</p>}` to any surface.
  describe.each(RENDER_SITES)('🔴 W3 — $name renders nothing extra when absent', ({ file }) => {
    const code = codeOnly(read(file));
    it('never reads wire_label at the render site', () => {
      const uses = code.split('wire_label').length - 1;
      expect(
        uses,
        'zero uses allowed. The page asks resolveWireLabelFocus and renders the ' +
          'snippet either way; any direct read is a branch, and a branch on the ' +
          'EMPTY case is the 2026-08-10 bug (「这条没有值」 shown as 「版本太旧、去升级」) ' +
          'coming back. Absence is normal: always on the Personal lane, and on the ' +
          'team lane for every audit-only finding.',
      ).toBe(0);
    });
    it('still renders the snippet unconditionally of the label', () => {
      // The snippet's own guard is on the SNIPPET, never on the label — a
      // finding with no wire_label must still show its text.
      expect(code, 'the snippet must not become conditional on the label')
        .not.toMatch(/wire_label\s*&&[\s\S]{0,200}renderMaskedSnippet/);
    });
  });

  // ── W4 (E7) — the feature owns NO copy, so none can editorialise ──────────
  // The old row had a label key (`fieldWireLabel`). It is gone with the row.
  // Keeping the key around would be an invitation: the 2026-08-10 note started
  // life exactly as an unused catalog entry. This asserts the absence in every
  // locale of every console — and the orphan-key rule (R4 in
  // shared/i18n/i18n-key-coverage.test.ts) independently fails on a key with no
  // caller, so the two rules close the loop from both ends.
  //
  // 能红: re-add `"fieldWireLabel": "Forwarded as"` to any catalog.
  for (const { name, root } of CATALOGS) {
    for (const lng of ['en', 'zh'] as const) {
      it(`🔴 W4 — ${name} · ${lng} carries no 发出形态 copy at all`, () => {
        const keys = flatKeys(catalog(root, lng));
        const strays = keys.filter((k) => /wireLabel|forwardedAs/i.test(k));
        expect(
          strays,
          'the number is substituted into the snippet and needs no label. A key ' +
            'here would be either a row nobody asked for or a sentence about ' +
            'absence — and absence is normal and gets no text.',
        ).toEqual([]);
      });
    }
  }

  // ── W5 (E6) — one renderer, byte-identical in both trees ──────────────────
  // `@/shared/utils/*` is NOT vite-aliased across the two web trees, so each
  // console compiles its own copy. Rule A (the correspondence rule) is fenced
  // BEHAVIOURALLY inside mask-highlight.test.ts; that fence only covers both
  // consoles if both copies — module AND test — stay identical. This is the
  // same invariant `make -f workflow/CI/Makefile web-drift-check` enforces
  // (whitelist entry `src/shared/utils`), asserted here too so a wrong edit
  // fails in the same run as the feature it would break.
  //
  // 能红: edit either copy alone.
  for (const rel of [MASK_HIGHLIGHT, MASK_HIGHLIGHT_TEST]) {
    it(`🔴 W5 — ${rel} is identical in both consoles`, () => {
      expect(
        read(path.join(MASTER_WEB, rel)),
        `${rel} drifted between the trees — the behavioural fence for 「highlight ` +
          `THIS finding's token」 then only protects one console.`,
      ).toBe(read(path.join(USER_WEB, rel)));
    });
  }

  // ── W6 (E6) — the correspondence rule is EXERCISED, not merely present ────
  // A pointer with teeth: this file cannot re-assert behaviour (no jsdom, no
  // cross-tree import), but it CAN refuse to let the behavioural fence be
  // quietly emptied. The named cases are the two halves of rule A — the second
  // one is the 张冠李戴 case, which is the only one that fails when somebody
  // "simplifies" the resolver into "highlight the first token".
  //
  // 能红: delete the 命中2 case from mask-highlight.test.ts.
  it('🔴 W6 — mask-highlight.test.ts still pins BOTH sides of the correspondence', () => {
    const src = read(path.join(USER_WEB, MASK_HIGHLIGHT_TEST));
    for (const needle of [
      'resolveWireLabelFocus',
      '命中1 numbers 张先生',
      '命中2 numbers 李女士',
      'unresolvable degrades to the plain snippet',
    ]) {
      expect(
        src,
        `mask-highlight.test.ts no longer contains ${JSON.stringify(needle)} — the ` +
          'behavioural fence for the correspondence rule has been weakened. It is ' +
          'the ONLY thing standing between a reader and 「张先生的号码是以 {{PHONE_2}} ' +
          '发出的」, which is worse than showing no number.',
      ).toContain(needle);
    }
  });
});
