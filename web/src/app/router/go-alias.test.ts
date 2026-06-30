import { describe, it, expect } from 'vitest';
import { resolveStoreFromPathname, collapseLeadingSlashes, GO_TARGETS, FALLBACK } from './go-alias';

/**
 * Regression test for 2026-06-02 bugfix
 * "ak-web-token-wrong-store".
 *
 * The bug: `aikey web` opens `/go/<alias>#auth_token=<jwt>`. The old
 * fragment-ingest in main.tsx checked `pathname.startsWith('/user')` on
 * the intermediate `/go/*` path, wrote the user JWT to the master store,
 * and the user got kicked to /user/session-expired despite the token
 * being valid. Bug existed silently for 40 days because the contract
 * between go-alias.tsx (router redirect) and main.tsx (fragment ingest)
 * was implicit — encoded only in a comment.
 *
 * This file pins every row of the resolveStoreFromPathname decision
 * table. If anyone refactors GO_TARGETS, FALLBACK, or the alias
 * resolution and breaks the contract, these tests fail loudly.
 *
 * The "/go/<alias>" branch is tested against the LIVE GO_TARGETS table
 * (no fixture stubs) so a future alias addition can't silently regress
 * by routing user-destined aliases to master.
 */
describe('resolveStoreFromPathname', () => {
  it('/go/<known-user-alias> → user (canonical bug-repro case)', () => {
    expect(resolveStoreFromPathname('/go/overview')).toBe('user');
  });

  it('every alias currently in GO_TARGETS resolves to a known store', () => {
    // Defensive: if someone adds an alias that points at a path which
    // is neither /user/* nor /master/*, this catches it. Today every
    // entry points at /user/*, but the test is robust to future
    // /master/* additions — it just asserts the resolution is sane.
    for (const [alias, target] of Object.entries(GO_TARGETS)) {
      const store = resolveStoreFromPathname(`/go/${alias}`);
      const expected = target.startsWith('/user') ? 'user' : 'master';
      expect(store, `alias=${alias} target=${target}`).toBe(expected);
    }
  });

  it('case-insensitive alias lookup matches router behavior', () => {
    // GoAliasRedirect lowercases the param before lookup; main.tsx must
    // match so a CLI that sends `/go/Overview` (camel-cased, hypothetical)
    // ends up in the same store the router will redirect to.
    expect(resolveStoreFromPathname('/go/OVERVIEW')).toBe('user');
    expect(resolveStoreFromPathname('/go/Overview')).toBe('user');
  });

  it('/go/<unknown-alias> falls back to FALLBACK destination, NOT the literal /go/* pathname', () => {
    // Pre-fix unknown aliases ended up in master store because the
    // fallback was the original /go/<x> pathname which doesn't start
    // with /user. Post-fix they match the router's FALLBACK = /user/overview,
    // so the user store gets the token and the user lands on /user/overview
    // — which is exactly where the router would have sent them.
    expect(FALLBACK.startsWith('/user')).toBe(true);
    expect(resolveStoreFromPathname('/go/nonexistent-alias')).toBe('user');
    expect(resolveStoreFromPathname('/go/typo-here')).toBe('user');
  });

  it('/user/* path → user store (direct navigation, not via /go/)', () => {
    // Sanity: the non-/go/ path still works the way it always did. This
    // covers the case where a CLI emits a full /user/<page>#auth_token URL
    // directly (older binaries may still do this), and the case where the
    // SPA reloads itself on a /user/* path with a fragment.
    expect(resolveStoreFromPathname('/user/overview')).toBe('user');
    expect(resolveStoreFromPathname('/user/vault')).toBe('user');
    expect(resolveStoreFromPathname('/user/account')).toBe('user');
  });

  it('/master/* path → master store (admin direct login flow)', () => {
    // The admin login page receives its JWT through `POST /accounts/login`
    // (no URL fragment), but the contract still needs to hold for any
    // future /master/<x>#auth_token flow or hand-crafted recovery URL.
    expect(resolveStoreFromPathname('/master/login')).toBe('master');
    expect(resolveStoreFromPathname('/master/dashboard')).toBe('master');
    expect(resolveStoreFromPathname('/master/settings')).toBe('master');
  });

  it('paths outside /user/* and /master/* default to master', () => {
    // Edge: a fragment landing on /health, /version, /go-typo (no /go/
    // prefix), etc. Master is the conservative default — admins can
    // recover from a wrong store more easily than users (they have a
    // password flow), and these paths shouldn't carry JWTs in practice
    // anyway.
    expect(resolveStoreFromPathname('/health')).toBe('master');
    expect(resolveStoreFromPathname('/')).toBe('master');
    expect(resolveStoreFromPathname('/random-path')).toBe('master');
  });

  it('GO_TARGETS includes the canonical aliases the CLI sends today', () => {
    // Belt-and-braces: if someone deletes one of the aliases the CLI
    // emits via `aikey web <page>`, the cross-binary contract breaks.
    // This test pins the aliases that today's CLI uses (see
    // aikey-cli/src/commands_account/mod.rs web_page_alias).
    const cliAliases = ['overview', 'import', 'vault', 'account', 'usage'];
    for (const a of cliAliases) {
      expect(GO_TARGETS, `alias=${a}`).toHaveProperty(a);
      expect(resolveStoreFromPathname(`/go/${a}`)).toBe('user');
    }
  });
});

/**
 * Regression test for 2026-06-30 bugfix "ak-web-double-slash-securityerror".
 *
 * The bug: a control_url stored WITH a trailing slash made `aikey web` open
 * `http://host:3000//go/overview#auth_token=...`. The browser reads a leading
 * `//` as a PROTOCOL-RELATIVE URL (host `go`), so the fragment-ingest's
 * history.replaceState('//go/overview') threw a cross-origin SecurityError and
 * white-screened the whole SPA; resolveStoreFromPathname also missed `/go/`.
 * collapseLeadingSlashes is the defense-in-depth normalization (the CLI side is
 * fixed too). These pin that the leading run collapses while interior slashes
 * and the already-clean single-slash case are untouched.
 */
describe('collapseLeadingSlashes', () => {
  it('collapses a leading double slash to one (the crash repro)', () => {
    expect(collapseLeadingSlashes('//go/overview')).toBe('/go/overview');
  });

  it('collapses any leading run of slashes to one', () => {
    expect(collapseLeadingSlashes('///user/vault')).toBe('/user/vault');
  });

  it('leaves an already-clean path unchanged', () => {
    expect(collapseLeadingSlashes('/go/overview')).toBe('/go/overview');
  });

  it('leaves interior slashes intact (only the leading run is the hazard)', () => {
    expect(collapseLeadingSlashes('/go/a//b')).toBe('/go/a//b');
  });

  it('normalized output routes to the correct store again', () => {
    // The end-to-end point: after normalization the store decision works.
    expect(resolveStoreFromPathname(collapseLeadingSlashes('//go/overview'))).toBe('user');
  });
});
