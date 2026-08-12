// @ts-nocheck — source-level fence; production code does not need Node ambient types.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-08-11: a commit landed `src/shared/compliance/` in USER/web only and the
// trial build died with ENOENT on `@/shared/compliance/action-taken`.
//
// It was not a missing mirror. THREE vite configs resolve the same `@`:
//
//   user/web      →  @ = user/web/src                     (never a problem)
//   master/web    →  @ = master/web/src, with per-dir regex aliases that send
//                    user-only shared dirs back to user/web
//   trial/web     →  @ = MASTER_WEB_SRC, plus the same per-dir aliases
//
// The new dir's alias was added to master/web and NOT to the trial composer, so
// a user page bundled by trial resolved at master/web — which has no copy, and
// must not grow one (that is the dual-edit trap the alias block exists to
// close). tsc passed the whole time: master/web's tsconfig `paths` DID map the
// dir, so only the bundler ever saw the gap.
//
// RULE: every `@/shared/<dir>/*` alias in master/web's vite config must also be
// in the trial composer's, and every user-only shared dir must have one.
const REPO = path.resolve(process.cwd(), '..', '..');
const R = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf-8');

const MASTER_VITE = 'aikey-control-master/web/vite.config.ts';
const TRIAL_VITE = 'aikey-trial-server/web/vite.config.ts';
const MASTER_TSCONFIG = 'aikey-control-master/web/tsconfig.json';

/** The `@/shared/<dir>/` prefixes a vite config redirects to user/web. */
function aliasedSharedDirs(src: string): Set<string> {
  return new Set(
    [...src.matchAll(/\^@\\\/shared\\\/([a-z-]+(?:\\\/[a-z-]+)*)\\\//g)].map((m) =>
      m[1].replace(/\\\//g, '/'),
    ),
  );
}

describe('the three vite configs agree on user-only shared dirs', () => {
  it('keeps compliance vocabulary single-sourced from user/web', () => {
    const duplicate = path.join(
      REPO,
      'aikey-control-master/web/src/shared/compliance/entity-types.ts',
    );
    expect(
      fs.existsSync(duplicate),
      'entity-types.ts is owned by user/web and explicitly aliased by Master '
      + 'and Trial; a physical Master copy creates a second source of truth',
    ).toBe(false);
  });

  // 🔴 A dir that master/web redirects to user/web but that ALSO exists in
  // master/web is resolved differently by the two builds: the master SPA gets
  // user/web's copy (via the alias), the trial composer gets master/web's (its
  // bare `@`). Same import specifier, two files. That is only safe while the
  // two copies are identical — and as of 2026-08-11 two of them are NOT.
  //
  // Frozen as a ratchet rather than a hard failure: deciding which copy is
  // canonical is a real change with consumers on both sides, not something to
  // slip into a build fix. New divergence fails here immediately.
  const KNOWN_DIVERGENT: Record<string, string> = {
    'shared/types/team-vault.ts': 'pre-ratchet (2026-08-11) — master build uses user/web copy, trial uses master/web copy',
    'shared/usage/usage-time-zone.ts': 'pre-ratchet (2026-08-11) — same split resolution',
  };

  it('dual-resolved shared files stay byte-identical across the repos', () => {
    const userShared = path.join(REPO, 'aikey-control/web/src/shared');
    const masterShared = path.join(REPO, 'aikey-control-master/web/src/shared');
    const dirs = [...aliasedSharedDirs(R(MASTER_VITE))].filter((d) =>
      fs.existsSync(path.join(masterShared, d)),
    );
    const drifted: string[] = [];
    for (const d of dirs) {
      for (const f of fs.readdirSync(path.join(userShared, d))) {
        if (f.includes('.test.')) continue; // tests never reach a bundle
        const a = path.join(userShared, d, f);
        const b = path.join(masterShared, d, f);
        if (!fs.statSync(a).isFile() || !fs.existsSync(b)) continue;
        if (fs.readFileSync(a, 'utf-8') !== fs.readFileSync(b, 'utf-8')) {
          drifted.push(`shared/${d}/${f}`);
        }
      }
    }
    // Red-fence check: edit one copy of any dual-resolved file.
    const unexpected = drifted.filter((f) => !(f in KNOWN_DIVERGENT));
    expect(unexpected, 'these files are resolved from user/web by the master build and '
      + 'from master/web by the trial build, and the two copies now differ — the same '
      + 'import gives different behaviour per edition. Sync them, or make the dir '
      + 'single-sourced in every config').toEqual([]);
    // The ratchet turns one way: a fixed entry must be deleted from the list.
    const stale = Object.keys(KNOWN_DIVERGENT).filter((f) => !drifted.includes(f));
    expect(stale, 'KNOWN_DIVERGENT lists files that no longer differ — delete them so '
      + 'the list keeps meaning something').toEqual([]);
  });

  it('every user-only shared dir is aliased in BOTH configs', () => {
    // The authoritative question is not "do the two lists match" but "can a user
    // page's import be resolved". A dir that exists only in user/web needs an
    // alias in every config whose `@` points elsewhere.
    // Red-fence check: add a new src/shared/<dir>/ without touching aliases.
    const userShared = path.join(REPO, 'aikey-control/web/src/shared');
    const masterShared = path.join(REPO, 'aikey-control-master/web/src/shared');
    const userOnly = fs
      .readdirSync(userShared, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !fs.existsSync(path.join(masterShared, e.name)))
      .map((e) => e.name);

    const master = aliasedSharedDirs(R(MASTER_VITE));
    const trial = aliasedSharedDirs(R(TRIAL_VITE));
    const gaps = userOnly.flatMap((d) => {
      const out: string[] = [];
      if (![...master].some((a) => a === d || a.startsWith(`${d}/`))) out.push(`master/web: @/shared/${d}`);
      if (![...trial].some((a) => a === d || a.startsWith(`${d}/`))) out.push(`trial/web: @/shared/${d}`);
      return out;
    });
    expect(gaps, 'a shared dir exists only in user/web and is not aliased everywhere '
      + 'that bundles user pages — the import will resolve at master/web and fail').toEqual([]);
  });

  it('tsconfig paths and vite aliases cover the same dirs', () => {
    // 🔴 The two lists drifting is what let this ship: tsconfig mapped the dir
    // (so tsc was green) while vite did not (so only the build knew).
    // Red-fence check: add a tsconfig path without the matching Vite alias.
    const ts = R(MASTER_TSCONFIG);
    const tsDirs = new Set(
      [...ts.matchAll(/"@\/shared\/([a-z/-]+)\/\*"/g)].map((m) => m[1]),
    );
    const vite = aliasedSharedDirs(R(MASTER_VITE));
    const onlyInTsconfig = [...tsDirs].filter((d) => !vite.has(d));
    expect(onlyInTsconfig, `master/web tsconfig maps @/shared/${onlyInTsconfig.join(', ')} `
      + 'but vite does not alias it. Types resolve, the bundle does not — the failure '
      + 'shows up only at build time, in whichever edition builds last').toEqual([]);
  });
});
