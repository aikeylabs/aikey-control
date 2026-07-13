package shared

import (
	"errors"
	"net/http"
	"testing"

	"github.com/lib/pq"
)

func TestSSOIdentityConstraintTranslation(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		err := translateSQLiteError(errors.New(
			"UNIQUE constraint failed: account_external_identities.provider, account_external_identities.subject",
		))
		assertDomainErrorCode(t, err, CodeBizSSOIdentityConflict)
	})

	t.Run("postgres", func(t *testing.T) {
		err := TranslatePGError(&pq.Error{
			Code:       "23505",
			Constraint: "pk_account_external_identities",
			Detail:     "Key (provider, subject)=(feishu, union-1) already exists.",
		})
		assertDomainErrorCode(t, err, CodeBizSSOIdentityConflict)
	})
}

func TestSSOErrorHTTPStatuses(t *testing.T) {
	cases := map[string]int{
		CodeBizSSOStateInvalid:     http.StatusBadRequest,
		CodeBizSSOTenantMismatch:   http.StatusForbidden,
		CodeBizSSOIdentityConflict: http.StatusConflict,
		CodeBizSSOProviderDisabled: http.StatusUnprocessableEntity,
		CodeBizSSOExchangeFailed:   http.StatusBadGateway,
	}
	for code, want := range cases {
		if got := domainErrorStatus(code); got != want {
			t.Errorf("domainErrorStatus(%q) = %d, want %d", code, got, want)
		}
	}
}

func assertDomainErrorCode(t *testing.T, err error, want string) {
	t.Helper()
	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected DomainError, got %T: %v", err, err)
	}
	if domainErr.Code != want {
		t.Fatalf("error code = %q, want %q", domainErr.Code, want)
	}
}
