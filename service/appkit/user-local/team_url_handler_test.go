package userlocal

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Test the GET /system/team-url response shape, specifically the 2026-06-30
// `configured_url` fallback field added so the Settings page can re-display a
// control URL that was saved (to config.json) before the user ran
// `aikey login`. Regression guard: `team_url` must keep its independent
// "logged into a team" semantics (the cross-app sidebar menu clears team nav
// when it's empty), so `configured_url` is an ADDITIVE field — never folded
// into team_url.
func decodeTeamURL(t *testing.T, h http.HandlerFunc) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/system/team-url", nil)
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode body %q: %v", body, err)
	}
	return out
}

func TestHandleTeamURL_NotLoggedIn_FallsBackToConfiguredURL(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	// vault empty (not logged in) but config.json has a saved URL.
	read := func() (string, error) { return "", nil }
	readConfigured := func() (string, error) { return "http://192.168.1.10:3000", nil }

	out := decodeTeamURL(t, handleTeamURL(read, readConfigured, logger))

	if out["team_url"] != "" {
		t.Errorf("team_url = %v, want empty (not logged into a team)", out["team_url"])
	}
	if out["configured_url"] != "http://192.168.1.10:3000" {
		t.Errorf("configured_url = %v, want the saved config.json URL", out["configured_url"])
	}
}

func TestHandleTeamURL_LoggedIn_KeepsTeamURL(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	read := func() (string, error) { return "http://team.example:3000", nil }
	readConfigured := func() (string, error) { return "http://team.example:3000", nil }

	out := decodeTeamURL(t, handleTeamURL(read, readConfigured, logger))

	if out["team_url"] != "http://team.example:3000" {
		t.Errorf("team_url = %v, want the vault URL", out["team_url"])
	}
}

// When no configured-URL reader is wired (e.g. test harness / Production where
// the field is irrelevant), the response must omit configured_url entirely so
// existing consumers that only read team_url are unaffected.
func TestHandleTeamURL_NoConfiguredReader_OmitsField(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	read := func() (string, error) { return "", nil }

	out := decodeTeamURL(t, handleTeamURL(read, nil, logger))

	if _, present := out["configured_url"]; present {
		t.Errorf("configured_url present (%v) but no reader was wired; want omitted", out["configured_url"])
	}
}
