// @ts-nocheck — vitest-only test using Node built-ins (fs/path/__dirname); the
// project ships no @types/node so tsc rejects these, but vitest runs it fine.
// Same convention as no-raw-authmode-scope.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// SYSTEMIC FENCE (2026-08-15) — a failed Check must be visible in EVERY view
// that offers a Check button.
//
// The trust-check page has two table views over the same rows: SOURCE
// (SourceTable, table.tsx) and BAND (BaseUrlList, index.tsx). Both render a
// per-row Check button, and the page keeps ONE `errors` map (alias →
// VerifyErrorState) that the polling effect fills on any terminal non-pass
// status ('fail' | 'failed' | 'error' | 'inconclusive').
//
// SourceTable rendered `<VerifyErrorChip>`; BaseUrlList took the same `errors`
// prop and threw it away with a bare `void errors;`. So a Check launched from
// BAND that failed left NO trace in the UI: the row kept showing the PREVIOUS
// run's band. Observed 2026-08-15 — `openai-personal` failed four consecutive
// runs with UPSTREAM_429 "You have no credits remaining", and the row still
// read "TRUSTED 85 · last check 2d". The user has no way to learn the check
// they just asked for never ran.
//
// This is the project's "失败要显眼，不要沉默" rule: if we cannot be sure
// something worked, say so where the user is looking — not only in the view
// they happen not to be on.
//
// 能红 (how to make this test red): re-add `void errors;` to BaseUrlList, or
// drop the `<VerifyErrorChip …>` from its action cell. Either turns the BAND
// view silent again and this suite fails.
//
// Bugfix: workflow/CI/bugfix/2026-08-15-trust-check-band-view-drops-verify-error.md

const INDEX = join(__dirname, 'index.tsx');
const TABLE = join(__dirname, 'table.tsx');

// Slice out one top-level `function <name>(` block: from its declaration to
// the next top-level declaration (a `function`/`const` at column 0). Matching
// on the whole file would let a chip rendered ANYWHERE else satisfy the
// assertion — the point is that BaseUrlList itself renders it.
function topLevelFn(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} not found — did it get renamed?`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const nextDecl = rest.search(/\n(?:function |const |export )/);
  return nextDecl === -1 ? rest : rest.slice(0, nextDecl);
}

describe('a failed Check is surfaced in both trust-check views', () => {
  const indexSrc = readFileSync(INDEX, 'utf8');
  const tableSrc = readFileSync(TABLE, 'utf8');
  const baseUrlList = topLevelFn(indexSrc, 'BaseUrlList');

  it('BaseUrlList (BAND view) renders the verify error chip', () => {
    expect(
      /<VerifyErrorChip\b/.test(baseUrlList),
      'BaseUrlList takes the page-level `errors` map but never renders '
        + 'VerifyErrorChip. A Check that fails from the BAND view then leaves no '
        + 'trace: the row keeps the previous run\'s band (the 2026-08-15 '
        + 'UPSTREAM_429 "no credits" case, silent across four runs).',
    ).toBe(true);
  });

  it('BaseUrlList does not discard the errors prop', () => {
    expect(
      /\bvoid\s+errors\s*;/.test(baseUrlList),
      'BaseUrlList discards `errors` with `void errors;`. That statement is '
        + 'what made failed Checks invisible in the BAND view — read the map '
        + 'for the representative alias and render VerifyErrorChip instead.',
    ).toBe(false);
  });

  it('BaseUrlList reads the errors map keyed by the representative alias', () => {
    // The row's score, lastCheck and Check button all speak for
    // `group.representative`, so its error belongs on the same row.
    expect(
      /errors\[\s*rep\.alias_name\s*\]/.test(baseUrlList),
      'BaseUrlList should look up `errors[rep.alias_name]` — the same alias its '
        + 'Check button acts on — so the chip describes the run the user triggered.',
    ).toBe(true);
  });

  it('both views use the same VerifyErrorChip component', () => {
    // Parity, not duplication: if a future change gives one view a bespoke
    // error renderer, the two drift and only one keeps the terminal-status
    // → variant mapping ('error' → upstream, 'fail' → failed, …).
    expect(
      /export function VerifyErrorChip\b/.test(tableSrc),
      'VerifyErrorChip must stay exported from table.tsx — it is the single '
        + 'renderer both SOURCE and BAND views share.',
    ).toBe(true);
    expect(
      /\bVerifyErrorChip\b/.test(indexSrc),
      'index.tsx must import and use VerifyErrorChip rather than growing its '
        + 'own error markup.',
    ).toBe(true);
  });
});
