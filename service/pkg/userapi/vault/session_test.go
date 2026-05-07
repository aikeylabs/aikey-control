package vault

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStore_PutGet_Roundtrip(t *testing.T) {
	s := NewStore(5 * time.Second)
	id, _ := s.Put("deadbeef")
	got, ttl, ok := s.Get(id)
	if !ok || got != "deadbeef" {
		t.Fatalf("get after put: ok=%v got=%q", ok, got)
	}
	if ttl < time.Second {
		t.Fatalf("ttl too short: %s", ttl)
	}
}

func TestStore_Expired_Evicted(t *testing.T) {
	s := NewStore(10 * time.Millisecond)
	id, _ := s.Put("abc")
	time.Sleep(20 * time.Millisecond)
	if _, _, ok := s.Get(id); ok {
		t.Fatal("expired session must not resolve")
	}
}

func TestStore_Delete_Idempotent(t *testing.T) {
	s := NewStore(time.Minute)
	id, _ := s.Put("x")
	s.Delete(id)
	s.Delete(id) // second delete must not panic
	if _, _, ok := s.Get(id); ok {
		t.Fatal("deleted session must not resolve")
	}
}

// TestStore_Get_HardExpire locks the 2026-04-24 security review fix:
// session expiry is fixed at unlock time and is NOT extended by subsequent
// activity. The previous sliding-TTL behavior was defeated by the front-end
// status poll (every 10s) which kept any open tab unlocked indefinitely.
func TestStore_Get_HardExpire(t *testing.T) {
	s := NewStore(100 * time.Millisecond)
	id, _ := s.Put("x")
	time.Sleep(50 * time.Millisecond)
	if _, ttl, ok := s.Get(id); !ok {
		t.Fatal("session should still be alive at 50ms")
	} else if ttl > 60*time.Millisecond {
		t.Fatalf("ttl should reflect remaining lifetime (<=50ms), got %v", ttl)
	}
	time.Sleep(60 * time.Millisecond)
	if _, _, ok := s.Get(id); ok {
		t.Fatal("session must hard-expire at the absolute deadline regardless of prior gets")
	}
}

func TestRequireUnlock_BlocksWhenNoCookie(t *testing.T) {
	s := NewStore(time.Minute)
	called := false
	wrapped := s.RequireUnlock(func(w http.ResponseWriter, r *http.Request) { called = true })
	rr := httptest.NewRecorder()
	wrapped(rr, httptest.NewRequest(http.MethodPost, "/api/user/import/confirm", nil))
	if called {
		t.Fatal("inner handler must NOT run without session")
	}
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}
}

func TestRequireUnlock_PassesVaultKeyToContext(t *testing.T) {
	store := NewStore(time.Minute)
	id, _ := store.Put("my-hex-key")
	var seen string
	wrapped := store.RequireUnlock(func(w http.ResponseWriter, r *http.Request) {
		k, ok := KeyFrom(r.Context())
		if !ok {
			t.Error("KeyFrom: not present")
			return
		}
		seen = k
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/user/import/confirm", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookie, Value: id})
	wrapped(rr, req)
	if seen != "my-hex-key" {
		t.Fatalf("vault key not propagated: %q", seen)
	}
}
