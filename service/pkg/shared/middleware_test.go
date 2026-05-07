package shared

import (
	"net/http"
	"net/http/httptest"
	"testing"
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
