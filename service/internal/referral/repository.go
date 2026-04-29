package referral

import "context"

// Repository is the storage contract for referrals.
type Repository interface {
	// Create inserts a new pending referral. Duplicate (referrer, email) pairs
	// are silently ignored (idempotent).
	Create(ctx context.Context, r *Referral) error
	// Complete marks referrals for the given email as completed, linking them
	// to the referred account. Returns count of rows updated.
	Complete(ctx context.Context, referredEmail, referredAccountID string) (int, error)
	// ListByReferrer returns all referrals created by a given account.
	ListByReferrer(ctx context.Context, referrerAccountID string) ([]*Referral, error)
}
