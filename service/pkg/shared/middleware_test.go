package shared

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalIdentityMiddleware_InjectsLocalOwner(t *testing.T) {
	var gotAccountID string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAccountID = AccountID(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := LocalIdentityMiddleware()(inner)
	req := httptest.NewRequest(http.MethodGet, "/accounts/me", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if gotAccountID != "local-owner" {
		t.Errorf("AccountID = %q, want %q", gotAccountID, "local-owner")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestLocalIdentityMiddleware_ClaimsEmail(t *testing.T) {
	var gotEmail string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, ok := r.Context().Value(claimsKey).(*Claims); ok {
			gotEmail = c.Email
		}
		w.WriteHeader(http.StatusOK)
	})

	handler := LocalIdentityMiddleware()(inner)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if gotEmail != "local@localhost" {
		t.Errorf("Email = %q, want %q", gotEmail, "local@localhost")
	}
}

// Phase 3B R20 CORS sentinel tests — `<local-networks>` should reflect
// any private-network origin while denying public-internet origins.
// Why these specific cases:
//   - 127.0.0.1 / ::1 / localhost: legitimate loopback that the
//     trial/local-server cross-fetch flow uses by default.
//   - 192.168.x / 10.x / 172.16.x: legitimate LAN deployments
//     (docker on dev mac, office VPN, home router subnet).
//   - example.com / 8.8.8.8 / 169.254.x.x: explicitly NOT private —
//     covering both real public origins and link-local fallback so the
//     allowlist doesn't accidentally green-light a failed-DHCP host.
//   - file:// / data: / malformed: sanitize early so url.Parse oddities
//     can't trick the matcher into returning true.
func TestCORS_LocalNetworksSentinel(t *testing.T) {
	cases := []struct {
		name   string
		origin string
		want   bool
	}{
		{"loopback v4 default port", "http://127.0.0.1", true},
		{"loopback v4 custom port", "http://127.0.0.1:3000", true},
		{"loopback v6", "http://[::1]:8090", true},
		{"localhost literal", "http://localhost:3000", true},
		{"RFC 1918 192.168", "http://192.168.0.113:3000", true},
		{"RFC 1918 10/8", "http://10.0.0.5:8080", true},
		{"RFC 1918 172.16/12", "http://172.20.30.40:3000", true},
		{"public IP google DNS", "http://8.8.8.8:80", false},
		{"public DNS name", "https://evil.com", false},
		{"link-local fallback", "http://169.254.10.20:3000", false},
		{"empty origin", "", false},
		{"malformed", "not-a-url", false},
		{"file URL", "file:///etc/passwd", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isLocalNetworkOrigin(tc.origin)
			if got != tc.want {
				t.Errorf("isLocalNetworkOrigin(%q) = %v, want %v", tc.origin, got, tc.want)
			}
		})
	}
}

func TestCORS_LocalNetworksReflectsAllowedOrigin(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := CORSMiddleware([]string{CORSAllowLocalNetworks})(inner)

	// Allowed: docker LAN origin.
	req := httptest.NewRequest(http.MethodGet, "/accounts/me", nil)
	req.Header.Set("Origin", "http://192.168.0.113:3000")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://192.168.0.113:3000" {
		t.Errorf("LAN origin: Access-Control-Allow-Origin = %q, want echo back", got)
	}

	// Blocked: public internet origin.
	req2 := httptest.NewRequest(http.MethodGet, "/accounts/me", nil)
	req2.Header.Set("Origin", "https://evil.com")
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if got := rec2.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("public origin: Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func TestCORS_MixedAllowlist(t *testing.T) {
	// `<local-networks>` + explicit public URL — both should match.
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := CORSMiddleware([]string{
		CORSAllowLocalNetworks,
		"https://team.example.com",
	})(inner)

	for _, origin := range []string{
		"http://127.0.0.1:8090",           // local sentinel
		"https://team.example.com",        // explicit allowlist
	} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("mixed allowlist origin=%q: ACAO=%q, want %q", origin, got, origin)
		}
	}

	// Origin neither in allowlist nor in private networks → blocked.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://different-public.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("non-matching public origin: ACAO=%q, want empty", got)
	}
}

// Phase 3B R20 (revised): `<control-panel-url>` sentinel reads
// `controlPanelUrl` from `~/.aikey/config/config.json`. We can't
// safely overwrite the real home file in CI, so the test exercises
// the path-injectable inner helper plus the cache reset path.
func TestCORS_LoadControlPanelOriginFromPath(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "valid url with port",
			body: `{"controlPanelUrl":"http://192.168.0.113:3000","version":"1"}`,
			want: "http://192.168.0.113:3000",
		},
		{
			name: "valid url default port stripped",
			body: `{"controlPanelUrl":"https://team.example.com"}`,
			want: "https://team.example.com",
		},
		{
			name: "path component dropped from origin",
			body: `{"controlPanelUrl":"http://10.0.0.5:8080/console/login?x=1"}`,
			want: "http://10.0.0.5:8080",
		},
		{
			name: "empty controlPanelUrl",
			body: `{"controlPanelUrl":"","version":"1"}`,
			want: "",
		},
		{
			name: "missing key",
			body: `{"version":"1"}`,
			want: "",
		},
		{
			name: "malformed json",
			body: `{not json`,
			want: "",
		},
		{
			name: "malformed url (no scheme)",
			body: `{"controlPanelUrl":"192.168.0.113:3000"}`,
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, "config-"+tc.name+".json")
			if err := os.WriteFile(path, []byte(tc.body), 0o644); err != nil {
				t.Fatal(err)
			}
			got := loadControlPanelOriginFromPath(path)
			if got != tc.want {
				t.Errorf("body=%s\n  got %q\n want %q", tc.body, got, tc.want)
			}
		})
	}
}

func TestCORS_LoadControlPanelOriginFromPath_Missing(t *testing.T) {
	// Missing file returns empty without erroring — the file is
	// allowed to not exist (fresh install, no `aikey login` yet).
	got := loadControlPanelOriginFromPath(filepath.Join(t.TempDir(), "does-not-exist.json"))
	if got != "" {
		t.Errorf("missing file: got %q, want empty", got)
	}
}

func TestCORS_ControlPanelURLSentinel_AppliesAtRequestTime(t *testing.T) {
	// The middleware should call readControlPanelOrigin at request
	// time (cached) — not at construction time — so a config.json
	// change post-startup eventually flips the allowlist.
	//
	// We can't easily test the disk-read path without polluting the
	// home dir, so this test seeds the cache atomic directly and
	// asserts the middleware honours it.
	prevCache := controlPanelOriginCache.Load()
	t.Cleanup(func() {
		if prevCache != nil {
			controlPanelOriginCache.Store(prevCache)
		}
	})

	controlPanelOriginCache.Store(controlPanelOriginCacheEntry{
		origin: "http://192.168.0.113:3000",
		at:     time.Now(), // fresh, well within TTL
	})

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := CORSMiddleware([]string{CORSAllowControlPanelURL})(inner)

	// Matches the seeded cache → reflected.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://192.168.0.113:3000")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://192.168.0.113:3000" {
		t.Errorf("matching origin: ACAO=%q, want echo back", got)
	}

	// Different origin → blocked even though sentinel is set.
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("Origin", "https://evil.com")
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)
	if got := rec2.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("non-matching origin: ACAO=%q, want empty", got)
	}
}
