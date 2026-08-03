import type { Plugin } from 'vite';

/**
 * Marks the entry module script `blocking="render"` in the built index.html.
 *
 * ## Why (2026-07-26, measured)
 *
 * Crossing the Personal↔team boundary of the composing gateway (e.g.
 * /user/usage-ledger → /user/team-usage-ledger) is a FULL DOCUMENT navigation:
 * the two sides are separate bundles behind one origin. index.css opts both into
 * `@view-transition { navigation: auto }`, and a cross-document view transition
 * holds the outgoing page until the incoming document's FIRST RENDER.
 *
 * That is the whole problem: for a client-rendered SPA the first render is an
 * empty `<div id="root">`, because `<script type="module">` is deferred. So the
 * transition faithfully revealed a blank page and the console flashed — reported
 * as "菜单闪 / 整个页面闪".
 *
 * `blocking="render"` makes the browser withhold that first render until the
 * entry script has executed. Paired with a synchronous initial mount
 * (`flushSync` in main.tsx) the first render already contains the shell, so the
 * transition swaps between two drawn pages.
 *
 * ## Why a plugin rather than the attribute in index.html
 *
 * Vite rewrites the entry `<script>` when it emits the bundle and drops unknown
 * attributes — putting `blocking="render"` in the source index.html survives dev
 * but is silently lost in the build, which is the worst kind of bug: it works
 * when you test it locally with `vite dev` and not in anything you ship.
 *
 * ## Measured effect (CDP screencast, local→team crossing, Chrome 150)
 *
 *   baseline                      2 blank frames, ~71ms of solid background
 *   blocking=render only          1 blank frame,  ~16ms
 *   blocking=render + flushSync   0 blank frames  (reproduced 3×)
 *   reverted to baseline          2 blank frames, ~55ms  ← causality both ways
 *
 * ## Cost
 *
 * First paint is withheld until the entry bundle executes on EVERY load, not
 * just boundary crossings. On a cross-document navigation that is strictly
 * better (the outgoing page stays up instead of blanking). On a cold load it
 * trades a slightly later first paint for not showing an empty shell. Revisit if
 * the entry bundle grows substantially.
 */
export function renderBlockingEntry(): Plugin {
  let applied = false;
  // A failed build never reaches transformIndexHtml, so without this the
  // assertion below fires on EVERY failure and replaces the real error with a
  // misleading one about a missing attribute (2026-08-01: it masked a
  // `Could not load .../account-decisions` module-resolution failure in the
  // Trial composer, and the reported cause was nowhere near the actual one).
  let buildFailed = false;
  return {
    name: 'aikey:render-blocking-entry',
    apply: 'build',
    buildEnd(err) {
      buildFailed = Boolean(err);
    },
    transformIndexHtml: {
      order: 'post', // after Vite has rewritten the entry to the hashed asset
      handler(html) {
        const out = html.replace(
          /<script(\s+type="module")/g,
          '<script$1 blocking="render"',
        );
        applied = out !== html;
        return out;
      },
    },
    closeBundle() {
      // Fail loudly rather than silently shipping the flash back: if Vite ever
      // changes how it emits the entry tag, this plugin becomes a no-op and the
      // only symptom would be a UI regression nobody connects to a build change.
      if (!applied && !buildFailed) {
        this.error(
          'aikey:render-blocking-entry did not match the entry <script type="module"> in index.html. ' +
            'The cross-document view-transition fix depends on that attribute — see this plugin\'s doc comment.',
        );
      }
    },
  };
}
