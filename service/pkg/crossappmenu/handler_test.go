package crossappmenu

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
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

func TestPersonalMenuZhLabels_CoverAllEntries(t *testing.T) {
	// Coverage invariant (Phase E-2): every PersonalMenu entry must have a
	// zh label so a zh user never silently sees an English label mixed in.
	// A new menu entry added without a translation fails here loudly.
	for _, e := range PersonalMenu {
		if _, ok := personalMenuZhLabels[e.ID]; !ok {
			t.Errorf("PersonalMenu entry %q (%q) has no zh label in personalMenuZhLabels", e.ID, e.Label)
		}
	}
}

func TestHandler_LocalizesLabelsForZh(t *testing.T) {
	// zh request → labels swapped to Chinese; en (default) → unchanged.
	// Drives the real Handler through the same LocaleMiddleware the
	// user-local mux uses, so the locale path is exercised end-to-end.
	// Probes personal-vault + personal-apps: vault verifies basic zh
	// localization; apps verifies a second entry stays localized after the
	// 2026-06-26 menu reshuffle (Apps moved INSIGHTS→APPS group, Import was
	// removed as a cross-app entry — see personal_menu.go).
	cases := []struct {
		name      string
		accept    string
		wantVault string
		wantApps  string
	}{
		{"zh", "zh-CN,zh;q=0.9", "保管库", "应用"},
		{"en", "en-US,en;q=0.9", "Vault", "Apps"},
		{"no-header", "", "Vault", "Apps"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := shared.LocaleMiddleware(Handler(SourcePersonal, PersonalMenu))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/system/cross-app-menu", nil)
			if tc.accept != "" {
				req.Header.Set("Accept-Language", tc.accept)
			}
			h.ServeHTTP(rec, req)

			var resp Response
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode: %v", err)
			}
			byID := map[string]string{}
			for _, e := range resp.Entries {
				byID[e.ID] = e.Label
			}
			if got := byID["personal-vault"]; got != tc.wantVault {
				t.Errorf("vault label=%q, want %q", got, tc.wantVault)
			}
			if got := byID["personal-apps"]; got != tc.wantApps {
				t.Errorf("apps label=%q, want %q", got, tc.wantApps)
			}
		})
	}

	// The shared PersonalMenu slice must not be mutated by a zh request.
	if PersonalMenu[0].Label != "Vault" {
		t.Errorf("PersonalMenu mutated: [0].Label=%q, want %q", PersonalMenu[0].Label, "Vault")
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
