package vault

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// ── pure helpers ──────────────────────────────────────────────────────────

func TestItoa(t *testing.T) {
	cases := []struct {
		in   int
		want string
	}{
		{0, "0"}, {1, "1"}, {9, "9"}, {10, "10"}, {99, "99"}, {123, "123"}, {-5, "-5"},
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
	if got := nextSuffix("foo-5", 2); got != "foo-2" {
		t.Fatalf("foo-5 with n=2 should strip to foo-2, got %q", got)
	}
	if got := nextSuffix("openai-work-12", 3); got != "openai-work-3" {
		t.Fatalf("compound stem should still strip trailing -N, got %q", got)
	}
}

func TestNextSuffix_NonNumericHyphenStays(t *testing.T) {
	if got := nextSuffix("claude-work", 2); got != "claude-work-2" {
		t.Fatalf("non-numeric suffix should not be stripped, got %q", got)
	}
}

func TestNextSuffix_LeadingHyphenNotStripped(t *testing.T) {
	if got := nextSuffix("-5", 2); got != "-5-2" {
		t.Fatalf("leading-hyphen stem must not be stripped, got %q", got)
	}
}

// ── collectRecords (cli response fan-in) ───────────────────────────────────

func TestCollectRecords_Empty(t *testing.T) {
	data := json.RawMessage(`{"count":0,"entries":[]}`)
	res := &cli.Result{Status: "ok", Data: data}
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
	res := &cli.Result{Status: "ok", Data: data}
	out := collectRecords(res, nil, "entries")
	if out.err != nil {
		t.Fatalf("unexpected error: %v", out.err)
	}
	if out.count != 2 || len(out.records) != 2 {
		t.Errorf("expected 2 records, got count=%d len=%d", out.count, len(out.records))
	}
}

func TestCollectRecords_CliErrorBranch(t *testing.T) {
	res := &cli.Result{Status: "error", ErrorCode: "I_VAULT_KEY_INVALID", ErrorMessage: "bad key"}
	out := collectRecords(res, nil, "entries")
	if out.err == nil {
		t.Fatal("cli-error response must surface as err")
	}
	if ierr, ok := out.err.(*cli.InvokeError); !ok || ierr.Code != "I_VAULT_KEY_INVALID" {
		t.Errorf("expected InvokeError with I_VAULT_KEY_INVALID, got %v", out.err)
	}
}

func TestCollectRecords_MissingArrayKey(t *testing.T) {
	data := json.RawMessage(`{"count":0}`)
	res := &cli.Result{Status: "ok", Data: data}
	out := collectRecords(res, nil, "entries")
	if out.err != nil {
		t.Fatalf("missing array key should be treated as empty, not error: %v", out.err)
	}
	if out.count != 0 {
		t.Errorf("want 0, got %d", out.count)
	}
}

// ── handler target-validation short circuits ──────────────────────────────

// reqWithKey builds a request with a vault_key_hex injected into context as
// if RequireUnlock had run, so handlers can be exercised without spinning up
// the real middleware chain.
func reqWithKey(method, path string, body []byte) *http.Request {
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	return r.WithContext(InjectKey(r.Context(), "deadbeef"))
}

func TestEntryAddHandler_OAuth_Returns403(t *testing.T) {
	h := NewCRUDHandlers(NewStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{
		"target": "oauth", "alias": "x", "secret_plaintext": "y",
	})
	req := reqWithKey("POST", "/api/user/vault/entry", body)
	w := httptest.NewRecorder()
	h.EntryAddHandler(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("oauth add should be 403, got %d body=%s", w.Code, w.Body.String())
	}
	var payload cli.JSONError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.ErrorCode != cli.ErrOAuthAddViaCLI {
		t.Errorf("want %s, got %s", cli.ErrOAuthAddViaCLI, payload.ErrorCode)
	}
}

func TestEntryDeleteHandler_Team_Returns400(t *testing.T) {
	h := NewCRUDHandlers(NewStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "team", "id": "vk_xxx"})
	req := reqWithKey("DELETE", "/api/user/vault/entry", body)
	w := httptest.NewRecorder()
	h.EntryDeleteHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("team delete should be 400, got %d body=%s", w.Code, w.Body.String())
	}
	var payload cli.JSONError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.ErrorCode != cli.ErrUnknownTarget {
		t.Errorf("want %s, got %s", cli.ErrUnknownTarget, payload.ErrorCode)
	}
}

func TestAliasPatchHandler_UnknownTarget_Returns400(t *testing.T) {
	h := NewCRUDHandlers(NewStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "mystery", "id": "x", "new_value": "y"})
	req := reqWithKey("PATCH", "/api/user/vault/entry/alias", body)
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
// old-behavior 422 for a missing key.
func TestListHandler_NoSession_DispatchesToLockedPath(t *testing.T) {
	h := NewCRUDHandlers(NewStore(time.Minute), cli.New(nil))
	req := httptest.NewRequest("GET", "/api/user/vault/list", nil)
	w := httptest.NewRecorder()
	h.ListHandler(w, req)
	if w.Code == http.StatusUnprocessableEntity {
		t.Fatalf("locked-path regression: handler returned 422 instead of dispatching to list_metadata_locked (body=%s)", w.Body.String())
	}
	switch w.Code {
	case http.StatusInternalServerError, http.StatusServiceUnavailable, http.StatusGatewayTimeout, http.StatusOK:
	default:
		t.Fatalf("unexpected status %d on locked path (body=%s)", w.Code, w.Body.String())
	}
}

// Stage 7-1: UseHandler accepts target=team. Validation of the team key
// (existence / state) is done by the CLI vault-op layer.
func TestUseHandler_TeamNoLongerRejectedAtDispatch(t *testing.T) {
	h := NewCRUDHandlers(NewStore(time.Minute), cli.New(nil))
	body, _ := json.Marshal(map[string]string{"target": "team", "id": "vk_xxx"})
	req := reqWithKey("POST", "/api/user/vault/use", body)
	w := httptest.NewRecorder()
	h.UseHandler(w, req)
	var payload cli.JSONError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if w.Code == http.StatusBadRequest && payload.ErrorCode == cli.ErrUnknownTarget {
		t.Fatalf("team target was rejected at dispatch layer (regression to pre-Stage-7 behavior); body=%s", w.Body.String())
	}
}

func TestUseHandler_UnknownTarget_StillReturns400(t *testing.T) {
	h := NewCRUDHandlers(NewStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "mystery", "id": "x"})
	req := reqWithKey("POST", "/api/user/vault/use", body)
	w := httptest.NewRecorder()
	h.UseHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("mystery target should be 400, got %d body=%s", w.Code, w.Body.String())
	}
	var payload cli.JSONError
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload.ErrorCode != cli.ErrUnknownTarget {
		t.Errorf("want %s, got %s", cli.ErrUnknownTarget, payload.ErrorCode)
	}
}

func TestEntryAddHandler_MissingFields_Returns400(t *testing.T) {
	h := NewCRUDHandlers(NewStore(time.Minute), nil)
	body, _ := json.Marshal(map[string]string{"target": "personal"})
	req := reqWithKey("POST", "/api/user/vault/entry", body)
	w := httptest.NewRecorder()
	h.EntryAddHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing fields should be 400, got %d", w.Code)
	}
}
