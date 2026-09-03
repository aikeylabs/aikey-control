import { NavGlyph } from '@/shared/ui/nav-glyphs';
import React from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RouteErrorBoundary } from '@/shared/ui/RouteErrorBoundary';

import { useUserAuthStore } from '@/store';
import { runtimeConfig } from '@/app/config/runtime';
import { BrandWordmark, BrandMark } from '@/shared/ui/BrandWordmark';
import { userAccountsApi } from '@/shared/api/user/accounts';
// Resolves to aikey-control/web via the `@/shared/api/user/*` tsconfig +
// vite alias — one canonical copy, same as userAccountsApi above.
import { isTeamTokenRejected } from '@/shared/api/user/team-session';
import { LanguageSwitcher } from '@/shared/components/LanguageSwitcher';
import { ThemeToggle } from '@/shared/ui/ThemeToggle';
import { SeatPendingBanner } from '@/shared/components/SeatPendingBanner';
import { DataFetchErrorBanner } from '@/shared/components/DataFetchErrorBanner';
import { memberIdentity } from '@/shared/utils/member-identity';
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
  buildCrossAppUrl,
  getCrossAppLinkBase,
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

// lucide "layout-dashboard" (outline) — matches user_vault_3_1.html
// template so /user/overview's sidebar glyph reads the same on both
// user console pages. Swapped from heroicons "squares-2x2" 2026-04-23.

// lucide "user" (outline) — matches user_vault_3_1.html. Compound
// path: head circle + shoulders arc (lucide ships these as <circle> +
// <path> nodes; collapsed into one `d` so the NavIcon wrapper doesn't
// need to support multi-shape icons).

// lucide "bar-chart-3" (outline) — matches template. Replaces the
// heroicons "receipt-percent" we used before so the Usage entry's
// glyph reads "charts/metrics" instead of "receipt/tax", which
// better describes the page content (usage ledger + bar charts).

// lucide "circle-dollar-sign" (outline) — Cost / token-spend page glyph.
// Picked over a generic dollar sign because the bounded circle reads as
// "individual transaction unit" rather than monetary total, matching
// the page's "per-key cost breakdown" content.

// lucide "download" (outline) — matches template. Previously was
// heroicons "arrow-down-tray" (very similar glyph) but we align on
// lucide's version so stroke terminations match the other lucide
// icons rendered in the main content area (import page uses lucide
// natively via <i data-lucide="download">).

// lucide "shield" (outline, no check) — matches user_vault_3_1.html.
// Earlier we used heroicons "shield-check" which has an additional
// checkmark stroke inside the shield; the template uses the plain
// shield so we swap to match. Pairs with the key icon (Team Keys)
// to distinguish vault-browsing destinations.

// heroicons v2 "user-plus" (outline) — header "Invite" button.

// lucide "fingerprint" (outline) — Compliance Audit (2026-06-02) sidebar
// glyph. First attempted clipboard-check (rectangle + tab + tick), but at
// 16×16 the silhouette reads as a generic small box and gets lost next to
// adjacent rectangular icons (Vault shield, Apps bot rect, Receipt). The
// fingerprint's concentric-arc silhouette is unique in this shell, scales
// well to small sidebar size, and the "on-device detection / privacy"
// connotation matches the page's data-locality story (original text never
// leaves the machine — see compliancePage.pageDescription i18n). Multi-
// arc lucide path compiled into one `d` via M subpaths so NavIcon's
// single-path renderer works (same trick as ICON_APPS / ICON_SETTINGS).

// lucide "settings" (outline) — Phase 4G (2026-06-01) Settings page gear
// glyph. Used in (a) the top-bar gear button that navigates to
// /user/settings, (b) the sidebar Account-group nav entry, and (c) the
// cross-app menu's `settings` icon name (master-side renders it when
// surfacing the personal-settings cross-app entry). Compiled into one
// `d` via M subpaths so NavIcon's single-path renderer works.

// lucide "bot" (outline) — Connected Apps glyph (refreshed 2026-05-23
// per design_iterations/vault_logo_layout_refine_3.html mockup).
// Renders a rounded robot head: body rect, antenna stem + top bar,
// left/right "ear" stubs, and two eye dots. The bot metaphor fits the
// page meaning better than the previous square-stack — these are
// third-party AI Agents (Claude / Codex / Kimi) that the user "plugs
// into" via AiKey, so a friendly bot face reads more immediately as
// "AI Apps" than abstract stacked squares.
//
// Geometry note: lucide's stock bot has heavy internal padding inside
// the 24×24 viewBox (y=4..20 = 67% vertical fill) which made the
// rendered glyph visually smaller than sibling icons (which fill ~92%
// of the box). Re-tightened the coordinates so the bot occupies y=3..22
// (~79% fill): antenna pushed up 1 unit, body extended down 2 units.
// Horizontal kept (x=2..22) since the ears were already at the edge.
//
// Compiled into one `d` via multiple M subpaths so NavIcon's
// single-path renderer works (lucide's original 7-element multi-path
// can't be inlined directly).

// lucide "bot" — Online Agents (alpha.5) sidebar glyph. Robot head + antenna
// with a face (eyes + mouth) to read distinctly from ICON_APPS.

// lucide "radar" — Trust Check (degrade-detector M5) sidebar glyph.
// Multi-path icon, so we can't reuse the single-`d` NavIcon path; the
// RadarIcon function below renders all paths inline. The radar metaphor
// matches the page's role: scanning each credential source for trust
// signals (degrade / impersonation) — same icon used in the UI template
// `.superdesign/design_iterations/degrade_detector_web_1_2_1_1_1.html`.

// Named thin wrappers — keeps call sites self-documenting and gives
// elements a stable identity for tests / `data-origin-name`-style tooling.
function KeyIcon({ className }: { className?: string } = {}) {
  return <NavGlyph name="key" className={className} />;
}
function OverviewIcon()    { return <NavGlyph name="overview" />; }
function UserIcon()        { return <NavGlyph name="user" />; }
function ReceiptIcon()     { return <NavGlyph name="receipt" />; }
function DollarIcon()      { return <NavGlyph name="dollar" />; }

// Performance nav glyph (2026-08-01 user request): gauge/speedometer — the
// canonical performance-profiling mark (lucide `gauge`). Replaces the dollar
// sign, a leftover from the page's "Cost" era that no longer matches its
// profiling identity.
// Access Token nav glyph (2026-08-10 user request) — lucide-style TALLY SEAL — the
// literal sense of 令牌 / 兵符: an object of authority split in two, one half
// held by the issuer and one by the bearer, valid only when the halves match.
// That is exactly this credential's relationship: the gateway holds the check,
// the third-party agent holds the token it presents.
//
// Why not a key: the key marks belong to the OTHER route — Vault (shield),
// Team Keys (three-person), Team OAuth (fingerprint) and the master console's
// KeyIcon (虚拟密钥) all sit in the same group, and a fifth key-ish glyph would
// make the very distinction this rename exists to draw invisible. The
// perforation notch also reads at 16px, unlike a small key's bit.
//
// Replaces ICON_APPS, which Agents inherited from Connected Apps on 2026-08-01 —
// an app-grid mark on a credential page. Path bytes must match the master
// console's TokenTallyIcon (icons are mirrored console-wide).

function GaugeIcon() { return <NavGlyph name="gauge" />; }
function UploadCloudIcon() { return <NavGlyph name="upload-cloud" />; }
function AppsIcon()        { return <NavGlyph name="apps" />; }
function TokenTallyIcon() { return <NavGlyph name="token-tally" />; }
function BotIcon()         { return <NavGlyph name="bot" />; }
function UserPlusIcon()    { return <NavGlyph name="user-plus" />; }
function ShieldIcon()      { return <NavGlyph name="shield" />; }
function FingerprintIcon() { return <NavGlyph name="fingerprint" />; }

// Team-keys nav glyph (2026-08-01 user request): the SAME three-person mark
// the vault page's kind tiles draw for team-managed keys (heroicons users
// path, mirrored from pages/user/_shared/tool-glyph KIND_GLYPH.team) — the
// menu and the rows it leads to now speak one icon language.
function TeamKindIcon() { return <NavGlyph name="team-kind" />; }

// Compliance-audit nav glyph (2026-08-01 user request, second pass): scales
// of justice (lucide `scale` compiled into one `d` via M subpaths) — the
// canonical "rules / 合规" metaphor. First cut was clipboard-check; the
// fingerprint before that now belongs to Team OAuth (the vault OAuth-kind
// mark), and two fingerprints in one sidebar read as the same feature.
function ScaleIcon() { return <NavGlyph name="scale" />; }

// Connected-Apps nav glyph (2026-08-01 user request): puzzle piece — the
// universal plugin/extension metaphor. Chosen over the literal 插头 plug
// (already the console-wide mark for DIRECT-CREDENTIAL kind) and the grid
// (handed to Agents the same day). Lucide `puzzle`, single path.
function PuzzleIcon() { return <NavGlyph name="puzzle" />; }
function SettingsIcon()    { return <NavGlyph name="settings" />; }

// Team Usage glyph. History: Phase 3B R17 (2026-05-11) used heads-over-bars
// to say "team's metrics"; replaced 2026-08-01 (user feedback: cluttered at
// 16px) with a plain axis + rising columns — still distinct from personal
// Usage's receipt mark.
function TeamUsageIcon() {
  // 2026-08-01 (user request, v3): rising trend line (lucide trending-up).
  // v2's axis+columns collided with personal Usage's icon (named ReceiptIcon
  // but drawing a bar chart); a line chart keeps the "usage metrics" read
  // while staying visually distinct in the same sidebar group.
  return <NavGlyph name="team-usage" />;
}

// Multi-path lucide "radar" (M5 Day 1, 2026-05-21). Re-rendered as inline
// SVG instead of NavIcon since NavIcon takes only a single `d`.
function RadarIcon() { return <NavGlyph name="radar" />; }

// lucide "share-2" — Contribute OAuth (N3b) glyph (2026-06-29). Three nodes
// linked by two edges: reads as "share / contribute your account into the org
// pool". Replaces the old KeyIcon, which made Contribute OAuth visually
// identical to the adjacent Team Keys entry in the KEYS group. Multi-path, so
// inline like RadarIcon / TeamUsageIcon instead of the single-path NavIcon.
function ShareIcon() { return <NavGlyph name="share" />; }

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
 *   - 'cost'         → DollarIcon (R15 — A's Performance cross-app
 *                       rendering on B; B has no /user/performance route,
 *                       A is canonical. Icon name kept as 'cost' for
 *                       backward-compat with stored menu snapshots.)
 *   - 'apps'         → AppsIcon (2026-05-21 — A's Connected Apps
 *                       cross-app rendering on B; B has no /user/apps
 *                       route, A is canonical)
 *   - 'trust-check'  → RadarIcon (2026-05-21 — A's degrade-detector
 *                       Trust Check cross-app rendering on B; sits in
 *                       the new QUALITY group, see types.go/types.ts)
 *   - 'user'         → UserIcon (legacy, no longer emitted by any
 *                       cross-app menu after R16 dropped Account
 *                       cross-app — kept for backward-compat with
 *                       cached/fallback menu snapshots)
 *   - 'team-account' → UserIcon (legacy, see 'user' note)
 *   - 'oauth-contribute' → ShareIcon (2026-06-29 — B's Contribute OAuth
 *                       cross-app rendering on A; distinct from Team Keys'
 *                       KeyIcon. Server-gated by OAUTH_GROUP_ENABLED.)
 *
 * Unknown / future icon names fall back to a small generic dot so the
 * link still renders rather than crashing on schema drift.
 */
function crossAppIconFor(iconName: string | undefined): React.ReactNode {
  switch (iconName) {
    case 'vault':        return <ShieldIcon />;
    case 'import':       return <UploadCloudIcon />;
    case 'team':         return <TeamKindIcon />;
    case 'chart':        return <ReceiptIcon />;
    case 'team-chart':   return <TeamUsageIcon />;
    case 'cost':         return <GaugeIcon />;
    case 'apps':         return <PuzzleIcon />;
    case 'access-token': return <TokenTallyIcon />;
    case 'trust-check':  return <RadarIcon />;
    case 'compliance':   return <ScaleIcon />;
    // 2026-08-01: fingerprint (the vault OAuth-kind mark) — was ShareIcon;
    // must match the local-nav Team OAuth entry above.
    case 'oauth-contribute': return <FingerprintIcon />;
    // 2026-05-30: mirrored from master/web for symmetry. A-side never
    // fetches personal-invites via cross-app (Personal advertises but
    // doesn't consume its own menu), but keeping the switch symmetric
    // avoids future drift if the protocol ever surfaces invites on
    // both directions.
    case 'invite':       return <UserPlusIcon />;
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
// `parent` (2026-06-26): a route segment key in ROUTE_LABELS this page
// nests under, rendered as an intermediate clickable breadcrumb crumb.
// Used for 导入下沉: Import is a sub-page of Vault → 用户 / 保管库 / 导入.
type RouteMeta = { label: string; originName?: string; parent?: string };

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
  'team-oauth': { label: 'Team OAuth' },
  // 2026-07-31: allocation-engine switch log — a drill-down of Team OAuth
  // (header button entry, no sidebar item). Breadcrumb nests like Import →
  // Vault: 用户 / 团队OAuth / 切换日志.
  'switch-log':   { label: 'Switch Log', parent: 'team-oauth' },
  'scheduling-log': { label: 'Scheduling Log', parent: 'team-oauth' },
  vault:          { label: 'Vault',      originName: 'My Vault' },
  'usage-ledger': { label: 'Usage',      originName: 'Usage Ledger' },
  // 2026-07-08: team-usage-ledger + performance were absent here, so the
  // top breadcrumb fell back to the raw URL segment ("用户 / performance")
  // instead of the localized nav label — the sidebar was fine because it
  // reads navGroups. Labels must match navGroups so tNavLabel resolves the
  // same i18n key (navTeamUsage / navPerformance). performance keeps
  // originName 'Cost' (URL renamed /user/cost → /user/performance 2026-05-21)
  // so data-origin-name selectors stay in lockstep with the sidebar item.
  'team-usage-ledger': { label: 'Team Usage' },
  performance:    { label: 'Performance', originName: 'Cost' },
  'usage-detail': { label: 'Usage Detail' },
  apps:           { label: 'Apps',        originName: 'Connected Apps' },
  // 2026-07-16: my-agents was in navGroups but absent here, so its top
  // breadcrumb fell back to the raw URL segment ("用户 / my-agents") instead
  // of the localized nav label. Label matches navGroups so tNavLabel resolves
  // the same i18n key (navMyAgents), present in en+zh.
  // 2026-08-10: display rename "Agents" → "Access Token" (zh 令牌管理).
  // originName keeps 'My Agents' so data-origin-name selectors stay stable
  // across BOTH renames — it is a test anchor, not a user-facing string.
  'access-tokens': { label: 'Access Token', originName: 'My Agents' },
  invites:        { label: 'Invites' },
  'trust-check':  { label: 'Trust Check' },
  // Compliance Audit (G-series, 2026-06): user-side page; present in BOTH
  // user/web and master/web because the trial composer resolves `@` to
  // master/web (dual-edit rule — see UserShell.dual-edit.test.ts).
  compliance:     { label: 'Compliance Audit' },
  // Phase 4G (2026-06-01): Web Console Settings page breadcrumb label.
  settings:       { label: 'Settings' },
  // Import sank into the Vault page (导入下沉 2026-06-26); it is no longer a
  // sidebar item but still a sub-page of Vault, so its breadcrumb nests
  // under Vault: 用户 / 保管库 / 导入.
  import:         { label: 'Import',     originName: 'Bulk Import', parent: 'vault' },
};

type Crumb = { label: string; originName?: string; path?: string };

/** Breadcrumb trail from the top-most ancestor down to the current page.
 *  Most routes are flat (trail = [current]). A route with a `parent` in
 *  ROUTE_LABELS contributes an intermediate, clickable crumb (e.g. Import
 *  → Vault). The leading "用户/User" root is rendered separately by the
 *  header and is not part of this trail. */
function useBreadcrumbTrail(): Crumb[] {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  const meta = ROUTE_LABELS[last] ?? { label: last };
  const trail: Crumb[] = [{ label: meta.label, originName: meta.originName }];
  let parentKey = meta.parent;
  const seen = new Set<string>(); // cycle guard
  while (parentKey && ROUTE_LABELS[parentKey] && !seen.has(parentKey)) {
    seen.add(parentKey);
    const pm = ROUTE_LABELS[parentKey];
    trail.unshift({ label: pm.label, originName: pm.originName, path: `/user/${parentKey}` });
    parentKey = pm.parent;
  }
  return trail;
}

/**
 * Tray hand-off — where the "back to the simple view" control comes from.
 *
 * 🔴 WHY A QUERY PARAM AND NOT A BUILD FLAG (2026-08-17). The desktop tray and
 * a plain browser open the SAME console URL. The tray's Expert button is a
 * switch between two views of one window, so it must be able to switch BACK;
 * a user who typed the console's address themselves has nothing to go back to,
 * and a dead "Simple" button in their toolbar would be a lie. The difference is
 * per-visit, not per-build, so it travels on the URL: the tray appends
 * `?from=tray&back=<its own loopback url>`.
 *
 * 🔴 `back` IS ATTACKER-CONTROLLABLE. Anyone can send a link with any `back`
 * value; without the check below the console would render a button, styled as
 * its own, that navigates wherever that link says. So it is accepted only when
 * it is plain http on loopback — which is the only thing the tray ever serves.
 */
const TRAY_BACK_KEY = 'aikey.trayBackUrl';

/** Accepts a candidate `back` value, or null. See the 🔴 note above: this is
 *  the only thing standing between an attacker-supplied link and a button that
 *  looks like ours. Applied on every read — including reads from storage — so
 *  there is exactly one definition of "acceptable". */
function validTrayBackUrl(back: string | null): string | null {
  if (!back) return null;
  try {
    const target = new URL(back);
    if (target.protocol !== 'http:') return null;
    if (target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') return null;
    return target.toString();
  } catch {
    return null;
  }
}

/**
 * 🔴 The origin has to OUTLIVE the URL that carried it (2026-08-17).
 *
 * Reading `location.search` at mount looked right and produced no button at
 * all: the tray linked at `/`, the app redirects that to `/user/overview`, and
 * the redirect drops the query — so by the time this ran there was nothing to
 * read. Even with that fixed, the params vanish the moment the user clicks
 * anything in the console, and the way back would disappear with them.
 *
 * sessionStorage is the right lifetime: per-tab, gone when the tab closes,
 * which is exactly "this visit came from the tray". Not localStorage — that
 * would keep offering a way back to a tray port that no longer exists, days
 * later, in a window the user opened themselves.
 */
function traySimpleViewUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  if (params.get('from') === 'tray') {
    const fresh = validTrayBackUrl(params.get('back'));
    if (fresh) {
      try {
        window.sessionStorage.setItem(TRAY_BACK_KEY, fresh);
      } catch {
        // Private mode, storage disabled, quota. The button still works on
        // this page; it just will not survive navigation. Degrading is better
        // than throwing inside a layout.
      }
      return fresh;
    }
  }

  try {
    // Re-validated on read: same rule, one place, no trust in storage either.
    return validTrayBackUrl(window.sessionStorage.getItem(TRAY_BACK_KEY));
  } catch {
    return null;
  }
}

// ── i18n label maps ──────────────────────────────────────────────────────────
//
// Nav labels and group titles double as logic anchors elsewhere in this file:
//   - `group.title` feeds `matchesGroup` (uppercased ASCII comparison vs the
//     cross-app Group enum), so the raw English title MUST stay in the data.
//   - route labels feed `data-origin-name` selectors / e2e scripts.
// We therefore keep the English literals in the data structures and translate
// only at the render boundary by mapping the English string → an i18n sub-key.
// Unmapped strings fall through to the raw label (e.g. cross-app labels from
// the wire contract, which are already localized server-side).
const NAV_LABEL_I18N_KEY: Record<string, string> = {
  Overview: 'navOverview',
  Vault: 'navVault',
  Import: 'navImport',
  'Team Keys': 'navTeamKeys',
  'Team OAuth': 'navOauthContribute',
  'Switch Log': 'navSwitchLog',
  Usage: 'navUsage',
  'Usage Detail': 'navUsageDetail',
  'Team Usage': 'navTeamUsage',
  Performance: 'navPerformance',
  Apps: 'navApps',
  'Access Token': 'navMyAgents',
  'Trust Check': 'navTrustCheck',
  'Compliance Audit': 'navComplianceAudit',
  Account: 'navAccount',
  Invites: 'navInvites',
  // Phase 4G (2026-06-01): Settings page breadcrumb. Not in any
  // sidebar navGroups (Settings is reached via the top-bar gear icon
  // and the sidebar user-chip click only); listed here so the
  // breadcrumb renders the localized label when on /user/settings.
  Settings: 'navSettings',
};

const GROUP_TITLE_I18N_KEY: Record<string, string> = {
  Keys: 'groupKeys',
  Cost: 'groupCost',
  // 2026-07-17: group display rename Apps → "Agents & Apps" (the group
  // header used to duplicate its own "Apps" item's label, and Agents —
  // per 方案 A, NOT an app — sat under a header that said otherwise).
  // i18n key stays groupApps; cross-app protocol enum stays APPS.
  'Agents & Apps': 'groupApps',
  Quality: 'groupQuality',
  Account: 'groupAccount',
};

// Cross-app menu labels (i18n). Cross-app menu entries carry an English
// `label` from the wire contract / fallback snapshot (see CrossAppMenuEntry.label
// — "Today English-only; i18n hook is a follow-up"). We translate at the render
// boundary by mapping the entry's stable `id` (which never changes across
// releases — see types.ts) to a fully-qualified i18n key. The English label
// stays in the data (it doubles as the offline fallback display); unmapped ids
// fall through to the raw label so a newly-added cross-app entry still renders
// rather than showing a bare key.
//
// BOTH directions MUST be covered (2026-06-29 i18n-mix bugfix): on A (Personal)
// side we render B's TEAM entries (`team-*` ids); on B (Team) side we render A's
// PERSONAL entries (`personal-*` ids). The original map only had `team-*`, so on
// B side every personal-* cross-app row fell back to its English wire label while
// the local rows were translated → "half Chinese, half English" sidebar. Personal
// ids reuse the existing `userShell.nav*` keys (same labels as the local sidebar
// items) so there's no duplicated translation / split source-of-truth.
//
// Why key off `id` and not `label`: `id` is the wire-contract stable identity
// (renaming a label is allowed, changing an id breaks cross-app active-state),
// so it's the durable anchor for the translation lookup.
const CROSS_APP_LABEL_I18N_KEY: Record<string, string> = {
  // Team entries — rendered on A (Personal) side. These come from master/web's
  // OWN_TEAM_MENU (B publishes, A consumes). The i18n mapping must exist
  // regardless or it leaks its English wire label.
  'team-keys': 'teamMenu.teamKeys',
  'team-usage': 'teamMenu.teamUsage',
  'team-compliance': 'teamMenu.teamCompliance',
  'team-account': 'teamMenu.account',
  // Personal entries — rendered on B (Team) side. Reuse the sidebar nav
  // labels; note `personal-cost`'s display label is "Performance".
  'personal-vault': 'userShell.navVault',
  'personal-usage': 'userShell.navUsage',
  'personal-cost': 'userShell.navPerformance',
  'personal-apps': 'userShell.navApps',
  'personal-trust-check': 'userShell.navTrustCheck',
  'personal-compliance': 'userShell.navComplianceAudit',
  'personal-invites': 'userShell.navInvites',
  // 2026-06-30 (RW8): the OAuth contribute page moved to the local node, so it's
  // a Personal entry now (was the team-side 'team-oauth-contribute'). Label =
  // the menu nav label ("团队OAuth" / "Team OAuth").
  'personal-oauth-contribute': 'userShell.navOauthContribute',
  'personal-access-tokens': 'userShell.navMyAgents',
};

/** Avatar initials for a DISPLAY LABEL (a name, a discriminator or an address —
 *  whatever memberIdentity resolved to), not for an address. Splits on spaces
 *  too: "Wang Nan" is a name shape now that the label can be a person's name,
 *  and splitting only on [._-] reduced it to a single "W". */
function initials(label: string): string {
  const parts = label.split('@')[0].split(/[\s._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

// Sidebar collapse persistence key — bumping the `:v1` suffix lets us
// invalidate old saved state if the sidebar contract changes.
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'aikey:sidebar-collapsed:v1';

// ── UserShell ───────────────────────────────────────────────────────────────

export function UserShell() {
  const { t } = useTranslation();
  // Route identity for RouteErrorBoundary: the ROUTER's location, not
  // window.location — the boundary must reset as part of the same render pass
  // the navigation triggers.
  const { pathname: shellPathname } = useLocation();
  // Translate a nav label / group title at the render boundary. The raw
  // English string stays in the data (it doubles as a logic anchor — see
  // NAV_LABEL_I18N_KEY note); unmapped strings (cross-app wire labels) pass
  // through untranslated.
  const tNavLabel = React.useCallback(
    (label: string) => {
      const key = NAV_LABEL_I18N_KEY[label];
      return key ? t(`userShell.${key}`) : label;
    },
    [t],
  );
  const tGroupTitle = React.useCallback(
    (title: string) => {
      const key = GROUP_TITLE_I18N_KEY[title];
      return key ? t(`userShell.${key}`) : title;
    },
    [t],
  );
  // Translate a cross-app menu entry label by its stable `id`, falling back
  // to the wire/fallback English label when the id is unmapped (forward-compat
  // with new cross-app entries). Map values are fully-qualified i18n keys so
  // both directions resolve: team-* → teamMenu.*, personal-* → userShell.nav*.
  const tTeamMenuLabel = React.useCallback(
    (id: string, fallbackLabel: string) => {
      const key = CROSS_APP_LABEL_I18N_KEY[id];
      return key ? t(key) : fallbackLabel;
    },
    [t],
  );
  const user = useUserAuthStore((s) => s.user);
  // Pull the same /accounts/me query the Profile page uses so the
  // sidebar identity (email + role) stays in lockstep with the Profile
  // Identity & Session card. In local-bypass / personal-edition mode
  // the server returns `local@localhost`; in JWT mode it returns the
  // authenticated user. The zustand store is a secondary fallback for
  // the first paint before the query resolves.
  // Default retries kept on purpose: a token rejected moments after
  // `aikey login` is the gateway's 2s vault cache (DefaultVaultCacheTTL,
  // aikey-trial-server internal/gateway/gateway.go), not a dead session.
  // The default backoff spans that window so the race heals itself;
  // skipping retries would pin "session expired" on a fresh login.
  const meQuery = useQuery({ queryKey: ['me'], queryFn: userAccountsApi.me });
  // Gateway forwarded the vault JWT and the team server rejected it. The
  // store fallback below would happily serve a stale email from the dead
  // session, so this has to win over it.
  const teamSessionExpired = isTeamTokenRejected(meQuery.error);
  const identityEmail = teamSessionExpired ? undefined : (meQuery.data?.email ?? user?.email);
  // A member who signed in through an identity provider has no address of their
  // own: global_accounts.email carries a synthetic handle. 🚫 It must never be
  // rendered — the name to show is the seat alias, which is the single source of
  // truth for a person's name on the web.
  //
  // 🔴 Deliberately UNGATED, unlike SeatPendingBanner. That banner asks "does
  // this deployment even have seats?" and must stay quiet on Personal; this asks
  // "what is this person called?", and a personal box with a team session has a
  // name to show. Where there are genuinely no seats the endpoint is a local
  // stub answering an empty list, which costs one request per shell mount and
  // resolves to the same neutral label as no answer at all.
  const seatsQuery = useQuery({
    queryKey: ['my-seats', 'identity'],
    queryFn: userAccountsApi.mySeatsForIdentity,
    retry: 1,
  });
  const seatAlias = seatsQuery.data?.find((s) => s.alias)?.alias;
  // 🔴 Three distinct states, three distinct renderings — 🚫 never collapsed:
  //   still asking            → undefined  → the '…' placeholder below
  //   session gone            → undefined  → "session expired"
  //   answered, no name found → memberIdentity's fallback
  // Collapsing the first into the third showed a confident "member" on every
  // first paint that then flipped to the real name, and made "loading" and
  // "genuinely nameless" indistinguishable.
  //
  // 🚫 And the fallback is NOT the role word: a member with no seat rendered as
  // "member / MEMBER", two rows of the same word carrying zero information about
  // who is signed in. memberIdentity falls back to the short SSO discriminator
  // first, which at least identifies someone.
  const identityPending = meQuery.isPending || seatsQuery.isPending;
  const identity =
    teamSessionExpired || identityPending
      ? undefined
      : memberIdentity(identityEmail, seatAlias, t('userShell.roleMember'));
  const identityLabel = identity?.primary;
  const identityRole = teamSessionExpired ? undefined : (meQuery.data?.role ?? user?.role);
  // Phase 4G (2026-06-01): the sidebar bottom button no longer calls
  // `clearAuth` directly — it navigates to /user/settings where the
  // proper /system/logout endpoint runs (clears vault row + team-key
  // bindings, not just the React store). `useUserAuthStore` stays
  // imported above because the SettingsPage may invalidate it via
  // localStorage clears + hard navigate; UserShell itself no longer
  // reads it here.
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const breadcrumbTrail = useBreadcrumbTrail();
  /* Brand wordmark: was a hardcoded 'AiKey' text label (renamed from
     "AiKey Vault" 2026-04-22); replaced 2026-07-18 by the BrandWordmark
     SVG (i-dot in brand yellow). Still deliberately NOT read from
     runtimeConfig so the user shell renders synchronously even if
     window.__AIKEY_CONFIG__ hasn't loaded yet. */

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

  // Active-nav reveal-on-load (React.useLayoutEffect + scrollIntoView) removed
  // 2026-07-22 by request. Trade-off accepted: a deep-link / refresh / cross-app
  // full load onto a nav item low in the list may leave it scrolled out of view
  // in the sidebar. See bugfix 2026-07-22-scrollbar-gutter-content-reflow.

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
  // Cross-app NAVIGATION base (2026-07-03 composing gateway). Distinct from
  // otherBaseUrl on purpose — user invariant: menu VISIBILITY / runtime menu
  // sync / composed detection keep reading the REAL team URL (original
  // login/non-login scope behavior, byte-identical); only where a click
  // NAVIGATES switches to same-origin when the local gateway composes the
  // team side ('' → relative href → full-document load → gateway forwards).
  const crossAppLinkBase = getCrossAppLinkBase() ?? otherBaseUrl;

  // Phase 4G (2026-06-01): single helper that opens the Settings page.
  // Personal (A) has /user/settings as a real route, so React Router
  // handles it. Team (B) has no such route — the canonical Settings
  // page lives on the user's local-server (8090) because it edits
  // vault state (Control URL write, /system/logout, etc., none of which
  // make sense to expose on the team server origin). We cross-jump to
  // A's URL when discoverable; if A's local-server isn't reachable
  // (no otherBaseUrl), we fall back to internal navigation so the gear
  // button doesn't dead-end — master/web's router will surface a 404
  // which is a better failure than a silent no-op click.
  // 2026-08-25 generalized from onOpenSettings (bugfix
  // 20260825-team-page-topbar-navigates-to-unregistered-route): the Invite
  // CTA next to the gear did a raw `navigate('/user/invites')` — on the B
  // (team) bundle that path is unregistered and there is no catch-all, so the
  // click rendered the raw "Unexpected Application Error! 404 Not Found".
  // Every top-bar jump to a personal-side page now goes through this ONE
  // helper: SPA navigation on the side that owns the page, full-document
  // cross-jump from the team side (relative under the gateway, absolute
  // cross-origin otherwise). Fenced by usershell-personal-nav-helper.test.ts.
  const openPersonalPage = React.useCallback((path: string) => {
    if (!IS_PERSONAL_SIDE && otherBaseUrl) {
      window.location.href = buildCrossAppUrl((crossAppLinkBase ?? otherBaseUrl).replace(/\/$/, ''), path);
      return;
    }
    navigate(path);
  }, [navigate, otherBaseUrl, crossAppLinkBase]);
  const onOpenSettings = React.useCallback(() => openPersonalPage('/user/settings'), [openPersonalPage]);

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
  // Resolved once per mount: the query string does not change while the shell
  // is alive, and re-reading it on every render would invite a
  // navigation-dependent flicker in a control that must simply be there or not.
  const simpleViewUrl = React.useMemo(traySimpleViewUrl, []);

  const isSingleBinaryComposed = React.useMemo(() => {
    // 2026-06-03: explicit `controlPlaneMode === 'trial'` signal short-
    // circuits the origin-comparison heuristic below. trial Go server
    // injects this via window.__AIKEY_CONFIG__ in the served index.html.
    //
    // Why explicit signal needed: the origin-comparison heuristic
    // (otherBaseUrl.origin === window.location.origin) breaks when a
    // stale `aikey-cross-app:personal-base-url` localStorage entry
    // exists from a past `aikey login` to a team server. trial bundle
    // then thinks "other side" is that stale team URL, even though
    // trial actually serves master + user on one port — and renders
    // Vault / Performance / Apps / Trust Check / Compliance Audit /
    // Invites as cross-app trailers pointing at the stale URL, which
    // breaks click-through on unauth state. See bugfix
    // "20260603-trial-single-binary-detection-stale-cache.md".
    if (runtimeConfig.controlPlaneMode === 'trial') return true;
    // 2026-07-27: a GATEWAY-FORWARDED team page must never read as composed.
    // `teamGateway` is the explicit discriminator (injected only into forwarded
    // B pages — see runtime.ts); the origin fallback below CANNOT distinguish
    // this case, because under the gateway the peer legitimately IS this origin
    // (resolveCrossAppPeer rule 1). Before the 2026-07-26 peer fix this was
    // masked by the poisoned cache (:3000 ≠ :8090 → false by accident); healing
    // the cache exposed it: the team bundle treated itself as the Trial single
    // binary, rendered personal-side entries (team-oauth …) as SPA NavLinks,
    // and clicking them hit the team router's error boundary — "Unexpected
    // Application Error! 404". Forwarded pages must keep FULL-DOCUMENT links
    // (relative, via getCrossAppLinkBase()==='') so the gateway routes them to
    // the local bundle. 项目原则: 禁止从可推断信号判定网关伪装场景。
    if (runtimeConfig.teamGateway) return false;
    if (!otherBaseUrl) return false;
    try {
      return new URL(otherBaseUrl).origin === window.location.origin;
    } catch {
      return false;
    }
  }, [otherBaseUrl]);

  // 1a (2026-07-22): pre-warm the forwarded team-page bundle.
  //
  // WHY: cross-app entries (Account / Compliance / Overview) are served by a
  // DIFFERENT SPA bundle (the team server, via the composing gateway), so
  // navigating to them from the Personal side is a full-document load that must
  // fetch+parse the team bundle — measured ~700ms cold vs ~73ms warm. All team
  // pages share one bundle, so we fetch one team page's HTML on idle to discover
  // its current hashed asset URLs and <link rel=prefetch> them, turning the
  // first cross-app click warm. Personal side + real team gateway only; once per
  // session; best-effort (swallows errors, never blocks the main flow).
  // See bugfix 2026-07-22-scrollbar-gutter-content-reflow.md (§cross-app reload).
  React.useEffect(() => {
    if (!IS_PERSONAL_SIDE || isSingleBinaryComposed || !otherBaseUrl) return;
    if (sessionStorage.getItem('aikey:team-bundle-warmed') === '1') return;
    const base = (crossAppLinkBase ?? '').replace(/\/$/, '');
    const handle = window.setTimeout(() => {
      fetch(`${base}/user/account`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((html) => {
          const assets = new Set(
            [...html.matchAll(/\/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)/g)].map((m) => m[0]),
          );
          if (assets.size === 0) return;
          assets.forEach((a) => {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.as = a.endsWith('.css') ? 'style' : 'script';
            link.href = `${base}${a}`;
            document.head.appendChild(link);
          });
          sessionStorage.setItem('aikey:team-bundle-warmed', '1');
        })
        .catch(() => {});
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [isSingleBinaryComposed, otherBaseUrl, crossAppLinkBase]);

  // Preserve the sidebar's vertical scroll position across navigations.
  //
  // WHY: cross-app nav (Account / Compliance / Overview) is a full-document
  // reload, so the sidebar <nav> remounts at scrollTop=0. When the user has
  // scrolled the overflowing menu down to reach a lower item and clicks it, the
  // menu visibly snaps back to the top ("菜单滚动条跳跃"). We persist the nav
  // scrollTop to sessionStorage on scroll and restore it in a LAYOUT effect
  // (runs before paint → zero visible jump), keeping the menu's vertical
  // position stable across page switches. Same-origin (composing gateway) means
  // sessionStorage is shared between local and forwarded pages, so the position
  // carries across the local↔team boundary too. Supersedes the old
  // active-item scrollIntoView (removed 2026-07-22) with a no-jump approach.
  // See bugfix 2026-07-22-scrollbar-gutter-content-reflow.md.
  const sidebarNavRef = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    const nav = sidebarNavRef.current;
    if (!nav) return;
    const KEY = 'aikey:sidebar-scroll';
    const saved = sessionStorage.getItem(KEY);
    if (saved) nav.scrollTop = parseInt(saved, 10) || 0;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        try { sessionStorage.setItem(KEY, String(nav.scrollTop)); } catch { /* quota/full — non-fatal */ }
      });
    };
    nav.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      nav.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

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

    // refreshOtherBaseUrl writes localStorage + clears the stale team
    // menu on mismatch internally; this hook just syncs React state so
    // the sidebar re-renders. Reading the latest cached value via
    // getOtherBaseUrl() avoids stale-closure reads of the otherBaseUrl
    // state variable captured at mount — visibilitychange fires long
    // after mount.
    const runDiscovery = async () => {
      const discovered = await refreshOtherBaseUrl();
      if (cancelled) return;
      if (discovered != null) {
        setOtherBaseUrlState((prev) => (prev === discovered ? prev : discovered));
      }
      const effectiveUrl = discovered ?? getOtherBaseUrl();
      if (!effectiveUrl) return;
      if (!isOtherMenuStale()) return;
      const freshMenu = await refreshOtherMenu(effectiveUrl);
      if (cancelled) return;
      if (freshMenu) setOtherMenu(freshMenu);
    };

    runDiscovery();

    // 2026-05-30: also re-run when the tab becomes visible. UserShell is
    // a route LAYOUT — soft navigations within the SPA do NOT remount
    // it, so without this listener the team-base-url cache from a prior
    // `aikey login` survives across "run `aikey login --control-url
    // <new>` then come back to the browser tab" flows until a full
    // browser reload. visibilitychange covers: terminal refocus, laptop
    // wake / OS-level resume, browser back/forward between top-level
    // pages. See workflow/CI/bugfix/20260530-cross-app-menu-stale-
    // localStorage-after-relogin.md.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void runDiscovery();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Map cross-app Group enum (KEYS/INSIGHTS/ACCOUNT/QUALITY) to existing
   * sidebar group title casing ("Keys"/"Insights"/"Account"/"Quality").
   *
   * 2026-05-30: aliases table covers display renames where the local
   * group title diverged from the cross-app protocol enum. Phase 4
   * (2026-05-21) renamed the "Insights" group to "Cost" on both
   * user/web and master/web for product reasons, but the cross-app
   * protocol kept group="INSIGHTS" for backwards compat with v1.0.0
   * clients. Without this alias, all INSIGHTS-group personal entries
   * (Usage / Performance / Apps) silently dropped from the master
   * sidebar — see workflow/CI/bugfix/20260530-cross-app-menu-group-
   * rename-misses-insights-entries.md. */
  function matchesGroup(crossAppGroup: CrossAppMenuGroup, navGroupTitle: string | undefined): boolean {
    if (!navGroupTitle) return false;
    const TITLE_TO_GROUP_ALIASES: Record<string, CrossAppMenuGroup> = {
      COST: 'INSIGHTS', // Phase 4 阶段 3 (2026-05-21) display rename
      // 2026-07-17 display rename Apps → "Agents & Apps"; protocol enum
      // stays APPS for backwards compat (same pattern as COST above).
      'AGENTS & APPS': 'APPS',
    };
    const normalized = navGroupTitle.toUpperCase();
    const aliased = TITLE_TO_GROUP_ALIASES[normalized] ?? normalized;
    return aliased === crossAppGroup;
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
    /** 2026-07-03 (user report): hide this LOCAL item until the CLI is
     *  logged into a team. For pages that are meaningless without a team
     *  backend (e.g. Team OAuth pool sign-in). Composed single-binary
     *  mode ignores it — trial always ships the team side locally. */
    requiresTeamLogin?: boolean;
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
        // Vault lives on A only (Personal credential storage). On B side,
        // cross-app from A surfaces it as `Personal Vault` pointing at the
        // user's local-server. Import (2026-06-26) is no longer a sidebar
        // item — it sank into the Vault page as an action button (导入下沉);
        // the cross-app personal-import entry was dropped accordingly.
        { path: '/user/vault',        icon: <ShieldIcon />,      label: 'Vault',      originName: 'My Vault',   personalOnly: true },
        // Team Keys live on B only (canonical /user/virtual-keys page is
        // the team server's). On A side, cross-app from B surfaces it as
        // `Team Keys` pointing at the remote team URL. Phase 3B R7
        // dropped A's local /user/virtual-keys nav entry — it was a
        // stub showing empty state since A's local-server has no team
        // data source.
        { path: '/user/virtual-keys', icon: <TeamKindIcon />,    label: 'Team Keys',  originName: 'Virtual Keys', teamOnly: true },
        // OAuth pool contribute / per-member sign-in. personalOnly since
        // 2026-06-30 (RW8): the page now LIVES on the local node (A, 8090) —
        // it pulls team data via the two-hop team-fetch but is HOSTED locally,
        // so on A it must render a LOCAL NavLink (was teamOnly, which made A
        // render it as a cross-app link to the team origin :3000 where the page
        // no longer exists). On B (team) the matching cross-app slot comes from
        // A's OWN_PERSONAL_MENU ('personal-oauth-contribute'). Same pattern as
        // Vault / Trust Check (local page + cross-app trailer on the other side).
        { path: '/user/team-oauth', icon: <FingerprintIcon />,   label: 'Team OAuth', personalOnly: true, requiresTeamLogin: true },
        // Access Token (was "Agents", moved here from the APPS group 2026-08-10
        // by user decision). A seat principal that exposes a team OAuth VK to a
        // third-party agent product — the artifact the user copies is the token.
        // Placed AFTER Team OAuth because a token draws from that pool.
        // requiresTeamLogin: it only exists in a cluster/team org.
        // Keep in sync with own-menu.ts + personal_menu.go (ts_drift_test).
        { path: '/user/access-tokens', icon: <TokenTallyIcon />, label: 'Access Token', originName: 'My Agents', personalOnly: true, requiresTeamLogin: true },
      ],
    },
    {
      // Phase 4 阶段 3 (2026-05-21): "Insights" group renamed to "Cost".
      // Rationale: every item in this group answers a "how much / where
      // did the money go" question — Usage (token spend) and Performance
      // (cost-vs-output analysis, formerly the "Cost" sub-item). Renaming
      // the GROUP to Cost pins the mental model; the previous "Cost"
      // sub-item became "Performance" so the names don't collide.
      // 2026-06-26: Apps moved out of this group into its own "Apps" group.
      title: 'Cost',
      items: [
        // Phase 3B R18 (2026-05-11): Insights split into explicit items
        // so A↔B order is consistent. (See git history for the
        // pre-2026-05-21 cross-app slot reasoning — still applies.)
        //
        // Order (after 2026-05-21 rename):
        //   - Usage       (personalOnly)  → ReceiptIcon
        //   - Team Usage  (teamOnly)      → TeamUsageIcon
        //   - Performance (personalOnly)  → DollarIcon (was: "Cost")
        { path: '/user/usage-ledger', icon: <ReceiptIcon />,   label: 'Usage',       originName: 'Usage Ledger', personalOnly: true },
        { path: '/user/team-usage-ledger', icon: <TeamUsageIcon />, label: 'Team Usage',                         teamOnly: true     },
        // 2026-05-21 (later same day): URL also renamed `/user/cost` →
        // `/user/performance` so the sidebar path matches the visible label.
        // The page file, function name, CSS class, and trailer ID stay keyed
        // on "cost" (internal-only identifiers, not user-facing). Old
        // `/user/cost` URL still works via redirect in routes/user.tsx.
        { path: '/user/performance',  icon: <GaugeIcon />,     label: 'Performance', originName: 'Cost',          personalOnly: true },
      ],
    },
    {
      // Phase 4 阶段 3 (2026-05-21): new "Quality" group, holds the
      // degrade-detector "Trust Check" entry. Moved here from the
      // previous Insights group because Trust Check is about service-
      // quality monitoring (is upstream actually serving claude-3.5 or
      // a downgrade?), distinct from the "how much money" framing of
      // the Cost group. Solo-item group today; future quality-related
      // signals (latency, error rate, freshness probes) join here.
      title: 'Quality',
      items: [
        // M5 (2026-05-21): degrade-detector trust-check entry.
        // personalOnly because the page calls trust-local on 8801,
        // which only lives on the user's machine.
        { path: '/user/trust-check', icon: <RadarIcon />, label: 'Trust Check', personalOnly: true },
        // Compliance — crossAppPreferred (was personalOnly until 2026-06-12), same
        // pattern as Account. WHY: at a centralized gateway (form ①) a member's
        // events live on the team server, so when logged into team the ONE
        // compliance entry must point THERE, in-place — not add a second "Team
        // Compliance" row beside a now-empty local one. crossAppPreferred absorbs
        // the team-compliance cross-app entry into this slot (used.add → no
        // duplicate trailer). Logged-out / Personal (no team) falls back to the
        // LOCAL self-view NavLink, reading the local-server
        // /api/user/compliance/events. Admins still use /master/compliance/audit.
        //
        // 🔴 DUAL-EDIT: this file is byte-identical in aikey-control/web and
        // aikey-control-master/web. In the MASTER copy crossAppPreferred is
        // ignored, so the same entry renders a local NavLink to that app's own
        // /user/compliance instead of jumping back to :8090. One file, two
        // behaviours decided at runtime — 🚫 not two files.
        { path: '/user/compliance', icon: <ScaleIcon />, label: 'Compliance Audit', originName: 'Compliance Audit', crossAppPreferred: true },
      ],
    },
    {
      // 2026-06-26: Apps split out of the Cost group into its own
      // standalone "Apps" group (cross-app group enum 'APPS', see
      // shared/cross-app-menu/types.ts). personalOnly because the
      // /api/user/apps/* endpoints read app_records / app_keys from the
      // personal vault, which only lives on the user's machine. On B side
      // the cross-app entry (id personal-apps, group APPS) re-slots into
      // this group by path; a header-less top-level item could not (a
      // group with no title yields no matchesGroup candidates on B).
      // Placed after Quality & Compliance (2026-06-26 user decision).
      // 2026-07-17: group display-renamed Apps → "Agents & Apps" (header
      // used to duplicate the "Apps" item label, and Agents is NOT an app
      // per 方案 A). Cross-app group enum stays APPS — matchesGroup maps
      // the new title back via TITLE_TO_GROUP_ALIASES.
      title: 'Agents & Apps',
      items: [
        // 2026-08-10 (user decision): the Access Token item MOVED OUT of this
        // group into KEYS — what it manages is a credential, so it belongs
        // beside Vault / Team Keys / Team OAuth. The group TITLE was left as
        // "Agents & Apps" on the user's explicit instruction; see the Keys group
        // for the moved item.
        { path: '/user/apps', icon: <PuzzleIcon />, label: 'Apps', originName: 'Connected Apps', personalOnly: true },
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
        // Phase 4F (spec §6.14.2): generate / revoke anonymous
        // install-attribution invite codes. personalOnly because
        // the local-api this page calls only lives on Personal +
        // Trial editions — Production's aikey-control runs on a
        // VPS and can't read the per-machine installer_id from a
        // user's laptop.
        { path: '/user/invites', icon: <UserPlusIcon />, label: 'Invites', personalOnly: true },
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
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        {/* Brand row — h-16 centered logo + the yellow top-glow line
            master uses as its signature accent. The bottom border was
            intentionally removed earlier (user flagged "全是横线"); the
            top glow is a single line of primary with diffused shadow,
            reads as a spotlight rather than a divider. */}
        {/* Brand row geometry (2026-05-23 v3 — "slightly centered" tuning):
              h-20  (80px tall, was 64px) — gives the AK mark ~26px of
                    breathing room above and below for a balanced
                    head/box ratio (~3:1).
              pl-[40px] (was 27px which strict-aligned the AK box center
                    with the nav-icon column at 40.5px). Strict alignment
                    left the whole brand block hugging the sidebar's
                    left edge (left-to-right ratio ~1:5.3 against the
                    280px sidebar). Bumping pl to 40 shifts the brand
                    13px right, dropping the ratio to ~1:3.5 — still
                    left-leaning but no longer cramped, while keeping
                    distinct from a "fully centered" treatment.
            Collapsed-sidebar CSS (index.css:366) overrides both with
            `padding:0; justify-content:center` so the icon-only mode
            still centers properly. */}
        <div className="nav-brand h-20 flex items-center justify-start pl-[40px] relative flex-shrink-0">
          {/* Logo aligned with aikeylabs.com main site (2026-05-23):
              32x32 "AK" letterform box + Space Grotesk display font for
              the "AiKey" word, tracking-tight. Replaces the previous
              lucide KeyIcon + JetBrains-Mono tracking-widest combo so
              users moving between the public site and the console see
              the same wordmark.

              Color treatment (2026-05-23 v2): main site dark-mode
              default is a stark `bg-white` box; in the perpetually-
              dark console sidebar that read too "hard" against the
              surrounding amber accents (top glow line, active nav
              rail). Switched to the main site's HOVER amber instead
              (bg-amber-400 → var(--primary) #facc15 + dark text), so
              the AK box sits in-family with the rest of the sidebar's
              amber strong-marks. Subtle amber halo box-shadow echoes
              the top brand glow. */}
          <div
            className="flex items-center gap-[7px] font-bold text-lg tracking-tight"
            style={{
              // "AiKey" wordmark color — uses shared --display-foreground
              // token (#c8c4ba) so all premium-headings (sidebar brand
              // + topbar breadcrumb + page H1s) stay in lockstep.
              // Single source of truth; tweak the token in index.css.
              color: 'var(--display-foreground)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {/* Brand chip — 2026-07-18 rev 7: consolidated onto the shared
                BrandMark (was an inline "AK" text chip). "AK" is now a static
                vector (no web font → no FOUT flash); `nav-brand-mark` keeps
                the collapsed-sidebar hook, size 28 = the prior in-shell chip
                ("登录后的 logo 稍微小一些"). */}
            {/* 2026-07-23 (user): brand banner enlarged ~107% (modest; 32 felt a
                touch big, 30 chosen) — mark 28→30 + wordmark scale 1→1.07, in
                proportion. */}
            <BrandMark className="nav-brand-mark" size={30} />
            {/* SVG wordmark: i-dot in brand yellow (2026-07-18); logoText
                here is the fixed 'AiKey' constant (see comment above).
                tagline={false} (2026-07-18 user request): the "AI RUNTIME
                GOVERNANCE" line shows only on login screens, not inside
                the logged-in shells. */}
            <BrandWordmark className="nav-brand-text" tagline={false} scale={1.07} />
          </div>
        </div>

        {/* Nav — grouped items separated by spacing + uppercase mono
            headers, no divider rules. Groups without a `title` (the
            Overview bucket) render as plain items. */}
        <nav ref={sidebarNavRef} className="sidebar-nav-scroll flex-1 overflow-y-auto">
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
                    {tGroupTitle(group.title)}
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
                    // 2026-07-03: login-gated local items (Team OAuth) hide
                    // when no team is connected — same lifecycle as the
                    // cross-app team entries (menu-scope invariant: logout
                    // shows a pure-personal sidebar). Composed mode exempt.
                    // Side-agnostic login signal: A derives teamLoggedIn
                    // from otherBaseUrl (see useVisibilityState); reading
                    // the field directly would break the dual-edit build
                    // (B's VisibilityState has no teamLoggedIn).
                    if (item.requiresTeamLogin && !isSingleBinaryComposed && !otherBaseUrl) {
                      continue;
                    }
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
                              href={buildCrossAppUrl(crossAppLinkBase, xa.path)}
                              className="nav-item nav-item-cross-app"
                              data-tooltip={tTeamMenuLabel(xa.id, xa.label)}
                              data-origin-name={`cross-app:${xa.id}`}
                              title={t('userShell.opensLink', { url: `${crossAppLinkBase}${xa.path}` })}
                            >
                              {crossAppIconFor(xa.icon)}
                              <span className="nav-label">{tTeamMenuLabel(xa.id, xa.label)}</span>
                            </a>
                          );
                          continue;
                        }
                        if (otherBaseUrl) {
                          renderedItems.push(
                            <a
                              key={item.path}
                              href={buildCrossAppUrl(crossAppLinkBase, item.path)}
                              className="nav-item nav-item-cross-app"
                              data-tooltip={tNavLabel(displayLabel)}
                              data-origin-name={`cross-app:own-${item.path.replace(/^\//, '').replace(/\//g, '-')}`}
                              title={t('userShell.opensLink', { url: `${crossAppLinkBase}${item.path}` })}
                            >
                              {item.icon}
                              <span className="nav-label">{tNavLabel(displayLabel)}</span>
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
                            href={buildCrossAppUrl(crossAppLinkBase, item.path)}
                            className="nav-item nav-item-cross-app"
                            data-tooltip={tNavLabel(displayLabel)}
                            data-origin-name={`cross-app:own-${item.path.replace(/^\//, '').replace(/\//g, '-')}`}
                            title={t('userShell.opensLink', { url: `${crossAppLinkBase}${item.path}` })}
                          >
                            {item.icon}
                            <span className="nav-label">{tNavLabel(displayLabel)}</span>
                          </a>
                        );
                      } else {
                        // B-side crossAppPreferred renders a LOCAL NavLink here.
                        // Consume any same-path cross-app entry so the opposite
                        // side's matching entry (e.g. Personal's compliance) does
                        // NOT also render as a trailing extra → duplicate row
                        // (2026-06-12). Scoped to crossAppPreferred only, so
                        // Usage/Team-Usage (which intentionally coexist) are
                        // unaffected. MUST mirror aikey-control/web (dual-edit).
                        if (item.crossAppPreferred && otherBaseUrl) {
                          const xaSame = crossAppItems.find((e) => e.path === item.path);
                          if (xaSame) used.add(xaSame.id);
                        }
                        renderedItems.push(
                          <NavLink
                            key={item.path}
                            to={item.path}
                            className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                            data-tooltip={tNavLabel(displayLabel)}
                            {...(item.originName ? { 'data-origin-name': item.originName } : {})}
                          >
                            {item.icon}
                            <span className="nav-label">{tNavLabel(displayLabel)}</span>
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
                            href={buildCrossAppUrl(crossAppLinkBase, xa.path)}
                            className="nav-item nav-item-cross-app"
                            data-tooltip={tTeamMenuLabel(xa.id, xa.label)}
                            data-origin-name={`cross-app:${xa.id}`}
                            title={t('userShell.opensLink', { url: `${crossAppLinkBase}${xa.path}` })}
                          >
                            {crossAppIconFor(xa.icon)}
                            <span className="nav-label">{tTeamMenuLabel(xa.id, xa.label)}</span>
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
                          href={buildCrossAppUrl(crossAppLinkBase, e.path)}
                          className="nav-item nav-item-cross-app"
                          data-tooltip={tTeamMenuLabel(e.id, e.label)}
                          data-origin-name={`cross-app:${e.id}`}
                          title={t('userShell.opensLink', { url: `${crossAppLinkBase}${e.path}` })}
                        >
                          {crossAppIconFor(e.icon)}
                          <span className="nav-label">{tTeamMenuLabel(e.id, e.label)}</span>
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
          aria-label={collapsed ? t('userShell.expandSidebar') : t('userShell.collapseSidebar')}
          data-tooltip={collapsed ? t('userShell.expandSidebarShortcut') : t('userShell.collapseSidebarShortcut')}
          title={collapsed ? t('userShell.expandSidebarShortcut') : t('userShell.collapseSidebarShortcut')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            {/* lucide chevrons-left — CSS rotates it 180° when collapsed
                so the same glyph reads as chevrons-right without
                needing a second icon component. */}
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
          </svg>
          <span className="sidebar-toggle-label">{collapsed ? t('userShell.expand') : t('userShell.collapse')}</span>
        </button>

        {/* Bottom: User info — rounded surface card, no top border. Phase
            4G (2026-06-01): the whole chip is now a button that navigates
            to /user/settings. The previous sidebar-bottom logout button
            was a front-end-only `clearAuth()` that left the vault row
            intact (bug: reopening the SPA silently re-authenticated). It
            has moved to the Settings page where it can call the real
            /system/logout endpoint. The hook class names
            (`.nav-user-who` etc.) stay so the existing collapse CSS
            hides the email / role bits while keeping the avatar visible
            in icon-only mode. */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="nav-user flex-shrink-0"
          title={t('settings.title')}
          aria-label={t('settings.title')}
        >
          <div className="nav-user-avatar">
            {identityLabel ? initials(identityLabel) : 'U'}
          </div>
          <div className="nav-user-who flex-1 min-w-0">
            {/* Email + role — mirrors the Profile page's Identity &
                Session card (email + role badge) so the sidebar
                identity microcopy and the full Profile view stay in
                sync. `role` is lowercased by the auth store so we
                upper-case it at the display boundary (same as the
                Profile page's .role-badge rendering). */}
            <div className="nav-user-name truncate" title={identity?.unambiguous}>
              {identityLabel ?? (teamSessionExpired ? t('userShell.sessionExpired') : '…')}
            </div>
            <div className="nav-user-role truncate">
              {teamSessionExpired
                ? t('userShell.sessionExpiredHint')
                : (identityRole ?? t('userShell.roleMember')).toUpperCase()}
            </div>
          </div>
          <SettingsIcon />
        </button>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* 🔴 Absolutely positioned, NOT a flex sibling (2026-08-18, user
            decision A). The header used to sit above the scroll container in
            normal flow, which meant no content ever passed beneath it — and
            `backdrop-filter` on a bar with nothing behind it blurs a flat
            colour, i.e. renders no glass at all. Overlaying it on the scroll
            container is what makes the frosted effect real; the container
            below compensates with pt-16 so page content still starts under
            the bar rather than behind it.
            Dual-edit mirror: keep identical in control/web + master/web. */}
        <header className="vault-header h-16 flex items-center justify-between px-6 absolute top-0 left-0 right-0 z-20">
          <div className="flex items-center text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>
            <span data-origin-name="User Console">{t('userShell.breadcrumbUser')}</span>
            {breadcrumbTrail.map((crumb, i) => {
              const isLast = i === breadcrumbTrail.length - 1;
              return (
                <React.Fragment key={`${crumb.label}-${i}`}>
                  <span className="mx-2 opacity-50">/</span>
                  {isLast || !crumb.path ? (
                    <span
                      className="font-bold"
                      style={{ color: 'var(--display-foreground)' }}
                      {...(crumb.originName ? { 'data-origin-name': crumb.originName } : {})}
                    >
                      {tNavLabel(crumb.label)}
                    </span>
                  ) : (
                    // Intermediate ancestor (e.g. Vault for the Import sub-page):
                    // muted + clickable, inherits the row's muted-foreground color.
                    <NavLink
                      to={crumb.path}
                      className="hover:underline"
                      {...(crumb.originName ? { 'data-origin-name': crumb.originName } : {})}
                    >
                      {tNavLabel(crumb.label)}
                    </NavLink>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            {/* Tray hand-off (2026-08-17): only rendered when this visit came
                FROM the tray, so a browser-typed visit shows no dead control.
                See traySimpleViewUrl for why the target is validated. */}
            {simpleViewUrl && (
              <button
                type="button"
                onClick={() => { window.location.href = simpleViewUrl; }}
                className="btn btn-outline"
                data-origin-name="Back to simple view"
                title={t('userShell.backToSimple')}
              >
                {t('userShell.backToSimple')}
              </button>
            )}
            {/* Light/dark switch (2026-09-03). Sits beside the language
                switcher because both are display preferences rather than
                actions on data — grouping them keeps the action cluster to
                the right unambiguous. Dark stays the default. */}
            <ThemeToggle />
            <LanguageSwitcher />
            {/* Phase 4G (2026-06-01): top-bar Settings entry. Gear icon-
                only button, ghost variant so it sits visually quieter
                than the Invite CTA next to it. `onOpenSettings`
                cross-jumps to A's local-server when running on B side. */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="btn btn-ghost text-[10px] px-2 py-1.5 flex items-center"
              title={t('settings.title')}
              aria-label={t('settings.title')}
            >
              <SettingsIcon />
            </button>
            <button
              onClick={() => openPersonalPage('/user/invites')}
              className="btn btn-outline text-[10px] px-3 py-1.5 flex items-center gap-1.5"
              style={{ borderColor: 'rgba(250,204,21,0.3)', color: 'var(--primary-text)' }}
            >
              {/* Icon size bumped from w-3.5 to w-4 (2026-04-22) to match
                  nav-sidebar icons. Prior 3.5 made the Invite glyph look
                  visually smaller than every other icon on screen. */}
              <UserPlusIcon />
              {t('userShell.invite')}
            </button>
          </div>
        </header>
        {/* scrollbar-gutter: stable — reserve the scrollbar gutter permanently
            so routes that overflow vs fit don't reflow the content ~6px sideways
            on nav. Dual-edit mirror: keep identical in control/web + master/web.
            bugfix 2026-07-22-scrollbar-gutter-content-reflow. */}
        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] pt-16">
          {/* Account without a seat: shown at the top of every console view
              because the member can reach any of them and none of them work.
              Dismissible — only an administrator can resolve it. */}
          <SeatPendingBanner />
          {/* Global net for silently-failing reads (2026-07-26): any query in
              error state surfaces here, so a 401/CORS/500 can never again
              masquerade as "暂无数据". Per-page ApiErrorDisplay blocks give the
              precise message; this layer is the one that doesn't depend on a
              page author remembering. */}
          <DataFetchErrorBanner />
          {/* 🔴 One page's render crash must not take the console down
              (2026-07-30 seats incident). The boundary sits INSIDE the shell, so
              nav survives and the operator can move to a working page; keyed on
              the pathname so navigating away clears the fallback. */}
          <RouteErrorBoundary resetKey={shellPathname}>
            <Outlet />
          </RouteErrorBoundary>
        </div>
      </main>
    </div>
  );
}
