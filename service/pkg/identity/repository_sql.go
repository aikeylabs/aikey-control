package identity

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/AiKeyLabs/aikey-control-service/pkg/shared"
)

// sqlRepo implements Repository against PostgreSQL or SQLite —
// dialect differences are handled by shared.DB (see pkg/shared/
// dbkit.go). Renamed from postgresRepo/NewPostgresRepository
// 2026-04-24 because the file name was misleading.
type sqlRepo struct {
	db *shared.DB
}

// NewSQLRepository creates a Repository backed by either PG or SQLite.
func NewSQLRepository(db *shared.DB) Repository {
	return &sqlRepo{db: db}
}

func (r *sqlRepo) Create(ctx context.Context, a *GlobalAccount) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO global_accounts
			(account_id, email, account_status, password_hash, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		a.AccountID, a.Email, a.AccountStatus, a.PasswordHash, time.Now().UTC(),
	)
	return r.db.TranslateError(err)
}

func (r *sqlRepo) FindByID(ctx context.Context, accountID string) (*GlobalAccount, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT account_id, email, account_status, COALESCE(password_hash,''),
		       created_at, last_login_at
		FROM global_accounts WHERE account_id = ?`, accountID)
	return scanAccount(row)
}

func (r *sqlRepo) FindByEmail(ctx context.Context, email string) (*GlobalAccount, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT account_id, email, account_status, COALESCE(password_hash,''),
		       created_at, last_login_at
		FROM global_accounts WHERE email = ?`, email)
	return scanAccount(row)
}

func (r *sqlRepo) UpdateLastLogin(ctx context.Context, accountID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE global_accounts SET last_login_at = ? WHERE account_id = ?`,
		time.Now().UTC(), accountID,
	)
	return err
}

func scanAccount(row *sql.Row) (*GlobalAccount, error) {
	var a GlobalAccount
	var lastLogin sql.NullTime
	err := row.Scan(&a.AccountID, &a.Email, &a.AccountStatus, &a.PasswordHash,
		&a.CreatedAt, &lastLogin)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan account: %w", err)
	}
	if lastLogin.Valid {
		a.LastLoginAt = &lastLogin.Time
	}
	return &a, nil
}
