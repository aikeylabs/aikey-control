// @ts-nocheck — vitest-only test file using Node built-ins.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 🔴 Fence for the PageQueryErrors ↔ DataFetchErrorBanner hand-off (2026-08-22).
 *
 * PageQueryErrors now suppresses any error code the shell banner is already
 * showing, so one failure is drawn once instead of twice stacked. That is only
 * safe while the shell actually mounts the banner. If someone removes
 * `<DataFetchErrorBanner />` from UserShell, the suppression here stops being
 * a dedupe and becomes SILENCE — which is precisely the 2026-07-26 disease
 * (a dead backend rendering as "暂无数据") that both components exist to kill.
 *
 * Nothing else would catch that: the page still passes its errors, the fence in
 * pages/user/no-silent-query-errors.test.ts still sees <PageQueryErrors>, tsc is
 * happy, and the console just quietly stops reporting failed reads.
 *
 * 能红: delete the <DataFetchErrorBanner /> line from either UserShell, or drop
 * the cache lookup from PageQueryErrors.
 */
const SRC = resolve(process.cwd(), 'src');
const MASTER = resolve(process.cwd(), '../../aikey-control-master/web/src');

const read = (p: string) => readFileSync(p, 'utf-8');

describe('PageQueryErrors defers to the shell banner', () => {
  it('the suppression reads the shared query cache', () => {
    const src = read(resolve(SRC, 'shared/components/PageQueryErrors.tsx'));
    expect(src).toContain('queryClient.getQueryCache().getAll()');
    expect(src).toContain('.filter((e) => !shown.has(e.code))');
  });

  it('every shell that renders PageQueryErrors pages also mounts the banner', () => {
    for (const root of [SRC, MASTER]) {
      const shell = resolve(root, 'layouts/UserShell.tsx');
      if (!existsSync(shell)) continue;
      const src = read(shell);
      expect(src, `${shell}: banner no longer mounted — PageQueryErrors' suppression would turn into silence`).toContain('<DataFetchErrorBanner />');
    }
  });

  it('the banner keeps the contract the release probe depends on', () => {
    const src = read(resolve(SRC, 'shared/components/DataFetchErrorBanner.tsx'));
    // workflow/CI/scripts/data-error-banner-probe.mjs finds it by role and
    // regex-matches the error code out of the rendered text.
    expect(src).toContain('role="alert"');
    expect(src).toContain('{first.code}');
  });
});
