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
  {
    id: 'personal-import',
    group: 'KEYS',
    label: 'Import',
    path: '/user/import',
    visibility: 'always',
    icon: 'import',
  },

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
  // cross-app link to A's local /user/cost page (B has no /user/cost
  // route — A is the canonical owner). Without this entry, navGroups
  // Cost (personalOnly) was filtered on B with no cross-app match,
  // making the Cost item silently disappear on B's sidebar.
  {
    id: 'personal-cost',
    group: 'INSIGHTS',
    label: 'Cost',
    path: '/user/cost',
    visibility: 'always',
    icon: 'cost',
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
];
