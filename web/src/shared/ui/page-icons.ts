import type { GlyphName } from '@/shared/ui/nav-glyphs';

// page-icons.tsx — which glyph a PAGE TITLE shows, keyed by route.
//
// WHY: "the page icon matches the menu icon" used to be a convention, and on
// 2026-08-10 it was already broken — /user/virtual-keys rendered a crowd of
// people in the sidebar and a key in its own title. Both sides now resolve from
// here, so the two cannot disagree.
//
// KEY = the LAST path segment, which is exactly what both breadcrumb
// implementations already use (AppShell.useBreadcrumb, UserShell
// .useBreadcrumbTrail). That makes `/master/orgs/<uuid>/seats` collapse to
// `seats` for free — the org id never needs parsing.
//
// TWO TABLES, not one: `virtual-keys` exists in both consoles with DIFFERENT
// glyphs (the member page is a team-key list, master's is the admin registry),
// so a single flat table would silently pick one. The console is chosen by the
// first path segment.
//
// The nav-backed entries below are generated from each shell's own nav
// structure, so they cannot drift from it. Entries under the "no nav item"
// comment are pages the sidebar never links; they inherit the glyph of the
// section they belong to, mirroring the existing `parent` chain in
// UserShell's ROUTE_LABELS (import → vault, switch-log → team-oauth).
//
// 🔴 Dual-edit: shared/ui is on the web-drift-check mirror whitelist — this file
// must stay byte-identical in both webs, which is why it carries both consoles.

const USER_PAGE_GLYPH: Record<string, GlyphName> = {
  'access-tokens': 'token-tally',
  'account': 'user',
  'apps': 'puzzle',
  'compliance': 'scale',
  'invites': 'user-plus',
  'overview': 'overview',
  'performance': 'gauge',
  'team-oauth': 'fingerprint',
  'team-usage-ledger': 'team-usage',
  'trust-check': 'radar',
  'usage-ledger': 'receipt',
  'vault': 'shield',
  'virtual-keys': 'team-kind',
  // 无导航项的页面：继承语义最近的父级章节图标
  'browser-profile-guide': 'fingerprint',
  'cli-guide': 'bot',
  'import': 'upload-cloud',
  'my-keys': 'team-kind',
  'my-seats': 'users',
  'oauth-contribute': 'fingerprint',
  'pending-keys': 'team-kind',
  'referrals': 'user-plus',
  'settings': 'settings',
  'switch-log': 'history',
  'usage-detail': 'receipt',
};

const MASTER_PAGE_GLYPH: Record<string, GlyphName> = {
  'access-tokens': 'token-tally',
  'audit': 'scale',
  'bindings': 'channels',
  'cluster-health': 'activity',
  'control-events': 'history',
  'conversation-audit': 'conversation',
  'dashboard': 'dashboard',
  // Licence — 'shield' matches the sidebar's ShieldIcon in AppShell. Unused
  // elsewhere in THIS table; the user tree's 'vault' also uses it, which is a
  // different console with a different nav, so the two never appear together.
  'license': 'shield',
  'nodes': 'server',
  'oauth-groups': 'layers',
  'packs': 'library',
  'provider-accounts': 'cloud',
  'quota': 'master-gauge',
  'route-groups': 'layers',
  'seats': 'users',
  'usage-audit': 'usage-audit',
  'usage-ledger': 'master-receipt',
  'virtual-keys': 'key',
  // 无导航项的页面：继承语义最近的父级章节图标
  'mock-provider': 'bot',
  'settings': 'settings',
  'triage': 'scale',
  'unpriced-models': 'master-gauge',
};

/**
 * The glyph a page title should show, or undefined when the route has no
 * mapping (the header then renders without a tile rather than guessing).
 */
export function pageGlyphFor(pathname: string): GlyphName | undefined {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;
  const last = segments[segments.length - 1];
  const table = segments[0] === 'master' ? MASTER_PAGE_GLYPH : USER_PAGE_GLYPH;
  return table[last];
}
