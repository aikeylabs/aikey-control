package shared

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fixedKey is a deterministic 32-byte HMAC key used across tests so a
// bug in entropy plumbing doesn't make tests flaky.
var fixedKey = bytes.Repeat([]byte("k"), 32)

// localAPITestCfg returns a baseline config with the test key + a
// loopback allowlist matching the local web's expected origin.
func localAPITestCfg() LocalAPIConfig {
	return LocalAPIConfig{
		AllowedOrigins: []string{
			"http://127.0.0.1:8090",
			"http://localhost:8090",
		},
		CSRFKey:     fixedKey,
		RateLimiter: NewLocalAPIRateLimiter(10, time.Minute),
	}
}

// passthroughHandler echoes 200 OK so successful Wrap callthrough is
// observable. Records whether it was reached.
type passthroughHandler struct {
	called bool
}

func (h *passthroughHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.called = true
	w.WriteHeader(http.StatusOK)
}

// issueCSRFViaRecorder mints a fresh token + cookie by hitting a
// throwaway HTTP request through IssueCSRFToken. Returns the cookie
// header value the test can echo on subsequent requests.
func issueCSRFViaRecorder(t *testing.T, cfg LocalAPIConfig) (cookie, header string) {
	t.Helper()
	rec := httptest.NewRecorder()
	tok, err := IssueCSRFToken(rec, cfg)
	if err != nil {
		t.Fatalf("IssueCSRFToken: %v", err)
	}
	// The Set-Cookie header contains "name=value; ..." — grab the
	// value half so tests can put it on a fresh request cookie jar.
	setCookie := rec.Result().Header.Get("Set-Cookie")
	if !strings.Contains(setCookie, CSRFCookieName+"=") {
		t.Fatalf("Set-Cookie missing %s: %q", CSRFCookieName, setCookie)
	}
	return tok, tok
}

func newPOST(t *testing.T, body string, opts func(r *http.Request)) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/local-api/invite/create", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if opts != nil {
		opts(r)
	}
	return r
}

func TestWrapLocalAPI_HappyPath(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()
	cookieVal, headerVal := issueCSRFViaRecorder(t, cfg)

	next := &passthroughHandler{}
	wrapped := WrapLocalAPI(cfg, next)

	r := newPOST(t, `{}`, func(r *http.Request) {
		r.Header.Set("Origin", "http://127.0.0.1:8090")
		r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: cookieVal})
		r.Header.Set(CSRFHeaderName, headerVal)
	})
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if !next.called {
		t.Fatal("inner handler not called on accepted POST")
	}
}

func TestWrapLocalAPI_RejectsOffListOrigin(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()
	cookieVal, headerVal := issueCSRFViaRecorder(t, cfg)

	wrapped := WrapLocalAPI(cfg, &passthroughHandler{})
	r := newPOST(t, `{}`, func(r *http.Request) {
		r.Header.Set("Origin", "https://evil.example.com")
		r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: cookieVal})
		r.Header.Set(CSRFHeaderName, headerVal)
	})
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, r)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["status"] != "origin_denied" {
		t.Fatalf("status category: want origin_denied, got %q", body["status"])
	}
}

func TestWrapLocalAPI_RejectsMissingCSRFCookie(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()
	_, headerVal := issueCSRFViaRecorder(t, cfg)

	wrapped := WrapLocalAPI(cfg, &passthroughHandler{})
	r := newPOST(t, `{}`, func(r *http.Request) {
		r.Header.Set("Origin", "http://127.0.0.1:8090")
		r.Header.Set(CSRFHeaderName, headerVal)
		// no cookie
	})
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, r)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", rec.Code)
	}
}

func TestWrapLocalAPI_RejectsHeaderCookieMismatch(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()
	cookieVal, _ := issueCSRFViaRecorder(t, cfg)

	wrapped := WrapLocalAPI(cfg, &passthroughHandler{})
	r := newPOST(t, `{}`, func(r *http.Request) {
		r.Header.Set("Origin", "http://127.0.0.1:8090")
		r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: cookieVal})
		r.Header.Set(CSRFHeaderName, "different-value-than-cookie")
	})
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, r)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", rec.Code)
	}
}

func TestWrapLocalAPI_RejectsForgedCSRFSignature(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()

	// Build a token whose signature was produced with a DIFFERENT key.
	// verifyCSRFToken must catch this.
	otherKeyCfg := LocalAPIConfig{
		CSRFKey:        bytes.Repeat([]byte("x"), 32),
		AllowedOrigins: cfg.AllowedOrigins,
	}
	rec := httptest.NewRecorder()
	forged, err := IssueCSRFToken(rec, otherKeyCfg)
	if err != nil {
		t.Fatalf("IssueCSRFToken (other key): %v", err)
	}

	wrapped := WrapLocalAPI(cfg, &passthroughHandler{})
	r := newPOST(t, `{}`, func(r *http.Request) {
		r.Header.Set("Origin", "http://127.0.0.1:8090")
		r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: forged})
		r.Header.Set(CSRFHeaderName, forged)
	})
	rec2 := httptest.NewRecorder()
	wrapped.ServeHTTP(rec2, r)
	if rec2.Code != http.StatusForbidden {
		t.Fatalf("forged-signature: want 403, got %d", rec2.Code)
	}
}

func TestWrapLocalAPI_PreflightOPTIONS(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()
	wrapped := WrapLocalAPI(cfg, &passthroughHandler{})

	r := httptest.NewRequest(http.MethodOptions, "/local-api/invite/create", nil)
	r.Header.Set("Origin", "http://127.0.0.1:8090")
	r.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, r)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status: want 204, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:8090" {
		t.Errorf("Access-Control-Allow-Origin: want exact echo, got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") {
		t.Errorf("Access-Control-Allow-Methods: want POST, got %q", got)
	}
}

func TestWrapLocalAPI_PreflightOffListOrigin(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()
	wrapped := WrapLocalAPI(cfg, &passthroughHandler{})

	r := httptest.NewRequest(http.MethodOptions, "/local-api/invite/create", nil)
	r.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, r)

	// Preflight still returns 204 (per CORS spec) but MUST NOT include
	// the off-list origin in Access-Control-Allow-Origin. The browser
	// then refuses the cross-origin POST without ever sending it.
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("off-list origin echoed: %q (should be empty)", got)
	}
}

func TestRateLimiter_AllowAndDeny(t *testing.T) {
	t.Parallel()
	l := NewLocalAPIRateLimiter(2, time.Minute)
	if !l.Allow("k") {
		t.Fatal("first call: want allow")
	}
	if !l.Allow("k") {
		t.Fatal("second call: want allow")
	}
	if l.Allow("k") {
		t.Fatal("third call: want deny (bucket drained)")
	}
}

func TestRateLimiter_PerKeyIsolation(t *testing.T) {
	t.Parallel()
	l := NewLocalAPIRateLimiter(1, time.Minute)
	if !l.Allow("a") || !l.Allow("b") {
		t.Fatal("two distinct keys: both first calls should allow")
	}
	if l.Allow("a") {
		t.Fatal("key a should now be drained")
	}
}

func TestWrapLocalAPI_RateLimitReturns429(t *testing.T) {
	t.Parallel()
	cfg := localAPITestCfg()
	cfg.RateLimiter = NewLocalAPIRateLimiter(1, time.Minute)
	cookieVal, headerVal := issueCSRFViaRecorder(t, cfg)

	wrapped := WrapLocalAPI(cfg, &passthroughHandler{})
	build := func() *http.Request {
		return newPOST(t, `{}`, func(r *http.Request) {
			r.Header.Set("Origin", "http://127.0.0.1:8090")
			r.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: cookieVal})
			r.Header.Set(CSRFHeaderName, headerVal)
		})
	}

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, build())
	if rec.Code != http.StatusOK {
		t.Fatalf("first call: want 200, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	wrapped.ServeHTTP(rec, build())
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second call: want 429, got %d", rec.Code)
	}
}

func TestIssueCSRFToken_RejectsShortKey(t *testing.T) {
	t.Parallel()
	cfg := LocalAPIConfig{CSRFKey: []byte("too-short")}
	rec := httptest.NewRecorder()
	_, err := IssueCSRFToken(rec, cfg)
	if err == nil {
		t.Fatal("want error on short CSRF key")
	}
}
