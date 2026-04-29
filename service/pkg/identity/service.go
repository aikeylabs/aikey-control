package identity

import (
	"context"
	"fmt"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
	"golang.org/x/crypto/bcrypt"
)

// Service handles identity use cases: registration and login.
//
// TODO(evolution): when moving to half-DDD, split LoginCommand / RegisterCommand
// into explicit command structs and route through a command bus.
type Service struct {
	repo Repository
}

// NewService creates an identity Service backed by the provided repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// RegisterParams carries the input for account registration.
type RegisterParams struct {
	Email    string
	Password string // plaintext; hashed before storage
}

// Register creates a new GlobalAccount.  Returns ErrConflict if email is taken.
func (s *Service) Register(ctx context.Context, p RegisterParams) (*GlobalAccount, error) {
	existing, _ := s.repo.FindByEmail(ctx, p.Email)
	if existing != nil {
		return nil, shared.BizAuthEmailTaken(p.Email)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	account := &GlobalAccount{
		AccountID:     shared.NewID(),
		Email:         p.Email,
		AccountStatus: AccountStatusActive,
		PasswordHash:  string(hash),
	}
	if err := s.repo.Create(ctx, account); err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}
	return account, nil
}

// LoginParams carries credentials for login.
type LoginParams struct {
	Email    string
	Password string
}

// Login validates credentials and returns the account on success.
func (s *Service) Login(ctx context.Context, p LoginParams) (*GlobalAccount, error) {
	account, err := s.repo.FindByEmail(ctx, p.Email)
	if err != nil || account == nil {
		return nil, shared.BizAuthInvalidCredentials()
	}
	if !account.IsActive() {
		return nil, shared.BizAuthAccountInactive()
	}
	if err := bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(p.Password)); err != nil {
		return nil, shared.BizAuthInvalidCredentials()
	}
	_ = s.repo.UpdateLastLogin(ctx, account.AccountID)
	return account, nil
}

// GetByID fetches an account by ID; returns ErrNotFound if absent.
func (s *Service) GetByID(ctx context.Context, accountID string) (*GlobalAccount, error) {
	a, err := s.repo.FindByID(ctx, accountID)
	if err != nil || a == nil {
		return nil, shared.BizAuthTokenInvalid()
	}
	return a, nil
}
