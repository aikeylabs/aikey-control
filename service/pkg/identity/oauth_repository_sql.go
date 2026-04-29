package identity

// SQL-backed (PostgreSQL or SQLite via shared.DB) implementations for
// the two OAuth-side repositories declared in oauth_repository.go —
// LoginSession (the OAuth device-code / activation flow) and
// RefreshToken (the issued JWT bookkeeping).
//
// Naming note: these constructors are deliberately called
// NewLoginSessionRepository / NewRefreshTokenRepository (no `Postgres`
// or `SQL` prefix) because they were never mis-labeled to begin with.
// The 2026-04-24 DDD rename only touched names that lied — i.e.
// `postgresRepo` / `NewPostgresRepository` — which in this package
// was the main identity.Repository (renamed to sqlRepo /
// NewSQLRepository). Adding `SQL` to these two purely for
// uniformity would churn cross-package callsites (cmd/main.go,
// appkit/core/base.go) without fixing anything concrete. If a future
// cleanup wants to normalize, the pattern to pick is either
// "all SQL-backed ctors have NewSQL* prefix" or "no dialect prefix
// anywhere (rely on file name + doc)"; this decision is out of scope
// for the 2026-04-24 pass.

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// ---- loginSessionRepo ----

type loginSessionRepo struct{ db *shared.DB }

// NewLoginSessionRepository creates a SQL-backed LoginSessionRepository
// (PostgreSQL or SQLite — dialect handled by shared.DB).
func NewLoginSessionRepository(db *shared.DB) LoginSessionRepository {
	return &loginSessionRepo{db: db}
}

func (r *loginSessionRepo) Create(ctx context.Context, s *LoginSession) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO login_sessions
			(login_session_id, device_code, activation_token, email,
			 client_name, client_version, os_platform, status, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		s.LoginSessionID, s.DeviceCode, s.ActivationToken, s.Email,
		s.ClientName, s.ClientVersion, s.OSPlatform, s.Status,
		s.ExpiresAt, time.Now().UTC(),
	)
	return err
}

// selectColumns is the canonical column list for LoginSession reads. Kept as
// a constant so SetEmail / ResendEmail / scanLoginSession stay in sync — a
// drift was the root cause of the 2026-04-21 resend/change-email bug (new
// column added without updating readers).
const loginSessionSelectColumns = `login_session_id, device_code, activation_token, login_token,
	       login_token_used, email, client_name, client_version, os_platform,
	       status, account_id, expires_at, created_at, last_email_sent_at`

func (r *loginSessionRepo) FindByID(ctx context.Context, id string) (*LoginSession, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+loginSessionSelectColumns+`
		FROM login_sessions WHERE login_session_id = ?`, id)
	return scanLoginSession(row)
}

func (r *loginSessionRepo) FindByDeviceCode(ctx context.Context, deviceCode string) (*LoginSession, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+loginSessionSelectColumns+`
		FROM login_sessions WHERE device_code = ?`, deviceCode)
	return scanLoginSession(row)
}

func (r *loginSessionRepo) FindByActivationToken(ctx context.Context, token string) (*LoginSession, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+loginSessionSelectColumns+`
		FROM login_sessions WHERE activation_token = ?`, token)
	return scanLoginSession(row)
}

func (r *loginSessionRepo) SetEmail(ctx context.Context, sessionID, deviceCode, email, activationToken string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE login_sessions
		SET email = ?, activation_token = ?, status = ?, last_email_sent_at = ?
		WHERE login_session_id = ? AND device_code = ? AND status = ?`,
		email, activationToken, LoginSessionStatusPendingEmailActivation, time.Now().UTC(),
		sessionID, deviceCode, LoginSessionStatusPendingEmailEntry,
	)
	if err != nil {
		return fmt.Errorf("set email on login session: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrLoginSessionWrongState
	}
	return nil
}

// ResendEmail rotates activation_token on a session already in
// pending_email_activation. Also supports change-email (email column gets
// overwritten if it differs). Invalidates the previous activation link by
// overwriting activation_token — the old email's embedded token no longer
// matches any row.
func (r *loginSessionRepo) ResendEmail(ctx context.Context, sessionID, deviceCode, email, activationToken string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE login_sessions
		SET email = ?, activation_token = ?, last_email_sent_at = ?
		WHERE login_session_id = ? AND device_code = ? AND status = ?`,
		email, activationToken, time.Now().UTC(),
		sessionID, deviceCode, LoginSessionStatusPendingEmailActivation,
	)
	if err != nil {
		return fmt.Errorf("resend email on login session: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrLoginSessionWrongState
	}
	return nil
}

func (r *loginSessionRepo) Approve(ctx context.Context, sessionID, loginToken, accountID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE login_sessions
		SET status = ?, login_token = ?, account_id = ?
		WHERE login_session_id = ?`,
		LoginSessionStatusApprovedPendingClaim, loginToken, accountID, sessionID,
	)
	return err
}

func (r *loginSessionRepo) IssueToken(ctx context.Context, sessionID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE login_sessions SET status = ? WHERE login_session_id = ?`,
		LoginSessionStatusTokenIssued, sessionID,
	)
	return err
}

func (r *loginSessionRepo) MarkLoginTokenUsed(ctx context.Context, sessionID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE login_sessions SET login_token_used = 1 WHERE login_session_id = ?`, sessionID,
	)
	return err
}

func (r *loginSessionRepo) Deny(ctx context.Context, sessionID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE login_sessions SET status = ? WHERE login_session_id = ?`,
		LoginSessionStatusDenied, sessionID,
	)
	return err
}

func scanLoginSession(row *sql.Row) (*LoginSession, error) {
	var s LoginSession
	var loginToken sql.NullString
	var accountID sql.NullString
	var lastSent sql.NullTime
	err := row.Scan(
		&s.LoginSessionID, &s.DeviceCode, &s.ActivationToken, &loginToken,
		&s.LoginTokenUsed, &s.Email, &s.ClientName, &s.ClientVersion, &s.OSPlatform,
		&s.Status, &accountID, &s.ExpiresAt, &s.CreatedAt, &lastSent,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan login session: %w", err)
	}
	if loginToken.Valid {
		s.LoginToken = &loginToken.String
	}
	if accountID.Valid {
		s.AccountID = &accountID.String
	}
	if lastSent.Valid {
		t := lastSent.Time
		s.LastEmailSentAt = &t
	}
	return &s, nil
}

// ---- refreshTokenRepo ----

type refreshTokenRepo struct{ db *shared.DB }

// NewRefreshTokenRepository creates a SQL-backed RefreshTokenRepository
// (PostgreSQL or SQLite — dialect handled by shared.DB).
func NewRefreshTokenRepository(db *shared.DB) RefreshTokenRepository {
	return &refreshTokenRepo{db: db}
}

func (r *refreshTokenRepo) Create(ctx context.Context, rt *RefreshToken) error {
	var sessionID sql.NullString
	if rt.LoginSessionID != nil {
		sessionID = sql.NullString{String: *rt.LoginSessionID, Valid: true}
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO refresh_tokens
			(token_id, account_id, token_hash, login_session_id, revoked, expires_at, created_at)
		VALUES (?, ?, ?, ?, 0, ?, ?)`,
		rt.TokenID, rt.AccountID, rt.TokenHash, sessionID, rt.ExpiresAt, time.Now().UTC(),
	)
	return err
}

func (r *refreshTokenRepo) FindByHash(ctx context.Context, hash string) (*RefreshToken, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT token_id, account_id, token_hash, login_session_id,
		       revoked, expires_at, created_at
		FROM refresh_tokens WHERE token_hash = ?`, hash)
	var rt RefreshToken
	var sessionID sql.NullString
	err := row.Scan(&rt.TokenID, &rt.AccountID, &rt.TokenHash, &sessionID,
		&rt.Revoked, &rt.ExpiresAt, &rt.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan refresh token: %w", err)
	}
	if sessionID.Valid {
		s := sessionID.String
		rt.LoginSessionID = &s
	}
	return &rt, nil
}

func (r *refreshTokenRepo) Revoke(ctx context.Context, tokenID string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE refresh_tokens SET revoked = 1 WHERE token_id = ?`, tokenID,
	)
	return err
}
