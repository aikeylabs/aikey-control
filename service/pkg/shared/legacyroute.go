package shared

import (
	"log/slog"
	"net/http"
)

// HandleWithLegacyPath registers h at its canonical pattern AND at a legacy
// pattern kept alive for one release.
//
// # Why both, instead of just renaming
//
// A renamed API path is invisible to clients that already shipped:
//
//   - an offline package pins a web bundle compiled against the OLD path;
//   - a member's local node can be older than the team server it talks to, and
//     the cross-app contract lets those versions differ by design;
//   - anything an admin scripted against the documented path keeps calling it.
//
// Serving only the new path turns every one of those into a 404 at the exact
// moment of upgrade — the one moment a user is least able to tell a rename from
// an outage.
//
// # Why the legacy hit is WARNed rather than served silently
//
// "Keep the old path for one release" becomes "keep it forever" unless the next
// release can prove nobody calls it. The WARN is that proof: grep the deprecation
// event, see zero hits across a release window, then delete the alias. A silent
// alias has no such exit.
//
// # Constraint
//
// canonical and legacy MUST declare the same wildcard NAMES ({orgID}, {seatID}, …).
// Handlers read them via r.PathValue, which resolves against whichever pattern
// matched — rename a wildcard in only one of the two and the handler silently
// reads "" on the legacy path.
func HandleWithLegacyPath(mux *http.ServeMux, canonical, legacy string, h http.Handler) {
	mux.Handle(canonical, h)
	mux.Handle(legacy, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.WarnContext(r.Context(), "legacy API path used; it is scheduled for removal",
			slog.String("event.name", EventControlLegacyAPIPathUsed),
			slog.String("legacy_pattern", legacy),
			slog.String("canonical_pattern", canonical),
			slog.String("path", r.URL.Path))
		h.ServeHTTP(w, r)
	}))
}
