package shared

import (
	"path/filepath"
	"runtime"
	"testing"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared/sharedtest"
)

// Wire-exit ratchet (2026-08-11).
//
// shared.JSON is where the nil-slice→JSON-null defect class is neutralised
// (see respond_nilslice.go — four shipped incidents). That guarantee is only
// as good as the share of responses that actually leave through it: a handler
// that calls `json.NewEncoder(w).Encode(...)` directly is back to hand-rolled
// wire shape, invisible to the fix and to every future improvement made at
// the exit (locale, error meta stripping, …).
//
// This test RATCHETS the bypass surface: the files below already encode
// directly and are frozen as-is (converting them is separate, deliberate
// work — several are health endpoints with their own status semantics). Any
// NEW file that encodes directly fails here with instructions.
//
// To shrink the list: convert a file to shared.JSON and delete its line.
// To grow it: don't — route the new handler through shared.JSON. If a case
// genuinely cannot (streaming, NDJSON), add it WITH a comment saying why,
// the same way every entry in TILE_EXEMPT / the compliance exception tables
// carries its reason.
var allowedDirectEncoders = map[string]string{
	"appkit/user-local/handler.go":                  "pre-ratchet (2026-08-11 freeze)",
	"appkit/user-local/invite_local_api.go":         "pre-ratchet (2026-08-11 freeze)",
	"appkit/user-local/service_handler.go":          "pre-ratchet (2026-08-11 freeze)",
	"appkit/user-local/system_settings_handlers.go": "pre-ratchet (2026-08-11 freeze)",
	"pkg/crossappmenu/handler.go":                   "pre-ratchet (2026-08-11 freeze)",
	"pkg/shared/localapi.go":                        "pre-ratchet (2026-08-11 freeze)",
	"pkg/shared/respond.go":                        "the choke point itself",
	"pkg/userapi/app/health_handler.go":             "pre-ratchet (2026-08-11 freeze)",
	"pkg/userapi/cli/write.go":                      "pre-ratchet (2026-08-11 freeze)",
	"pkg/userapi/intake/handlers.go":                "pre-ratchet (2026-08-11 freeze)",
	"pkg/userapi/vault/crud.go":                     "pre-ratchet (2026-08-11 freeze)",
	"pkg/userapi/vault/handlers.go":                 "pre-ratchet (2026-08-11 freeze)",
}

func TestNoNewDirectJSONEncoderExits(t *testing.T) {
	// pkg/shared is two levels below the module root.
	_, self, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate the module root")
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(self)))
	sharedtest.CheckWireExitRatchet(t, root, allowedDirectEncoders)
}
