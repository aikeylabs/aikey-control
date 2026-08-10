package shared

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// HandleWithLegacyPath is the whole back-compat story for a renamed endpoint.
// If it silently stopped serving the legacy pattern, every already-shipped
// client (offline-package web bundles, older member nodes, admin scripts) would
// 404 at upgrade time — and nothing else in the tree would notice.
//
// 能红:
//   - drop the mux.Handle(legacy, …) line → the legacy-path assertions fail.
//   - drop the WARN → the deprecation-evidence assertion fails (and with it the
//     only signal that would ever let us delete the alias).
//   - rename a wildcard in only one pattern → the PathValue assertion fails.
func TestHandleWithLegacyPath_ServesBothAndWarnsOnLegacy(t *testing.T) {
	var logBuf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	var seenSeat []string
	mux := http.NewServeMux()
	HandleWithLegacyPath(mux,
		"GET /orgs/{orgID}/access-tokens/{seatID}/vk",
		"GET /orgs/{orgID}/agents/{seatID}/vk",
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenSeat = append(seenSeat, r.PathValue("seatID"))
			w.WriteHeader(http.StatusOK)
		}))

	for _, tc := range []struct{ name, path string }{
		{"canonical", "/orgs/o1/access-tokens/s1/vk"},
		{"legacy", "/orgs/o1/agents/s1/vk"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s path %s: status %d, want 200 — a shipped client would see a 404 here",
				tc.name, tc.path, rec.Code)
		}
	}

	// Wildcards must resolve on BOTH patterns. If the two declare different
	// wildcard names the handler reads "" on one of them and fails in a way no
	// status code reveals.
	if len(seenSeat) != 2 || seenSeat[0] != "s1" || seenSeat[1] != "s1" {
		t.Fatalf("seatID did not resolve on both patterns: %#v", seenSeat)
	}

	// The legacy hit — and ONLY the legacy hit — must leave deprecation evidence.
	var warns int
	for _, line := range strings.Split(strings.TrimSpace(logBuf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line is not JSON: %q", line)
		}
		if rec["event.name"] == EventControlLegacyAPIPathUsed {
			warns++
			if rec["canonical_pattern"] == nil || rec["legacy_pattern"] == nil {
				t.Errorf("deprecation WARN lacks the patterns needed to act on it: %v", rec)
			}
		}
	}
	if warns != 1 {
		t.Fatalf("legacy-path deprecation WARNs = %d, want exactly 1 (canonical must stay silent); log:\n%s",
			warns, logBuf.String())
	}
}
