// Package crossappmenu defines the wire contract for the M-scheme
// (Mirror Menu) cross-app sidebar synchronization.
//
// Both Personal local-server and Team control-service expose
// GET /system/cross-app-menu returning a CrossAppMenuResponse. The
// opposite side fetches it at runtime to render cross-app sidebar
// entries as `<a href="${other_origin}${path}">` links.
//
// The wire contract is the canonical source of truth. The TS-side
// type definitions in
// aikey-control/web/src/shared/cross-app-menu/types.ts MUST stay in
// sync with this Go file (verified by workflow/CI/Makefile
// cross-app-menu-check).
//
// See: roadmap20260320/技术实现/update/20260510-personal-team-数据隔离与合并显示.md
// 决策 4 (M scheme).
package crossappmenu

// SchemaVersion is the wire schema version. Bump only on
// breaking changes (removed required fields or changed semantics);
// added optional fields do not require a bump because consumers are
// forward-compatible (unknown fields ignored).
const SchemaVersion = 1

// Source identifies which side produced the menu response.
type Source string

const (
	SourcePersonal Source = "personal"
	SourceTeam     Source = "team"
)

// Group is the sidebar grouping bucket. New buckets must be added on
// both Go sides and on the TS side.
type Group string

const (
	GroupKeys     Group = "KEYS"
	GroupInsights Group = "INSIGHTS"
	GroupAccount  Group = "ACCOUNT"
	// QUALITY added 2026-05-21 to support the degrade-detector
	// "Trust Check" entry that lives in A's sidebar Quality group.
	// Peers on older binaries don't know QUALITY → matchesGroup()
	// will skip the entry; harmless graceful degradation (the link
	// just doesn't show until peer upgrades).
	GroupQuality Group = "QUALITY"
	// APPS added 2026-06-26 to split "Apps" out of the INSIGHTS/Cost
	// group into its own sidebar group. Same graceful-degradation
	// contract as QUALITY: peers on older binaries skip the entry.
	GroupApps Group = "APPS"
)

// Visibility is the sentinel each side maps to its own runtime predicate.
// See cross-app-menu/visibility.ts in both webs for the per-side mapping.
type Visibility string

const (
	VisibilityAlways            Visibility = "always"
	VisibilityTeamLoggedIn      Visibility = "team-logged-in"
	VisibilityLocalServerOnline Visibility = "local-server-online"
)

// Entry is one cross-app menu entry. Field semantics documented in the
// TS counterpart at
// aikey-control/web/src/shared/cross-app-menu/types.ts (CrossAppMenuEntry).
type Entry struct {
	ID         string     `json:"id"`
	Group      Group      `json:"group"`
	Label      string     `json:"label"`
	Path       string     `json:"path"`
	Visibility Visibility `json:"visibility"`
	Icon       string     `json:"icon,omitempty"`
}

// Response is the JSON envelope returned by GET /system/cross-app-menu.
type Response struct {
	SchemaVersion int     `json:"schema_version"`
	Source        Source  `json:"source"`
	FetchedAt     string  `json:"fetched_at"` // RFC3339 UTC
	Entries       []Entry `json:"entries"`
}
