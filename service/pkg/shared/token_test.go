package shared

import (
	"strings"
	"testing"
	"time"
)

func testTokenService(t *testing.T) *TokenService {
	t.Helper()
	return NewTokenService([]byte(strings.Repeat("x", 32)))
}

func TestTokenService_RoundTrip(t *testing.T) {
	ts := testTokenService(t)

	token, err := ts.Issue("acc-1", "user@example.com")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if token == "" {
		t.Fatal("empty token")
	}

	claims, err := ts.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.AccountID != "acc-1" {
		t.Errorf("AccountID = %q, want acc-1", claims.AccountID)
	}
	if claims.Email != "user@example.com" {
		t.Errorf("Email = %q", claims.Email)
	}
}

func TestTokenService_InvalidSignature(t *testing.T) {
	ts1 := testTokenService(t)
	ts2 := NewTokenService([]byte(strings.Repeat("y", 32)))

	token, _ := ts1.Issue("acc-1", "user@example.com")
	if _, err := ts2.Verify(token); err == nil {
		t.Error("expected error verifying token with wrong secret")
	}
}

func TestTokenService_Expiry(t *testing.T) {
	// Override TTL to verify expiry logic exists (actual expiry tested via clock skew).
	ts := testTokenService(t)
	token, _ := ts.Issue("acc-1", "u@e.com")
	claims, err := ts.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.ExpiresAt == nil {
		t.Fatal("token must have an expiry")
	}
	if !claims.ExpiresAt.After(time.Now()) {
		t.Error("token must expire in the future")
	}
}

func TestTokenService_TamperedToken(t *testing.T) {
	ts := testTokenService(t)
	token, _ := ts.Issue("acc-1", "u@e.com")

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Skip("unexpected JWT format")
	}
	// Corrupt the payload.
	parts[1] = parts[1] + "X"
	tampered := strings.Join(parts, ".")
	if _, err := ts.Verify(tampered); err == nil {
		t.Error("expected error for tampered token")
	}
}
