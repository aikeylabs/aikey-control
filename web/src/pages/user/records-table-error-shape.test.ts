// @ts-nocheck — vitest-only test file using Node built-ins. Same pragma
// rationale as the sibling no-silent-query-errors.test.ts.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 Fence for ONE rule, across EVERY page that owns a records table:
 *
 *     a failed read is described ONCE, at the top of the page —
 *     never a second time inside the table.
 *
 * ## Why this file exists instead of another per-page test
 *
 * 2026-08-22 the user rejected the three-copies-of-one-failure shape on
 * /user/vault (shell banner + page aggregate + an in-table red block) and the
 * decision was fenced — in `vault/list-error-visibility.test.ts`, i.e. BY FILE.
 *
 * 2026-08-24 the identical shape was reported again, on /user/virtual-keys:
 * `加载失败: Network Error` drawn inside the Team Keys card while the shell
 * banner already said the same thing above it. The per-file fence could not
 * see it. The concept "in-table error display" has as many outlets as there
 * are records tables, so the fence has to sweep the directory, not name a file.
 *
 * ## What is banned, and why these exact shapes
 *
 * `EmptyState` is the in-table placeholder both pages use. Passing it an error
 * object's text — via `{{message}}` interpolation or a raw `.message` read —
 * is the banned shape: it is the second copy AND it is a bare message with no
 * code and no next step, which R2 of
 * workflow/CI/requirements/2026-07-26-read-path-error-visibility.md forbids on
 * its own. A neutral, static line (`vault.listUnavailable`,
 * `teamKeys.listUnavailable`) is what may stay.
 *
 * 能红: put `<EmptyState message={t('teamKeys.emptyLoadFailed', { message: err.message })} />`
 * back into any user page and the sweep names the file.
 */
const PAGES_DIR = __dirname;

function pageSources(): Array<{ rel: string; source: string }> {
  const out: Array<{ rel: string; source: string }> = [];
  for (const entry of readdirSync(PAGES_DIR)) {
    const dir = join(PAGES_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.tsx')) continue;
      const abs = join(dir, file);
      if (!existsSync(abs)) continue;
      out.push({ rel: `${entry}/${file}`, source: readFileSync(abs, 'utf8') });
    }
  }
  return out;
}

describe('records-table error shape (R2 · one failure, described once)', () => {
  it('no user page renders an error message inside the in-table placeholder', () => {
    const offenders: string[] = [];
    for (const { rel, source } of pageSources()) {
      for (const line of source.split('\n')) {
        if (!line.includes('<EmptyState')) continue;
        // Interpolated i18n (`t(key, { message: … })`) or a direct `.message`
        // read — both mean "the error's own text is being drawn in the table".
        if (/\{\s*message\s*:/.test(line) || /\.message/.test(line)) {
          offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      'an error message is being drawn inside a records table — it already appears in the shell banner / page aggregate above; render a neutral static line instead',
    ).toEqual([]);
  });

  it('/user/virtual-keys reports its list error in the aggregate, not in the table', () => {
    const source = readFileSync(join(PAGES_DIR, 'virtual-keys', 'index.tsx'), 'utf8');
    // Reported once, at the top. Dropping `error` here is the 2026-07-26
    // silent-failure regression, not a cleanup.
    expect(source).toContain('<PageQueryErrors sources={[error, teamVaultQuery.error]} />');
    // The neutral line, and its `allKeys.length === 0` guard. react-query keeps
    // `data` when a REFETCH fails, so without the guard this line prints on top
    // of a table full of valid rows — the contradiction reported on 2026-08-24.
    expect(source).toContain(
      "{isError && allKeys.length === 0 && <EmptyState message={t('teamKeys.listUnavailable')} />}",
    );
    // A dead backend must never render as "this team has no keys".
    expect(source).toContain('!isLoading && !isError && allKeys.length === 0 && <TeamKeysEmptyPanel />');
  });
});
