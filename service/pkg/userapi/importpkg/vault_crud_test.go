package importpkg

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ── pure helpers ──────────────────────────────────────────────────────────

func TestItoa(t *testing.T) {
	cases := []struct {
		in   int
		want string
	}{
		{0, "0"},
		{1, "1"},
		{9, "9"},
		{10, "10"},
		{99, "99"},
		{123, "123"},
		{-5, "-5"},
	}
	for _, c := range cases {
		if got := itoa(c.in); got != c.want {
			t.Errorf("itoa(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNextSuffix_FirstConflict(t *testing.T) {
	if got := nextSuffix("foo", 2); got != "foo-2" {
		t.Fatalf("first conflict should produce foo-2, got %q", got)
	}
}

func TestNextSuffix_ChainedAttempts(t *testing.T) {
	// Successive attempts against the same stem should produce foo-2, foo-3, foo-4.
	// The loop passes the *original* stem each time (not the previous attempt),
	// so we simulate that here.
	stem := "foo"
	for n := 2; n <= 5; n++ {
		got := nextSuffix(stem, n)
		want := "foo-" + itoa(n)
		if got != want {
			t.Errorf("nextSuffix(%q, %d) = %q, want %q", stem, n, got, want)
		}
	}
}

func TestNextSuffix_StripExistingNumericSuffix(t *testing.T) {
	// Input already has `-5` — we should replace it with the new number, not
	// append (which would produce foo-5-2, ugly UI).
	if got := nextSuffix("foo-5", 2); got != "foo-2" {
		t.Fatalf("foo-5 with n=2 should strip to foo-2, got %q", got)
	}
	if got := nextSuffix("openai-work-12", 3); got != "openai-work-3" {
		t.Fatalf("compound stem should still strip trailing -N, got %q", got)
	}
}

func TestNextSuffix_NonNumericHyphenStays(t *testing.T) {
	// "claude-work" — the hyphen separates two words, not a suffix. The trailing
	// segment `work` is non-numeric so we must NOT strip; just append -N.
	if got := nextSuffix("claude-work", 2); got != "claude-work-2" {
		t.Fatalf("non-numeric suffix should not be stripped, got %q", got)
	}
}

func TestNextSuffix_LeadingHyphenNotStripped(t *testing.T) {
	// Pathological: "-5" alone. The stripping logic requires idx > 0, so the
	// leading hyphen at position 0 leaves the stem intact. Result: "-5-2".
	if got := nextSuffix("-5", 2); got != "-5-2" {
		t.Fatalf("leading-hyphen stem must not be stripped, got %q", got)
	}
}

// The reveal rate limiter (allowReveal + revealWindow) was removed 2026-04-24
// along with the reveal endpoint. No rate limit is needed for an endpoint
// that no longer exists; the corresponding tests (TestAllowReveal_*) were
// deleted. The unlock rate limiter keeps its tests in importpkg_test.go.

// ── collectRecords (cli response fan-in) ───────────────────────────────────

func TestCollectRecords_Empty(t *testing.T) {
	data := json.RawMessage(`{"count":0,"entries":[]}`)
	res := &resultEnvelope{Status: "ok", Data: data}
	out := collectRecords(res, nil, "entries")
	if out.err != nil {
		t.Fatalf("empty response must not be an error: %v", out.err)
	}
	if out.count != 0 || len(out.records) != 0 {
		t.Errorf("empty should produce zero records, got count=%d len=%d", out.count, len(out.records))
	}
}

func TestCollectRecords_Populated(t *testing.T) {
	data := json.RawMessage(`{"count":2,"entries":[{"id":"a"},{"id":"b"}]}`)
	res := &resultEnvelope{Status: "ok", Data: data}
	out := collectRecords(res, nil, "entries")
	if out.err != nil {
		t.Fatalf("unexpected error: %v", out.err)
	}
	if out.count != 2 || len(out.records) != 2 {
		t.Errorf("expected 2 records, got count=%d len=%d", out.count, len(out.records))
	}
}

func TestCollectRecords_CliErrorBranch(t *testing.T) {
	res := &resultEnvelope{Status: "error", ErrorCode: "I_VAULT_KEY_INVALID", ErrorMessage: "bad key"}
	out := collectRecords(res, nil, "entries")
	if out.err == nil {
		t.Fatal("cli-error response must surface as err")
	}
	if ierr, ok := out.err.(*InvokeError); !ok || ierr.Code != "I_VAULT_KEY_INVALID" {
		t.Errorf("expected InvokeError with I_VAULT_KEY_INVALID, got %v", out.err)
	}
}

func TestCollectRecords_MissingArrayKey(t *testing.T) {
	// cli returned ok but no entries/accounts key (empty vault sentinel).
	data := json.RawMessage(`{"count":0}`)
	res := &resultEnvelope{Status: "ok", Data: data}
	out := collectRecords(res, nil, "entries")
	if out.err != nil {
		t.Fatalf("missing array key should be treated as empty, not error: %v", out.err)
	}
	if out.count != 0 {
		t.Errorf("want 0, got %d", out.count)
	}
}

// ── handler target-validation short circuits ──────────────────────────────
//
// These tests exercise the early-return branches that fire BEFORE CliBridge
// spawns a subprocess, so they work with a nil Bridge. This is the "cheap
// HTTP semantics" layer — full happy-path coverage lives in Phase 3 smoke.

// ctxWithKey injects a fake vault_key_hex into the request context so
// vaultKeyFrom(r.Context()) returns true without going through RequireUnlock.
func ctxWithKey(r *http.Request, hex string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), sessionKey{}, hex))
}

func TestEntryAddHandler_OAuth_Returns403(t *testing.T) {
	h := NewVaultCRUDHandlers(NewSessionStore(time.Minute), nil) // nil bridge OK — short-circuits before spawn
	body, _ := json.Marshal(map[string]string{
		"target": "oauth", "alias": "x", "secret_plaintext": "y",
	})
	req := httptest.NewRequest("POST", "/api/user/vault/entry", bytes.NewReader(body))
	req = ctxWithKey(req, "deadbeef")
	w := httptest.NewRecorder()
	h.EntryAddHandler(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("oauth add should be 403, got %d body=%s", w.Code, w.Body.String())
	}
	var payload jsonError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.ErrorCode != ErrOAuthAddViaCLI {
		t.Errorf("want %s, got %s", ErrOAuthAddViaCLI, payload.ErrorCode)
	}
}

// TestRevealHandler_OAuth_Returns403 was removed 2026-04-24 along with the
// reveal endpoint. The "OAuth tokens are never revealed" invariant is now
// enforced structurally (no endpoint exists), not by a 403 branch.

func TestEntryDeleteHandler_Team_Returns400(t *testing.T) {
	h := NewVaultCRUDHandlers(NewSessionStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "team", "id": "vk_xxx"})
	req := httptest.NewRequest("DELETE", "/api/user/vault/entry", bytes.NewReader(body))
	req = ctxWithKey(req, "deadbeef")
	w := httptest.NewRecorder()
	h.EntryDeleteHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("team delete should be 400, got %d body=%s", w.Code, w.Body.String())
	}
	var payload jsonError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.ErrorCode != ErrUnknownTarget {
		t.Errorf("want %s, got %s", ErrUnknownTarget, payload.ErrorCode)
	}
}

func TestAliasPatchHandler_UnknownTarget_Returns400(t *testing.T) {
	h := NewVaultCRUDHandlers(NewSessionStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "mystery", "id": "x", "new_value": "y"})
	req := httptest.NewRequest("PATCH", "/api/user/vault/entry/alias", bytes.NewReader(body))
	req = ctxWithKey(req, "deadbeef")
	w := httptest.NewRecorder()
	h.AliasPatchHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown target should be 400, got %d", w.Code)
	}
}

// TestListHandler_NoSession_DispatchesToLockedPath verifies that a missing
// session cookie no longer short-circuits to a 4xx. Instead, the handler
// should take the locked path and attempt to spawn `query
// list_metadata_locked`. We can't easily exercise the spawn without a real
// cli binary, so this test asserts the handler DOESN'T return the
// old-behavior 422 for a missing key — a 500/503 from the cli spawn is
// acceptable (and expected) in this no-cli unit test environment.
func TestListHandler_NoSession_DispatchesToLockedPath(t *testing.T) {
	h := NewVaultCRUDHandlers(NewSessionStore(time.Minute), NewCliBridge(nil))
	req := httptest.NewRequest("GET", "/api/user/vault/list", nil)
	w := httptest.NewRecorder()
	h.ListHandler(w, req)
	// 422 would mean we regressed back to the old RequireUnlock behavior.
	if w.Code == http.StatusUnprocessableEntity {
		t.Fatalf("locked-path regression: handler returned 422 instead of dispatching to list_metadata_locked (body=%s)", w.Body.String())
	}
	// Any of these is fine — they all indicate the handler took the
	// locked branch and failed further down (cli binary not present in
	// the test process).
	switch w.Code {
	case http.StatusInternalServerError, http.StatusServiceUnavailable, http.StatusGatewayTimeout, http.StatusOK:
		// expected shapes
	default:
		t.Fatalf("unexpected status %d on locked path (body=%s)", w.Code, w.Body.String())
	}
}

// Stage 7-1 (active-state cross-shell sync, 2026-04-27): UseHandler accepts
// target=team. Validation of the team key (existence / state) is done by the
// CLI vault-op layer — the Go handler just needs to stop short-circuiting
// 'team' to ErrUnknownTarget before the bridge invocation. We can't test the
// happy path in this unit harness (needs a real cli binary), but we CAN
// assert that 'team' no longer produces ErrUnknownTarget as a dispatch-layer
// error and that 'mystery' still does.
func TestUseHandler_TeamNoLongerRejectedAtDispatch(t *testing.T) {
	h := NewVaultCRUDHandlers(NewSessionStore(time.Minute), NewCliBridge(nil))
	body, _ := json.Marshal(map[string]string{"target": "team", "id": "vk_xxx"})
	req := httptest.NewRequest("POST", "/api/user/vault/use", bytes.NewReader(body))
	req = ctxWithKey(req, "deadbeef")
	w := httptest.NewRecorder()
	h.UseHandler(w, req)
	// Pre-Stage-7: this returned 400 with ErrUnknownTarget. Now the
	// handler dispatches to the cli bridge; without a real cli, the bridge
	// returns a different error (5xx). What we assert: the response is
	// NOT the dispatch-layer ErrUnknownTarget rejection.
	var payload jsonError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if w.Code == http.StatusBadRequest && payload.ErrorCode == ErrUnknownTarget {
		t.Fatalf("team target was rejected at dispatch layer (regression to pre-Stage-7 behavior); body=%s", w.Body.String())
	}
}

func TestUseHandler_UnknownTarget_StillReturns400(t *testing.T) {
	h := NewVaultCRUDHandlers(NewSessionStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "mystery", "id": "x"})
	req := httptest.NewRequest("POST", "/api/user/vault/use", bytes.NewReader(body))
	req = ctxWithKey(req, "deadbeef")
	w := httptest.NewRecorder()
	h.UseHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("mystery target should be 400, got %d body=%s", w.Code, w.Body.String())
	}
	var payload jsonError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.ErrorCode != ErrUnknownTarget {
		t.Errorf("want %s, got %s", ErrUnknownTarget, payload.ErrorCode)
	}
}

func TestEntryAddHandler_MissingFields_Returns400(t *testing.T) {
	h := NewVaultCRUDHandlers(NewSessionStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "personal"}) // no alias/secret
	req := httptest.NewRequest("POST", "/api/user/vault/entry", bytes.NewReader(body))
	req = ctxWithKey(req, "deadbeef")
	w := httptest.NewRecorder()
	h.EntryAddHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing fields should be 400, got %d", w.Code)
	}
}
