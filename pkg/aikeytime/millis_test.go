package aikeytime

import (
	"encoding/json"
	"testing"
	"time"
)

func TestFromTimeAndBack(t *testing.T) {
	now := time.Date(2026, 4, 24, 12, 25, 7, 375_000_000, time.UTC)
	m := FromTime(now)
	got := m.Time()
	if !got.Equal(now) {
		t.Fatalf("round trip mismatch:\n got  %s\n want %s", got, now)
	}
}

func TestFromTimeLocalNormalisesToUTC(t *testing.T) {
	// Same instant in two zones should produce identical Millis.
	utc := time.Date(2026, 4, 24, 1, 30, 0, 0, time.UTC)
	cstLoc := time.FixedZone("CST", 8*3600)
	cst := time.Date(2026, 4, 24, 9, 30, 0, 0, cstLoc) // same instant
	if FromTime(utc) != FromTime(cst) {
		t.Fatalf("FromTime should be tz-agnostic: utc=%d cst=%d", FromTime(utc), FromTime(cst))
	}
}

func TestFromZeroTimeGivesZero(t *testing.T) {
	var zero time.Time
	if m := FromTime(zero); m != 0 {
		t.Fatalf("zero time.Time should give Millis(0), got %d", m)
	}
}

func TestMillisJSONRoundTrip(t *testing.T) {
	m := FromTime(time.Date(2026, 4, 24, 14, 30, 0, 0, time.UTC))
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != "1777041000000" {
		t.Fatalf("unexpected JSON %s", b)
	}
	var got Millis
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got != m {
		t.Fatalf("round trip mismatch: got %d want %d", got, m)
	}
}

func TestMillisJSONZeroIsNull(t *testing.T) {
	b, err := json.Marshal(Millis(0))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != "null" {
		t.Fatalf("zero should marshal as null, got %s", b)
	}
	var m Millis
	if err := json.Unmarshal([]byte("null"), &m); err != nil {
		t.Fatalf("unmarshal null: %v", err)
	}
	if m != 0 {
		t.Fatalf("null should unmarshal as 0, got %d", m)
	}
}

func TestMillisJSONStringToleranceRFC3339(t *testing.T) {
	var m Millis
	if err := json.Unmarshal([]byte(`"2026-04-24T14:30:00Z"`), &m); err != nil {
		t.Fatalf("unmarshal RFC3339 string: %v", err)
	}
	want := FromTime(time.Date(2026, 4, 24, 14, 30, 0, 0, time.UTC))
	if m != want {
		t.Fatalf("got %d want %d", m, want)
	}
}

func TestScan(t *testing.T) {
	cases := []struct {
		name string
		src  any
		want Millis
	}{
		{"nil", nil, 0},
		{"int64", int64(1777041000000), 1777041000000},
		{"int", 1777041000000, 1777041000000},
		{"float64", float64(1777041000000), 1777041000000},
		{"string int", "1777041000000", 1777041000000},
		{"time.Time utc", time.Date(2026, 4, 24, 14, 30, 0, 0, time.UTC), 1777041000000},
		{"time.Time cst", time.Date(2026, 4, 24, 22, 30, 0, 0, time.FixedZone("CST", 8*3600)), 1777041000000},
		{"go default String cst", "2026-04-24 22:30:00 +0800 CST", 1777041000000},
		{"go default String utc", "2026-04-24 14:30:00 +0000 UTC", 1777041000000},
		{"naive datetime", "2026-04-24 14:30:00", 1777041000000},
		{"RFC3339", "2026-04-24T14:30:00Z", 1777041000000},
		{"iso date", "2026-04-24", 1776988800000},
		{"bytes", []byte("1777041000000"), 1777041000000},
		{"empty string", "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var m Millis
			if err := m.Scan(tc.src); err != nil {
				t.Fatalf("Scan(%v): %v", tc.src, err)
			}
			if m != tc.want {
				t.Fatalf("Scan(%v) = %d want %d", tc.src, m, tc.want)
			}
		})
	}
}

func TestScanUnsupportedType(t *testing.T) {
	var m Millis
	if err := m.Scan(struct{}{}); err == nil {
		t.Fatalf("expected error for unsupported type")
	}
}

func TestValue(t *testing.T) {
	m := Millis(1777041000000)
	v, err := m.Value()
	if err != nil {
		t.Fatalf("Value: %v", err)
	}
	if v.(int64) != 1777041000000 {
		t.Fatalf("Value = %v want 1777041000000", v)
	}

	// Zero → nil
	zero := Millis(0)
	v, err = zero.Value()
	if err != nil {
		t.Fatalf("Value zero: %v", err)
	}
	if v != nil {
		t.Fatalf("Value zero = %v want nil", v)
	}
}

func TestParseTimeLegacyFormats(t *testing.T) {
	// Instant: 2026-04-24 14:30:00 UTC
	want := time.Date(2026, 4, 24, 14, 30, 0, 0, time.UTC)
	cases := []string{
		"2026-04-24 14:30:00.000000000 +0000 UTC", // Go default with UTC
		"2026-04-24 22:30:00.000000000 +0800 CST", // Go default with named CST zone
		"2026-04-24T14:30:00Z",                    // RFC3339
		"2026-04-24T14:30:00.000Z",                // RFC3339Nano with millis
		"2026-04-24 14:30:00",                     // Naive
	}
	for _, s := range cases {
		t.Run(s, func(t *testing.T) {
			got, err := ParseTime(s)
			if err != nil {
				t.Fatalf("ParseTime(%q): %v", s, err)
			}
			if !got.Equal(want) {
				t.Fatalf("ParseTime(%q) = %s want %s", s, got, want)
			}
		})
	}
}

func TestParseTimeUnknownFormat(t *testing.T) {
	if _, err := ParseTime("not a date"); err == nil {
		t.Fatalf("expected error for unrecognised format")
	}
}

func TestMillisStringEmpty(t *testing.T) {
	if Millis(0).String() != "" {
		t.Fatalf("zero millis should stringify as empty")
	}
}

func TestMillisIsZero(t *testing.T) {
	if !Millis(0).IsZero() {
		t.Fatalf("Millis(0) should be IsZero()")
	}
	if Millis(1).IsZero() {
		t.Fatalf("Millis(1) should not be IsZero()")
	}
}

// Regression — the actual bug that motivated this refactor. Simulates
// sort order on int64 (correct) vs lexicographic on Go default String
// format (broken).
func TestCrossDayBoundarySorting(t *testing.T) {
	// Two events: one at 2026-04-24T16:00Z (UTC afternoon) which is
	// 2026-04-25T00:00+08:00 local, and one at 2026-04-24T00:30Z
	// (UTC early morning) which is 2026-04-24T08:30+08:00 local.
	// Both should be within the UTC-day 2026-04-24.
	dayStart := FromTime(time.Date(2026, 4, 24, 0, 0, 0, 0, time.UTC))
	dayEnd := FromTime(time.Date(2026, 4, 25, 0, 0, 0, 0, time.UTC))

	earlyLocal := FromTime(time.Date(2026, 4, 24, 8, 30, 0, 0, time.FixedZone("CST", 8*3600)))
	lateLocal := FromTime(time.Date(2026, 4, 25, 0, 0, 0, 0, time.FixedZone("CST", 8*3600)))

	if earlyLocal < dayStart || earlyLocal >= dayEnd {
		t.Fatalf("early event should be within UTC day: early=%d dayStart=%d dayEnd=%d", earlyLocal, dayStart, dayEnd)
	}
	if lateLocal < dayStart || lateLocal >= dayEnd {
		t.Fatalf("late event should be within UTC day: late=%d dayStart=%d dayEnd=%d", lateLocal, dayStart, dayEnd)
	}
}
