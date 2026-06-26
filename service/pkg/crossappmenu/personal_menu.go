package crossappmenu

// PersonalMenu is the canonical Personal-side menu — Go counterpart of
// aikey-control/web/src/shared/cross-app-menu/own-menu.ts (OWN_PERSONAL_MENU).
//
// The two sources MUST stay in sync — see workflow/CI/Makefile
// cross-app-menu-check for the lint that compares them. Drift = a Team
// user fetching from local-server gets a different menu than what A's
// own sidebar renders.
//
// When changing this list:
//   1. Update OWN_PERSONAL_MENU in the TS file
//   2. Add the corresponding route to A's React router
//   3. Run cross-app-menu-check to verify Go ↔ TS match
// Phase 3B R11 (2026-05-11): labels mirror A's own sidebar exactly
// (Vault / Import / Usage / Profile — no "Personal " prefix). When B
// fetches this menu via /system/cross-app-menu, B's sidebar renders
// the entries with these labels, so the user sees consistent naming
// whether they're on A directly or looking at B's cross-app section.
// Spec: requirements/2026-05-11-aikey-web-local-first-team-merge.md R11.
var PersonalMenu = []Entry{
	{
		ID:         "personal-vault",
		Group:      GroupKeys,
		Label:      "Vault",
		Path:       "/user/vault",
		Visibility: VisibilityAlways,
		Icon:       "vault",
	},
	// "personal-import" removed 2026-06-26: Import sank into the Vault page
	// as an action button (导入下沉); it is no longer a standalone sidebar
	// destination. The /user/import route still exists. Must stay in sync
	// with own-menu.ts (cross-app-menu-check lint).
	{
		ID:         "personal-usage",
		Group:      GroupInsights,
		Label:      "Usage",
		Path:       "/user/usage-ledger",
		Visibility: VisibilityAlways,
		Icon:       "chart",
	},
	// Phase 3B R15 (2026-05-11): Cost added so B's sidebar (which has
	// Performance as personalOnly) finds a cross-app match and renders
	// a link to A's local /user/performance page (B has no own
	// /user/performance route — A is the canonical owner). Without
	// this entry the Performance item was silently filtered out on B.
	// 2026-05-21: Label renamed Cost → Performance, URL renamed
	// /user/cost → /user/performance. Trailer ID kept as
	// "personal-cost" so A↔B menu reconciliation across versions
	// (peers still on the old binary) stays matched. Icon name kept
	// as "cost" for the same backward-compat reason.
	{
		ID:         "personal-cost",
		Group:      GroupInsights,
		Label:      "Performance",
		Path:       "/user/performance",
		Visibility: VisibilityAlways,
		Icon:       "cost",
	},
	// Phase 4 阶段 3 (2026-05-21): Connected Apps. Same shape as the
	// other personalOnly entries — published here so B's sidebar can
	// surface a cross-app link back to A's /user/apps page.
	// /api/user/apps/* lives on A's local-server; B has no own
	// /user/apps route.
	// 2026-06-26: Group moved INSIGHTS → APPS (Apps split into its own
	// sidebar group). Must match own-menu.ts and UserShell's 'Apps' group.
	{
		ID:         "personal-apps",
		Group:      GroupApps,
		Label:      "Apps",
		Path:       "/user/apps",
		Visibility: VisibilityAlways,
		Icon:       "apps",
	},
	// M5 (2026-05-21): degrade-detector Trust Check. Sits in the new
	// QUALITY group (added 2026-05-21 in types.go). Peers on older
	// binaries don't know QUALITY → matchesGroup() drops the entry
	// silently; harmless until peer upgrades.
	{
		ID:         "personal-trust-check",
		Group:      GroupQuality,
		Label:      "Trust Check",
		Path:       "/user/trust-check",
		Visibility: VisibilityAlways,
		Icon:       "trust-check",
	},
	// Phase 3 (2026-06-03): Compliance Audit. Same shape as trust-check —
	// /api/user/compliance/events lives on A's local-server (reads
	// control.db); team server has no equivalent endpoint by design
	// (original prompt text never leaves the user's machine). B's
	// sidebar surfaces the Compliance Audit entry via this cross-app
	// trailer, pointing at the user's local-server (8090). Pairs with
	// the TS OWN_PERSONAL_MENU entry of the same ID.
	{
		ID:         "personal-compliance",
		Group:      GroupQuality,
		Label:      "Compliance Audit",
		Path:       "/user/compliance",
		Visibility: VisibilityAlways,
		Icon:       "compliance",
	},
	// Phase 3B R16 (2026-05-11): Account intentionally NOT exposed via
	// cross-app — both A and B have local /user/account routes showing
	// side-relevant data. Each side renders its own Account NavLink
	// locally; exposing the other side as cross-app would surface a
	// duplicate Account trailer in the same group.
	// Spec: requirements/2026-05-11-aikey-web-local-first-team-merge.md R16.

	// Phase 4F invites (2026-05-30): Invites cross-jumps to A's
	// /user/invites. B's local navGroups item is personalOnly because
	// the /local-api/invites/* endpoints it calls need installer_id
	// from the user's machine — only present on a Personal install.
	// Surfacing via cross-app lets B's sidebar render an Invites slot
	// pointing back at A's local-server where the page actually works.
	// Sits in the ACCOUNT group, same as the local navGroups item.
	{
		ID:         "personal-invites",
		Group:      GroupAccount,
		Label:      "Invites",
		Path:       "/user/invites",
		Visibility: VisibilityAlways,
		Icon:       "invite",
	},
}

// personalMenuZhLabels maps each PersonalMenu entry's stable ID to its
// Simplified-Chinese label. Phase E-2 (2026-05-30): the Handler swaps in
// these labels when the request's negotiated locale is "zh"; English stays
// the default for any other locale (incl. a missing Accept-Language header).
//
// Why key by ID, not by English label: ID is the backward-compat anchor
// (e.g. "personal-cost" survives the Cost→Performance rename), so keying by
// ID keeps the translation stable across English-label renames. The English
// labels in PersonalMenu above remain the canonical source compared by the
// TS-drift / cross-app-menu lints — this map is additive and applied only at
// response time, so it never mutates the shared slice.
//
// Coverage invariant: every PersonalMenu entry must have a zh label.
// TestPersonalMenuZhLabels_CoverAllEntries enforces this so a future entry
// can't silently fall back to English for zh users.
var personalMenuZhLabels = map[string]string{
	"personal-vault":       "保管库",
	"personal-usage":       "用量",
	"personal-cost":        "性能", // Label "Performance"; ID kept for back-compat.
	"personal-apps":        "应用",
	"personal-trust-check": "置信度检测",
	"personal-compliance":  "合规审计",
	"personal-invites":     "邀请码",
}
