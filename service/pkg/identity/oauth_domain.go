package identity

import "time"

// Login session status constants — drives the aikey login device flow state machine.
//
// State transitions (web-UI flow):
//
//	pending_email_entry → pending_email_activation → approved_pending_claim → token_issued
//	pending_email_entry → expired
//	pending_email_activation → denied | expired | cancelled
//	approved_pending_claim   → denied
const (
	// LoginSessionStatusPendingEmailEntry is the initial state when the CLI has called
	// Init() but the browser has not yet submitted an email via Begin().
	LoginSessionStatusPendingEmailEntry     = "pending_email_entry"
	LoginSessionStatusPendingEmailActivation = "pending_email_activation"
	LoginSessionStatusApprovedPendingClaim   = "approved_pending_claim"
	LoginSessionStatusTokenIssued            = "token_issued"
	LoginSessionStatusDenied                 = "denied"
	LoginSessionStatusExpired                = "expired"
	LoginSessionStatusCancelled              = "cancelled"
)

// LoginSessionTTL is the maximum lifetime of a login session.
const LoginSessionTTL = 15 * time.Minute

// LoginResendCooldown is the minimum gap between two activation emails on the
// same login session (Begin resend or change-email). Balances anti-spam with
// legitimate "didn't get the mail" retries.
const LoginResendCooldown = 30 * time.Second

// RefreshTokenTTL is the maximum lifetime of an issued refresh token.
const RefreshTokenTTL = 30 * 24 * time.Hour

// PollIntervalSeconds is the recommended polling interval hint returned to the CLI.
const PollIntervalSeconds = 3

// LoginSession represents a single aikey login attempt from a CLI device.
//
// The device_code is held by the CLI and used to poll for status.
// The activation_token is embedded in the email link and consumed on first click.
// The login_token is a one-time copy-paste fallback shown on the web activation page.
type LoginSession struct {
	LoginSessionID  string
	DeviceCode      string
	ActivationToken string  // embedded in email link; consumed on first valid use
	LoginToken      *string // fallback copy-paste token; nil until activation
	LoginTokenUsed  bool
	Email           string
	ClientName      string
	ClientVersion   string
	OSPlatform      string
	Status          string
	AccountID       *string
	ExpiresAt       time.Time
	CreatedAt       time.Time
	// LastEmailSentAt tracks when the activation email was last (re-)sent.
	// Drives the per-session resend cooldown; nil on freshly-created sessions
	// that have not yet entered pending_email_activation.
	LastEmailSentAt *time.Time
}

// IsExpired returns true if the session has passed its expiry time.
func (s *LoginSession) IsExpired() bool {
	return time.Now().UTC().After(s.ExpiresAt)
}

// RefreshToken is a long-lived opaque credential stored as a SHA-256 hash.
// Presenting the original plaintext allows issuing new short-lived access tokens
// without requiring the user to re-run aikey login.
type RefreshToken struct {
	TokenID        string
	AccountID      string
	TokenHash      string  // SHA-256 hex of the plaintext token; plaintext is never stored
	LoginSessionID *string // the session that originally issued this token
	Revoked        bool
	ExpiresAt      time.Time
	CreatedAt      time.Time
}
