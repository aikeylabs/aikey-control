// @ts-nocheck — vitest-only source-level integration fence.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGE = path.resolve(process.cwd(), 'src/pages/user/vault/index.tsx');
const source = fs.readFileSync(PAGE, 'utf-8');

describe('vault drawer live-record reconciliation', () => {
  it('does not close on one transient managed-key snapshot omission', () => {
    expect(source).toContain('const DRAWER_MISSING_GRACE_MS = 20_000;');
    expect(source).toContain('const missingKey = rowKey(drawerRecord);');
    expect(source).toContain('window.setTimeout(() => {');
    expect(source).toContain('rowKey(current) !== missingKey');
    expect(source).toContain('window.clearTimeout(timer)');
    expect(source).not.toMatch(/if \(!live\) \{\s*setDrawerRecord\(null\)/);
  });
});
