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
	{
		ID:         "personal-import",
		Group:      GroupKeys,
		Label:      "Import",
		Path:       "/user/import",
		Visibility: VisibilityAlways,
		Icon:       "import",
	},
	{
		ID:         "personal-usage",
		Group:      GroupInsights,
		Label:      "Usage",
		Path:       "/user/usage-ledger",
		Visibility: VisibilityAlways,
		Icon:       "chart",
	},
	// Phase 3B R15 (2026-05-11): Cost added so B's sidebar (which has
	// Cost as personalOnly) finds a cross-app match and renders a link
	// to A's local /user/cost page (B has no own /user/cost route — A
	// is the canonical owner). Without this entry the Cost item was
	// silently filtered out on B.
	{
		ID:         "personal-cost",
		Group:      GroupInsights,
		Label:      "Cost",
		Path:       "/user/cost",
		Visibility: VisibilityAlways,
		Icon:       "cost",
	},
	// Phase 3B R16 (2026-05-11): Account intentionally NOT exposed via
	// cross-app — both A and B have local /user/account routes showing
	// side-relevant data. Each side renders its own Account NavLink
	// locally; exposing the other side as cross-app would surface a
	// duplicate Account trailer in the same group.
	// Spec: requirements/2026-05-11-aikey-web-local-first-team-merge.md R16.
}
