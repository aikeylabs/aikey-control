/**
 * Wire contract for the cross-app sidebar menu sync.
 *
 * Both Personal (this repo, public) and Team (aikey-control-master/web,
 * private) sidebars render a unified menu with both PERSONAL_* and TEAM_*
 * entries. Each side owns its own menu in source code, exposes it via
 * GET /system/cross-app-menu, and fetches the other side's menu at boot
 * to render cross-app entries as `<a href="${other_origin}${path}">`.
 *
 * Why HTTP fetch instead of build-time shared spec: the Team repo deploys
 * on admin's cadence (slow); a bundled snapshot of the Personal menu would
 * lag behind the Personal repo's actual iteration. Runtime fetch lets the
 * Team sidebar see the latest Personal menu as soon as A's local-server
 * is reachable, regardless of when B was last deployed.
 *
 * See: roadmap20260320/技术实现/update/20260510-personal-team-数据隔离与合并显示.md
 * 决策 4 (M scheme).
 */

/** Increment when adding required fields. Consumers tolerate higher
 * versions by ignoring unknown fields; only bump when removing fields
 * or changing semantics. */
export const CROSS_APP_MENU_SCHEMA_VERSION = 1;

/** Sidebar grouping. Both sides render the same group order; entries
 * within a group come from BOTH sides interleaved by the order they
 * appear in the entries array (no per-entry order field — array order
 * IS the order). */
export type CrossAppMenuGroup = 'KEYS' | 'INSIGHTS' | 'ACCOUNT' | 'QUALITY' | 'APPS';
// 'QUALITY' added 2026-05-21 for the degrade-detector Trust Check entry.
// 'APPS' added 2026-06-26: Apps split out of the INSIGHTS/Cost group into
// its own sidebar group. A header-less top-level item (like Overview) can't
// surface cross-app on the Team side (matchesGroup() returns false for a
// group with no title), so Apps needs its own group enum to bucket the
// cross-app entry on B. Older peers don't know APPS → matchesGroup() drops
// it; harmless graceful degradation (same pattern as QUALITY).
// Keep this union in sync with service/pkg/crossappmenu/types.go's
// Group constants — both sides must list the same set or matchesGroup()
// silently drops cross-app entries from unrecognised groups.

/** Visibility sentinel — string label only; each side maps to its own
 * runtime predicate. The sentinels are intentionally edition-aware:
 *
 *   `always`              — render unconditionally
 *   `team-logged-in`      — A side: render only when vault has team JWT;
 *                           B side: always (B IS the team origin)
 *   `local-server-online` — A side: always (A IS the local server);
 *                           B side: probe-then-render (favicon image probe)
 *
 * New sentinels MUST be added with mappings on both sides — verify via
 * the cross-app-menu lint (workflow/CI/Makefile cross-app-menu-check).
 */
export type CrossAppMenuVisibility =
  | 'always'
  | 'team-logged-in'
  | 'local-server-online';

export interface CrossAppMenuEntry {
  /** Stable cross-app ID. Used for active-state matching when one side
   * needs to highlight the entry whose path the user is currently on
   * (would require route → id reverse map; current sidebar render does
   * not need this but the field is part of the wire contract for
   * future-proofing). Must NOT change between releases for the same
   * logical entry — renaming a label is fine, changing the id breaks
   * cross-app active state.
   */
  id: string;

  /** Sidebar group bucket. Order within a group follows array order. */
  group: CrossAppMenuGroup;

  /** User-visible label. Today English-only; i18n hook is a follow-up. */
  label: string;

  /** Path component appended to the owning origin's base URL. Must start
   * with `/`. The path semantics are owned by the producing side — the
   * consumer treats it as opaque and just builds `${other_origin}${path}`. */
  path: string;

  /** Visibility predicate sentinel. See CrossAppMenuVisibility doc. */
  visibility: CrossAppMenuVisibility;

  /** Optional icon ID — must exist in the shared icon set both sides
   * understand. If absent, a default chevron icon is rendered. */
  icon?: string;
}

/** Server-side response envelope returned by GET /system/cross-app-menu.
 * Both Personal local-server (8090) and Team control-service (3000)
 * return this shape. */
export interface CrossAppMenuResponse {
  /** Wire schema version — see CROSS_APP_MENU_SCHEMA_VERSION. */
  schema_version: number;

  /** "personal" when served by the Personal side (local-server, 8090).
   * "team" when served by the Team side (control-service, 3000).
   * Used by clients to validate they fetched from the side they expected
   * (defends against URL misconfiguration). */
  source: 'personal' | 'team';

  /** RFC3339 UTC timestamp of when the response was generated. Used by
   * clients to track cache freshness and surface "stale by N hours" hints
   * if needed. */
  fetched_at: string;

  /** The menu entries owned by the responding side. Order is significant
   * within each group — render order follows array order. */
  entries: CrossAppMenuEntry[];
}
