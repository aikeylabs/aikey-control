package shared

import (
	"testing"
	"time"
)

func TestDBTimeScansBothDialects(t *testing.T) {
	want := time.Date(2026, time.July, 12, 20, 30, 40, 0, time.UTC)
	for name, value := range map[string]any{
		"postgres": want,
		"sqlite":   "2026-07-12 20:30:40",
		"bytes":    []byte("2026-07-12T20:30:40Z"),
	} {
		t.Run(name, func(t *testing.T) {
			var got time.Time
			if err := DBTime(&got).Scan(value); err != nil {
				t.Fatalf("scan: %v", err)
			}
			if !got.Equal(want) {
				t.Fatalf("got %v, want %v", got, want)
			}
		})
	}
}

func TestNullableDBTimeScansNull(t *testing.T) {
	want := time.Date(2026, time.July, 12, 20, 30, 40, 0, time.UTC)
	var got *time.Time
	if err := NullableDBTime(&got).Scan(nil); err != nil || got != nil {
		t.Fatalf("null scan = (%v, %v), want (nil, nil)", got, err)
	}
	if err := NullableDBTime(&got).Scan(want); err != nil || got == nil || !got.Equal(want) {
		t.Fatalf("time scan = (%v, %v), want %v", got, err, want)
	}
}
