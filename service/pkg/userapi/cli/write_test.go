package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// TestWriteErr_StatusMap locks the I_* → HTTP status mapping that both the
// Web UI and CLI rely on. See the rationale block on WriteErr for why each
// code maps where it does.
func TestWriteErr_StatusMap(t *testing.T) {
	cases := []struct {
		code   string
		expect int
	}{
		{ErrVaultNoSession, 401},
		{ErrVaultLocked, 422},
		{ErrVaultUnlockFailed, 422},
		{"I_VAULT_KEY_INVALID", 422},
		{ErrBadRequest, 400},
		{ErrCliMalformedReply, 400},
		{"I_STDIN_INVALID_JSON", 400},
		{"I_CREDENTIAL_CONFLICT", 400},
		{ErrCliNotFound, 503},
		// Bugfix 20260523-test-connection-proxy-down-shows-local-server-error.md
		// pin: I_PROXY_NOT_RUNNING must NOT fall through to 500. The Vault
		// "Test connection" popup treats 5xx as "Local server is unavailable"
		// and steers users at `aikey service restart web` — wrong target when
		// the real fix is `aikey service start proxy`. 503 puts it in the
		// "dependency not running" family alongside ErrCliNotFound.
		{"I_PROXY_NOT_RUNNING", 503},
		{ErrCliTimeout, 504},
		// Phase 3B (2026-05-11) regression pin: team-key business-state
		// errors must NOT fall through to 500. Web UI shows
		// "Failed to set routing — status 500" for an honest "this team
		// key is currently revoked" event before this mapping was added.
		// 422 is the same family as I_VAULT_KEY_INVALID — keeps the FE
		// httpClient interceptor's 401-redirect logic out of the way.
		{"I_KEY_DISABLED", 422},
		{"I_KEY_NOT_DELIVERED", 422},
		{"I_KEY_STALE", 422},
		{"I_KEY_NO_PROVIDER", 422},
		{"I_INTERNAL", 500},
		{"I_SOMETHING_UNKNOWN", 500}, // fallback
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		WriteErr(rr, c.code, "msg")
		if rr.Code != c.expect {
			t.Errorf("%s: want %d got %d", c.code, c.expect, rr.Code)
		}
		var env JSONError
		if err := json.NewDecoder(rr.Body).Decode(&env); err != nil {
			t.Errorf("%s: body not JSON: %v", c.code, err)
			continue
		}
		if env.ErrorCode != c.code || env.Status != "error" {
			t.Errorf("%s: envelope mismatch: %+v", c.code, env)
		}
	}
}

// writeErrThroughLocale runs WriteErr behind the real shared.LocaleMiddleware
// (the Phase E mechanism) with the given Accept-Language, so LocaleFromWriter(w)
// resolves exactly as it does in the user-local mux — no hand-rolled locale
// writer. Returns the decoded error envelope.
func writeErrThroughLocale(t *testing.T, acceptLang, code, msg string) JSONError {
	t.Helper()
	h := shared.LocaleMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		WriteErr(w, code, msg)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if acceptLang != "" {
		req.Header.Set("Accept-Language", acceptLang)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	var env JSONError
	if err := json.NewDecoder(rr.Body).Decode(&env); err != nil {
		t.Fatalf("%s: body not JSON: %v", code, err)
	}
	if env.Status != "error" || env.ErrorCode != code {
		t.Fatalf("%s: SHAPE changed: %+v", code, env)
	}
	return env
}

// TestWriteErr_LocaleZh pins Phase E-2: zh requests with a known I_* code get
// the zh template; the response SHAPE (status + error_code) is unchanged.
func TestWriteErr_LocaleZh(t *testing.T) {
	env := writeErrThroughLocale(t, "zh-CN,zh;q=0.9", ErrVaultLocked, "vault is locked")
	if env.ErrorMessage != "保管库已锁定" {
		t.Errorf("zh message: want %q got %q", "保管库已锁定", env.ErrorMessage)
	}
}

// TestWriteErr_LocaleEnPassthrough pins that CLI/curl (no Accept-Language → en)
// keeps the passed English message verbatim.
func TestWriteErr_LocaleEnPassthrough(t *testing.T) {
	env := writeErrThroughLocale(t, "", ErrVaultLocked, "vault is locked")
	if env.ErrorMessage != "vault is locked" {
		t.Errorf("en passthrough: want %q got %q", "vault is locked", env.ErrorMessage)
	}
}

// TestWriteErr_LocaleZhUnknownCodeFallback pins that a zh request for a code
// without a zh template falls back to the passed English msg (no SHAPE change).
func TestWriteErr_LocaleZhUnknownCodeFallback(t *testing.T) {
	env := writeErrThroughLocale(t, "zh", "I_SOMETHING_UNKNOWN", "boom")
	if env.ErrorMessage != "boom" {
		t.Errorf("zh unknown-code fallback: want %q got %q", "boom", env.ErrorMessage)
	}
}

// TestZhWriteErrMessages_CoversWebSurface asserts every I_* code in WriteErr's
// status table (the web-reachable surface) has a zh template, so a new code
// can't silently regress to English under zh. I_SOMETHING_UNKNOWN is the
// test-only 500-fallback sentinel and is intentionally excluded.
func TestZhWriteErrMessages_CoversWebSurface(t *testing.T) {
	webCodes := []string{
		ErrVaultNoSession, ErrVaultLocked, ErrVaultUnlockFailed,
		"I_VAULT_KEY_INVALID", "I_VAULT_KEY_MALFORMED", "I_VAULT_NOT_INITIALIZED",
		"I_VAULT_ALREADY_INITIALIZED", ErrBadRequest, ErrCliMalformedReply,
		"I_STDIN_INVALID_JSON", "I_CREDENTIAL_CONFLICT", ErrOAuthAddViaCLI,
		ErrAppMutationDenied, ErrUnknownTarget, "I_CREDENTIAL_NOT_FOUND",
		"I_KEY_DISABLED", "I_KEY_NOT_DELIVERED", "I_KEY_STALE", "I_KEY_NO_PROVIDER",
		ErrAliasSuffixExhausted, ErrUnlockRateLimited, ErrCliNotFound,
		"I_PROXY_NOT_RUNNING", ErrCliTimeout,
	}
	for _, code := range webCodes {
		if _, ok := zhWriteErrMessages[code]; !ok {
			t.Errorf("missing zh template for web-reachable code %s", code)
		}
	}
}
