/**
 * 🔴 Grep fence: no user page may run a query whose error goes nowhere.
 *
 * The disease (2026-07-26): the console's common read pattern was
 *
 *     const { data: rawKeys } = useQuery({...});   // error discarded
 *     const allKeys = rawKeys ?? [];               // failure → empty list
 *
 * so a 401 / CORS block / 500 rendered as "暂无数据" — indistinguishable from an
 * account with no data. Two production defects hid behind it (the poisoned
 * cross-app peer URL; a Production-only 500 in PersonalRecent). Every page was
 * then wired to surface errors via <PageQueryErrors> or an inline error branch,
 * plus the global DataFetchErrorBanner in UserShell.
 *
 * This fence keeps the wiring from decaying: a NEW page (or a new query on an
 * old page) that drops its error goes red here, not in production three months
 * later. It checks two things per user page that calls useQuery:
 *
 *   1. The page imports an error surface — PageQueryErrors, ApiErrorDisplay, or
 *      demonstrably reads error/isError somewhere.
 *   2. No `const { data … } = useQuery` destructuring that omits `error` unless
 *      the page has a PageQueryErrors block (which reads object-style `.error`)
 *      or the site is allowlisted with a reason.
 *
 * The check is heuristic on purpose (this repo has no jsdom; the behavioural
 * proof lives in the fault-injection E2E — see
 * workflow/CI/e2e/cases/2026-07-26-读路径静默失败-全局兜底与逐页错误显示.md).
 * 能红: remove <PageQueryErrors> from any wired page, or add a new page with a
 * data-only destructure, and this test names the file.
 */
// @ts-nocheck — vitest-only test file using Node built-ins. Same pragma
// rationale as shared/utils/no-raw-seat-email.test.ts.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = join(__dirname);

/**
 * Pages exempt from the fence, each with the reason it is safe. Additions
 * REQUIRE a reason — an entry without one is itself a fence failure.
 */
const ALLOWLIST: Record<string, string> = {
  // Dead routes — app/routes/user.tsx redirects these paths away; the files are
  // retained only as historical reference and never render.
  'my-keys': 'route redirects to /user/overview (user.tsx); page never renders',
  'pending-keys': 'route redirects to /user/overview (user.tsx); page never renders',
  'my-seats': 'route redirects to /user/account (user.tsx); page never renders',
};

function pageDirs(): string[] {
  return readdirSync(PAGES).filter((d) => {
    const p = join(PAGES, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'index.tsx'));
  });
}

describe('no silent query errors on user pages', () => {
  it('every allowlist entry has a reason', () => {
    for (const [k, v] of Object.entries(ALLOWLIST)) {
      expect(typeof v === 'string' && v.length > 10, `ALLOWLIST['${k}'] needs a real reason`).toBe(true);
    }
  });

  it('every query-bearing page surfaces its errors', () => {
    const offenders: string[] = [];
    for (const dir of pageDirs()) {
      if (ALLOWLIST[dir]) continue;
      const src = readFileSync(join(PAGES, dir, 'index.tsx'), 'utf8');
      if (!src.includes('useQuery(')) continue;

      const hasSurface =
        src.includes('PageQueryErrors') ||
        src.includes('ApiErrorDisplay') ||
        /\bisError\b/.test(src) ||
        /\berror\b\s*[:,}\)]/.test(src);
      if (!hasSurface) {
        offenders.push(`${dir}/index.tsx: calls useQuery but has no error surface (PageQueryErrors / ApiErrorDisplay / isError)`);
        continue;
      }

      // Destructure-and-drop detector: `const { data … } = useQuery` without
      // `error` on a page that has NO PageQueryErrors aggregate to catch it.
      if (!src.includes('PageQueryErrors')) {
        const drops = [...src.matchAll(/const\s*\{([^}]*)\}\s*=\s*useQuery/g)]
          .filter((m) => !/\berror\b|\bisError\b/i.test(m[1]));
        if (drops.length > 0) {
          offenders.push(`${dir}/index.tsx: ${drops.length} useQuery destructure(s) drop \`error\` and the page has no <PageQueryErrors> aggregate`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the fence itself sees pages (not passing vacuously)', () => {
    expect(pageDirs().length).toBeGreaterThan(10);
  });
});
