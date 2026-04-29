// Package referral tracks user-to-user invite relationships.
// This is a side-path feature — errors must never block the main login flow.
package referral

import "time"

// Referral records a single referrer → referred relationship.
type Referral struct {
	ReferralID        string     `json:"referral_id"`
	ReferrerAccountID string     `json:"referrer_account_id"`
	ReferredEmail     string     `json:"referred_email"`
	ReferredAccountID string     `json:"referred_account_id,omitempty"`
	Status            string     `json:"status"` // pending | completed
	CreatedAt         time.Time  `json:"created_at"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
}
