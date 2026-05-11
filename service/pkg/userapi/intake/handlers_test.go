package intake

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// TestRulesHandler_ReturnsStaticLayerVersions covers the fallback path: with
// Bridge=nil the handler serves the hardcoded snapshot, which the Web Import
// page consumes for Use-Official auto-fill rules.
//
// 2026-05-11 (rc3): contract changed when kimi dual-platform split landed
// (commit a1409f1) — `family_base_urls` was retired in favor of the per-host
// `provider_routes` table (single source of truth across cli + proxy +
// fallback). Asserting on `provider_routes` here keeps the test aligned with
// the actual handler output.
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
			ProviderRoutes  []map[string]any  `json:"provider_routes"`
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
	if len(resp.Data.ProviderRoutes) == 0 {
		t.Fatal("provider_routes must have entries")
	}
	// Anthropic route should be present + point at api.anthropic.com.
	var foundAnthropic bool
	for _, r := range resp.Data.ProviderRoutes {
		if r["provider"] == "anthropic" && r["base_url"] == "https://api.anthropic.com" {
			foundAnthropic = true
			break
		}
	}
	if !foundAnthropic {
		t.Fatal("provider_routes missing anthropic entry pointing at https://api.anthropic.com")
	}
	// OpenAI route should be present too (any host/base_url; we only assert
	// the provider key exists for cross-check with cli's yaml).
	var foundOpenAI bool
	for _, r := range resp.Data.ProviderRoutes {
		if r["provider"] == "openai" {
			foundOpenAI = true
			break
		}
	}
	if !foundOpenAI {
		t.Fatal("provider_routes missing openai entry")
	}
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
// hardcoded fallback.
func TestRulesHandler_DelegatesToCliWhenAvailable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script stub not directly invocable on Windows")
	}
	stubDir := t.TempDir()
	stubPath := filepath.Join(stubDir, "aikey")
	const stubBody = `#!/bin/sh
cat <<'JSON'
{"status":"ok","data":{"layer_versions":{"rules":"stub","crf":"stub","fingerprint":"stub"},"family_base_urls":{"anthropic":"cli_from_stub"},"family_login_urls":{},"sample_providers":[]}}
JSON
`
	if err := os.WriteFile(stubPath, []byte(stubBody), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	t.Setenv("AIKEY_CLI_PATH", stubPath)

	bridge := cli.New(nil)
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
	if got := resp.Data.FamilyBaseURLs["anthropic"]; got != "cli_from_stub" {
		t.Fatalf("expected stub envelope to be passed through, got anthropic=%q (full: %+v)", got, resp.Data)
	}
	if got := resp.Data.LayerVersions["rules"]; got != "stub" {
		t.Fatalf("layer_versions.rules = %q, want stub", got)
	}
}

// TestRulesHandler_FallsBackWhenCliFails ensures the fallback path triggers
// when the cli binary blows up (non-zero exit).
func TestRulesHandler_FallsBackWhenCliFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script stub not directly invocable on Windows")
	}
	stubDir := t.TempDir()
	stubPath := filepath.Join(stubDir, "aikey")
	const stubBody = `#!/bin/sh
echo "boom" 1>&2
exit 17
`
	if err := os.WriteFile(stubPath, []byte(stubBody), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	t.Setenv("AIKEY_CLI_PATH", stubPath)

	bridge := cli.New(nil)
	h := &ImportHandlers{Bridge: bridge}
	rr := httptest.NewRecorder()
	h.RulesHandler(rr, httptest.NewRequest(http.MethodGet, "/api/user/import/rules", nil))
	if rr.Code != 200 {
		t.Fatalf("want 200 got %d (handler must serve fallback even on cli failure)", rr.Code)
	}
	var resp struct {
		Status string `json:"status"`
		Data   struct {
			ProviderRoutes []map[string]any `json:"provider_routes"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Fallback must include the anthropic route pointing at api.anthropic.com
	// — same assertion as the no-bridge fallback test above.
	var foundAnthropic bool
	for _, r := range resp.Data.ProviderRoutes {
		if r["provider"] == "anthropic" && r["base_url"] == "https://api.anthropic.com" {
			foundAnthropic = true
			break
		}
	}
	if !foundAnthropic {
		t.Fatalf("fallback not served on cli failure: provider_routes missing anthropic entry")
	}
}
