package identity

import "context"

// Repository defines the storage contract for GlobalAccount.
// Implementations live in repository_sql.go (dual-dialect — PostgreSQL
// or SQLite via shared.DB); mocks in tests.
type Repository interface {
	Create(ctx context.Context, account *GlobalAccount) error
	FindByID(ctx context.Context, accountID string) (*GlobalAccount, error)
	FindByEmail(ctx context.Context, email string) (*GlobalAccount, error)
	UpdateLastLogin(ctx context.Context, accountID string) error
}
