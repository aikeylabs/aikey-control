package crossappmenu

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

// TestTSGoMenuDrift verifies that PersonalMenu (Go) stays in sync with
// OWN_PERSONAL_MENU (TypeScript at aikey-control/web/src/shared/
// cross-app-menu/own-menu.ts). Drift = customer's local-server returns
// one menu shape over /system/cross-app-menu while the same web bundle
// shows another → user sees "Team Keys Usage" entry on team server but
// nothing in their local sidebar (or vice versa).
//
// Detection method: regex-extract `id` + `path` tuples from the TS
// source file and assert one-to-one match with Go entries. Comparing
// the TWO load-bearing fields (id is cross-app stable key, path is the
// actual route) catches the bugs we care about — id-only checks would
// miss path renames; full struct comparison is overkill.
//
// Adding a new entry: update both files together; this test fails
// loudly otherwise.
func TestTSGoMenuDrift(t *testing.T) {
	tsPath := locateTSFile(t, "own-menu.ts")
	tsEntries := parseTSEntries(t, tsPath)

	// Build Go-side reference: map of id → path
	goByID := make(map[string]string, len(PersonalMenu))
	for _, e := range PersonalMenu {
		goByID[e.ID] = e.Path
	}
	tsByID := make(map[string]string, len(tsEntries))
	for _, e := range tsEntries {
		tsByID[e.ID] = e.Path
	}

	// IDs only in Go (TS missed an entry add)
	for id, p := range goByID {
		if _, ok := tsByID[id]; !ok {
			t.Errorf("entry id=%q (path=%q) in Go PersonalMenu but missing from TS OWN_PERSONAL_MENU\n"+
				"  add to: %s", id, p, tsPath)
		}
	}
	// IDs only in TS (Go missed an entry add)
	for id, p := range tsByID {
		if _, ok := goByID[id]; !ok {
			t.Errorf("entry id=%q (path=%q) in TS OWN_PERSONAL_MENU but missing from Go PersonalMenu\n"+
				"  add to: aikey-control/service/pkg/crossappmenu/personal_menu.go", id, p)
		}
	}
	// Path mismatch (id matches but path diverged — most insidious because
	// the entry "appears" both sides but clicks would 404)
	for id, goPath := range goByID {
		tsPath, ok := tsByID[id]
		if !ok {
			continue
		}
		if goPath != tsPath {
			t.Errorf("entry id=%q path mismatch: Go=%q vs TS=%q", id, goPath, tsPath)
		}
	}
}

// tsEntry is the minimal cross-side shape we extract from TS source.
type tsEntry struct {
	ID   string
	Path string
}

// locateTSFile resolves the absolute path of a TS source file given its
// basename, using runtime.Caller to anchor on this test file's location
// rather than process cwd (which depends on how the test was invoked).
func locateTSFile(t *testing.T, basename string) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// thisFile = .../aikey-control/service/pkg/crossappmenu/ts_drift_test.go
	// pkgDir   = .../aikey-control/service/pkg/crossappmenu
	// up 3:    .../aikey-control/service          (pkg → service)
	//          .../aikey-control                  (service → repo root)
	// target = .../aikey-control/web/src/shared/cross-app-menu/<basename>
	pkgDir := filepath.Dir(thisFile)
	repoRoot := filepath.Join(pkgDir, "..", "..", "..") // → aikey-control/
	target := filepath.Join(repoRoot, "web", "src", "shared", "cross-app-menu", basename)
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("TS source file not found at %s: %v", target, err)
	}
	abs, _ := filepath.Abs(target)
	return abs
}

// reEntryBlock finds each top-level menu entry block. Anchored on
// `id:` because every entry leads with it; spans multi-line up to the
// closing brace of the block.
//
// Why regex (not a TS parser): we only need 2 fields out of a small
// well-formed file, and pulling in a JS engine to parse one const is
// extreme overkill. The schema is stable (linted in TS-side too).
var reEntryBlock = regexp.MustCompile(`(?s)\{\s*id:\s*'([^']+)'.*?path:\s*'([^']+)'.*?\}`)

func parseTSEntries(t *testing.T, path string) []tsEntry {
	t.Helper()
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	matches := reEntryBlock.FindAllStringSubmatch(string(src), -1)
	if len(matches) == 0 {
		t.Fatalf("no entries parsed from %s — regex may be out of date with TS schema", path)
	}
	out := make([]tsEntry, 0, len(matches))
	seen := make(map[string]bool, len(matches))
	for _, m := range matches {
		id := strings.TrimSpace(m[1])
		p := strings.TrimSpace(m[2])
		if seen[id] {
			t.Errorf("duplicate id %q in TS source (sanity-check failure inside test)", id)
		}
		seen[id] = true
		out = append(out, tsEntry{ID: id, Path: p})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// formatEntries is a debug helper for failing tests — prints id+path
// columns. Not used in passing-path runs.
func formatEntries(es []tsEntry) string {
	if len(es) == 0 {
		return "(empty)"
	}
	var b strings.Builder
	for _, e := range es {
		fmt.Fprintf(&b, "  %-30s %s\n", e.ID, e.Path)
	}
	return b.String()
}

var _ = formatEntries // referenced for future failing-output use
