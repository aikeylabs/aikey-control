/**
 * 🔴 Front/back contract fence for the compliance `action_taken` value domain.
 *
 * ── The failure this catches ─────────────────────────────────────────────────
 * On 2026-08-10 the database CHECK constraint was relaxed to admit `audit` (tool
 * -block scan findings: recorded only, nothing masked, nothing blocked, nobody
 * told). The rows started landing. The console still knew four values, so:
 *   · the action filter offered no `audit` option — the events could not be
 *     listed, and an operator filtering "show me what we let through" got a
 *     result that silently excluded the entire new class; and
 *   · `actionVariant()`'s `default: return 'green'` painted them in ALLOW's
 *     green, making "we detected something and forwarded it anyway"
 *     indistinguishable from "nothing matched".
 * The migration's own comment argued that `audit` must not be folded into
 * `allow`. The database honored that; the presentation layer undid it.
 *
 * ── Why the fence is shaped like THIS ────────────────────────────────────────
 * Written per outlet, not per line changed. "The console knows a value" is four
 * separate facts — filter option, badge variant, i18n label, summary count —
 * and the 2026-08-10 defect broke two of them in different ways. A fence that
 * only checked the filter list would have stayed green while every `audit` row
 * rendered green. So each outlet gets its own assertion, all driven off the ONE
 * Go enumeration, and the value domain itself is compared to that enumeration
 * rather than to a second hand-written copy.
 *
 * ── 能红 (how to prove it still works) ───────────────────────────────────────
 *   · delete 'audit' from COMPLIANCE_ACTION_TAKEN_VALUES  → "domain matches the
 *     database" goes red, naming `audit`.
 *   · set COMPLIANCE_ACTION_BADGE_VARIANT.audit = 'green' → "every outcome is
 *     visually distinct" goes red, naming the audit/allow collision.
 *   · drop `actionAudit` from any of the four catalogs     → the bilingual rule
 *     goes red, naming the catalog and the locale.
 *   · drop 'audit' from COMPLIANCE_ACTION_SUMMARY_ACTIONS  → the summary rule
 *     goes red.
 *
 * 🔴 If this test is red: do NOT widen the assertion. Either the console is
 * missing a value the database can store (add it — value, variant, label in BOTH
 * locales of BOTH catalogs, filter order), or the console offers a value the
 * database rejects (an always-empty filter, which reads to an operator as
 * "it never happened" — remove it).
 */
// @ts-nocheck — vitest-only file using Node built-ins (fs / path / process.cwd).
// Same pragma rationale as control-events/event-types.contract.test.ts: the
// project does not ship @types/node, and vitest has the Node types ambient.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  COMPLIANCE_ACTION_TAKEN_VALUES,
  COMPLIANCE_ACTION_BADGE_VARIANT,
  COMPLIANCE_ACTION_FILTER_ORDER,
  COMPLIANCE_ACTION_LABEL_KEY,
  COMPLIANCE_ACTION_SUMMARY_ACTIONS,
  COMPLIANCE_ACTION_SUMMARY_LABEL_KEY,
  UNKNOWN_COMPLIANCE_ACTION_VARIANT,
  complianceActionBadgeVariant,
  complianceActionFilterOptions,
  __resetUnknownActionWarnings,
} from './action-taken';

const USER_WEB = path.resolve(process.cwd(), '.');
const MASTER_WEB = path.resolve(process.cwd(), '../../aikey-control-master/web');

// The database's value domain lives in the migration toolchain, one repo over.
// Reading a sibling repo's Go source from a web fence is an established pattern
// here (see user/access-tokens/quota-deadend-regression.test.ts, which reads
// aikey-control-master/service/internal/accesstoken/service.go).
const SCHEMA_ENUMS_GO = path.resolve(
  process.cwd(),
  '../../aikey-config-tool/pkg/dbmigrate/schema_enums.go',
);

const read = (p: string) => fs.readFileSync(p, 'utf-8');

/** `var ComplianceActionTakenValues = []string{"allow", "mask", ...}` */
function databaseActionDomain(): string[] {
  const src = read(SCHEMA_ENUMS_GO);
  const block = src.match(/ComplianceActionTakenValues\s*=\s*\[\]string\{([^}]*)\}/);
  if (!block) return [];
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

// ── The value domain itself ────────────────────────────────────────────────

describe('action_taken value domain tracks the database', () => {
  const db = databaseActionDomain();

  it('found the Go domain at all (guards against a moved path)', () => {
    // A silently-empty parse would make every assertion below vacuously pass —
    // the fence would look green exactly when it had stopped working.
    expect(
      db,
      `no values parsed out of ${SCHEMA_ENUMS_GO}. Either the repo is not checked ` +
        `out beside this one, or ComplianceActionTakenValues moved//changed shape. ` +
        `Fix the path or the regex — do not let this fence pass vacuously.`,
    ).toContain('allow');
    expect(db.length).toBeGreaterThanOrEqual(4);
  });

  it('🔴 knows EVERY action the database can store', () => {
    const missing = db.filter((v) => !COMPLIANCE_ACTION_TAKEN_VALUES.includes(v)).sort();
    expect(
      missing,
      `the database can store these actions but the console does not know them: ` +
        `${missing.join(', ')}. Their rows render, but they cannot be filtered for and ` +
        `they fall through to the unknown-value styling. Add each to ` +
        `COMPLIANCE_ACTION_TAKEN_VALUES with a variant, a filter-order slot, and a ` +
        `label in BOTH locales of BOTH catalogs.`,
    ).toEqual([]);
  });

  it('offers no action the database would reject', () => {
    const phantom = COMPLIANCE_ACTION_TAKEN_VALUES.filter((v) => !db.includes(v)).sort();
    expect(
      phantom,
      `these console actions match no database value: ${phantom.join(', ')}. Selecting ` +
        `one yields an always-empty table, which an operator reads as "it never happened".`,
    ).toEqual([]);
  });
});

// ── Outlet 1: badge styling ────────────────────────────────────────────────

describe('badge styling keeps every outcome apart', () => {
  it('assigns a variant to every action', () => {
    const unstyled = COMPLIANCE_ACTION_TAKEN_VALUES.filter(
      (v) => !COMPLIANCE_ACTION_BADGE_VARIANT[v],
    );
    expect(unstyled, `no chip variant for: ${unstyled.join(', ')}`).toEqual([]);
  });

  it('🔴 renders every outcome visually distinct from every other', () => {
    // This is the assertion that makes the original defect impossible: `audit`
    // sharing `allow`'s green is exactly a duplicate in this map. Pairwise
    // distinctness is stated as the general invariant rather than as an
    // audit-vs-allow special case, so the NEXT value cannot collide either.
    const byVariant = new Map<string, string[]>();
    for (const action of COMPLIANCE_ACTION_TAKEN_VALUES) {
      const variant = COMPLIANCE_ACTION_BADGE_VARIANT[action];
      byVariant.set(variant, [...(byVariant.get(variant) ?? []), action]);
    }
    const collisions = [...byVariant.entries()]
      .filter(([, actions]) => actions.length > 1)
      .map(([variant, actions]) => `${actions.join('/')} all render as '${variant}'`);
    expect(
      collisions,
      `two outcomes cannot share a chip style — the reader has no way to tell them ` +
        `apart: ${collisions.join('; ')}. This is the 2026-08-10 defect (audit painted ` +
        `in allow's green) restated as a rule.`,
    ).toEqual([]);
  });

  it('🔴 never paints an unrecognized action as allow', () => {
    // The old `default: return 'green'` asserted that every not-yet-invented
    // value was benign. A server one version ahead shipping `quarantine` must
    // not read as "nothing matched".
    expect(UNKNOWN_COMPLIANCE_ACTION_VARIANT).not.toBe(COMPLIANCE_ACTION_BADGE_VARIANT.allow);
  });
});

describe('unknown-action fallback', () => {
  afterEach(() => __resetUnknownActionWarnings());

  it('resolves known actions without complaint', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const action of COMPLIANCE_ACTION_TAKEN_VALUES) {
      expect(complianceActionBadgeVariant(action)).toBe(COMPLIANCE_ACTION_BADGE_VARIANT[action]);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to neutral AND warns once per unknown value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A table of N rows must not emit N warnings — the memo keeps the signal
    // readable instead of drowning the console.
    expect(complianceActionBadgeVariant('quarantine')).toBe(UNKNOWN_COMPLIANCE_ACTION_VARIANT);
    expect(complianceActionBadgeVariant('quarantine')).toBe(UNKNOWN_COMPLIANCE_ACTION_VARIANT);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('quarantine');
    warn.mockRestore();
  });
});

// ── Outlet 2: filter options ───────────────────────────────────────────────

describe('the action filter can reach every action', () => {
  it('🔴 orders exactly the full domain, no gaps and no extras', () => {
    expect([...COMPLIANCE_ACTION_FILTER_ORDER].sort()).toEqual(
      [...COMPLIANCE_ACTION_TAKEN_VALUES].sort(),
    );
  });

  it('builds one option per action for both page scopes', () => {
    for (const scope of ['complianceAudit', 'compliancePage'] as const) {
      const options = complianceActionFilterOptions((k) => k, scope);
      expect(options.map((o) => o.value)).toEqual([...COMPLIANCE_ACTION_FILTER_ORDER]);
      for (const option of options) {
        expect(option.label).toBe(COMPLIANCE_ACTION_LABEL_KEY[scope][option.value]);
      }
    }
  });
});

// ── Outlet 3: bilingual labels, in BOTH consoles' catalogs ─────────────────

describe('every action is labeled in both locales of both catalogs', () => {
  const catalog = (root: string, lng: 'en' | 'zh') =>
    JSON.parse(read(path.join(root, `src/shared/i18n/locales/${lng}/common.json`)));

  /** Resolve a whole dotted key against a nested catalog. */
  const lookup = (cat: unknown, dotted: string): unknown =>
    dotted.split('.').reduce((node, part) => (node as Record<string, unknown>)?.[part], cat);

  // The self-view page lives in aikey-control and is rendered by BOTH consoles,
  // so its `compliancePage.` keys must resolve in both trees; master's own admin
  // page uses `complianceAudit.`.
  const targets: { name: string; root: string; scope: 'complianceAudit' | 'compliancePage' }[] = [
    { name: 'aikey-control (self-view)', root: USER_WEB, scope: 'compliancePage' },
    { name: 'aikey-control-master (self-view copy)', root: MASTER_WEB, scope: 'compliancePage' },
    { name: 'aikey-control-master (admin audit page)', root: MASTER_WEB, scope: 'complianceAudit' },
  ];

  for (const { name, root, scope } of targets) {
    for (const lng of ['en', 'zh'] as const) {
      it(`${name} · ${lng} labels every action`, () => {
        const cat = catalog(root, lng);
        const missing = COMPLIANCE_ACTION_TAKEN_VALUES.map(
          (action) => COMPLIANCE_ACTION_LABEL_KEY[scope][action],
        ).filter((key) => !lookup(cat, key));
        expect(
          missing,
          `${lng}/common.json in ${name} is missing ${missing.join(', ')} — the filter ` +
            `dropdown would render the raw i18n key.`,
        ).toEqual([]);
      });
    }
  }
});

// ── Outlet 4: summary counts ───────────────────────────────────────────────

describe('the self-view summary counts audit', () => {
  it('counts only real domain values', () => {
    const bogus = COMPLIANCE_ACTION_SUMMARY_ACTIONS.filter(
      (a) => !COMPLIANCE_ACTION_TAKEN_VALUES.includes(a),
    );
    expect(bogus, `summary cards for non-existent actions: ${bogus.join(', ')}`).toEqual([]);
  });

  it('🔴 gives audit a card, so the value cannot go uncounted', () => {
    // Scoped deliberately to `audit` rather than "every action has a card":
    // `warn` has never had a card either, and that PRE-EXISTING gap is flagged
    // for a separate decision (see COMPLIANCE_ACTION_SUMMARY_ACTIONS). Asserting
    // full coverage here would either force that unrelated change or have to be
    // written as a green-but-meaningless allowlist.
    expect(COMPLIANCE_ACTION_SUMMARY_ACTIONS).toContain('audit');
  });

  it('labels every carded action in both locales of both catalogs', () => {
    for (const root of [USER_WEB, MASTER_WEB]) {
      for (const lng of ['en', 'zh'] as const) {
        const cat = JSON.parse(read(path.join(root, `src/shared/i18n/locales/${lng}/common.json`)));
        const missing = COMPLIANCE_ACTION_SUMMARY_ACTIONS.map(
          (a) => COMPLIANCE_ACTION_SUMMARY_LABEL_KEY[a],
        ).filter((key) => !key.split('.').reduce((n: any, p) => n?.[p], cat));
        expect(missing, `${root} ${lng}: missing ${missing.join(', ')}`).toEqual([]);
      }
    }
  });
});

// ── The pages actually go through this module ──────────────────────────────

describe('no page hand-rolls the action domain again', () => {
  // The module only guarantees anything if the pages USE it. Before this change
  // each page carried its own `switch (a) { case 'block': ... default: green }`;
  // a future edit re-introducing one would leave every assertion above green
  // while the browser regressed. Both consumer pages are scanned, including the
  // one in the other repo.
  const pages = [
    { name: 'aikey-control user/compliance', file: path.join(USER_WEB, 'src/pages/user/compliance/index.tsx') },
    {
      name: 'aikey-control-master master/compliance/audit',
      file: path.join(MASTER_WEB, 'src/pages/master/compliance/audit/index.tsx'),
    },
  ];

  /**
   * Drop comments so the scan reads CODE only.
   *
   * Both pages now carry a comment EXPLAINING the deleted `default: return
   * 'green'` branch — that prose is the reason the next reader will not
   * reintroduce it, so the fence has to tolerate it rather than the comment
   * being reworded to dodge a regex. Line comments are only stripped when `//`
   * opens the line, which sidesteps the `https://` -inside-a-string case.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  for (const { name, file } of pages) {
    it(`${name} imports the shared domain and keeps no local copy`, () => {
      const src = read(file);
      const code = stripComments(src);
      expect(
        /compliance\/action-taken/.test(code),
        `${name} does not import shared/compliance/action-taken — it is styling or ` +
          `filtering actions from some other source.`,
      ).toBe(true);
      expect(
        /default:\s*return\s*'green'/.test(code),
        `${name} still has the 'unknown action is green' fallback. That branch is what ` +
          `rendered audit events as allow; unknown values must go through ` +
          `complianceActionBadgeVariant().`,
      ).toBe(false);
      expect(
        /case\s*'block'\s*:/.test(code),
        `${name} switches on the action value locally (found a \`case 'block':\`). That is ` +
          `the hand-written copy this module replaced — one of them will drift. Style and ` +
          `filter actions through shared/compliance/action-taken instead.`,
      ).toBe(false);
    });
  }
});
