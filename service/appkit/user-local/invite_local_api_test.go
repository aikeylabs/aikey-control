package userlocal

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// writeIdentityFile creates a tmpdir + identity file holding the given
// uuid. Returns the file path the test should plumb into
// InviteLocalAPIConfig.IdentityPath.
func writeIdentityFile(t *testing.T, id string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "identity")
	if err := os.WriteFile(path, []byte(id+"\n"), 0o600); err != nil {
		t.Fatalf("write identity: %v", err)
	}
	return path
}

// fakeMainSite is a minimal stub that records the body it received and
// echoes a canned response. Tests use it to assert that the local-API
// forwards installer_id from disk (not from request body) and that the
// response is relayed verbatim.
type fakeMainSite struct {
	t            *testing.T
	mu           sync.Mutex
	lastPath     string
	lastBody     map[string]any
	canResp      []byte
	canStatus    int
	server       *httptest.Server
	requestCount atomic.Int32
}

func newFakeMainSite(t *testing.T) *fakeMainSite {
	t.Helper()
	f := &fakeMainSite{
		t:         t,
		canStatus: http.StatusOK,
		canResp:   []byte(`{"code":"ABCDE12345","url":"https://aikeylabs.com/i/inv/ABCDE12345","created_at":"2026-05-18T12:00:00Z"}`),
	}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requestCount.Add(1)
		bodyBytes, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.lastPath = r.URL.Path
		_ = json.Unmarshal(bodyBytes, &f.lastBody)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(f.canStatus)
		_, _ = w.Write(f.canResp)
	}))
	t.Cleanup(f.server.Close)
	return f
}

// inviteAPIWithFakeMainSite returns an InviteLocalAPI handler wired to
// the fake main-site server + a tmp identity file + a baseline CSRF
// config. Returns the wrapper handler so tests don't repeat boilerplate.
func inviteAPIWithFakeMainSite(t *testing.T, installerID string, fake *fakeMainSite) (http.Handler, shared.LocalAPIConfig) {
	t.Helper()
	idPath := writeIdentityFile(t, installerID)
	cfg := InviteLocalAPIConfig{
		MainSiteBaseURL: fake.server.URL,
		LocalAPICfg: shared.LocalAPIConfig{
			AllowedOrigins: []string{"http://127.0.0.1:8090"},
			CSRFKey:        bytes.Repeat([]byte("k"), 32),
			RateLimiter:    shared.NewLocalAPIRateLimiter(10, time.Minute),
		},
		IdentityPath: idPath,
		HTTPClient:   fake.server.Client(),
	}
	return NewInviteLocalAPI(cfg), cfg.LocalAPICfg
}

// mintCSRFToken hits GET /local-api/csrf-token through the handler and
// returns (token, cookieHeaderValue). Both are needed for the
// double-submit on subsequent POSTs.
func mintCSRFToken(t *testing.T, handler http.Handler) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/local-api/csrf-token", nil)
	req.Header.Set("Origin", "http://127.0.0.1:8090")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("csrf-token: want 200, got %d", rec.Code)
	}
	var body struct{ Token string `json:"token"` }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode csrf body: %v", err)
	}
	if body.Token == "" {
		t.Fatal("empty token")
	}
	return body.Token
}

func newLocalAPIPost(t *testing.T, path, body, csrf string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://127.0.0.1:8090")
	r.AddCookie(&http.Cookie{Name: shared.CSRFCookieName, Value: csrf})
	r.Header.Set(shared.CSRFHeaderName, csrf)
	return r
}

func TestInviteLocalAPI_Create_ReadsInstallerIDFromDisk(t *testing.T) {
	t.Parallel()

	const id = "11111111-2222-4333-8444-555555555555"
	fake := newFakeMainSite(t)
	handler, _ := inviteAPIWithFakeMainSite(t, id, fake)
	csrf := mintCSRFToken(t, handler)

	// Page lies about installer_id by sending a bogus value in the
	// body. The handler MUST ignore it and use the disk value.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newLocalAPIPost(t, "/local-api/invite/create",
		`{"creator_installer_id":"deadbeef-0000-4000-8000-000000000000","creator_channel":"wechat"}`, csrf))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if fake.lastPath != "/invite" {
		t.Errorf("upstream path: want /invite, got %q", fake.lastPath)
	}
	got, _ := fake.lastBody["creator_installer_id"].(string)
	if got != id {
		t.Errorf("forwarded installer_id: want %q (from disk), got %q", id, got)
	}
	ch, _ := fake.lastBody["creator_channel"].(string)
	if ch != "wechat" {
		t.Errorf("forwarded channel: want wechat, got %q", ch)
	}
}

func TestInviteLocalAPI_Create_RelaysUpstreamBody(t *testing.T) {
	t.Parallel()

	fake := newFakeMainSite(t)
	handler, _ := inviteAPIWithFakeMainSite(t, "11111111-2222-4333-8444-555555555555", fake)
	csrf := mintCSRFToken(t, handler)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newLocalAPIPost(t, "/local-api/invite/create", `{}`, csrf))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"code":"ABCDE12345"`) {
		t.Errorf("response should pass main-site body verbatim, got: %s", body)
	}
	if !strings.Contains(body, `"url":"https://aikeylabs.com/i/inv/ABCDE12345"`) {
		t.Errorf("response should include url, got: %s", body)
	}
}

func TestInviteLocalAPI_Revoke_ReadsInstallerIDFromDisk(t *testing.T) {
	t.Parallel()

	const id = "11111111-2222-4333-8444-555555555555"
	fake := newFakeMainSite(t)
	fake.canResp = []byte(`{"status":"revoked","code":"ABCDE12345"}`)
	handler, _ := inviteAPIWithFakeMainSite(t, id, fake)
	csrf := mintCSRFToken(t, handler)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newLocalAPIPost(t, "/local-api/invite/revoke", `{"code":"ABCDE12345"}`, csrf))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if fake.lastPath != "/invite/revoke" {
		t.Errorf("upstream path: want /invite/revoke, got %q", fake.lastPath)
	}
	got, _ := fake.lastBody["installer_id"].(string)
	if got != id {
		t.Errorf("forwarded installer_id: want %q (from disk), got %q", id, got)
	}
	gotCode, _ := fake.lastBody["code"].(string)
	if gotCode != "ABCDE12345" {
		t.Errorf("forwarded code: want ABCDE12345, got %q", gotCode)
	}
}

func TestInviteLocalAPI_Revoke_RelaysUpstream403(t *testing.T) {
	t.Parallel()

	fake := newFakeMainSite(t)
	fake.canStatus = http.StatusForbidden
	fake.canResp = []byte(`{"status":"forbidden","message":"requester is not the creator of this invite"}`)
	handler, _ := inviteAPIWithFakeMainSite(t, "11111111-2222-4333-8444-555555555555", fake)
	csrf := mintCSRFToken(t, handler)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newLocalAPIPost(t, "/local-api/invite/revoke", `{"code":"OTHER01234"}`, csrf))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403 (relayed), got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "forbidden") {
		t.Errorf("response body should relay upstream forbidden message, got: %s", rec.Body.String())
	}
}

func TestInviteLocalAPI_RejectsMissingIdentityFile(t *testing.T) {
	t.Parallel()

	fake := newFakeMainSite(t)
	dir := t.TempDir()
	cfg := InviteLocalAPIConfig{
		MainSiteBaseURL: fake.server.URL,
		LocalAPICfg: shared.LocalAPIConfig{
			AllowedOrigins: []string{"http://127.0.0.1:8090"},
			CSRFKey:        bytes.Repeat([]byte("k"), 32),
			RateLimiter:    shared.NewLocalAPIRateLimiter(10, time.Minute),
		},
		IdentityPath: filepath.Join(dir, "no-such-file"),
	}
	handler := NewInviteLocalAPI(cfg)
	csrf := mintCSRFToken(t, handler)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newLocalAPIPost(t, "/local-api/invite/create", `{}`, csrf))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "identity_missing") {
		t.Errorf("response should signal identity_missing, got: %s", rec.Body.String())
	}
	// Critically: no upstream call.
	if fake.requestCount.Load() != 0 {
		t.Errorf("upstream must not be called when identity is missing, got %d requests", fake.requestCount.Load())
	}
}

func TestInviteLocalAPI_RejectsCrossOriginPOST(t *testing.T) {
	t.Parallel()

	fake := newFakeMainSite(t)
	handler, _ := inviteAPIWithFakeMainSite(t, "11111111-2222-4333-8444-555555555555", fake)
	csrf := mintCSRFToken(t, handler)

	// Forge Origin from a third-party site. Even with a valid CSRF cookie
	// stolen by some other means, the Origin-deny gate must catch this.
	req := httptest.NewRequest(http.MethodPost, "/local-api/invite/create", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example.com")
	req.AddCookie(&http.Cookie{Name: shared.CSRFCookieName, Value: csrf})
	req.Header.Set(shared.CSRFHeaderName, csrf)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin POST: want 403, got %d", rec.Code)
	}
	if fake.requestCount.Load() != 0 {
		t.Errorf("cross-origin must not reach upstream, got %d requests", fake.requestCount.Load())
	}
}

func TestInviteLocalAPI_RejectsMissingCSRF(t *testing.T) {
	t.Parallel()

	fake := newFakeMainSite(t)
	handler, _ := inviteAPIWithFakeMainSite(t, "11111111-2222-4333-8444-555555555555", fake)

	// No CSRF cookie, no header.
	req := httptest.NewRequest(http.MethodPost, "/local-api/invite/create", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:8090")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF: want 403, got %d", rec.Code)
	}
	if fake.requestCount.Load() != 0 {
		t.Errorf("missing-CSRF must not reach upstream, got %d", fake.requestCount.Load())
	}
}

func TestInviteLocalAPI_RejectsRevokeWithMissingCode(t *testing.T) {
	t.Parallel()

	fake := newFakeMainSite(t)
	handler, _ := inviteAPIWithFakeMainSite(t, "11111111-2222-4333-8444-555555555555", fake)
	csrf := mintCSRFToken(t, handler)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, newLocalAPIPost(t, "/local-api/invite/revoke", `{"code":""}`, csrf))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty code: want 400, got %d", rec.Code)
	}
	if fake.requestCount.Load() != 0 {
		t.Errorf("empty code must not reach upstream, got %d", fake.requestCount.Load())
	}
}
