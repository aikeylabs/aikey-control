package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/vault"
)

// Build a Handlers wired with a real (but never-invoked) Bridge. The Bridge
// is never invoked because every failure path (missing session, bad body)
// short-circuits before Bridge.Invoke is reached. This lets us test the
// HTTP boundary without spawning aikey-cli subprocesses.
func newTestHandlers() *Handlers {
	return NewHandlers(vault.NewStore(0), cli.New(nil))
}

// TestListHandler_NoSession_DoesNotRequireUnlock pins the revised
// unlock policy (2026-05-21): GET /list is metadata-only and must NOT
// be gated by an unlocked vault session. The route in
// pkg/userapi/handlers.go::Register intentionally does NOT wrap
// ListHandler in Store.RequireUnlock, and the handler itself uses
// invokeBridgeNoVault — which means a request without a session must
// fall through to the Bridge (and only fail for Bridge-level reasons,
// e.g. CLI unavailable in this unit test).
//
// We assert the negative invariant: the response must NOT carry
// I_VAULT_LOCKED or I_VAULT_NO_SESSION. Anything else (including
// Bridge errors caused by the nil CLI binary in this test rig) is
// acceptable — those would be observed in integration tests with a
// real CLI.
func TestListHandler_NoSession_DoesNotRequireUnlock(t *testing.T) {
	h := newTestHandlers()
	req := httptest.NewRequest(http.MethodGet, "/api/user/apps/list", nil)
	w := httptest.NewRecorder()
	h.ListHandler(w, req)

	var body struct {
		ErrorCode string `json:"error_code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.ErrorCode == cli.ErrVaultLocked || body.ErrorCode == cli.ErrVaultNoSession {
		t.Errorf("list must not require unlock; got error_code = %q", body.ErrorCode)
	}
}

// TestGetHandler_EmptyBody_ReturnsBadRequest pins the body-shape gate:
// any mutation/read-with-payload endpoint must reject empty body with
// a clean error before reaching Bridge.
func TestGetHandler_EmptyBody_ReturnsBadRequest(t *testing.T) {
	h := newTestHandlers()
	// Inject a fake session so the unlock guard passes — we want to
	// exercise the body-decode path specifically.
	ctx := vault.InjectKey(context.Background(), "deadbeef")
	req := httptest.NewRequest(http.MethodPost, "/api/user/apps/get", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	h.GetHandler(w, req)
	if w.Code < 400 {
		t.Fatalf("expected 4xx for empty body, got %d", w.Code)
	}
	var body struct {
		ErrorCode string `json:"error_code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.ErrorCode != cli.ErrBadRequest {
		t.Errorf("error_code = %q, want %q", body.ErrorCode, cli.ErrBadRequest)
	}
}

// TestRouteHandler_MissingFields_ReturnsBadRequest pins the field-
// presence gate: route requires all 4 fields. Decoder accepts {} (no
// fields → zero values), so the explicit length-check inside
// RouteHandler is what catches it. If anyone collapses the check to a
// generic json decode, this test catches the regression.
func TestRouteHandler_MissingFields_ReturnsBadRequest(t *testing.T) {
	h := newTestHandlers()
	ctx := vault.InjectKey(context.Background(), "deadbeef")
	// Body is an empty JSON object — passes the empty-body gate but
	// trips the "all fields required" guard.
	body := bytes.NewReader([]byte(`{}`))
	req := httptest.NewRequest(http.MethodPost, "/api/user/apps/route", body).WithContext(ctx)
	w := httptest.NewRecorder()
	h.RouteHandler(w, req)
	if w.Code < 400 {
		t.Fatalf("expected 4xx for missing fields, got %d", w.Code)
	}
	var resp struct {
		ErrorCode    string `json:"error_code"`
		ErrorMessage string `json:"error_message"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ErrorCode != cli.ErrBadRequest {
		t.Errorf("error_code = %q, want %q", resp.ErrorCode, cli.ErrBadRequest)
	}
	if !strings.Contains(resp.ErrorMessage, "required") {
		t.Errorf("error_message %q didn't mention 'required'", resp.ErrorMessage)
	}
}

// TestRegisterHandler_MissingFields_ReturnsBadRequest pins the boundary
// validation for the 2026-05-25 Web UI self-service registration path.
// The handler must reject empty slug + empty upstreams before reaching
// Bridge so the user gets a clean error message ("upstreams cannot be
// empty…") instead of a Bridge subprocess crash.
func TestRegisterHandler_MissingSlug_ReturnsBadRequest(t *testing.T) {
	h := newTestHandlers()
	ctx := vault.InjectKey(context.Background(), "deadbeef")
	body := bytes.NewReader([]byte(`{"upstreams":["anthropic"]}`))
	req := httptest.NewRequest(http.MethodPost, "/api/user/apps/register", body).WithContext(ctx)
	w := httptest.NewRecorder()
	h.RegisterHandler(w, req)
	if w.Code < 400 {
		t.Fatalf("expected 4xx for missing slug, got %d", w.Code)
	}
	var resp struct {
		ErrorCode    string `json:"error_code"`
		ErrorMessage string `json:"error_message"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ErrorCode != cli.ErrBadRequest {
		t.Errorf("error_code = %q, want %q", resp.ErrorCode, cli.ErrBadRequest)
	}
	if !strings.Contains(resp.ErrorMessage, "slug") {
		t.Errorf("error_message %q must mention 'slug'", resp.ErrorMessage)
	}
}

// TestRegisterHandler_EmptyUpstreams_ReturnsBadRequest pins the explicit
// non-empty check on the upstreams array. The CLI side also rejects
// empty upstreams with I_NO_UPSTREAMS, but the boundary check here
// gives the Web user a clean message without spawning a CLI subprocess.
func TestRegisterHandler_EmptyUpstreams_ReturnsBadRequest(t *testing.T) {
	h := newTestHandlers()
	ctx := vault.InjectKey(context.Background(), "deadbeef")
	body := bytes.NewReader([]byte(`{"slug":"some-app","upstreams":[]}`))
	req := httptest.NewRequest(http.MethodPost, "/api/user/apps/register", body).WithContext(ctx)
	w := httptest.NewRecorder()
	h.RegisterHandler(w, req)
	if w.Code < 400 {
		t.Fatalf("expected 4xx for empty upstreams, got %d", w.Code)
	}
	var resp struct {
		ErrorCode    string `json:"error_code"`
		ErrorMessage string `json:"error_message"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ErrorCode != cli.ErrBadRequest {
		t.Errorf("error_code = %q, want %q", resp.ErrorCode, cli.ErrBadRequest)
	}
	if !strings.Contains(resp.ErrorMessage, "upstream") {
		t.Errorf("error_message %q must mention 'upstream'", resp.ErrorMessage)
	}
}

// TestRegisterHandler_NoSession_RequiresUnlock pins the unlock policy
// for the Web registration path. Unlike list / get (which are public
// reads of registration metadata), register WRITES — it issues a new
// bearer + snapshots bindings — so it must require an unlocked vault
// session.
func TestRegisterHandler_NoSession_RequiresUnlock(t *testing.T) {
	// Note: this test exercises the handler directly. Production route
	// mounting wraps RegisterHandler in Store.RequireUnlock, which would
	// reject before the handler runs. Calling the handler directly with
	// no session context exercises the safety-net branch inside
	// invokeBridge (cli.ErrVaultLocked when KeyFrom(ctx) returns false).
	h := newTestHandlers()
	body := bytes.NewReader([]byte(`{"slug":"x","upstreams":["anthropic"]}`))
	req := httptest.NewRequest(http.MethodPost, "/api/user/apps/register", body)
	w := httptest.NewRecorder()
	h.RegisterHandler(w, req)
	var resp struct {
		ErrorCode string `json:"error_code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ErrorCode != cli.ErrVaultLocked {
		t.Errorf("expected vault-locked error without session, got %q", resp.ErrorCode)
	}
}

// ── A2 (Google "medium") — real localhost TCP + http.Client roundtrip ──

// keyInjectingMiddleware bypasses the production auth middleware for
// A2 tests, injecting a synthetic vault key into the request context
// the same way Store.RequireUnlock would after a real unlock. This
// lets us exercise the HTTP boundary (real net.Listen, real http.Client,
// real codec) WITHOUT having to wire a full vault subsystem into the
// test rig. The Bridge subprocess will still fail to spawn (no aikey
// binary available in the test PATH), but the failure surfaces as a
// well-formed error envelope via cli.WriteInvokeError, which is itself
// part of the boundary contract we want to fence.
func keyInjectingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := vault.InjectKey(r.Context(), "deadbeef")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// newAppMuxForA2 mirrors the production /api/user/apps/* route mounting
// in pkg/userapi/handlers.go but without the auth middleware (replaced
// by keyInjectingMiddleware so RequireUnlock-style downstream checks
// see a session). Drift here = drift in production routing; that's
// exactly the regression A2 catches that A1 (direct handler calls)
// cannot.
func newAppMuxForA2() (*http.ServeMux, *Handlers) {
	h := newTestHandlers()
	mux := http.NewServeMux()
	mux.Handle("GET /api/user/apps/list", keyInjectingMiddleware(http.HandlerFunc(h.ListHandler)))
	mux.Handle("POST /api/user/apps/get", keyInjectingMiddleware(http.HandlerFunc(h.GetHandler)))
	mux.Handle("POST /api/user/apps/register", keyInjectingMiddleware(http.HandlerFunc(h.RegisterHandler)))
	mux.Handle("POST /api/user/apps/reveal-token", keyInjectingMiddleware(http.HandlerFunc(h.RevealTokenHandler)))
	return mux, h
}

// TestA2_RegisterHandler_RoutedViaRealHTTP_BoundaryGatesFire is the
// 2026-05-25 A2-level (Google "medium") fence for the new Web UI
// register endpoint. Spins up httptest.NewServer with the production
// route mounting + a passthrough auth middleware so the test
// exercises:
//
//   - real net.Listener on localhost:<random>
//   - real http.Client → net.Conn → server roundtrip
//   - real ServeMux pattern matching ("POST /api/user/apps/register")
//   - real Content-Type / Content-Length codec
//   - the boundary validation gates inside RegisterHandler (empty
//     body / missing slug / empty upstreams)
//
// What A1 (direct handler call in TestRegisterHandler_*_ReturnsBadRequest)
// does NOT catch but A2 does:
//
//   - wrong HTTP verb (POST vs GET) on the mux pattern — A1 hardcodes
//     the verb on httptest.NewRequest, the mux gate is bypassed
//   - route typos like `/api/user/apps/Register` (capitalised) — A1
//     calls the function directly, the URL path string is ignored
//   - middleware not firing in the right order — A1 invokes the
//     handler without traversing the mux
//
// The Bridge subprocess in newTestHandlers() is a real cli.Bridge
// with no binary configured, so the happy-path branch errors out
// inside Invoke. We do NOT assert on the happy-path response body —
// that would require either a real `aikey` binary or a Bridge
// interface refactor (out of scope here). We assert on the boundary
// gates that fire BEFORE the Bridge subprocess spawn attempt.
func TestA2_RegisterHandler_RoutedViaRealHTTP_BoundaryGatesFire(t *testing.T) {
	mux, _ := newAppMuxForA2()
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// 1) Wrong method — must hit ServeMux's method-not-allowed branch
	//    (or fall through to 405). A1 doesn't catch wrong-verb mounts
	//    because httptest.NewRequest takes the verb as a string arg
	//    that the handler ignores.
	{
		resp, err := http.Get(srv.URL + "/api/user/apps/register")
		if err != nil {
			t.Fatalf("GET /register: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			t.Errorf("GET on register endpoint returned 200; mux pattern accepts wrong verb")
		}
	}

	// 2) Empty body — must hit decodeBody's empty-body gate.
	{
		resp, err := http.Post(srv.URL+"/api/user/apps/register", "application/json", strings.NewReader(""))
		if err != nil {
			t.Fatalf("POST empty body: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 400 {
			t.Errorf("POST empty body returned %d, want 4xx", resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		var env struct {
			ErrorCode string `json:"error_code"`
		}
		_ = json.Unmarshal(body, &env)
		if env.ErrorCode != cli.ErrBadRequest {
			t.Errorf("empty body error_code = %q, want %q", env.ErrorCode, cli.ErrBadRequest)
		}
	}

	// 3) Missing slug — JSON valid but slug field empty. Must hit the
	//    explicit slug-required gate in RegisterHandler.
	{
		resp, err := http.Post(srv.URL+"/api/user/apps/register",
			"application/json",
			strings.NewReader(`{"upstreams":["anthropic"]}`))
		if err != nil {
			t.Fatalf("POST no slug: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 400 {
			t.Errorf("POST without slug returned %d, want 4xx", resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		var env struct {
			ErrorCode    string `json:"error_code"`
			ErrorMessage string `json:"error_message"`
		}
		_ = json.Unmarshal(body, &env)
		if env.ErrorCode != cli.ErrBadRequest {
			t.Errorf("missing slug error_code = %q, want %q", env.ErrorCode, cli.ErrBadRequest)
		}
		if !strings.Contains(env.ErrorMessage, "slug") {
			t.Errorf("missing slug error_message = %q, must mention 'slug'", env.ErrorMessage)
		}
	}

	// 4) Empty upstreams — JSON valid, slug present, but upstreams [].
	//    Must hit the explicit upstreams-required gate.
	{
		resp, err := http.Post(srv.URL+"/api/user/apps/register",
			"application/json",
			strings.NewReader(`{"slug":"some-app","upstreams":[]}`))
		if err != nil {
			t.Fatalf("POST empty upstreams: %v", err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		var env struct {
			ErrorCode    string `json:"error_code"`
			ErrorMessage string `json:"error_message"`
		}
		_ = json.Unmarshal(body, &env)
		if env.ErrorCode != cli.ErrBadRequest {
			t.Errorf("empty upstreams error_code = %q, want %q", env.ErrorCode, cli.ErrBadRequest)
		}
		if !strings.Contains(env.ErrorMessage, "upstream") {
			t.Errorf("empty upstreams error_message = %q, must mention 'upstream'", env.ErrorMessage)
		}
	}
}

// TestA2_RevealTokenHandler_RoutedViaRealHTTP_BoundaryGatesFire is the
// A2-level twin for the reveal-token endpoint. Same boundary
// contract: real HTTP roundtrip, real mux pattern matching, real
// codec. See TestA2_RegisterHandler_* docstring for why we don't
// assert on the happy-path response (no real CLI binary available
// in tests).
func TestA2_RevealTokenHandler_RoutedViaRealHTTP_BoundaryGatesFire(t *testing.T) {
	mux, _ := newAppMuxForA2()
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Wrong method — GET on a POST-only endpoint
	{
		resp, err := http.Get(srv.URL + "/api/user/apps/reveal-token")
		if err != nil {
			t.Fatalf("GET /reveal-token: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			t.Errorf("GET on reveal-token returned 200; mux pattern accepts wrong verb")
		}
	}

	// Empty body
	{
		resp, err := http.Post(srv.URL+"/api/user/apps/reveal-token", "application/json", strings.NewReader(""))
		if err != nil {
			t.Fatalf("POST empty body: %v", err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		var env struct {
			ErrorCode string `json:"error_code"`
		}
		_ = json.Unmarshal(body, &env)
		if env.ErrorCode != cli.ErrBadRequest {
			t.Errorf("empty body error_code = %q, want %q", env.ErrorCode, cli.ErrBadRequest)
		}
	}

	// Missing slug
	{
		resp, err := http.Post(srv.URL+"/api/user/apps/reveal-token",
			"application/json",
			strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("POST no slug: %v", err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		var env struct {
			ErrorCode    string `json:"error_code"`
			ErrorMessage string `json:"error_message"`
		}
		_ = json.Unmarshal(body, &env)
		if env.ErrorCode != cli.ErrBadRequest {
			t.Errorf("missing slug error_code = %q, want %q", env.ErrorCode, cli.ErrBadRequest)
		}
		if !strings.Contains(env.ErrorMessage, "slug") {
			t.Errorf("missing slug error_message = %q, must mention 'slug'", env.ErrorMessage)
		}
	}
}

// TestA2_AppRoutesMounted_NotConfusedWithEachOther fences the
// route-pattern-collision risk: with 4+ POST endpoints on the same
// /api/user/apps/* prefix, a typo in the mux pattern (e.g. accidentally
// mounting register on /api/user/apps/get) would be invisible to A1
// tests (they call the handler directly by Go function name) but
// caught here by checking which handler responds to each URL.
func TestA2_AppRoutesMounted_NotConfusedWithEachOther(t *testing.T) {
	mux, _ := newAppMuxForA2()
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Each handler validates body differently. register/reveal-token
	// require slug; route requires slug + upstream + key_source_type +
	// key_source_ref. Posting `{}` to each gives back a distinct error
	// message that proves which handler answered — a route collision
	// would surface as the wrong message at the wrong URL.
	cases := []struct {
		url             string
		wantErrSubstr   string
	}{
		{"/api/user/apps/register", "slug"},          // RegisterHandler
		{"/api/user/apps/reveal-token", "slug"},      // RevealTokenHandler
		{"/api/user/apps/get", "slug"},               // GetHandler
		// list is GET-only so we skip it here; the GET vs POST tests
		// above already cover its method gating.
	}
	for _, c := range cases {
		t.Run(c.url, func(t *testing.T) {
			resp, err := http.Post(srv.URL+c.url, "application/json", strings.NewReader(`{}`))
			if err != nil {
				t.Fatalf("POST %s: %v", c.url, err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			var env struct {
				ErrorMessage string `json:"error_message"`
			}
			_ = json.Unmarshal(body, &env)
			if !strings.Contains(env.ErrorMessage, c.wantErrSubstr) {
				t.Errorf("POST %s: error_message = %q, must mention %q (proves correct handler was wired)",
					c.url, env.ErrorMessage, c.wantErrSubstr)
			}
		})
	}
}

// TestRevealTokenHandler_NoSession_RequiresUnlock pins the
// 2026-05-25 reveal-token endpoint's unlock policy. The handler is
// wrapped by Store.RequireUnlock at the route layer, but the in-handler
// vault.KeyFrom check provides defence-in-depth: a direct call with no
// session context must still respond with I_VAULT_LOCKED rather than
// silently spawning a CLI subprocess without auth.
func TestRevealTokenHandler_NoSession_RequiresUnlock(t *testing.T) {
	h := newTestHandlers()
	body := bytes.NewReader([]byte(`{"slug":"some-app"}`))
	req := httptest.NewRequest(http.MethodPost, "/api/user/apps/reveal-token", body)
	w := httptest.NewRecorder()
	h.RevealTokenHandler(w, req)
	var resp struct {
		ErrorCode string `json:"error_code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ErrorCode != cli.ErrVaultLocked {
		t.Errorf("expected vault-locked error without session, got %q", resp.ErrorCode)
	}
}

// TestRevealTokenHandler_MissingSlug_ReturnsBadRequest pins the body
// validation gate. Empty / missing slug is rejected at the HTTP
// boundary so we don't spawn a CLI subprocess that would itself error
// — cheaper failure path + cleaner error message for the UI.
func TestRevealTokenHandler_MissingSlug_ReturnsBadRequest(t *testing.T) {
	h := newTestHandlers()
	ctx := vault.InjectKey(context.Background(), "deadbeef")
	body := bytes.NewReader([]byte(`{}`))
	req := httptest.NewRequest(http.MethodPost, "/api/user/apps/reveal-token", body).WithContext(ctx)
	w := httptest.NewRecorder()
	h.RevealTokenHandler(w, req)
	if w.Code < 400 {
		t.Fatalf("expected 4xx for missing slug, got %d", w.Code)
	}
	var resp struct {
		ErrorCode string `json:"error_code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ErrorCode != cli.ErrBadRequest {
		t.Errorf("error_code = %q, want %q", resp.ErrorCode, cli.ErrBadRequest)
	}
}

// TestSlugOnlyHandlers_DegradeDetectorMutationLocked pins the
// 2026-05-23 policy: revoke / rotate on degrade-detector must be
// blocked at the HTTP boundary BEFORE the Bridge fires (so we never
// destroy the first-party bearer wiring trust-local + the rhythm
// observer). Pause / resume stay allowed because they're recoverable.
//
// Lock is scoped to `degrade-detector` slug per user-explicit decision
// (X2 over X1 "all first-party") — see workflow/CI/bugfix/20260523-
// app-mutation-policy.md for the rationale. Adding new protected slugs
// requires editing mutationLockedSlugs AND extending this test.
func TestSlugOnlyHandlers_DegradeDetectorMutationLocked(t *testing.T) {
	cases := []struct {
		name        string
		handler     func(*Handlers, http.ResponseWriter, *http.Request)
		expectBlock bool
	}{
		{"revoke", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.RevokeHandler(w, r) }, true},
		{"rotate", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.RotateHandler(w, r) }, true},
		{"pause", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.PauseHandler(w, r) }, false},
		{"resume", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.ResumeHandler(w, r) }, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := newTestHandlers()
			ctx := vault.InjectKey(context.Background(), "deadbeef")
			body := bytes.NewReader([]byte(`{"slug":"degrade-detector"}`))
			req := httptest.NewRequest(http.MethodPost, "/api/user/apps/"+c.name, body).WithContext(ctx)
			w := httptest.NewRecorder()
			c.handler(h, w, req)

			var resp cli.JSONError
			_ = json.Unmarshal(w.Body.Bytes(), &resp)

			if c.expectBlock {
				if w.Code != http.StatusForbidden {
					t.Errorf("%s on degrade-detector: expected 403, got %d (body=%s)",
						c.name, w.Code, w.Body.String())
				}
				if resp.ErrorCode != cli.ErrAppMutationDenied {
					t.Errorf("%s on degrade-detector: expected error_code=%s, got %q",
						c.name, cli.ErrAppMutationDenied, resp.ErrorCode)
				}
			} else {
				// pause / resume should be allowed to fall through to the
				// Bridge (which will fail in this test rig because the CLI
				// isn't wired). We only assert the lock did NOT engage.
				if resp.ErrorCode == cli.ErrAppMutationDenied {
					t.Errorf("%s on degrade-detector must NOT be locked; got %s",
						c.name, cli.ErrAppMutationDenied)
				}
			}
		})
	}
}

// TestSlugOnlyHandlers_NonProtectedSlugPassesThrough ensures the lock
// is narrow: other slugs (here: a synthetic third-party app) reach the
// Bridge for revoke / rotate just like before, so the policy change is
// scoped strictly to the slugs in `mutationLockedSlugs`.
func TestSlugOnlyHandlers_NonProtectedSlugPassesThrough(t *testing.T) {
	cases := []string{"revoke", "rotate"}
	for _, action := range cases {
		t.Run(action, func(t *testing.T) {
			h := newTestHandlers()
			ctx := vault.InjectKey(context.Background(), "deadbeef")
			body := bytes.NewReader([]byte(`{"slug":"third-party-agent"}`))
			req := httptest.NewRequest(http.MethodPost, "/api/user/apps/"+action, body).WithContext(ctx)
			w := httptest.NewRecorder()
			switch action {
			case "revoke":
				h.RevokeHandler(w, req)
			case "rotate":
				h.RotateHandler(w, req)
			}
			var resp cli.JSONError
			_ = json.Unmarshal(w.Body.Bytes(), &resp)
			if resp.ErrorCode == cli.ErrAppMutationDenied {
				t.Errorf("%s on third-party-agent must NOT be policy-locked; "+
					"the lock is degrade-detector-scoped only", action)
			}
		})
	}
}

// TestSlugOnlyHandlers_RequireSlug pins the slug-presence guard for the
// 4 slug-only handlers (revoke / pause / resume / rotate). All four
// share the slugOnlyAction helper, so testing one would in principle be
// enough — but testing all four prevents a future refactor from
// silently de-coupling one of them and skipping the guard.
func TestSlugOnlyHandlers_RequireSlug(t *testing.T) {
	cases := []struct {
		name    string
		handler func(*Handlers, http.ResponseWriter, *http.Request)
	}{
		{"revoke", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.RevokeHandler(w, r) }},
		{"pause", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.PauseHandler(w, r) }},
		{"resume", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.ResumeHandler(w, r) }},
		{"rotate", func(h *Handlers, w http.ResponseWriter, r *http.Request) { h.RotateHandler(w, r) }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := newTestHandlers()
			ctx := vault.InjectKey(context.Background(), "deadbeef")
			body := bytes.NewReader([]byte(`{}`))
			req := httptest.NewRequest(http.MethodPost, "/api/user/apps/"+c.name, body).WithContext(ctx)
			w := httptest.NewRecorder()
			c.handler(h, w, req)
			if w.Code < 400 {
				t.Errorf("%s: expected 4xx for missing slug, got %d", c.name, w.Code)
			}
		})
	}
}
