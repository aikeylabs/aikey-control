// Package sharedtest holds test helpers shared across the member and master
// service repos (master imports aikey-control/service, so its tests can call
// these too — one ratchet implementation, two allowlists).
package sharedtest

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// CheckWireExitRatchet fails the test when any non-test .go file under root
// contains a direct `json.NewEncoder(w` exit that is not in allowed, or when
// allowed carries a stale entry. See pkg/shared/wire_exit_ratchet_test.go for
// the rationale (nil-slice→null defect class, normalised at shared.JSON).
func CheckWireExitRatchet(t *testing.T, root string, allowed map[string]string) {
	t.Helper()
	var offenders []string
	found := map[string]bool{}
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			base := info.Name()
			if base == "vendor" || base == "node_modules" || strings.HasPrefix(base, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		// The needle is split so this scanner does not find itself.
		if !strings.Contains(string(src), "json.NewEncoder"+"(w)") {
			return nil
		}
		rel := filepath.ToSlash(strings.TrimPrefix(p, root+string(os.PathSeparator)))
		found[rel] = true
		if _, frozen := allowed[rel]; !frozen {
			offenders = append(offenders, rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	sort.Strings(offenders)
	if len(offenders) > 0 {
		t.Fatalf("new direct json.NewEncoder"+"(w) exit(s):\n  %s\n\n"+
			"Responses must leave through shared.JSON — that is where nil slices are\n"+
			"normalised to [] (respond_nilslice.go; 4 shipped null-array crashes) and\n"+
			"where future wire-wide behaviour lives. If this handler truly cannot use\n"+
			"it (streaming/NDJSON), add the file to the allowlist WITH the reason.",
			strings.Join(offenders, "\n  "))
	}

	var stale []string
	for rel := range allowed {
		if !found[rel] {
			stale = append(stale, rel)
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Fatalf("ratchet allowlist entries whose files no longer encode directly "+
			"(or moved) — delete them so the ratchet stays tight:\n  %s",
			strings.Join(stale, "\n  "))
	}
}
