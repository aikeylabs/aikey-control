package crossappmenu

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandler_ReturnsExpectedShape(t *testing.T) {
	entries := []Entry{
		{ID: "x", Group: GroupKeys, Label: "X", Path: "/x", Visibility: VisibilityAlways, Icon: "ic"},
	}
	h := Handler(SourcePersonal, entries)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/system/cross-app-menu", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type=%q, want application/json; charset=utf-8", got)
	}

	var resp Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp.SchemaVersion != SchemaVersion {
		t.Errorf("schema_version=%d, want %d", resp.SchemaVersion, SchemaVersion)
	}
	if resp.Source != SourcePersonal {
		t.Errorf("source=%q, want %q", resp.Source, SourcePersonal)
	}
	if _, err := time.Parse(time.RFC3339, resp.FetchedAt); err != nil {
		t.Errorf("fetched_at=%q not RFC3339: %v", resp.FetchedAt, err)
	}
	if len(resp.Entries) != 1 || resp.Entries[0].ID != "x" {
		t.Errorf("entries=%+v, want one entry with id=x", resp.Entries)
	}
}

func TestPersonalMenu_HasNoEmptyFields(t *testing.T) {
	// Drift-safety probe: every entry must have all required fields set
	// (the JSON wire contract says id/group/label/path/visibility are
	// non-empty). Catches accidentally-deleted field values during edits.
	for i, e := range PersonalMenu {
		if e.ID == "" {
			t.Errorf("PersonalMenu[%d]: empty ID", i)
		}
		if e.Group == "" {
			t.Errorf("PersonalMenu[%d] (%s): empty Group", i, e.ID)
		}
		if e.Label == "" {
			t.Errorf("PersonalMenu[%d] (%s): empty Label", i, e.ID)
		}
		if e.Path == "" || e.Path[0] != '/' {
			t.Errorf("PersonalMenu[%d] (%s): Path=%q must be non-empty and start with /", i, e.ID, e.Path)
		}
		if e.Visibility == "" {
			t.Errorf("PersonalMenu[%d] (%s): empty Visibility", i, e.ID)
		}
	}
}

func TestPersonalMenu_UniqueIDs(t *testing.T) {
	// IDs are stable cross-app keys used for active-state matching.
	// Duplicate IDs would silently break that contract.
	seen := make(map[string]bool, len(PersonalMenu))
	for _, e := range PersonalMenu {
		if seen[e.ID] {
			t.Errorf("duplicate id %q in PersonalMenu", e.ID)
		}
		seen[e.ID] = true
	}
}
