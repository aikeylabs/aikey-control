// @ts-nocheck — vitest-only file using Node built-ins (fs/path/process.cwd);
// the project doesn't ship @types/node, so the project-wide `tsc --noEmit`
// would reject these imports. vitest runs it fine.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Error-envelope field-name fence (2026-07-12 bugfix).
 *
 * Bug: the Vault "Test connection" popup showed, for a TEAM key:
 *     检测无法运行 / "Request failed with status code 404" / no next step.
 *
 * Root cause: THERE ARE TWO ERROR ENVELOPES IN THIS SYSTEM.
 *   - aikey-local-server (userapi): {status, error_code, error_message}
 *     — see service/pkg/userapi/cli/errors.go `JSONError`, and the
 *       ErrEnvelope type in shared/api/user/vault.ts.
 *   - master / team API:            {error, message}
 *     — see shared/api/team/team-fetch.ts `teamPostJSON`.
 *
 * The probe hits a LOCAL-server endpoint (POST /api/user/vault/test), but the
 * catch handler read `data.error` / `data.message` — the MASTER shape. Those
 * are always undefined here, so `code` fell back to axios's transport code
 * (ERR_BAD_REQUEST for any non-2xx) and EVERY I_* branch in friendlyTestError
 * was dead for HTTP-error responses: a team key's I_CREDENTIAL_NOT_FOUND 404
 * (the only code mapped to 404 in userapi/cli/write.go) rendered as a bare
 * axios sentence with no remediation, even though friendlyTestError has had a
 * "Key not found" branch all along.
 *
 * Note the earlier 2026-06-26 fix *claimed* to prefer the backend code — it
 * read the wrong field names, so it never took effect. This fence pins the
 * field names themselves so the same silent no-op can't come back.
 */

const PAGE = path.resolve(process.cwd(), 'src/pages/user/vault/index.tsx');
const ENVELOPE_TYPE = path.resolve(process.cwd(), 'src/shared/api/user/vault.ts');

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

/** The `setTestError({...})` call inside the probe's .catch handler. */
function probeCatchAssignment(src: string): string {
  const m = src.match(/setTestError\(\{[\s\S]*?\}\);/);
  return m ? m[0] : '';
}

describe('vault probe reads the LOCAL-server error envelope', () => {
  const page = read(PAGE);
  const assignment = probeCatchAssignment(page);

  it('finds the probe catch assignment (guards regex rot)', () => {
    expect(assignment).not.toBe('');
    expect(assignment).toMatch(/httpStatus/);
  });

  it('reads error_code / error_message, not the master API shape', () => {
    // The load-bearing assertion: without these, every I_* branch is dead.
    expect(assignment, 'must read local envelope `error_code`').toMatch(/data\?\.error_code/);
    expect(assignment, 'must read local envelope `error_message`').toMatch(/data\?\.error_message/);
  });

  it('prefers the backend code over the axios transport code', () => {
    // `code: data?.error_code ?? ... ?? err.code` — the backend code must be
    // consulted BEFORE err.code, else ERR_BAD_REQUEST wins and masks it.
    const codeLine = assignment.match(/code:\s*([^,]+),/)?.[1] ?? '';
    const backendIdx = codeLine.indexOf('error_code');
    const axiosIdx = codeLine.indexOf('err.code');
    expect(backendIdx, 'error_code must appear in the code expression').toBeGreaterThanOrEqual(0);
    expect(axiosIdx, 'err.code must remain as the last-resort fallback').toBeGreaterThan(backendIdx);
  });

  it('the ErrEnvelope type it must match still declares error_code/error_message', () => {
    // If the backend envelope is ever renamed, this fails alongside the page —
    // making the coupling explicit instead of silently drifting apart again.
    const env = read(ENVELOPE_TYPE);
    const m = env.match(/interface ErrEnvelope \{([\s\S]*?)\}/);
    expect(m, 'ErrEnvelope not found').toBeTruthy();
    expect(m[1]).toMatch(/error_code:\s*string/);
    expect(m[1]).toMatch(/error_message:\s*string/);
  });
});
