package oauth

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Fences for bugfix 2026-07-29 (web add-OAuth-account with the proxy down
// showed a bare "502").
//
// The relay's 502 envelope is the SINGLE SOURCE for what the user reads in
// that state — the web client renders its message verbatim. So the envelope
// must be a complete self-service path (why / check / fix / retry), not a
// status code with a sentence fragment.

// deadPort returns a port with nothing listening (bound then released).
func deadPort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	_, port, _ := net.SplitHostPort(l.Addr().String())
	_ = l.Close()
	return port
}

// 🔴 THE fence: proxy down → 502 with the full guidance, on BOTH the personal
// and the pool relay legs (they must never drift apart).
//
// 能红: shorten the writeProxyUnavailable message (drop `aikey proxy status`
// or the start command) → the substring assertions fail.
func TestForward_ProxyDownYieldsActionableEnvelope(t *testing.T) {
	t.Setenv("AIKEY_PROXY_PORT", deadPort(t))

	legs := []struct {
		name    string
		handler http.HandlerFunc
		req     *http.Request
	}{
		{"personal login", LoginHandler,
			httptest.NewRequest(http.MethodPost, "/api/user/oauth/login", strings.NewReader(`{"provider":"codex"}`))},
		{"pool authorize-url", PoolAuthorizeURLHandler,
			httptest.NewRequest(http.MethodPost, "/api/user/oauth/pool/authorize-url", strings.NewReader(`{"provider":"codex"}`))},
	}
	for _, leg := range legs {
		t.Run(leg.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			leg.handler(rec, leg.req)

			if rec.Code != http.StatusBadGateway {
				t.Fatalf("proxy down → HTTP %d, want 502", rec.Code)
			}
			var body struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("502 body is not the JSON envelope (the web renders raw text then): %v\n%s",
					err, rec.Body.String())
			}
			if body.Error.Code != "PROXY_UNAVAILABLE" {
				t.Fatalf("code = %q, want PROXY_UNAVAILABLE (the web keys its handling on it)", body.Error.Code)
			}
			// The complete self-service path, in one message: why → check →
			// fix → escalate → retry. Losing any leg strands the user again.
			for _, want := range []string{
				"not running",             // why (names the actual state, not just "unreachable")
				"brokered by the proxy",   // why the OAuth flow needs it at all
				"aikey proxy status",      // check FIRST (distinguishes not-started vs crashing)
				"aikey service start all", // fix
				"aikey doctor",            // escalate if it keeps dying
				"retry",                   // close the loop
			} {
				if !strings.Contains(body.Error.Message, want) {
					t.Fatalf("502 message lost %q — no longer a self-service path:\n%s",
						want, body.Error.Message)
				}
			}
		})
	}
}

// The healthy-path contract the enrichment must not break: broker answers
// (including broker ERRORS) relay verbatim — status code and body — so the
// browser always sees the broker's structured envelope, never a re-wrap.
func TestForward_RelaysBrokerAnswerVerbatim(t *testing.T) {
	broker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth/login" {
			t.Errorf("broker got %s, want /oauth/login", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict) // an arbitrary broker-side error
		_, _ = w.Write([]byte(`{"error":{"code":"SESSION_EXISTS","message":"already pending"}}`))
	}))
	t.Cleanup(broker.Close)
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(broker.URL, "http://"))
	t.Setenv("AIKEY_PROXY_PORT", port)

	rec := httptest.NewRecorder()
	LoginHandler(rec, httptest.NewRequest(http.MethodPost, "/api/user/oauth/login",
		strings.NewReader(`{"provider":"codex"}`)))

	if rec.Code != http.StatusConflict {
		t.Fatalf("relay rewrote the broker's status: got %d want 409", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "SESSION_EXISTS") {
		t.Fatalf("relay rewrote the broker's body: %s", rec.Body.String())
	}
}
