package crossappmenu

import (
	"encoding/json"
	"net/http"
	"time"
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
		resp := Response{
			SchemaVersion: SchemaVersion,
			Source:        source,
			FetchedAt:     time.Now().UTC().Format(time.RFC3339),
			Entries:       entries,
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
