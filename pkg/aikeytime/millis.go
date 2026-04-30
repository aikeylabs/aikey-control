// Package aikeytime is the shared timestamp wrapper across aikey services.
//
// Millis is an int64 Unix epoch in milliseconds. Chosen because:
//   - SQLite stores int64 natively in INTEGER columns, eliminating the
//     string-comparison / strftime-parse class of bugs we hit when
//     time.Time was written via Go's default String() format with a
//     local tz suffix (e.g. "2026-04-24 12:25:07.375794 +0800 CST").
//   - 13-digit numbers are JS-native (Date.now()) and flow through JSON
//     without any parsing / serialization ambiguity.
//   - int64 comparison is trivially monotonic and timezone-free.
//
// On Postgres the column type remains TIMESTAMPTZ — the wrapper's
// Scanner tolerates both int64 and time.Time at read, and its Valuer
// always emits int64 (Postgres driver converts int64 to an epoch
// timestamp via the server-side cast Postgres does automatically
// when binding to TIMESTAMPTZ parameters). See ParseTime for the
// fallback used to accept legacy on-disk formats (Go default String
// / naive datetime / RFC3339) during one-shot data migrations.
package aikeytime

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Millis is Unix epoch time in milliseconds. Zero value represents
// "null / not set" — use NullMillis (with Valid bool) when the
// distinction between 0 and null matters (rare; most usage columns
// are NOT NULL).
type Millis int64

// FromTime converts a time.Time to Millis, normalising to UTC.
func FromTime(t time.Time) Millis {
	if t.IsZero() {
		return 0
	}
	return Millis(t.UTC().UnixMilli())
}

// Now returns the current time as Millis.
func Now() Millis { return Millis(time.Now().UTC().UnixMilli()) }

// Time returns the Millis as a time.Time in UTC.
func (m Millis) Time() time.Time {
	if m == 0 {
		return time.Time{}
	}
	return time.UnixMilli(int64(m)).UTC()
}

// IsZero reports whether m is the zero value.
func (m Millis) IsZero() bool { return m == 0 }

// Int64 returns the underlying epoch millis as int64. Use this at
// write sites where the driver expects a plain integer (e.g. SQLite
// INTEGER column). The Value() method on this type returns the same
// value via the database/sql Valuer path.
func (m Millis) Int64() int64 { return int64(m) }

// String renders as RFC3339 UTC for human eyes. The wire format is
// int64, not this string — see MarshalJSON.
func (m Millis) String() string {
	if m == 0 {
		return ""
	}
	return m.Time().Format(time.RFC3339Nano)
}

// MarshalJSON emits the int64 millis. Zero emits JSON null to keep
// nullable columns round-tripping through APIs without fake zeros.
// Callers who need "0 = unset" semantics (almost none in this
// codebase) should wrap with explicit *Millis.
func (m Millis) MarshalJSON() ([]byte, error) {
	if m == 0 {
		return []byte("null"), nil
	}
	return []byte(strconv.FormatInt(int64(m), 10)), nil
}

// UnmarshalJSON accepts:
//   - int64 / JSON number → int64 millis
//   - "null" → zero
//   - JSON string → RFC3339 / Go default String / naive datetime
//     (tolerance path for hand-crafted test fixtures and transition
//     period where an old wire serializer may still send strings)
//
// Why the tolerance: during the one-shot data migration phase we need
// to read legacy on-disk strings; ParseTime is the shared parser.
// Once migration settles we could tighten this to numbers-only, but
// the surface is small enough that keeping tolerance is cheap.
func (m *Millis) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "null" || trimmed == "" {
		*m = 0
		return nil
	}
	// JSON number
	if n, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		*m = Millis(n)
		return nil
	}
	// JSON string
	if len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"' {
		s := trimmed[1 : len(trimmed)-1]
		if s == "" {
			*m = 0
			return nil
		}
		t, err := ParseTime(s)
		if err != nil {
			return fmt.Errorf("aikeytime.Millis: %w", err)
		}
		*m = FromTime(t)
		return nil
	}
	return fmt.Errorf("aikeytime.Millis: cannot parse %q", trimmed)
}

// Scan implements sql.Scanner. Accepts:
//   - int64  → direct millis (SQLite INTEGER column)
//   - time.Time → FromTime (Postgres TIMESTAMPTZ column)
//   - string → ParseTime fallback (legacy data during migration,
//     or drivers that stringify on read)
//   - nil → zero
//   - []byte → same as string (some SQLite drivers return bytes)
//
// Why accept string at read: during migration the old column still
// holds legacy formats; readers upstream of the migration (or
// unsafely-ordered reads during a crash-mid-migration recovery)
// should degrade gracefully rather than panic.
func (m *Millis) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*m = 0
		return nil
	case int64:
		*m = Millis(v)
		return nil
	case int:
		*m = Millis(int64(v))
		return nil
	case float64:
		*m = Millis(int64(v))
		return nil
	case time.Time:
		*m = FromTime(v)
		return nil
	case string:
		if v == "" {
			*m = 0
			return nil
		}
		// Try int first (SQLite's flexible typing may return string
		// for an INTEGER column in some edge cases).
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			*m = Millis(n)
			return nil
		}
		t, err := ParseTime(v)
		if err != nil {
			return fmt.Errorf("aikeytime.Millis.Scan string %q: %w", v, err)
		}
		*m = FromTime(t)
		return nil
	case []byte:
		return m.Scan(string(v))
	}
	return fmt.Errorf("aikeytime.Millis.Scan: unsupported type %T", src)
}

// Value implements driver.Valuer. Always emits int64; nil for zero.
// Postgres TIMESTAMPTZ binding: pgx / lib/pq accept int64 via
// client-side type coercion only when the column is explicitly cast;
// in practice every write site in this codebase lets the driver pick
// a textual representation. To stay safe across both dialects, we
// emit int64 unconditionally — SQLite stores as INTEGER (target
// column type post-migration), Postgres stores via the driver's
// implicit int8 → timestamptz path using to_timestamp semantics
// enforced at write-site SQL (`to_timestamp($1/1000.0)`) where
// needed. See the write-site helpers in collector-service for the
// Postgres binding wrapper.
//
// Why zero → nil: zero-as-null preserves nullability semantics across
// the wrapper without requiring sql.NullInt64 everywhere. Columns
// declared NOT NULL will never receive nil here because upstream
// code ensures they're set.
func (m Millis) Value() (driver.Value, error) {
	if m == 0 {
		return nil, nil
	}
	return int64(m), nil
}

// ---------------------------------------------------------------------------
// ParseTime: fallback parser for legacy on-disk strings
// ---------------------------------------------------------------------------

// Accepted input formats (probed in order):
//
//  1. "2006-01-02 15:04:05.999999999 -0700 MST"   — Go default time.Time.String(), with named zone abbreviation
//  2. "2006-01-02 15:04:05.999999999 -0700"        — Go default sans zone name
//  3. "2006-01-02 15:04:05 -0700 MST"              — same, no fractional
//  4. time.RFC3339Nano                              — "2006-01-02T15:04:05.999999999Z07:00"
//  5. time.RFC3339                                  — "2006-01-02T15:04:05Z07:00"
//  6. "2006-01-02 15:04:05.999999999"              — naive datetime (UTC assumed), SQLite datetime() output
//  7. "2006-01-02 15:04:05"                         — naive, no fractional (SQLite datetime('now') default)
//  8. "2006-01-02"                                  — date only (UTC assumed; only used for usage_date legacy)
//
// Why cover so many: see design doc 20260424-时间戳统一为int64毫秒-data-service.md, §"兼容现存数据的 4 类格式".
var legacyFormats = []string{
	"2006-01-02 15:04:05.999999999 -0700 MST",
	"2006-01-02 15:04:05 -0700 MST",
	"2006-01-02 15:04:05.999999999 -0700",
	"2006-01-02 15:04:05 -0700",
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02 15:04:05.999999999",
	"2006-01-02 15:04:05",
	"2006-01-02",
}

// ParseTime attempts to parse s in every known legacy format. Naive
// datetime inputs (no zone) are interpreted as UTC. Plain integer
// strings are treated as Unix epoch milliseconds — this path exists
// for mid-migration recovery where some rows may already hold int64
// millis written by a newer binary (see v1.0.3-alpha hook logs).
func ParseTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty time string")
	}
	// Integer string → Unix millis. Only accept if the value falls in a
	// plausible millis range (> 10^12 ≈ 2001-09-09) so we don't mis-read
	// a 10-digit second-epoch as millis. 13 digits is today.
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		if n > 1_000_000_000_000 {
			return time.UnixMilli(n).UTC(), nil
		}
	}
	for _, layout := range legacyFormats {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
		// For naive formats without zone, also try ParseInLocation(UTC)
		// which is semantically equivalent but some Go versions differ
		// on how time.Parse treats no-zone layouts. Belt-and-braces.
		if !strings.ContainsAny(layout, "-Z") {
			if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
				return t.UTC(), nil
			}
		}
	}
	return time.Time{}, fmt.Errorf("unrecognised time format: %q", s)
}
