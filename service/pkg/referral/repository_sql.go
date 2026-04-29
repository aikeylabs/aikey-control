package referral

import (
	"context"
	"fmt"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

type sqlRepo struct{ db *shared.DB }

// NewSQLRepository creates a SQL-backed referral repository (PostgreSQL
// or SQLite — dialect handled transparently by shared.DB).
func NewSQLRepository(db *shared.DB) Repository {
	return &sqlRepo{db: db}
}

func (r *sqlRepo) Create(ctx context.Context, ref *Referral) error {
	query := r.db.InsertOrIgnore("referrals",
		"referral_id, referrer_account_id, referred_email, status",
		"?, ?, ?, 'pending'")
	_, err := r.db.ExecContext(ctx, query,
		ref.ReferralID, ref.ReferrerAccountID, ref.ReferredEmail)
	return err
}

func (r *sqlRepo) Complete(ctx context.Context, referredEmail, referredAccountID string) (int, error) {
	query := fmt.Sprintf(`UPDATE referrals
		 SET referred_account_id = ?, status = 'completed', completed_at = %s
		 WHERE referred_email = ? AND status = 'pending'`, r.db.Now())
	res, err := r.db.ExecContext(ctx, query,
		referredAccountID, referredEmail)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (r *sqlRepo) ListByReferrer(ctx context.Context, referrerAccountID string) ([]*Referral, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT referral_id, referrer_account_id, referred_email,
		        COALESCE(referred_account_id, ''), status, created_at, completed_at
		 FROM referrals
		 WHERE referrer_account_id = ?
		 ORDER BY created_at DESC`, referrerAccountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*Referral
	for rows.Next() {
		var ref Referral
		if err := rows.Scan(
			&ref.ReferralID, &ref.ReferrerAccountID, &ref.ReferredEmail,
			&ref.ReferredAccountID, &ref.Status, &ref.CreatedAt, &ref.CompletedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, &ref)
	}
	return result, rows.Err()
}
