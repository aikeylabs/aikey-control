import React from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useUserAuthStore } from '@/store';
import { userAccountsApi } from '@/shared/api/user/accounts';

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
function UploadCloudIcon() { return <NavIcon d={ICON_UPLOAD_CLOUD} />; }
function UserPlusIcon()    { return <NavIcon d={ICON_USER_PLUS} />; }
function ShieldIcon()      { return <NavIcon d={ICON_SHIELD} />; }

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
  account:        { label: 'Profile',    originName: 'My Account' },
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
  type NavItem = { path: string; icon: React.ReactNode; label: string; originName?: string };
  type NavGroup = { title?: string; items: NavItem[] };

  const navGroups: NavGroup[] = [
    {
      // Overview sits alone above the first divider — no header.
      items: [
        { path: '/user/overview', icon: <OverviewIcon />, label: 'Overview' },
      ],
    },
    {
      title: 'Keys',
      items: [
        { path: '/user/vault',        icon: <ShieldIcon />,      label: 'Vault',      originName: 'My Vault' },
        { path: '/user/import',       icon: <UploadCloudIcon />, label: 'Import',     originName: 'Bulk Import' },
        { path: '/user/virtual-keys', icon: <KeyIcon />,         label: 'Team Keys',  originName: 'Virtual Keys' },
      ],
    },
    {
      title: 'Insights',
      items: [
        { path: '/user/usage-ledger', icon: <ReceiptIcon />, label: 'Usage', originName: 'Usage Ledger' },
      ],
    },
    {
      title: 'Account',
      items: [
        { path: '/user/account', icon: <UserIcon />, label: 'Profile', originName: 'My Account' },
      ],
    },
  ];

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
          <div className="flex items-center gap-2 font-mono font-bold tracking-widest text-lg" style={{ color: 'var(--foreground)' }}>
            <KeyIcon className="w-5 h-5" />
            <span className="nav-brand-text">{logoText}</span>
          </div>
        </div>

        {/* Nav — grouped items separated by spacing + uppercase mono
            headers, no divider rules. Groups without a `title` (the
            Overview bucket) render as plain items. */}
        <nav className="flex-1 overflow-y-auto">
          {navGroups.map((group, gi) => (
            <div className="nav-section" key={gi}>
              {group.title && (
                <div
                  className="nav-group-title"
                  {...(gi === 0 ? { 'data-origin-name': 'User Console' } : {})}
                >
                  {group.title}
                </div>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                  data-tooltip={item.label}
                  {...(item.originName ? { 'data-origin-name': item.originName } : {})}
                >
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
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
