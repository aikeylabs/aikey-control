// Package identity covers the GlobalAccount bounded context:
// platform-wide identity, login, and authentication tokens.
//
// Bounded context: Identity
// Ubiquitous language: GlobalAccount, account_id, email, account_status
package identity

import "time"

// AccountStatus values for GlobalAccount.
const (
	AccountStatusActive    = "active"
	AccountStatusSuspended = "suspended"
	AccountStatusDeleted   = "deleted"
)

// GlobalAccount represents a platform-wide user identity.
// It is NOT an org member; membership is expressed via OrgSeat.
type GlobalAccount struct {
	AccountID     string
	Email         string
	AccountStatus string
	PasswordHash  string // bcrypt; empty for SSO-only accounts
	CreatedAt     time.Time
	LastLoginAt   *time.Time
}

// IsActive returns true if the account may authenticate.
func (a *GlobalAccount) IsActive() bool {
	return a.AccountStatus == AccountStatusActive
}
