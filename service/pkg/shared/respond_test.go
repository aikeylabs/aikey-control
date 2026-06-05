package shared

import (
	"net/http"
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
			got := domainErrorStatus(tc.code)
			if got != tc.want {
				t.Errorf("domainErrorStatus(%q) = %d, want %d (NOT 500 — see "+
					"Master Settings → Change Password 401-interceptor rationale)", tc.code, got, tc.want)
			}
		})
	}
}
