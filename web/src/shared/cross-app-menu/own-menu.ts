/**
 * The Personal side's own sidebar menu — the source of truth for what
 * pages this app exposes to cross-app navigation.
 *
 * This array is:
 *   - Bundled into A's web SPA → rendered directly in A's sidebar
 *   - Returned by A's local-server at GET /system/cross-app-menu →
 *     fetched by B at runtime so B's sidebar can show Personal entries
 *
 * Adding a new entry: add an entry here AND ensure the corresponding
 * route exists in src/app/router/ (lint cross-app-menu-check verifies).
 *
 * See: ../types.ts for field semantics.
 */

import type { CrossAppMenuEntry } from './types';

export const OWN_PERSONAL_MENU: CrossAppMenuEntry[] = [
  // Phase 3B R11 (2026-05-11): labels match A's own sidebar exactly
  // (Vault / Import / Usage / Profile — no "Personal " prefix). When
  // B fetches this menu via cross-app, B's sidebar renders the entries
  // with these labels, so the user sees consistent naming whether
  // they're on A directly or looking at B's cross-app section. The
  // "Personal " prefix was redundant: on A the entries don't need
  // disambiguation (they ARE the personal-side menu) and on B the
  // cross-origin link href makes it obvious this is "the other side".
  // Spec: requirements/2026-05-11-aikey-web-local-first-team-merge.md R11.
  {
    id: 'personal-vault',
    group: 'KEYS',
    label: 'Vault',
    path: '/user/vault',
    visibility: 'always',
    icon: 'vault',
  },
  // 'personal-import' removed 2026-06-26: Import is no longer a standalone
  // sidebar destination — it sank into the Vault page as an action button
  // (导入下沉). The /user/import route still exists; the Vault page links to
  // it. Dropping the cross-app entry keeps the Team side from rendering a
  // stray standalone "Import" row. Must stay in sync with personal_menu.go.

  // INSIGHTS group
  {
    id: 'personal-usage',
    group: 'INSIGHTS',
    label: 'Usage',
    path: '/user/usage-ledger',
    visibility: 'always',
    icon: 'chart',
  },
  // Phase 3B R15 (2026-05-11): Cost added so B side can render a
  // cross-app link to A's local /user/performance page (B has no
  // /user/performance route — A is the canonical owner). Without
  // this entry, the Performance item (personalOnly) was filtered
  // on B with no cross-app match and silently disappeared.
  // 2026-05-21: label renamed Cost → Performance, URL renamed
  // /user/cost → /user/performance. Trailer ID kept as
  // 'personal-cost' so existing A↔B menu reconciliation still
  // matches across already-deployed peers.
  {
    id: 'personal-cost',
    group: 'INSIGHTS',
    label: 'Performance',
    path: '/user/performance',
    visibility: 'always',
    icon: 'cost',
  },
  // Phase 4 阶段 3 (2026-05-21): Apps — surface A's local Connected
  // Apps list to B's sidebar. /api/user/apps/* lives on A's
  // local-server; B has no own /user/apps route.
  // 2026-06-26: Apps moved from INSIGHTS to its own APPS group (split out
  // of the Cost group into a standalone sidebar group). Must match
  // personal_menu.go's GroupApps and the new 'Apps' navGroup in UserShell.
  {
    id: 'personal-apps',
    group: 'APPS',
    label: 'Apps',
    path: '/user/apps',
    visibility: 'always',
    icon: 'apps',
  },
  // M5 (2026-05-21): degrade-detector Trust Check. Belongs to the
  // QUALITY group (added 2026-05-21 in types.ts). Peers on older
  // binaries don't know QUALITY → matchesGroup() drops the entry
  // silently; safe degradation.
  {
    id: 'personal-trust-check',
    group: 'QUALITY',
    label: 'Trust Check',
    path: '/user/trust-check',
    visibility: 'always',
    icon: 'trust-check',
  },
  // Phase 3 (2026-06-03): Compliance Audit. Belongs to QUALITY alongside
  // Trust Check — both surface "did anything detected go wrong with my
  // local AI traffic". /api/user/compliance/events lives on A's
  // local-server (reads control.db); team server has no such endpoint
  // by design (original prompt text must never leave the user's
  // machine). With this trailer entry, B's sidebar surfaces "Compliance
  // Audit" pointing at the user's local-server (8090) where the page
  // actually works. Same pattern as Trust Check.
  {
    id: 'personal-compliance',
    group: 'QUALITY',
    label: 'Compliance Audit',
    path: '/user/compliance',
    visibility: 'always',
    icon: 'compliance',
  },

  // C11 (2026-06-30): pool account sign-in — sign in to the team account the
  // allocation engine routes you to, with your used-account history. Local page
  // (8090) that relays sign-in to the local proxy broker + reads master via the
  // team-fetch two-hop. visibility 'always' (the page shows a "not signed in to
  // team" notice for Personal-only users, like Compliance Audit).
  {
    id: 'personal-oauth-contribute',
    group: 'KEYS',
    label: 'Team OAuth',
    path: '/user/team-oauth',
    visibility: 'always',
    icon: 'oauth-contribute',
  },

  // Phase 3B R16 (2026-05-11): Account intentionally NOT exposed via
  // cross-app. Both A and B have a local /user/account route showing
  // side-relevant data (A = personal vault account; B = team
  // membership). Each side renders its own Account NavLink locally —
  // exposing the other side as cross-app would surface a duplicate
  // "Account" trailer in the same group, plus a meaningless link
  // (clicking on B-side Account on A would show team-server account
  // details that aren't useful in personal context).
  // Spec: requirements/2026-05-11-aikey-web-local-first-team-merge.md R16.

  // Phase 4F invites (2026-05-30): expose Invites via cross-app so the
  // Team SPA sidebar can also show the entry. Master/web's local
  // Invites navGroups item is personalOnly (the /local-api endpoints
  // it calls need installer_id from the user's machine — only present
  // on a Personal install). With this trailer entry, the master
  // navGroups Invites slot finds a path-matching cross-app entry and
  // renders it pointing at the user's local-server (8090) where the
  // page actually works. Same pattern as Vault / Import.
  {
    id: 'personal-invites',
    group: 'ACCOUNT',
    label: 'Invites',
    path: '/user/invites',
    visibility: 'always',
    icon: 'invite',
  },
];
