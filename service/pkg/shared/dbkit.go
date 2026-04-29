package shared

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/AiKeyLabs/pkg/aikeytime"
)

// Dialect constants for database selection.
const (
	DialectPostgres = "postgres"
	DialectSQLite   = "sqlite"
)

// DB wraps *sql.DB with dialect awareness. Repository code uses ? placeholders
// universally; the wrapper rewrites them to $1,$2,... for PostgreSQL.
//
// This eliminates the need for separate postgres.go / sqlite.go repository
// files in packages whose dialect differences are expression-level (date
// bucketing, placeholders, casts, ON CONFLICT). Packages with structural
// differences — e.g. pq.Array ↔ IN (?,?,…), per-row upsert shapes — still
// split into postgres.go + sqlite.go (see managedkey/ and snapshot/).
type DB struct {
	*sql.DB
	Dialect string
}

// NewDB wraps an existing *sql.DB with a dialect tag.
func NewDB(db *sql.DB, dialect string) *DB {
	return &DB{DB: db, Dialect: dialect}
}

// BindMillis returns the correct driver argument for an aikeytime.Millis
// value on the current dialect. β-hybrid:
//   - SQLite (INTEGER column)    → int64 millis; 0 → nil (SQL NULL)
//   - Postgres (TIMESTAMPTZ col) → time.Time (UTC); zero → nil
//
// See roadmap20260320/技术实现/update/20260424-时间戳统一为int64毫秒-data-service.md.
func (d *DB) BindMillis(m aikeytime.Millis) any {
	if m.IsZero() {
		return nil
	}
	if d.Dialect == DialectSQLite {
		return m.Int64()
	}
	return m.Time()
}

// BindMillisPtr is the nullable-pointer variant. nil → NULL.
func (d *DB) BindMillisPtr(m *aikeytime.Millis) any {
	if m == nil || m.IsZero() {
		return nil
	}
	if d.Dialect == DialectSQLite {
		return m.Int64()
	}
	return m.Time()
}

// ExecContext executes a query with placeholder rewriting.
func (d *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.DB.ExecContext(ctx, d.rewrite(query), args...)
}

// QueryContext executes a query with placeholder rewriting.
func (d *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.DB.QueryContext(ctx, d.rewrite(query), args...)
}

// QueryRowContext executes a query with placeholder rewriting.
func (d *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return d.DB.QueryRowContext(ctx, d.rewrite(query), args...)
}

// Begin starts a transaction and returns a dialect-aware Tx wrapper.
func (d *DB) Begin() (*Tx, error) {
	tx, err := d.DB.Begin()
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, dialect: d.Dialect}, nil
}

// BeginTx starts a transaction with options.
func (d *DB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*Tx, error) {
	tx, err := d.DB.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, dialect: d.Dialect}, nil
}

// InsertOrIgnore returns dialect-appropriate INSERT that silently skips duplicates.
//
//	Postgres: INSERT INTO t (...) VALUES (...) ON CONFLICT DO NOTHING
//	SQLite:   INSERT OR IGNORE INTO t (...) VALUES (...)
func (d *DB) InsertOrIgnore(table, columns, placeholders string) string {
	if d.Dialect == DialectSQLite {
		return fmt.Sprintf("INSERT OR IGNORE INTO %s (%s) VALUES (%s)", table, columns, placeholders)
	}
	return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT DO NOTHING", table, columns, placeholders)
}

// Now returns the SQL expression for current timestamp.
//
//	Postgres: NOW()
//	SQLite:   datetime('now')
func (d *DB) Now() string {
	if d.Dialect == DialectSQLite {
		return "datetime('now')"
	}
	return "NOW()"
}

// IsSQLite returns true if the dialect is SQLite.
func (d *DB) IsSQLite() bool { return d.Dialect == DialectSQLite }

// TranslateError converts a database driver error to a DomainError when
// a known constraint mapping exists. Dispatches to the appropriate handler
// based on dialect.
func (d *DB) TranslateError(err error) error {
	if err == nil {
		return nil
	}
	if d.Dialect == DialectSQLite {
		return translateSQLiteError(err)
	}
	return TranslatePGError(err)
}

// translateSQLiteError maps SQLite constraint errors to DomainError.
// SQLite error format: "UNIQUE constraint failed: table.col1, table.col2"
func translateSQLiteError(err error) error {
	msg := err.Error()

	if strings.Contains(msg, "UNIQUE constraint failed") {
		for _, rule := range sqliteConstraintRules {
			if strings.Contains(msg, rule.pattern) {
				return rule.factory(msg)
			}
		}
		// Unknown unique constraint.
		return &DomainError{
			Code:    CodeBizBindAliasTaken,
			Message: "unique constraint violated",
			Meta:    map[string]any{"db_detail": msg},
		}
	}

	if strings.Contains(msg, "FOREIGN KEY constraint failed") {
		return &DomainError{
			Code:    CodeBizOrgNotFound,
			Message: "referenced resource not found",
			Meta:    map[string]any{"db_detail": msg},
		}
	}

	if strings.Contains(msg, "NOT NULL constraint failed") {
		field := msg
		if idx := strings.LastIndex(msg, "."); idx >= 0 && idx+1 < len(msg) {
			field = msg[idx+1:]
		}
		return DataInvalidField(field, "not_null", fmt.Sprintf("field %q must not be null", field))
	}

	return err
}

var sqliteConstraintRules = []struct {
	pattern string
	factory func(string) *DomainError
}{
	{"global_accounts.email", func(d string) *DomainError {
		return &DomainError{Code: CodeBizAuthEmailTaken, Message: "email is already registered", Meta: map[string]any{"db_detail": d}}
	}},
	{"org_seats.org_id, org_seats.invited_email", func(d string) *DomainError {
		return &DomainError{Code: CodeBizSeatEmailTaken, Message: "a seat for this email already exists in the org", Meta: map[string]any{"db_detail": d}}
	}},
	{"providers.provider_code", func(d string) *DomainError {
		return &DomainError{Code: CodeBizProvCodeTaken, Message: "a provider with this code already exists", Meta: map[string]any{"db_detail": d}}
	}},
	{"managed_provider_credentials.org_id, managed_provider_credentials.provider_id, managed_provider_credentials.display_name", func(d string) *DomainError {
		return &DomainError{Code: CodeBizCredNameTaken, Message: "a credential with this name already exists for this provider in the org", Meta: map[string]any{"db_detail": d}}
	}},
	{"managed_provider_bindings.org_id, managed_provider_bindings.binding_alias", func(d string) *DomainError {
		return &DomainError{Code: CodeBizBindAliasTaken, Message: "a template binding with this alias already exists in the org", Meta: map[string]any{"db_detail": d}}
	}},
	{"managed_provider_bindings.virtual_key_id, managed_provider_bindings.protocol_type, managed_provider_bindings.provider_id", func(d string) *DomainError {
		return &DomainError{Code: CodeBizBindDuplicateTarget, Message: "an active binding for this protocol/provider pair already exists on this virtual key", Meta: map[string]any{"db_detail": d}}
	}},
	{"managed_virtual_keys.org_id, managed_virtual_keys.seat_id, managed_virtual_keys.alias", func(d string) *DomainError {
		return &DomainError{Code: CodeBizKeyAliasTaken, Message: "a virtual key with this alias already exists for this seat", Meta: map[string]any{"db_detail": d}}
	}},
}

// Tx wraps *sql.Tx with dialect-aware placeholder rewriting.
type Tx struct {
	*sql.Tx
	dialect string
}

// ExecContext executes a query within the transaction with placeholder rewriting.
func (t *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.Tx.ExecContext(ctx, rewriteIfPG(query, t.dialect), args...)
}

// QueryContext executes a query within the transaction.
func (t *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.Tx.QueryContext(ctx, rewriteIfPG(query, t.dialect), args...)
}

// QueryRowContext executes a query within the transaction.
func (t *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return t.Tx.QueryRowContext(ctx, rewriteIfPG(query, t.dialect), args...)
}

// rewrite converts ? placeholders to $N for PostgreSQL. No-op for SQLite.
func (d *DB) rewrite(query string) string {
	return rewriteIfPG(query, d.Dialect)
}

func rewriteIfPG(query, dialect string) string {
	if dialect != DialectPostgres {
		return query
	}
	// Fast path: no ? in query.
	if !strings.Contains(query, "?") {
		return query
	}
	var b strings.Builder
	b.Grow(len(query) + 16)
	n := 1
	inString := false
	for i := 0; i < len(query); i++ {
		ch := query[i]
		if ch == '\'' {
			inString = !inString
		}
		if ch == '?' && !inString {
			b.WriteByte('$')
			b.WriteString(fmt.Sprintf("%d", n))
			n++
		} else {
			b.WriteByte(ch)
		}
	}
	return b.String()
}
