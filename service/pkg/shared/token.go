package shared

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenTTL is the JWT validity window for legacy/admin tokens.
const TokenTTL = 24 * time.Hour

// AccessTokenTTL is the validity window for OAuth access tokens issued to
// the CLI (via `aikey login`) and to the web (via `aikey web` on
// production JWT-mode deployments). Refresh-token (RefreshTokenTTL =
// 30 days) is the longer-lived companion the CLI uses for silent
// renewal — so this number controls "how often the CLI must talk to
// the server" rather than "max session length".
//
// 2026-05-11 raised from 1 h → 24 h: 1 h forced a refresh every hour
// which was noisy in logs and made the browser webJWT (same TTL)
// expire mid-session whenever the user kept a tab open through
// lunch, surfacing as the unfriendly `/user/session-expired` page
// every couple of hours. 24 h matches the legacy TokenTTL above so
// both flows have the same "one workday before refresh" cadence.
const AccessTokenTTL = 24 * time.Hour

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

// IssueAccessToken creates an access JWT for OAuth CLI sessions (lifetime
// `AccessTokenTTL`, currently 24 h). Use this instead of Issue for tokens
// issued through the aikey login flow — they round-trip the
// access/refresh pair the CLI silently renews.
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
