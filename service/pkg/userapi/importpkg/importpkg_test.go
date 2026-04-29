package importpkg

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// ── SessionStore ──────────────────────────────────────────────────────────

func TestSessionStore_PutGet_Roundtrip(t *testing.T) {
	s := NewSessionStore(5 * time.Second)
	id, _ := s.put("deadbeef")
	got, ttl, ok := s.get(id)
	if !ok || got != "deadbeef" {
		t.Fatalf("get after put: ok=%v got=%q", ok, got)
	}
	if ttl < time.Second {
		t.Fatalf("ttl too short: %s", ttl)
	}
}

func TestSessionStore_Expired_Evicted(t *testing.T) {
	s := NewSessionStore(10 * time.Millisecond)
	id, _ := s.put("abc")
	time.Sleep(20 * time.Millisecond)
	if _, _, ok := s.get(id); ok {
		t.Fatal("expired session must not resolve")
	}
}

func TestSessionStore_Delete_Idempotent(t *testing.T) {
	s := NewSessionStore(time.Minute)
	id, _ := s.put("x")
	s.delete(id)
	s.delete(id) // second delete must not panic
	if _, _, ok := s.get(id); ok {
		t.Fatal("deleted session must not resolve")
	}
}

func TestSessionStore_Get_HardExpire(t *testing.T) {
	// Hard-expire policy (2026-04-24 security review): session expiry is fixed
	// at unlock time and is NOT extended by subsequent activity. The previous
	// sliding-TTL behavior was defeated by the front-end status poll (every
	// 10s) which kept any open tab unlocked indefinitely; the idle auto-lock
	// UX guarantee now requires password re-entry at expiry regardless of
	// background polling.
	s := NewSessionStore(100 * time.Millisecond)
	id, _ := s.put("x")
	time.Sleep(50 * time.Millisecond)
	if _, ttl, ok := s.get(id); !ok {
		t.Fatal("session should still be alive at 50ms")
	} else if ttl > 60*time.Millisecond {
		t.Fatalf("ttl should reflect remaining lifetime (<=50ms), got %v", ttl)
	}
	// Second get — must NOT extend. Absolute age is ~100ms; expect expired.
	time.Sleep(60 * time.Millisecond)
	if _, _, ok := s.get(id); ok {
		t.Fatal("session must hard-expire at the absolute deadline regardless of prior gets")
	}
}

// ── VKCache ───────────────────────────────────────────────────────────────

func TestVKCache_HitAndMiss(t *testing.T) {
	c := NewVKCache(time.Minute)
	if _, ok := c.Get("k"); ok {
		t.Fatal("empty cache must miss")
	}
	c.Set("k", []byte("value"))
	v, ok := c.Get("k")
	if !ok || string(v) != "value" {
		t.Fatalf("hit failed: ok=%v value=%q", ok, v)
	}
}

func TestVKCache_Expired_EvictsOnRead(t *testing.T) {
	c := NewVKCache(10 * time.Millisecond)
	c.Set("k", []byte("v"))
	time.Sleep(20 * time.Millisecond)
	if _, ok := c.Get("k"); ok {
		t.Fatal("expired cache entry must not be returned")
	}
}

func TestVKCache_Invalidate(t *testing.T) {
	c := NewVKCache(time.Minute)
	c.Set("k", []byte("v"))
	c.Invalidate("k")
	if _, ok := c.Get("k"); ok {
		t.Fatal("invalidated key must miss")
	}
}

// ── writeErr HTTP status mapping ──────────────────────────────────────────

func TestWriteErr_StatusMap(t *testing.T) {
	cases := []struct {
		code   string
		expect int
	}{
		// 401 only for "no session cookie at all" — distinguishes from
		// "bad vault password" so the httpClient login-redirect interceptor
		// doesn't fire on password typos (self-review 2026-04-22).
		{ErrVaultNoSession, 401},
		// 422 for vault-password-specific failures (semantically:
		// well-formed request, but vault business state rejects it).
		{ErrVaultLocked, 422},
		{ErrVaultUnlockFailed, 422},
		{"I_VAULT_KEY_INVALID", 422},
		{ErrBadRequest, 400},
		{ErrCliMalformedReply, 400},
		{"I_STDIN_INVALID_JSON", 400},
		{"I_CREDENTIAL_CONFLICT", 400},
		{ErrCliNotFound, 503},
		{ErrCliTimeout, 504},
		{"I_INTERNAL", 500},
		{"I_SOMETHING_UNKNOWN", 500}, // fallback
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		writeErr(rr, c.code, "msg")
		if rr.Code != c.expect {
			t.Errorf("%s: want %d got %d", c.code, c.expect, rr.Code)
		}
		var env jsonError
		if err := json.NewDecoder(rr.Body).Decode(&env); err != nil {
			t.Errorf("%s: body not JSON: %v", c.code, err)
			continue
		}
		if env.ErrorCode != c.code || env.Status != "error" {
			t.Errorf("%s: envelope mismatch: %+v", c.code, env)
		}
	}
}

// ── VaultHandlers.allowUnlock (brute-force rate limit) ──────────────────

func TestAllowUnlock_ThrottlesAfterBudget(t *testing.T) {
	h := &VaultHandlers{}
	key := "203.0.113.7"
	// First 10 attempts must pass; 11th must be rejected.
	for i := 0; i < unlockRateLimitMax; i++ {
		if !h.allowUnlock(key) {
			t.Fatalf("attempt %d should be allowed (budget=%d)", i+1, unlockRateLimitMax)
		}
	}
	if h.allowUnlock(key) {
		t.Fatalf("attempt %d must be rate-limited", unlockRateLimitMax+1)
	}
	// Different source key must have its own budget — critical: a blocked
	// attacker must not leak denial onto a legitimate neighbour sharing the
	// server.
	if !h.allowUnlock("198.51.100.4") {
		t.Fatal("different IP must get its own budget")
	}
}

// ── VaultHandlers.StatusHandler (session-less fast path) ─────────────────

func TestStatusHandler_NoCookie_ReturnsLocked(t *testing.T) {
	h := &VaultHandlers{Store: NewSessionStore(time.Minute)}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/user/vault/status", nil)
	h.StatusHandler(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status: %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"unlocked":false`) {
		t.Fatalf("body missing unlocked:false: %q", body)
	}
}

func TestStatusHandler_ValidCookie_ReturnsUnlockedWithTTL(t *testing.T) {
	store := NewSessionStore(2 * time.Minute)
	id, _ := store.put("deadbeef")
	h := &VaultHandlers{Store: store}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/user/vault/status", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: id})
	h.StatusHandler(rr, req)
	body := rr.Body.String()
	if !strings.Contains(body, `"unlocked":true`) {
		t.Fatalf("expected unlocked:true, got %q", body)
	}
	if !strings.Contains(body, `"ttl_seconds"`) {
		t.Fatalf("expected ttl_seconds, got %q", body)
	}
}

// ── RequireUnlock middleware ──────────────────────────────────────────────

func TestRequireUnlock_BlocksWhenNoCookie(t *testing.T) {
	h := &VaultHandlers{Store: NewSessionStore(time.Minute)}
	called := false
	wrapped := h.RequireUnlock(func(w http.ResponseWriter, r *http.Request) { called = true })
	rr := httptest.NewRecorder()
	wrapped(rr, httptest.NewRequest(http.MethodPost, "/api/user/import/confirm", nil))
	if called {
		t.Fatal("inner handler must NOT run without session")
	}
	// No cookie at all -> 401 (session absent, top-level auth problem).
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}
}

func TestRequireUnlock_PassesVaultKeyToContext(t *testing.T) {
	store := NewSessionStore(time.Minute)
	id, _ := store.put("my-hex-key")
	h := &VaultHandlers{Store: store}
	var seen string
	wrapped := h.RequireUnlock(func(w http.ResponseWriter, r *http.Request) {
		k, ok := vaultKeyFrom(r.Context())
		if !ok {
			t.Error("vaultKeyFrom: not present")
			return
		}
		seen = k
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/user/import/confirm", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: id})
	wrapped(rr, req)
	if seen != "my-hex-key" {
		t.Fatalf("vault key not propagated: %q", seen)
	}
}

// ── RulesHandler (static response) ────────────────────────────────────────

func TestRulesHandler_ReturnsStaticLayerVersions(t *testing.T) {
	h := &ImportHandlers{}
	rr := httptest.NewRecorder()
	h.RulesHandler(rr, httptest.NewRequest(http.MethodGet, "/api/user/import/rules", nil))
	if rr.Code != 200 {
		t.Fatalf("want 200 got %d", rr.Code)
	}
	var resp struct {
		Status string `json:"status"`
		Data   struct {
			LayerVersions   map[string]string `json:"layer_versions"`
			FamilyBaseURLs  map[string]string `json:"family_base_urls"`
			FamilyLoginURLs map[string]string `json:"family_login_urls"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Status != "ok" {
		t.Fatalf("status: %q", resp.Status)
	}
	if resp.Data.LayerVersions["rules"] == "" {
		t.Fatal("rules version missing")
	}
	// family_base_urls is the auto-fill source for the Import page Use-Official
	// rules; absence breaks Rule 2 (host match) and Rule 3 (single-protocol
	// auto-fill) silently. With Bridge=nil the handler falls back to its
	// hardcoded snapshot, so this asserts the snapshot stays in step with
	// the YAML even if the cli is unreachable.
	if got := resp.Data.FamilyBaseURLs["anthropic"]; got != "https://api.anthropic.com" {
		t.Fatalf("family_base_urls[anthropic] = %q, want https://api.anthropic.com", got)
	}
	if _, ok := resp.Data.FamilyBaseURLs["openai"]; !ok {
		t.Fatal("family_base_urls missing openai")
	}
	// family_login_urls covers the browser-facing hosts that aren't in
	// family_base_urls (e.g. aistudio.google.com, dashscope.console.aliyun.com).
	// These are needed for Rule 2 to match users who paste the API-key
	// management page URL — the gap that motivated adding this map.
	if got := resp.Data.FamilyLoginURLs["google_gemini"]; got != "https://aistudio.google.com/app/apikey" {
		t.Fatalf("family_login_urls[google_gemini] = %q, want aistudio.google.com URL", got)
	}
	if got := resp.Data.FamilyLoginURLs["qwen"]; got != "https://dashscope.console.aliyun.com/apiKey" {
		t.Fatalf("family_login_urls[qwen] = %q, want dashscope.console.aliyun.com URL", got)
	}
}

// TestRulesHandler_DelegatesToCliWhenAvailable verifies the live-cli path:
// when a Bridge is wired and the cli responds with an `ok` envelope, the
// handler passes the cli's data through verbatim instead of serving the
// hardcoded fallback. Uses a tmp shell stub as the "aikey" binary —
// skipped on Windows because the script isn't directly executable there.
func TestRulesHandler_DelegatesToCliWhenAvailable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script stub not directly invocable on Windows")
	}
	stubDir := t.TempDir()
	stubPath := filepath.Join(stubDir, "aikey")
	// The stub ignores its arguments / stdin and emits a fixed envelope.
	// `cli_from_stub` lets the test detect we hit the cli path (vs fallback,
	// which would say "anthropic": "https://api.anthropic.com").
	const stubBody = `#!/bin/sh
cat <<'JSON'
{"status":"ok","data":{"layer_versions":{"rules":"stub","crf":"stub","fingerprint":"stub"},"family_base_urls":{"anthropic":"cli_from_stub"},"family_login_urls":{},"sample_providers":[]}}
JSON
`
	if err := os.WriteFile(stubPath, []byte(stubBody), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	t.Setenv("AIKEY_CLI_PATH", stubPath)

	bridge := NewCliBridge(nil)
	h := &ImportHandlers{Bridge: bridge}
	rr := httptest.NewRecorder()
	h.RulesHandler(rr, httptest.NewRequest(http.MethodGet, "/api/user/import/rules", nil))
	if rr.Code != 200 {
		t.Fatalf("want 200 got %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Status string `json:"status"`
		Data   struct {
			FamilyBaseURLs map[string]string `json:"family_base_urls"`
			LayerVersions  map[string]string `json:"layer_versions"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v body=%s", err, rr.Body.String())
	}
	// Hit the stub, not the fallback: the stub's anthropic URL is the marker.
	if got := resp.Data.FamilyBaseURLs["anthropic"]; got != "cli_from_stub" {
		t.Fatalf("expected stub envelope to be passed through, got anthropic=%q (full: %+v)", got, resp.Data)
	}
	if got := resp.Data.LayerVersions["rules"]; got != "stub" {
		t.Fatalf("layer_versions.rules = %q, want stub", got)
	}
}

// TestRulesHandler_FallsBackWhenCliFails ensures the fallback path triggers
// when the cli binary blows up (non-zero exit). Stale fallback data is
// strictly better than a 5xx that breaks the import page entirely.
func TestRulesHandler_FallsBackWhenCliFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script stub not directly invocable on Windows")
	}
	stubDir := t.TempDir()
	stubPath := filepath.Join(stubDir, "aikey")
	// Stub that exits non-zero with stderr noise — simulates panic or crash.
	const stubBody = `#!/bin/sh
echo "boom" 1>&2
exit 17
`
	if err := os.WriteFile(stubPath, []byte(stubBody), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	t.Setenv("AIKEY_CLI_PATH", stubPath)

	bridge := NewCliBridge(nil)
	h := &ImportHandlers{Bridge: bridge}
	rr := httptest.NewRecorder()
	h.RulesHandler(rr, httptest.NewRequest(http.MethodGet, "/api/user/import/rules", nil))
	if rr.Code != 200 {
		t.Fatalf("want 200 got %d (handler must serve fallback even on cli failure)", rr.Code)
	}
	var resp struct {
		Status string `json:"status"`
		Data   struct {
			FamilyBaseURLs map[string]string `json:"family_base_urls"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Hardcoded fallback has the real anthropic URL — anything else means
	// we accidentally surfaced cli failure to the wire.
	if got := resp.Data.FamilyBaseURLs["anthropic"]; got != "https://api.anthropic.com" {
		t.Fatalf("fallback not served on cli failure: anthropic=%q", got)
	}
}
