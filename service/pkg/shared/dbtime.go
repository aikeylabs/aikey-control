package shared

import (
	"database/sql"
	"fmt"
	"time"
)

// DBTime returns a Scanner that accepts PostgreSQL time.Time values and the
// string/byte timestamp shapes emitted by modernc SQLite. Repositories shared
// by Production (PostgreSQL) and Trial (SQLite) must use this for timestamp
// columns instead of scanning directly into time.Time.
func DBTime(dst *time.Time) sql.Scanner {
	return dbTimeScanner{dst: dst}
}

// NullableDBTime is the nullable counterpart of DBTime.
func NullableDBTime(dst **time.Time) sql.Scanner {
	return nullableDBTimeScanner{dst: dst}
}

type dbTimeScanner struct {
	dst *time.Time
}

func (s dbTimeScanner) Scan(src any) error {
	switch value := src.(type) {
	case nil:
		*s.dst = time.Time{}
	case time.Time:
		*s.dst = value.UTC()
	case []byte:
		return s.Scan(string(value))
	case string:
		parsed, err := parseDBTime(value)
		if err != nil {
			return err
		}
		*s.dst = parsed
	default:
		return fmt.Errorf("DBTime: cannot scan %T into time.Time", src)
	}
	return nil
}

type nullableDBTimeScanner struct {
	dst **time.Time
}

func (s nullableDBTimeScanner) Scan(src any) error {
	if src == nil {
		*s.dst = nil
		return nil
	}
	var parsed time.Time
	if err := (dbTimeScanner{dst: &parsed}).Scan(src); err != nil {
		return err
	}
	*s.dst = &parsed
	return nil
}

func parseDBTime(value string) (time.Time, error) {
	for _, layout := range []string{
		"2006-01-02 15:04:05.999999999 -0700 MST",
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("DBTime: unparseable timestamp %q", value)
}
