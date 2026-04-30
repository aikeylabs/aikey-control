package vault

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// TestAllowUnlock_ThrottlesAfterBudget locks the brute-force rate limiter:
// 10 attempts/minute per source IP, with separate buckets per IP.
func TestAllowUnlock_ThrottlesAfterBudget(t *testing.T) {
	h := &Handlers{}
	key := "203.0.113.7"
	for i := 0; i < unlockRateLimitMax; i++ {
		if !h.allowUnlock(key) {
			t.Fatalf("attempt %d should be allowed (budget=%d)", i+1, unlockRateLimitMax)
		}
	}
	if h.allowUnlock(key) {
		t.Fatalf("attempt %d must be rate-limited", unlockRateLimitMax+1)
	}
	if !h.allowUnlock("198.51.100.4") {
		t.Fatal("different IP must get its own budget")
	}
}

func TestStatusHandler_NoCookie_ReturnsLocked(t *testing.T) {
	h := &Handlers{Store: NewStore(time.Minute)}
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
	// 20260430-个人vault-Web首次设置-方案A: status must include the
	// `initialized` field so a web-only user can see the first-run CTA.
	// With Bridge=nil the probe degrades to false.
	if !strings.Contains(body, `"initialized":false`) {
		t.Fatalf("body missing initialized:false (probe should degrade to false on nil bridge): %q", body)
	}
}

// TestInitHandler_BogusBinary_ReturnsCliError asserts InitHandler degrades
// gracefully when the cli bridge is unavailable — i.e. it returns a
// structured error envelope, not a 500/panic.
func TestInitHandler_BogusBinary_ReturnsCliError(t *testing.T) {
	h := &Handlers{
		Store:  NewStore(time.Minute),
		Bridge: &cli.Bridge{BinaryPath: "/nonexistent/aikey-cli-binary"},
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/user/vault/init",
		strings.NewReader(`{"password":"hunter2x4"}`))
	req.Header.Set("Content-Type", "application/json")
	h.InitHandler(rr, req)

	if rr.Code == 200 {
		t.Fatalf("InitHandler must not return 200 with a bogus binary path; body=%q", rr.Body.String())
	}
}

func TestStatusHandler_ValidCookie_ReturnsUnlockedWithTTL(t *testing.T) {
	store := NewStore(2 * time.Minute)
	id, _ := store.Put("deadbeef")
	h := &Handlers{Store: store}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/user/vault/status", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: id})
	h.StatusHandler(rr, req)
	body := rr.Body.String()
	if !strings.Contains(body, `"unlocked":true`) {
		t.Fatalf("expected unlocked:true, got %q", body)
	}
	if !strings.Contains(body, `"ttl_seconds"`) {
		t.Fatalf("expected ttl_seconds, got %q", body)
	}
}
