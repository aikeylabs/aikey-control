package crossappmenu

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// Handler returns an http.Handler that responds with the supplied
// menu entries on every GET. Use one Handler per side (Personal /
// Team), instantiated with that side's OWN_*_MENU.
//
// CORS: the handler intentionally does NOT set Access-Control-Allow-Origin
// — that's done at the framework / router layer (see the Register call
// in each side's handler.go). Keeping CORS out of the handler lets the
// caller decide the allowlist per-deployment without rebuilding this
// package.
//
// Why the entries are passed in (not read from a global): each binary
// owns its own menu data, and tests need to be able to construct a
// handler with arbitrary entries.
func Handler(source Source, entries []Entry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Phase E-2 (2026-05-30): localise the menu labels to the request's
		// negotiated locale. LocaleMiddleware (wrapping the user-local mux)
		// has already resolved Accept-Language onto the ResponseWriter, so
		// LocaleFromWriter is the single source of truth here (same path the
		// error-message i18n uses). en stays the default; only the labels
		// change — IDs / paths / groups / visibility are locale-invariant.
		resp := Response{
			SchemaVersion: SchemaVersion,
			Source:        source,
			FetchedAt:     time.Now().UTC().Format(time.RFC3339),
			Entries:       localizeEntries(entries, shared.LocaleFromWriter(w)),
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		// Short cache: clients respect their own TTL but we let CDNs
		// also amortize a few seconds of repeated polls. Not longer
		// because the menu can change between deploys and clients
		// fetching at the boundary should see the fresh version.
		w.Header().Set("Cache-Control", "public, max-age=10")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// localizeEntries returns a label-localized copy of entries for the given
// locale. For "en" (the default) or any entry with no translation it returns
// the entries unchanged — the input slice is the canonical English menu and is
// never mutated (the shared PersonalMenu var is concurrently read by every
// request). Only the Label field is locale-dependent; all other fields are the
// cross-app contract and stay identical across locales.
func localizeEntries(entries []Entry, locale string) []Entry {
	if locale != "zh" {
		return entries
	}
	out := make([]Entry, len(entries))
	copy(out, entries)
	for i := range out {
		if zh, ok := personalMenuZhLabels[out[i].ID]; ok {
			out[i].Label = zh
		}
	}
	return out
}
