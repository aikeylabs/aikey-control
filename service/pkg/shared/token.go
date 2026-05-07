package shared

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenTTL is the JWT validity window for legacy/admin tokens.
const TokenTTL = 24 * time.Hour

// AccessTokenTTL is the validity window for OAuth access tokens issued to CLI.
const AccessTokenTTL = 1 * time.Hour

// Claims are the payload fields embedded in every JWT issued by this service.
type Claims struct {
	AccountID string `json:"account_id"`
	Email     string `json:"email"`
	jwt.RegisteredClaims
}

// TokenService handles JWT creation and validation.
type TokenService struct {
	secret []byte
}

// NewTokenService creates a TokenService with the given signing secret.
// secret must be at least 32 bytes.
func NewTokenService(secret []byte) *TokenService {
	return &TokenService{secret: secret}
}

// Issue creates and signs a JWT for the given account.
func (ts *TokenService) Issue(accountID, email string) (string, error) {
	now := time.Now()
	claims := Claims{
		AccountID: accountID,
		Email:     email,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(TokenTTL)),
			Issuer:    "aikey-control-service",
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(ts.secret)
}

// IssueAccessToken creates a short-lived (1 h) JWT for OAuth CLI sessions.
// Use this instead of Issue for tokens issued through the aikey login flow.
func (ts *TokenService) IssueAccessToken(accountID, email string) (string, error) {
	now := time.Now()
	claims := Claims{
		AccountID: accountID,
		Email:     email,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
			Issuer:    "aikey-control-service",
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(ts.secret)
}

// Verify parses and validates a JWT, returning the embedded claims.
func (ts *TokenService) Verify(tokenStr string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return ts.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}
	claims, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, errors.New("invalid token claims")
	}
	return claims, nil
}
