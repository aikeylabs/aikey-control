package shared

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// Connection-pool bounds, overridable via env — same convention and defaults
// as collector/query (aikey-data shared/db.go, P0-4 S5). Why a bound at all
// (N2 定案 2026-08-19): an UNBOUNDED pool turns any burst of concurrent
// queries into one physical PG connection each; during the capacity-ladder
// port-exhaustion incident the control plane's reconnect churn helped blow
// through PostgreSQL max_connections (~100), taking every other PG client
// down with it. Queuing on a bounded pool degrades gracefully; exhausting the
// server does not.
const (
	defaultDBMaxOpenConns = 20
	defaultDBMaxIdleConns = 5
)

// envPoolSize reads a positive integer pool size from env; empty/invalid →
// fallback with a WARN (never silently — logging-conventions).
func envPoolSize(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		slog.Warn("invalid pool size env; using default",
			"event.name", "shared.db.pool_env_invalid", "env", key, "value", v, "default", fallback)
		return fallback
	}
	return n
}

// OpenDB opens a PostgreSQL connection pool from the given DSN.
func OpenDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	db.SetMaxOpenConns(envPoolSize("AIKEY_DB_MAX_OPEN_CONNS", defaultDBMaxOpenConns))
	db.SetMaxIdleConns(envPoolSize("AIKEY_DB_MAX_IDLE_CONNS", defaultDBMaxIdleConns))
	return db, nil
}

// RunMigrations executes unapplied .sql files from the given directory in lexical order.
// It tracks applied migrations in a `schema_migrations` table so each migration runs only once.
// Each migration runs in its own transaction; if any fails, the process stops.
func RunMigrations(db *sql.DB, dir string) error {
	if err := ensureMigrationsTable(db); err != nil {
		return err
	}

	applied, err := getAppliedMigrations(db)
	if err != nil {
		return err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir %q: %w", dir, err)
	}

	// Collect and sort .sql filenames
	var files []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		files = append(files, entry.Name())
	}
	sort.Strings(files)

	for _, name := range files {
		if applied[name] {
			continue
		}

		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read migration %q: %w", name, err)
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin tx for migration %q: %w", name, err)
		}

		if _, err := tx.Exec(string(data)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %q: %w", name, err)
		}

		if _, err := tx.Exec(
			`INSERT INTO schema_migrations (filename) VALUES ($1)`,
			name,
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %q: %w", name, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %q: %w", name, err)
		}
	}

	return nil
}

// ensureMigrationsTable creates the schema_migrations tracking table if it does not exist.
func ensureMigrationsTable(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename   TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}
	return nil
}

// getAppliedMigrations returns a set of already-applied migration filenames.
func getAppliedMigrations(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query(`SELECT filename FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("query applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan migration row: %w", err)
		}
		applied[name] = true
	}
	return applied, rows.Err()
}
