/**
 * 🔴 Fence: the licensed identity is rendered, never derived — user-side SPAs.
 *
 * This is the user/web half of the fence that already guards the master console
 * (aikey-control-master/web/src/shared/components/licensed-to.test.ts). Both
 * halves exist because both repos ship a LicensedTo component, and
 * specs/license-identity requires every surface to display a BYTE-IDENTICAL
 * string — so the thing that must be single-sourced is the RENDERER, and what
 * each fence asserts is that its component reaches for it instead of writing
 * the row itself.
 *
 * The realistic way this dies is not malice. It is a designer asking for the
 * long Chinese legal name to be clipped on a narrow card, or a developer
 * title-casing it "for consistency", or someone spelling out "Personal edition"
 * inline because importing a constant for one word felt like ceremony. All three
 * look like ordinary UI work and all three break the requirement.
 *
 * 能红: add `.slice(0, 24)` or `toUpperCase()` in LicensedTo.tsx, inline any
 * state sentence, or render the row from either page directly.
 */
// @ts-nocheck — vitest-only test using Node built-ins (fs/path/__dirname); the
// project ships no @types/node, so the project-wide tsc rejects these imports
// while vitest runs the file fine. Same convention as
// no-raw-authmode-scope.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');
const COMPONENT = join(SRC, 'shared', 'components', 'LicensedTo.tsx');
const RENDERER = join(SRC, 'shared', 'license', 'identity.ts');
const SIGN_IN = join(SRC, 'pages', 'user', 'login', 'index.tsx');
const SETTINGS = join(SRC, 'pages', 'user', 'settings', 'index.tsx');

/** Comments name the things they forbid; a fence that fires on its own
 *  rationale is a fence nobody can keep. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the licensed identity is one string on every user-side surface', () => {
  it('is rendered by one component that both surfaces use', () => {
    for (const [name, path] of [
      ['user sign-in page', SIGN_IN],
      ['user settings page', SETTINGS],
    ] as const) {
      const source = readFileSync(path, 'utf8');
      expect(
        source.includes('<LicensedTo'),
        `the ${name} does not render the shared LicensedTo component`,
      ).toBe(true);
      // 🔴 And it does not reach past the component for the raw value. Two
      // renderers of "the same" string is exactly how two surfaces drift.
      expect(
        /company_name/.test(source),
        `the ${name} reads company_name itself instead of rendering LicensedTo`,
      ).toBe(false);
    }
  });

  it('renders the server string verbatim', () => {
    const source = code(COMPONENT);
    // Each of these has a legitimate use elsewhere in a UI. Inside the one
    // component that renders a licensed identity, each is a way to make two
    // surfaces show different bytes.
    const banned: Array<[RegExp, string]> = [
      [/\.slice\(/, 'truncates the name'],
      [/\.substring\(/, 'truncates the name'],
      [/\.substr\(/, 'truncates the name'],
      [/toUpperCase\(\)/, 'changes the case of the name'],
      [/toLowerCase\(\)/, 'changes the case of the name'],
      [/\bt\(['"`]/, 'localises the name'],
      [/truncate/, 'truncates the name'],
      [
        /text-ellipsis|line-clamp/,
        'clips the name with CSS, which hides bytes the other surfaces show',
      ],
    ];
    for (const [pattern, why] of banned) {
      expect(
        pattern.test(source),
        `LicensedTo ${why} (${pattern}); specs/license-identity requires every ` +
          'surface to show a byte-identical string',
      ).toBe(false);
    }
    expect(source).toContain('lineFor(data)');
  });

  // 🔴 需求变更 2026-08-18: the row renders in all three states, and the wording
  // for each state is single-sourced. A component that spelled any of it out
  // would word it differently from `aikey status`.
  it('composes none of the state wording itself', () => {
    const source = code(COMPONENT);
    for (const literal of [
      'Licensed to',
      'Personal edition',
      'not commercially licensed',
      'unavailable',
    ]) {
      expect(
        source.includes(literal),
        `LicensedTo spells out ${JSON.stringify(literal)} instead of taking it ` +
          'from @/shared/license/identity, so two surfaces can word the same state differently',
      ).toBe(false);
    }
    expect(source).toContain("from '@/shared/license/identity'");
  });

  it('never renders a bare label, in any state', () => {
    const source = readFileSync(COMPONENT, 'utf8');
    // Nothing is rendered until an answer exists: a state is a claim, and no
    // claim has been established while the query is in flight.
    expect(
      /if\s*\(!data\b/.test(source),
      'LicensedTo renders before it has an answer, so it shows a row it cannot justify',
    ).toBe(true);
    expect(source).toContain('return null');
  });

  // 🔴 The gateway masquerades forwarded TEAM pages as `authMode:local_bypass`.
  // The licence row must never branch on that — and here it must not branch on
  // ANY deployment signal, because the relative path is correct in all four
  // quadrants (see shared/api/license.ts). A discriminator appearing here would
  // be a fifth thing to keep in sync, and the first one to go stale.
  it('picks no backend of its own', () => {
    for (const path of [COMPONENT, join(SRC, 'shared', 'license', 'api.ts')]) {
      const source = code(path);
      for (const signal of ['authMode', 'controlPlaneMode', 'teamGateway', 'usageApiBase']) {
        expect(
          source.includes(signal),
          `${path} branches on ${signal}; the relative path already resolves ` +
            'correctly in every deployment quadrant',
        ).toBe(false);
      }
    }
  });

  // The renderer is the single source of the bytes, so it — and only it — may
  // hold the literals. If this ever fails, someone moved them.
  it('keeps the literals in the renderer', () => {
    const source = readFileSync(RENDERER, 'utf8');
    expect(source).toContain("export const LICENSED_TO_LABEL = 'Licensed to: '");
    expect(source).toContain(
      "export const UNLICENSED_LINE = 'Licensed to: Personal edition (not commercially licensed)'",
    );
    expect(source).toContain("export const ERROR_LINE = 'Licensed to: unavailable'");
  });
});
