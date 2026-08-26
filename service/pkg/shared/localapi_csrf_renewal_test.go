package shared

// Fences for the CSRF lifecycle against LONG-LIVED consumer pages (2026-08-25,
// bugfix 20260825-tray-popover-csrf-expiry). The tray popover loads its page
// once and lives for days; the token lives csrfTTL. Before these paths existed,
// a page older than the TTL had EVERY request — including its 2s status poll —
// 403 forever, with no way back to a valid cookie short of a reload the
// popover never performs.
//
// 能红: drop the issueCSRFToken call from the csrf_denied branch → fence 1;
// drop maybeRenewCSRFCookie from the success path → fence 2.

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func csrfTestConfig(t *testing.T) LocalAPIConfig {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	return LocalAPIConfig{
		AllowedOrigins: []string{"http://127.0.0.1:1"},
		CSRFKey:        key,
	}
}

func wrapped(cfg LocalAPIConfig) http.Handler {
	return WrapLocalAPI(cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "OK")
	}))
}

func csrfCookieFrom(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == CSRFCookieName {
			return c
		}
	}
	return nil
}

// Fence 1: a csrf_denied 403 must carry a FRESH cookie so the caller's next
// request can pass — the recovery path for an already-expired page.
func TestCSRFDeniedResponseCarriesFreshCookie(t *testing.T) {
	cfg := csrfTestConfig(t)
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:1/status", nil)
	req.Host = "127.0.0.1:1"
	// No cookie, no header — the expired-popover shape.
	rec := httptest.NewRecorder()
	wrapped(cfg).ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "csrf_denied") {
		t.Fatalf("precondition: want csrf_denied 403, got %d %s", rec.Code, rec.Body.String())
	}
	fresh := csrfCookieFrom(rec)
	if fresh == nil || fresh.Value == "" {
		t.Fatal("csrf_denied response carries no fresh CSRF cookie — an expired resident page (tray popover) can never recover; its 2s poll 403s forever")
	}
	// …and the fresh cookie actually works on the next request.
	req2 := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:1/status", nil)
	req2.Host = "127.0.0.1:1"
	req2.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: fresh.Value})
	req2.Header.Set(CSRFHeaderName, fresh.Value)
	rec2 := httptest.NewRecorder()
	wrapped(cfg).ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("recovery cookie rejected on the follow-up request: %d %s", rec2.Code, rec2.Body.String())
	}
}

// Fence 2: an accepted request whose token is past half-life must be handed a
// rotated cookie (sliding renewal), and a YOUNG token must NOT be rotated —
// rotating per-request would race the page's read-cookie-then-send sequence.
func TestCSRFSlidingRenewalPastHalfLife(t *testing.T) {
	cfg := csrfTestConfig(t)

	oldToken, err := mintCSRFTokenWithTTL(cfg, time.Hour) // < csrfTTL/2 remaining
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:1/status", nil)
	req.Host = "127.0.0.1:1"
	req.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: oldToken})
	req.Header.Set(CSRFHeaderName, oldToken)
	rec := httptest.NewRecorder()
	wrapped(cfg).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("aging-but-valid token rejected: %d", rec.Code)
	}
	renewed := csrfCookieFrom(rec)
	if renewed == nil || renewed.Value == oldToken {
		t.Fatal("token past half-life was not rotated — the resident page will ride it to the expiry cliff and 403")
	}

	youngToken, err := mintCSRFTokenWithTTL(cfg, csrfTTL) // full life ahead
	if err != nil {
		t.Fatal(err)
	}
	req2 := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:1/status", nil)
	req2.Host = "127.0.0.1:1"
	req2.AddCookie(&http.Cookie{Name: CSRFCookieName, Value: youngToken})
	req2.Header.Set(CSRFHeaderName, youngToken)
	rec2 := httptest.NewRecorder()
	wrapped(cfg).ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("young token rejected: %d", rec2.Code)
	}
	if c := csrfCookieFrom(rec2); c != nil {
		t.Fatal("young token was rotated — per-request rotation races the page's read-cookie-then-send sequence (see maybeRenewCSRFCookie)")
	}
}

// mintCSRFTokenWithTTL builds a signed token expiring ttl from now, without
// going through an http response — the test needs tokens of chosen ages.
func mintCSRFTokenWithTTL(cfg LocalAPIConfig, ttl time.Duration) (string, error) {
	rec := httptest.NewRecorder()
	tok, err := issueCSRFToken(rec, cfg, ttl)
	return tok, err
}
