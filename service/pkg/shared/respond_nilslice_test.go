package shared

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Fences for EnsureEmptyCollections — the single-exit fix for the nil-slice→
// JSON-null defect class (4 incidents: 2026-05-23 performance rows, 07-16
// cluster slots, 07-18 cluster accounts, 07-30 seats members; see
// respond_nilslice.go for the full story).
//
// The assertions are on the SERIALIZED BYTES, not on len() — the defect lives
// in the wire representation, and len(nil)==0 passes on the Go side while the
// browser still receives `null` (the exact trap named in the 07-30 record).

// The 07-30 shape: `var out []T` + a loop that appended zero times.
func TestJSONEncodesNilSliceFieldAsEmptyArray(t *testing.T) {
	type detail struct {
		Members []string `json:"members"`
	}
	rec := httptest.NewRecorder()
	JSON(rec, 200, detail{}) // Members is nil — nobody appended

	body := rec.Body.String()
	if strings.Contains(body, `"members":null`) {
		t.Fatalf("nil slice reached the wire as null — the 2026-07-30 seats crash shape: %s", body)
	}
	if !strings.Contains(body, `"members":[]`) {
		t.Fatalf("expected members:[] on the wire, got: %s", body)
	}
}

// The 07-16/07-18 shape: the nil slice sits deep inside nested structs,
// slices of structs, pointers, and maps — where a per-field fix cannot follow.
func TestJSONNormalizesNestedCollections(t *testing.T) {
	type slot struct {
		Accounts []string `json:"accounts"`
	}
	type group struct {
		Slots   []slot           `json:"slots"`
		BySeat  map[string][]int `json:"by_seat"`
		Nested  *group           `json:"nested,omitempty"`
		Ignored string           `json:"ignored"`
	}
	payload := &group{
		Slots:  []slot{{Accounts: nil}}, // nil inside a slice element
		BySeat: map[string][]int{"s1": nil},
		Nested: &group{Slots: nil}, // nil behind a pointer
	}
	rec := httptest.NewRecorder()
	JSON(rec, 200, payload)

	body := rec.Body.String()
	// NOT a blanket "no null": the nested group's nil MAP legitimately stays
	// null (maps are outside this fix's scope by design). Assert the slice
	// fields specifically.
	for _, want := range []string{`"accounts":[]`, `"by_seat":{"s1":[]}`, `"slots":[]`} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %s in: %s", want, body)
		}
	}
}

// Scope guard: the rewrite must NOT widen into shapes the fix does not own.
func TestJSONLeavesNonArrayShapesAlone(t *testing.T) {
	type payload struct {
		Blob   []byte          `json:"blob"`             // marshals as string/null, not array
		Raw    json.RawMessage `json:"raw"`              // raw passthrough
		When   time.Time       `json:"when"`             // json.Marshaler — owns its shape
		MaybeP *int            `json:"maybe_p"`          // nil pointer stays null
		MaybeM map[string]int  `json:"maybe_m"`          // nil map stays null
		Omit   []string        `json:"omit,omitempty"`   // omitempty still omits
	}
	rec := httptest.NewRecorder()
	JSON(rec, 200, payload{})

	body := rec.Body.String()
	for _, want := range []string{`"blob":null`, `"raw":null`, `"maybe_p":null`, `"maybe_m":null`} {
		if !strings.Contains(body, want) {
			t.Fatalf("scope widened — expected %s to survive untouched, got: %s", want, body)
		}
	}
	if strings.Contains(body, `"omit"`) {
		t.Fatalf("omitempty stopped omitting — the rewrite changed empty-slice semantics: %s", body)
	}
}

// Interface-typed values (handlers often pass map[string]any) must be reached.
func TestJSONNormalizesThroughInterfaces(t *testing.T) {
	var nilList []string
	rec := httptest.NewRecorder()
	JSON(rec, 200, map[string]any{"items": nilList, "n": 3})

	body := rec.Body.String()
	if !strings.Contains(body, `"items":[]`) {
		t.Fatalf("nil slice behind interface{} reached the wire as null: %s", body)
	}
}

// A self-marshalling type must not be recursed into even when it CONTAINS
// slices — its MarshalJSON is the contract.
type customWire struct{ Hidden []string }

func (customWire) MarshalJSON() ([]byte, error) { return []byte(`"custom"`), nil }

func TestJSONRespectsCustomMarshalers(t *testing.T) {
	rec := httptest.NewRecorder()
	JSON(rec, 200, struct {
		C customWire `json:"c"`
	}{})
	if got := strings.TrimSpace(rec.Body.String()); got != `{"c":"custom"}` {
		t.Fatalf("custom marshaler output changed: %s", got)
	}
}
