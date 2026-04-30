package cli

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
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
		{ErrCliTimeout, 504},
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
