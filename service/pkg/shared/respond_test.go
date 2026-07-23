package shared

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestDomainErrorStatus_ChangePasswordCodes pins the HTTP status mapping for
// the two BIZ codes added 2026-06-02 for POST /v1/accounts/me/password
// (Master Settings → Change Password).
//
// Why this test matters: domainErrorStatus()'s default branch silently
// returns 500. If these two codes ever fall out of the explicit 400 case
// (e.g., a refactor moves them under a different bucket), the web client's
// 401-interceptor would still leave the page alone, but the user would see
// the generic "unknown error" banner instead of the targeted localized
// message — and the masterSettings.changePassword.errors.wrongCurrent /
// .weakPassword UI strings would silently rot.
func TestDomainErrorStatus_ChangePasswordCodes(t *testing.T) {
	cases := []struct {
		code string
		want int
	}{
		{CodeBizAuthWrongCurrentPwd, http.StatusBadRequest},
		{CodeBizAuthWeakPassword, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			got := DomainErrorHTTPStatus(tc.code)
			if got != tc.want {
				t.Errorf("domainErrorStatus(%q) = %d, want %d (NOT 500 — see "+
					"Master Settings → Change Password 401-interceptor rationale)", tc.code, got, tc.want)
			}
		})
	}
}

func TestDomainErrorStatus_OAuthPoolAndOnlineAgentCodes(t *testing.T) {
	cases := []struct {
		code string
		want int
	}{
		{CodeBizOauthGroupProviderUnsupported, http.StatusUnprocessableEntity},
		{CodeBizOauthGroupProviderMixed, http.StatusUnprocessableEntity},
		{CodeBizOauthGroupProtocolMixed, http.StatusUnprocessableEntity},
		{CodeBizOauthGroupProtocolInvalid, http.StatusUnprocessableEntity},
		{CodeBizOauthGroupBotSeat, http.StatusUnprocessableEntity},
		{CodeBizAgentGroupNotMember, http.StatusForbidden},
		{CodeBizAgentPoolNotOwner, http.StatusForbidden},
		{CodeBizAgentLimitReached, http.StatusConflict},
		{CodeBizAgentNonClusterOrg, http.StatusConflict},
		{CodeBizAgentParentSeatRequired, http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			if got := DomainErrorHTTPStatus(tc.code); got != tc.want {
				t.Fatalf("DomainErrorHTTPStatus(%q) = %d, want %d", tc.code, got, tc.want)
			}
		})
	}
}

func TestDomainErrorResponse_RegisteredAndUnknownCodes(t *testing.T) {
	tests := []struct {
		code string
		want int
	}{
		{CodeBizOauthGroupProviderMixed, http.StatusUnprocessableEntity},
		{CodeBizAgentGroupNotMember, http.StatusForbidden},
		{CodeBizAgentLimitReached, http.StatusConflict},
		{"BIZ_TEST_UNREGISTERED", http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.code, func(t *testing.T) {
			rec := httptest.NewRecorder()
			DomainErrorResponse(rec, &DomainError{Code: tt.code, Message: "test"})
			if rec.Code != tt.want {
				t.Fatalf("HTTP status = %d, want %d; body=%s", rec.Code, tt.want, rec.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got := body["error"]; got != tt.code {
				t.Fatalf("response error = %v, want %s", got, tt.code)
			}
		})
	}
}
