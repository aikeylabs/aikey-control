package userlocal

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Regression guard for bugfix 20260725-team-url-probe-honors-system-proxy.
//
// The Control Service URL "Test connectivity" probe must connect DIRECTLY to the
// team server, bypassing HTTP_PROXY/HTTPS_PROXY — because the real team-server
// client (Rust CLI PlatformClient / ureq) connects direct. If the probe honored
// the system proxy (http.DefaultTransport's ProxyFromEnvironment) it would lie
// relative to the real CLI: a user with Clash-style HTTP_PROXY set could see the
// probe time out through the proxy while the CLI would actually connect fine
// (the reported symptom).
//
// This asserts the structural invariant (Proxy==nil) rather than driving env
// vars, because Go caches ProxyFromEnvironment once per test binary — an env-var
// test could false-pass after a revert.
func TestNewTeamProbeClient_BypassesSystemProxy(t *testing.T) {
	client := newTeamProbeClient()

	tr, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("probe client Transport = %T, want *http.Transport (a nil Transport falls back to DefaultTransport, which honors the system proxy)", client.Transport)
	}
	if tr.Proxy != nil {
		t.Fatalf("probe client Transport.Proxy is non-nil; it must be nil so the probe bypasses HTTP_PROXY and mirrors the direct-connect CLI client")
	}
}

// Live-path guard: a reachable /health returns reachable=true. This also anchors
// that the handler actually uses newTeamProbeClient (green path stays intact
// after the transport change).
func TestHandleProbeTeamURL_ReachableHealth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := handleProbeTeamURL(logger)

	body, _ := json.Marshal(map[string]string{"url": srv.URL})
	req := httptest.NewRequest(http.MethodPost, "/system/team-url/probe", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	if out["reachable"] != true {
		t.Fatalf("reachable = %v, want true for a live /health returning 200 (body=%s)", out["reachable"], rec.Body.String())
	}
}
