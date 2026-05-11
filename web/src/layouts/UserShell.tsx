import React from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useUserAuthStore } from '@/store';
import { userAccountsApi } from '@/shared/api/user/accounts';
import {
  OWN_MENU,
  OWN_PERSONAL_MENU,
  readOtherMenu,
  refreshOtherMenu,
  isOtherMenuStale,
  isVisibleEntry,
  useVisibilityState,
  getOtherBaseUrl,
  refreshOtherBaseUrl,
  type CrossAppMenuEntry,
  type CrossAppMenuGroup,
} from '@/shared/cross-app-menu';

/**
 * Phase 3B R7 (2026-05-11): runtime detection of which side this UserShell
 * is rendering on. UserShell.tsx is byte-identical between user/web and
 * master/web (dual-edit invariant), so we can't compile-time-branch — but
 * the cross-app-menu module exports a side-specific OWN_MENU. On A side
 * OWN_MENU === OWN_PERSONAL_MENU (reference equality holds because both
 * are imported from the same module); on B side OWN_MENU is OWN_TEAM_MENU
 * (the module's `OWN_MENU` alias points at OWN_TEAM_MENU on B).
 *
 * Used to filter navGroups entries:
 *   - personalOnly entries render only on A (e.g. Vault, Import, Cost —
 *     B doesn't have these routes / data sources)
 *   - teamOnly entries render only on B (e.g. Team Keys — the team-keys
 *     page is the canonical page on B; A had a stub that's now removed)
 *   - Untagged entries render on both (Overview, Usage, Profile/Account)
 *
 * Spec: requirements/2026-05-11-aikey-web-local-first-team-merge.md R7.
 */
const IS_PERSONAL_SIDE = OWN_MENU === OWN_PERSONAL_MENU;

// ── Nav icons ────────────────────────────────────────────────────────────────
//
// Shared scaffold + per-icon path constants. Refactored 2026-04-22 to
// eliminate five near-identical `<svg className="w-4 h-4" fill="none"
// stroke="currentColor" ...>` blocks. The container attrs (size, stroke,
// viewBox) live in `NavIcon` so any global tweak (e.g. stroke weight
// change) happens in one place; individual named components remain so
// usage sites stay readable (`<OverviewIcon />` vs a less-informative
// `<NavIcon d={ICON_OVERVIEW} />`).
//
// Conventions for new icons:
//   - Prefer heroicons v2 outline paths — they're tuned for
//     `strokeWidth=1.8` and cover the full 3→21 range inside the 24×24
//     viewBox, which keeps sidebar icons visually balanced.
//   - If a glyph only covers part of the canvas, it will look smaller
//     than its siblings. See the 2026-04-22 UploadCloud→ArrowDownTray
//     swap for the precedent + rationale.
function NavIcon({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// lucide "key" (outline) — matches user_vault_3_1.html. Previously we
// used heroicons v2 "key" whose silhouette is noticeably different
// (modern stylised ring + shaft); the user console's main content uses
// lucide via `<i data-lucide="key">`, so aligning the sidebar glyph on
// the same geometry stops the Team Keys entry from looking like a
// stranger. Compound path combines the ring (circle → arc) + the
// bitting strokes that lucide ships as 3 SVG nodes.
const ICON_KEY =
  'M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z';

// lucide "layout-dashboard" (outline) — matches user_vault_3_1.html
// template so /user/overview's sidebar glyph reads the same on both
// user console pages. Swapped from heroicons "squares-2x2" 2026-04-23.
const ICON_OVERVIEW =
  'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z';

// lucide "user" (outline) — matches user_vault_3_1.html. Compound
// path: head circle + shoulders arc (lucide ships these as <circle> +
// <path> nodes; collapsed into one `d` so the NavIcon wrapper doesn't
// need to support multi-shape icons).
const ICON_USER =
  'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z';

// lucide "bar-chart-3" (outline) — matches template. Replaces the
// heroicons "receipt-percent" we used before so the Usage entry's
// glyph reads "charts/metrics" instead of "receipt/tax", which
// better describes the page content (usage ledger + bar charts).
const ICON_RECEIPT =
  'M3 3v18h18M7 16v-4M12 16V8M17 16v-6';

// lucide "circle-dollar-sign" (outline) — Cost / token-spend page glyph.
// Picked over a generic dollar sign because the bounded circle reads as
// "individual transaction unit" rather than monetary total, matching
// the page's "per-key cost breakdown" content.
const ICON_DOLLAR =
  'M12 2a10 10 0 100 20 10 10 0 000-20zM8 14.5c.5 1.5 2 2.5 4 2.5s4-1 4-2.5-1-2-3-2.5l-2-.5c-2-.5-3-1-3-2.5s2-2.5 4-2.5 3.5 1 4 2.5M12 6v12';

// lucide "download" (outline) — matches template. Previously was
// heroicons "arrow-down-tray" (very similar glyph) but we align on
// lucide's version so stroke terminations match the other lucide
// icons rendered in the main content area (import page uses lucide
// natively via <i data-lucide="download">).
const ICON_UPLOAD_CLOUD =
  'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3';

// lucide "shield" (outline, no check) — matches user_vault_3_1.html.
// Earlier we used heroicons "shield-check" which has an additional
// checkmark stroke inside the shield; the template uses the plain
// shield so we swap to match. Pairs with the key icon (Team Keys)
// to distinguish vault-browsing destinations.
const ICON_SHIELD =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';

// heroicons v2 "user-plus" (outline) — header "Invite" button.
const ICON_USER_PLUS =
  'M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z';

// Named thin wrappers — keeps call sites self-documenting and gives
// elements a stable identity for tests / `data-origin-name`-style tooling.
function KeyIcon({ className }: { className?: string } = {}) {
  return <NavIcon d={ICON_KEY} className={className} />;
}
function OverviewIcon()    { return <NavIcon d={ICON_OVERVIEW} />; }
function UserIcon()        { return <NavIcon d={ICON_USER} />; }
function ReceiptIcon()     { return <NavIcon d={ICON_RECEIPT} />; }
function DollarIcon()      { return <NavIcon d={ICON_DOLLAR} />; }
function UploadCloudIcon() { return <NavIcon d={ICON_UPLOAD_CLOUD} />; }
function UserPlusIcon()    { return <NavIcon d={ICON_USER_PLUS} />; }
function ShieldIcon()      { return <NavIcon d={ICON_SHIELD} />; }

// Phase 3B R17 (2026-05-11): Team Usage glyph — bar chart at the
// bottom + two small head circles above, to read as "team's
// chart/metrics" in one mark. Personal Usage uses plain ReceiptIcon
// (bar-chart-3); Team Usage needed a different glyph so the two
// Insights rows (Usage + Team Usage) on the same sidebar group don't
// look identical. Multi-shape SVG so we inline the markup instead of
// reusing the NavIcon single-path scaffold.
function TeamUsageIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <circle cx="8" cy="5" r="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="5" r="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 21h17M7 21v-6M12 21v-9M17 21v-4"
      />
    </svg>
  );
}

/**
 * Phase 3B R8 (2026-05-11): map a cross-app-menu entry's `icon` string
 * (semantic name from the wire contract) to one of the existing NavIcon
 * components. Keeps cross-app links visually consistent with the local
 * navGroups items rather than rendering a generic external-link glyph.
 *
 * Known icon names (CrossAppMenuEntry.icon):
 *   - 'vault'        → ShieldIcon (matches local Vault entry)
 *   - 'import'       → UploadCloudIcon (matches local Import entry)
 *   - 'team'         → KeyIcon (matches local Team Keys entry)
 *   - 'chart'        → ReceiptIcon (matches local Usage entry — A's
 *                       Personal Usage cross-app rendering on B)
 *   - 'team-chart'   → TeamUsageIcon (R17 — B's Team Usage cross-app
 *                       rendering on A; differentiated from local
 *                       Usage's plain bar-chart so the two Insights
 *                       rows don't look identical)
 *   - 'cost'         → DollarIcon (R15 — A's Cost cross-app rendering
 *                       on B; B has no /user/cost route, A is canonical)
 *   - 'user'         → UserIcon (legacy, no longer emitted by any
 *                       cross-app menu after R16 dropped Account
 *                       cross-app — kept for backward-compat with
 *                       cached/fallback menu snapshots)
 *   - 'team-account' → UserIcon (legacy, see 'user' note)
 *
 * Unknown / future icon names fall back to a small generic dot so the
 * link still renders rather than crashing on schema drift.
 */
function crossAppIconFor(iconName: string | undefined): React.ReactNode {
  switch (iconName) {
    case 'vault':        return <ShieldIcon />;
    case 'import':       return <UploadCloudIcon />;
    case 'team':         return <KeyIcon />;
    case 'chart':        return <ReceiptIcon />;
    case 'team-chart':   return <TeamUsageIcon />;
    case 'cost':         return <DollarIcon />;
    case 'user':
    case 'team-account': return <UserIcon />;
    default:
      // Forward-compat fallback: render a small dim dot rather than nothing,
      // so the entry still feels visually present even if the schema added
      // a new icon name we don't yet map.
      return (
        <span
          aria-hidden="true"
          className="w-4 h-4 flex-shrink-0 inline-flex items-center justify-center"
        >
          <span
            style={{
              width: 4, height: 4, borderRadius: '999px',
              background: 'currentColor', opacity: 0.5,
            }}
          />
        </span>
      );
  }
}

// ── Route labels ────────────────────────────────────────────────────────────
//
// `originName` records the PREVIOUS user-facing display name for any route
// that was renamed. Rendered as `data-origin-name="..."` on the element so
// operators / designers / e2e scripts can still grep the DOM by the old
// label and find the element. See 2026-04-22 rename session:
// - "My Account"    → "Profile"
// - "Virtual Keys"  → "Team Keys"
// - "Usage Ledger"  → "Usage"
// - "Bulk Import"   → "Quick Import" → "Import"  (origin = oldest display)
type RouteMeta = { label: string; originName?: string };

const ROUTE_LABELS: Record<string, RouteMeta> = {
  overview:       { label: 'Overview' },
  // Phase 3B R16 (2026-05-11): "Profile" → "Account" so the breadcrumb
  // matches the sidebar entry label. `originName` chain: "My Account"
  // (original) → "Profile" (renamed 2026-04-22) → "Account" (current).
  // We keep the earliest origin in `originName` so the longest-running
  // DOM selectors still resolve; the intermediate "Profile" gets
  // dropped since the rename arc <1 month doesn't have entrenched
  // selectors yet.
  account:        { label: 'Account',    originName: 'My Account' },
  'virtual-keys': { label: 'Team Keys',  originName: 'Virtual Keys' },
  vault:          { label: 'Vault',      originName: 'My Vault' },
  'usage-ledger': { label: 'Usage',      originName: 'Usage Ledger' },
  import:         { label: 'Import',     originName: 'Bulk Import' },
};

function useBreadcrumb(): RouteMeta {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return ROUTE_LABELS[last] ?? { label: last };
}

function initials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

// Sidebar collapse persistence key — bumping the `:v1` suffix lets us
// invalidate old saved state if the sidebar contract changes.
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'aikey:sidebar-collapsed:v1';

// ── UserShell ───────────────────────────────────────────────────────────────

export function UserShell() {
  const user = useUserAuthStore((s) => s.user);
  // Pull the same /accounts/me query the Profile page uses so the
  // sidebar identity (email + role) stays in lockstep with the Profile
  // Identity & Session card. In local-bypass / personal-edition mode
  // the server returns `local@localhost`; in JWT mode it returns the
  // authenticated user. The zustand store is a secondary fallback for
  // the first paint before the query resolves.
  const meQuery = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });
  const identityEmail = meQuery.data?.email ?? user?.email;
  const identityRole = meQuery.data?.role ?? user?.role;
  const clearAuth = useUserAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const breadcrumb = useBreadcrumb();
  /* Single brand label shared with `runtimeConfig.branding.logoText`
     (defaults to "AiKey", server may override). Renamed from
     "AiKey Vault" → "AiKey" 2026-04-22 to match the unified product
     branding. Hardcoded here rather than read from runtimeConfig so the
     user shell renders synchronously even if window.__AIKEY_CONFIG__
     hasn't loaded yet. */
  const logoText = 'AiKey';

  // ── Sidebar collapse state ─────────────────────────────────────────
  //
  // Ported from .superdesign/design_iterations/user_vault_3_1.html's
  // rail-mode sidebar. Width transitions between 240px (expanded) and
  // 64px (collapsed); labels fade out before the width animation so
  // text doesn't squash on the way out. State is persisted to
  // localStorage so the preference survives page reloads.
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage may be unavailable (private mode, embedded frames) —
      // that's fine, the in-memory state still works for this session.
    }
  }, [collapsed]);

  // Keyboard shortcut: ⌘\ on macOS, Ctrl\ elsewhere. Skip while a text
  // input is focused so backslash remains typeable in search / alias
  // / base_url fields.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function isActive(path: string) {
    return pathname === path || pathname.startsWith(path + '/');
  }

  // ── Cross-app menu (M scheme) ──
  // Render OPPOSITE side's sidebar entries inline as cross-origin links.
  // On A (Personal): shows Team entries pointing at the team server URL.
  // On B (Team): shows Personal entries pointing at the user's local-server.
  // Synchronous initial read = cache-or-fallback (zero render delay);
  // async refresh in mount effect updates next tick.
  // See roadmap update 20260510-personal-team-数据隔离与合并显示.md decision 4.
  const [otherMenu, setOtherMenu] = React.useState<CrossAppMenuEntry[]>(() => readOtherMenu());
  const [otherBaseUrl, setOtherBaseUrlState] = React.useState<string | null>(() => getOtherBaseUrl());
  const visState = useVisibilityState();

  // Phase 3B R21 (2026-05-11): single-binary composed detection.
  //
  // When otherBaseUrl resolves to the SAME origin as the current window,
  // the bundle is a trial-edition single-binary (aikey-full-trial) that
  // composes /user/* + /master/* on one server. There's no "other side"
  // to cross-fetch to — clicking a cross-app link would just loop back
  // here.
  //
  // In that mode we override the R7 personalOnly/teamOnly side-filter
  // for the sidebar:
  //   - Treat every navGroups item as sideAllowed (render local NavLink)
  //   - Dedupe items by path (Usage + Team Usage both target
  //     /user/usage-ledger; first-wins shows one row, not two pointing
  //     at the same page)
  //   - Suppress all cross-app trailer entries (they'd be loopback-fake)
  //
  // Production setup (personal local-server :8090 + docker team :3000)
  // is unaffected — different origins, isSingleBinaryComposed=false,
  // R7 filter and cross-app rendering work as before.
  const isSingleBinaryComposed = React.useMemo(() => {
    if (!otherBaseUrl) return false;
    try {
      return new URL(otherBaseUrl).origin === window.location.origin;
    } catch {
      return false;
    }
  }, [otherBaseUrl]);

  // Two-stage discovery (run together):
  //   1. Refresh other-base-url from local-server endpoint (A side only —
  //      reads CLI vault). If discovered + different from cached, update
  //      state which re-triggers menu refresh.
  //   2. Refresh the other-side menu from the (possibly newly-discovered)
  //      base URL.
  // Both are background fetches; the UI renders cache/fallback immediately
  // and patches in fresh data when network resolves.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const discovered = await refreshOtherBaseUrl();
      if (cancelled) return;
      const effectiveUrl = discovered ?? otherBaseUrl;
      if (discovered && discovered !== otherBaseUrl) {
        setOtherBaseUrlState(discovered);
      }
      if (!effectiveUrl) return;
      if (!isOtherMenuStale()) return;
      const freshMenu = await refreshOtherMenu(effectiveUrl);
      if (cancelled) return;
      if (freshMenu) setOtherMenu(freshMenu);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only fetch — re-running on otherBaseUrl change would loop
    // when refresh updates the state; the cancelled flag handles
    // unmount. localStorage updates take effect on next route mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Map cross-app Group enum (KEYS/INSIGHTS/ACCOUNT) to existing
   * sidebar group title casing ("Keys"/"Insights"/"Account"). */
  function matchesGroup(crossAppGroup: CrossAppMenuGroup, navGroupTitle: string | undefined): boolean {
    if (!navGroupTitle) return false;
    return navGroupTitle.toUpperCase() === crossAppGroup;
  }

  // Nav layout — grouped navigation (2026-04-23). Overview stays at the
  // top without a header as the landing / default route. The remaining
  // destinations are bucketed into 3 functional groups with divider +
  // uppercase-mono header, matching the established sidebar pattern in
  // the design mocks:
  //
  //   Overview
  //   ──────────
  //   KEYS:      Import · Vault · Team Keys
  //   ──────────
  //   INSIGHTS:  Usage
  //   ──────────
  //   ACCOUNT:   Profile
  //
  // `originName` preserves the prior label so data-origin-name in the
  // DOM still matches older selectors / test scripts.
  type NavItem = {
    path: string;
    icon: React.ReactNode;
    label: string;
    originName?: string;
    /** Phase 3B R7: only render on A (Personal) side. B's sidebar gets
     *  the equivalent via cross-app fetch from A's OWN_PERSONAL_MENU. */
    personalOnly?: boolean;
    /** Phase 3B R7: only render on B (Team) side. A's sidebar gets the
     *  equivalent via cross-app fetch from B's OWN_TEAM_MENU. */
    teamOnly?: boolean;
    /** Phase 3B R11: side-specific label for entries that exist on both
     *  sides under different concepts. Example: `Usage` on A means
     *  personal usage; on B the same label slot means `Team Usage`. The
     *  base `label` field is the A-side display; if `teamSideLabel` is
     *  set, B-side render swaps to it. */
    teamSideLabel?: string;
    /** Phase 3B R11: on B side, render this entry as a cross-origin
     *  link to A's local-server (otherBaseUrl) instead of a local
     *  NavLink. Used for `Overview` so B's Overview button takes the
     *  user back to their personal dashboard rather than B's own. */
    teamSideCrossApp?: boolean;
    /** Phase 3B R22 (revised 2026-05-11): on A side, **prefer**
     *  cross-app rendering when a matching cross-app menu entry
     *  exists (i.e. user is logged into the team server via
     *  `aikey login`). Falls back to local NavLink when no match
     *  (user logged out or pre-login). Used by Account so:
     *    - logged in → clicking Account jumps to team server's
     *      /user/account (real account data)
     *    - logged out → clicking Account stays on Personal local
     *      /user/account (stub local-owner)
     *  B side ignores this flag (B is the source of truth for the
     *  underlying data, always renders local). */
    crossAppPreferred?: boolean;
  };
  type NavGroup = { title?: string; items: NavItem[] };

  const navGroups: NavGroup[] = [
    {
      // Overview sits alone above the first divider — no header.
      // Phase 3B R23 (2026-05-11, supersedes R11): Overview uses
      // `crossAppPreferred` — A side click jumps to B's Overview
      // (which itself cross-fetches A's data for the personal-
      // flavored cards). B side click stays on B. Logged-out A side
      // falls back to A's local Overview (personal stub). Mirrors
      // the same pattern as Account (R22).
      items: [
        { path: '/user/overview', icon: <OverviewIcon />, label: 'Overview', crossAppPreferred: true },
      ],
    },
    {
      title: 'Keys',
      items: [
        // Vault + Import live on A only (Personal credential storage).
        // On B side, cross-app from A surfaces them as `Personal Vault`
        // and `Personal Import` pointing at the user's local-server.
        { path: '/user/vault',        icon: <ShieldIcon />,      label: 'Vault',      originName: 'My Vault',   personalOnly: true },
        { path: '/user/import',       icon: <UploadCloudIcon />, label: 'Import',     originName: 'Bulk Import', personalOnly: true },
        // Team Keys live on B only (canonical /user/virtual-keys page is
        // the team server's). On A side, cross-app from B surfaces it as
        // `Team Keys` pointing at the remote team URL. Phase 3B R7
        // dropped A's local /user/virtual-keys nav entry — it was a
        // stub showing empty state since A's local-server has no team
        // data source.
        { path: '/user/virtual-keys', icon: <KeyIcon />,         label: 'Team Keys',  originName: 'Virtual Keys', teamOnly: true },
      ],
    },
    {
      title: 'Insights',
      items: [
        // Phase 3B R18 (2026-05-11): Insights split into 3 explicit
        // items so A↔B order is consistent. Previously a single
        // `Usage` entry with `teamSideLabel: 'Team Usage'` rendered
        // local on both sides (label flipped per side) and the
        // cross-app trailer landed AFTER the local item, producing:
        //   A: [Usage, Cost, Team Usage]   (Team Usage = trailer)
        //   B: [Team Usage, Cost, Usage]   (Usage = trailer)
        // After the split, R13's slot-position logic re-places each
        // cross-app entry in its declared navGroups index, giving
        // both sides [Usage, Team Usage, Cost]:
        //   - Usage (personalOnly):   A local / B cross-app slot
        //   - Team Usage (teamOnly):  A cross-app slot / B local
        //   - Cost (personalOnly):    A local / B cross-app slot
        //
        // Same icon-per-side intent as before:
        //   - Personal Usage  → ReceiptIcon (plain bar-chart)
        //   - Team Usage      → TeamUsageIcon (bars + people)
        //   - Cost            → DollarIcon
        { path: '/user/usage-ledger', icon: <ReceiptIcon />,   label: 'Usage',      originName: 'Usage Ledger', personalOnly: true },
        { path: '/user/usage-ledger', icon: <TeamUsageIcon />, label: 'Team Usage',                            teamOnly: true     },
        { path: '/user/cost',         icon: <DollarIcon />,    label: 'Cost',                                  personalOnly: true },
      ],
    },
    {
      title: 'Account',
      items: [
        // Phase 3B R22 (revised 2026-05-11): Account uses
        // `crossAppPreferred` (not `teamOnly`). On A side it tries
        // cross-app first (jumps to team server when user is logged
        // in — real account data) and **falls back to local**
        // (Personal A's stub /user/account) when not logged in.
        // Without the fallback, a logged-out user would see Account
        // disappear from the sidebar entirely (because no cross-app
        // match exists when the team-account entry's visibility
        // gate `team-logged-in` fails). On B side, the flag is
        // ignored — B always renders local because B owns the
        // canonical account data.
        { path: '/user/account', icon: <UserIcon />, label: 'Account', originName: 'My Account', crossAppPreferred: true },
      ],
    },
  ];

  // Phase 3B R13 (2026-05-11): NO upfront filter. The render IIFE below
  // walks navGroups in declared order and decides per-item whether to
  // render local / cross-app / skip. Pre-filtering here would strip
  // personalOnly items on B before the IIFE could re-slot them with
  // their cross-app equivalents at their original positions, breaking
  // R13 order preservation.
  const sidedNavGroups: NavGroup[] = navGroups;

  return (
    <div className="user-pages flex h-screen overflow-hidden antialiased" style={{ backgroundColor: 'var(--background)' }}>
      {/* ── Sidebar ──
          Design re-aligned 2026-04-24 with user_vault_3_1_1.html:
          zero horizontal divider lines anywhere inside the sidebar.
          Sections are separated by whitespace + uppercase mono group
          titles only. Brand row has no top glow / bottom border; the
          bottom user chip is a rounded surface card instead of a
          bordered strip. Width transitions between 240px and 64px
          preserved via `.user-sidebar.collapsed`. */}
      <aside
        className={`user-sidebar flex-shrink-0 flex flex-col z-20${collapsed ? ' collapsed' : ''}`}
        style={{
          /* Width 280 — matches master AppShell exactly. */
          width: collapsed ? 64 : 280,
          backgroundColor: 'var(--sidebar)',
          borderRight: '1px solid var(--sidebar-border)',
          /* Depth shadow ported from master AppShell (2026-04-24 user
             request: "立体感 对齐 master"). A rightward drop-shadow
             lifts the rail off the main content so the divide reads
             as volume, not just a 1px hairline. */
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)',
        }}
      >
        {/* Brand row — h-16 centered logo + the yellow top-glow line
            master uses as its signature accent. The bottom border was
            intentionally removed earlier (user flagged "全是横线"); the
            top glow is a single line of primary with diffused shadow,
            reads as a spotlight rather than a divider. */}
        <div className="nav-brand h-16 flex items-center justify-center relative flex-shrink-0">
          <div
            className="absolute top-0 left-0 w-full h-px"
            aria-hidden="true"
            style={{
              backgroundColor: 'var(--primary)',
              opacity: 0.5,
              boxShadow: '0 0 10px rgba(250,204,21,0.5)',
            }}
          />
          <div className="flex items-center gap-2 font-mono font-bold tracking-widest text-xl" style={{ color: 'var(--foreground)' }}>
            <KeyIcon className="w-6 h-6" />
            <span className="nav-brand-text">{logoText}</span>
          </div>
        </div>

        {/* Nav — grouped items separated by spacing + uppercase mono
            headers, no divider rules. Groups without a `title` (the
            Overview bucket) render as plain items. */}
        <nav className="flex-1 overflow-y-auto">
          {sidedNavGroups.map((group, gi) => {
            // Cross-app entries belonging to this group, visibility-
            // filtered. Only rendered when otherBaseUrl is configured —
            // a missing URL means we'd link nowhere, which is worse UX
            // than just hiding.
            const crossAppItems = otherBaseUrl
              ? otherMenu
                  .filter((e) => matchesGroup(e.group, group.title))
                  .filter((e) => isVisibleEntry(e.visibility, visState))
              : [];
            return (
              <div className="nav-section" key={gi}>
                {group.title && (
                  <div
                    className="nav-group-title"
                    {...(gi === 0 ? { 'data-origin-name': 'User Console' } : {})}
                  >
                    {group.title}
                  </div>
                )}
                {/* Phase 3B R13 (2026-05-11): preserve navGroups declared
                    order even when local items are filtered (personalOnly
                    on B / teamOnly on A). For each navGroups item:
                      a. Allowed locally → render NavLink (with
                         teamSideLabel + teamSideCrossApp jump rules)
                      b. Filtered out but cross-app menu has an entry
                         with the same path → render the cross-app version
                         IN THIS POSITION (preserves order)
                      c. Filtered + no cross-app match → skip silently
                    Then any leftover cross-app entries (no matching
                    navGroups path) render after the navGroups loop as
                    extras. Without this, Team Keys (teamOnly on A → only
                    cross-app on A) was always sitting at the END of the
                    Keys group on B and BEFORE Vault/Import (which got
                    pushed to the cross-app trailer); now Team Keys renders
                    in its declared 3rd position on B (after Vault, Import). */}
                {(() => {
                  const used: Set<string> = new Set();
                  const renderedPaths: Set<string> = new Set();
                  const renderedItems: React.ReactNode[] = [];
                  for (const item of group.items) {
                    // R21: in single-binary composed mode (trial-full), the
                    // R7 personalOnly/teamOnly filter doesn't apply — every
                    // route exists locally on this same server, render all
                    // as local NavLinks and dedupe by path.
                    const sideAllowed = isSingleBinaryComposed
                      ? true
                      : (!(item.personalOnly && !IS_PERSONAL_SIDE)
                        && !(item.teamOnly && IS_PERSONAL_SIDE));
                    const displayLabel =
                      !IS_PERSONAL_SIDE && item.teamSideLabel ? item.teamSideLabel : item.label;
                    if (sideAllowed) {
                      // R21 path dedupe: in single-binary mode, multiple
                      // navGroups items can share a path (Usage personalOnly
                      // + Team Usage teamOnly both target /user/usage-ledger).
                      // First-wins so the sidebar doesn't show two rows
                      // pointing at the same page. In non-single-binary mode,
                      // R7 filter already prevents same-path collision, so
                      // this dedupe is effectively a no-op.
                      if (renderedPaths.has(item.path)) continue;
                      renderedPaths.add(item.path);

                      // R22 / R23 (revised): crossAppPreferred — on A side,
                      // render cross-app entry when otherBaseUrl is
                      // available (= user logged into team server),
                      // else fall back to local NavLink. B side ignores
                      // the flag.
                      //
                      // Two paths to "cross-app":
                      //   1. Matching menu entry from `crossAppItems`
                      //      (visibility-gated; carries cross-app label
                      //      & icon). Used by Account → team-account.
                      //   2. URL-based construction when no menu entry
                      //      matches but otherBaseUrl exists. Used by
                      //      Overview which has no menu group (no
                      //      `title`, so the matchesGroup filter
                      //      yields zero candidates).
                      //
                      // Both paths converge: when otherBaseUrl is null
                      // (e.g. after `aikey logout` + R6 cache clear),
                      // we fall through to local NavLink — same
                      // "logged-out shows Personal" semantic as
                      // Account (per user's R22 request).
                      if (IS_PERSONAL_SIDE && item.crossAppPreferred && !isSingleBinaryComposed) {
                        const xa = otherBaseUrl
                          ? crossAppItems.find((e) => e.path === item.path)
                          : null;
                        if (xa) {
                          used.add(xa.id);
                          renderedItems.push(
                            <a
                              key={xa.id}
                              href={`${otherBaseUrl}${xa.path}`}
                              className="nav-item nav-item-cross-app"
                              data-tooltip={xa.label}
                              data-origin-name={`cross-app:${xa.id}`}
                              title={`Opens ${otherBaseUrl}${xa.path}`}
                            >
                              {crossAppIconFor(xa.icon)}
                              <span className="nav-label">{xa.label}</span>
                            </a>
                          );
                          continue;
                        }
                        if (otherBaseUrl) {
                          renderedItems.push(
                            <a
                              key={item.path}
                              href={`${otherBaseUrl}${item.path}`}
                              className="nav-item nav-item-cross-app"
                              data-tooltip={displayLabel}
                              data-origin-name={`cross-app:own-${item.path.replace(/^\//, '').replace(/\//g, '-')}`}
                              title={`Opens ${otherBaseUrl}${item.path}`}
                            >
                              {item.icon}
                              <span className="nav-label">{displayLabel}</span>
                            </a>
                          );
                          continue;
                        }
                        // otherBaseUrl is null → fall through to local
                        // NavLink (Personal stub or A's own page).
                      }

                      // Local render path (with optional teamSideCrossApp jump).
                      // R21: teamSideCrossApp jump is also suppressed in
                      // single-binary mode — the "other side" IS this server,
                      // so jumping cross-origin is a fake.
                      if (!IS_PERSONAL_SIDE && item.teamSideCrossApp && otherBaseUrl
                        && !isSingleBinaryComposed) {
                        renderedItems.push(
                          <a
                            key={item.path}
                            href={`${otherBaseUrl}${item.path}`}
                            className="nav-item nav-item-cross-app"
                            data-tooltip={displayLabel}
                            data-origin-name={`cross-app:own-${item.path.replace(/^\//, '').replace(/\//g, '-')}`}
                            title={`Opens ${otherBaseUrl}${item.path}`}
                          >
                            {item.icon}
                            <span className="nav-label">{displayLabel}</span>
                          </a>
                        );
                      } else {
                        renderedItems.push(
                          <NavLink
                            key={item.path}
                            to={item.path}
                            className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                            data-tooltip={displayLabel}
                            {...(item.originName ? { 'data-origin-name': item.originName } : {})}
                          >
                            {item.icon}
                            <span className="nav-label">{displayLabel}</span>
                          </NavLink>
                        );
                      }
                    } else {
                      // Filtered out — slot in matching cross-app entry by path.
                      const xa = otherBaseUrl
                        ? crossAppItems.find((e) => e.path === item.path)
                        : null;
                      if (xa) {
                        used.add(xa.id);
                        renderedItems.push(
                          <a
                            key={xa.id}
                            href={`${otherBaseUrl}${xa.path}`}
                            className="nav-item nav-item-cross-app"
                            data-tooltip={xa.label}
                            data-origin-name={`cross-app:${xa.id}`}
                            title={`Opens ${otherBaseUrl}${xa.path}`}
                          >
                            {crossAppIconFor(xa.icon)}
                            <span className="nav-label">{xa.label}</span>
                          </a>
                        );
                      }
                      // else: skip (truly hidden)
                    }
                  }
                  // Cross-app extras not matched by any navGroups path.
                  // R21: suppressed entirely in single-binary composed mode
                  // (would point loopback at this same server).
                  if (!isSingleBinaryComposed) {
                    for (const e of crossAppItems) {
                      if (used.has(e.id)) continue;
                      renderedItems.push(
                        <a
                          key={e.id}
                          href={`${otherBaseUrl}${e.path}`}
                          className="nav-item nav-item-cross-app"
                          data-tooltip={e.label}
                          data-origin-name={`cross-app:${e.id}`}
                          title={`Opens ${otherBaseUrl}${e.path}`}
                        >
                          {crossAppIconFor(e.icon)}
                          <span className="nav-label">{e.label}</span>
                        </a>
                      );
                    }
                  }
                  return renderedItems;
                })()}
              </div>
            );
          })}
        </nav>

        {/* Collapse / expand toggle — sits above the user chip.
            `data-tooltip` only renders visually when `.collapsed` is
            set (CSS pseudo-element gated on `.user-sidebar.collapsed`
            in index.css). `⌘\` is the keyboard shortcut; we show it
            in the tooltip so users can discover the rebind. */}
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-tooltip={collapsed ? 'Expand sidebar  (⌘\\)' : 'Collapse sidebar  (⌘\\)'}
          title={collapsed ? 'Expand sidebar  (⌘\\)' : 'Collapse sidebar  (⌘\\)'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            {/* lucide chevrons-left — CSS rotates it 180° when collapsed
                so the same glyph reads as chevrons-right without
                needing a second icon component. */}
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
          </svg>
          <span className="sidebar-toggle-label">{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>

        {/* Bottom: User info — rounded surface card, no top border. The
            `.nav-user` / `.nav-user-who` / `.nav-user-signout` hooks
            let the global collapse CSS hide the who / signout bits
            while keeping the avatar visible. */}
        <div className="nav-user flex-shrink-0">
          <div className="nav-user-avatar">
            {identityEmail ? initials(identityEmail) : 'U'}
          </div>
          <div className="nav-user-who flex-1 min-w-0">
            {/* Email + role — mirrors the Profile page's Identity &
                Session card (email + role badge) so the sidebar
                identity microcopy and the full Profile view stay in
                sync. `role` is lowercased by the auth store so we
                upper-case it at the display boundary (same as the
                Profile page's .role-badge rendering). */}
            <div className="nav-user-name truncate">{identityEmail ?? '…'}</div>
            <div className="nav-user-role truncate">
              {(identityRole ?? 'member').toUpperCase()}
            </div>
          </div>
          <button
            onClick={clearAuth}
            className="nav-user-signout"
            title="Sign out"
            aria-label="Sign out"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="vault-header h-16 flex items-center justify-between px-6 flex-shrink-0 z-10">
          <div className="flex items-center text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
            <span data-origin-name="User Console">User</span>
            <span className="mx-2 opacity-50">/</span>
            <span
              className="font-bold"
              style={{ color: 'var(--foreground)' }}
              {...(breadcrumb.originName ? { 'data-origin-name': breadcrumb.originName } : {})}
            >
              {breadcrumb.label}
            </span>
          </div>
          <button
            onClick={() => navigate('/user/referrals')}
            className="btn btn-outline text-[10px] px-3 py-1.5 flex items-center gap-1.5"
            style={{ borderColor: 'rgba(250,204,21,0.3)', color: 'var(--primary)' }}
          >
            {/* Icon size bumped from w-3.5 to w-4 (2026-04-22) to match
                nav-sidebar icons. Prior 3.5 made the Invite glyph look
                visually smaller than every other icon on screen. */}
            <UserPlusIcon />
            Invite
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
