package identity

import (
	"context"
	"errors"
)

// ErrLoginSessionWrongState is returned by SetEmail / ResendEmail when the
// session row exists but is not in the status the method expects. The
// service layer translates this into the correct domain error for the caller
// (terminal / expired / cooldown).
var ErrLoginSessionWrongState = errors.New("login session not in expected state")

// LoginSessionRepository stores and retrieves LoginSession records.
type LoginSessionRepository interface {
	Create(ctx context.Context, session *LoginSession) error
	FindByID(ctx context.Context, sessionID string) (*LoginSession, error)
	FindByDeviceCode(ctx context.Context, deviceCode string) (*LoginSession, error)
	FindByActivationToken(ctx context.Context, token string) (*LoginSession, error)
	// SetEmail attaches an email and a fresh activation_token to a pending_email_entry
	// session, transitioning it to pending_email_activation so that the activation
	// email can be sent.  Returns an error (without mutating state) if session_id /
	// device_code do not match or the session is not in pending_email_entry state.
	// Also stamps last_email_sent_at = now so subsequent Begin calls can enforce
	// the resend cooldown.
	SetEmail(ctx context.Context, sessionID, deviceCode, email, activationToken string) error
	// ResendEmail rotates activation_token + email (email may change) on a
	// session that is already in pending_email_activation. Enforces the check
	// at SQL level: the UPDATE only matches when status = pending_email_activation
	// AND session_id/device_code match. Also updates last_email_sent_at = now.
	// Returns a sentinel error (ErrSessionNotInActivation) when no row matches,
	// so the service layer can distinguish "race" from "wrong input".
	ResendEmail(ctx context.Context, sessionID, deviceCode, email, activationToken string) error
	// Approve marks the session approved_pending_claim and records the account_id
	// and the one-time login_token for the copy-paste fallback path.
	Approve(ctx context.Context, sessionID, loginToken, accountID string) error
	// IssueToken marks the session token_issued after OAuth tokens have been sent.
	IssueToken(ctx context.Context, sessionID string) error
	// MarkLoginTokenUsed prevents a login_token from being exchanged a second time.
	MarkLoginTokenUsed(ctx context.Context, sessionID string) error
	// Deny marks the session denied (suspended account, unresolvable conflict, etc.).
	Deny(ctx context.Context, sessionID string) error
}

// RefreshTokenRepository stores and retrieves RefreshToken records.
type RefreshTokenRepository interface {
	Create(ctx context.Context, rt *RefreshToken) error
	FindByHash(ctx context.Context, hash string) (*RefreshToken, error)
	Revoke(ctx context.Context, tokenID string) error
}
