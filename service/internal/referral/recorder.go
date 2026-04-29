package referral

import (
	"context"

	"github.com/AiKeyLabs/aikey-control-service/pkg/shared"
)

// Recorder implements identity.ReferralRecorder using the referral Repository.
type Recorder struct {
	repo Repository
}

// NewRecorder creates a Recorder backed by the given repository.
func NewRecorder(repo Repository) *Recorder {
	return &Recorder{repo: repo}
}

// RecordReferral creates a pending referral. Idempotent on (referrer, email).
func (r *Recorder) RecordReferral(ctx context.Context, referrerAccountID, referredEmail string) error {
	return r.repo.Create(ctx, &Referral{
		ReferralID:        shared.NewID(),
		ReferrerAccountID: referrerAccountID,
		ReferredEmail:     referredEmail,
	})
}

// CompleteReferral marks pending referrals for the email as completed.
func (r *Recorder) CompleteReferral(ctx context.Context, referredEmail, referredAccountID string) error {
	_, err := r.repo.Complete(ctx, referredEmail, referredAccountID)
	return err
}
