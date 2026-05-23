// Package userlocal — service control endpoint.
//
// POST /api/internal/services/{name}/{action}
//
// Web-side counterpart to `aikey service start <name>`. The trust-check
// page's offline banner posts to this endpoint when the user clicks
// "Start service" — local-server then shells out to aikey CLI to
// actually run launchctl / systemctl.
//
// Whitelist is intentionally NARROWER than the CLI:
//   - `trust-local` — fully supported (no password, no self-restart issue)
//   - `web`         — REFUSED (would kill our own process mid-response)
//   - `proxy`       — REFUSED (requires vault master password; web has
//                     no path to prompt for it)
//
// Why a narrower set than the CLI: web is an unattended trigger (no
// TTY, no password prompt). The CLI accepts all three because the user
// is interactive. Forcing the same whitelist would mislead callers
// into thinking proxy/web start works from the page.
//
// See SPEC: workflow/CI/requirements/2026-05-21-plugin-owns-domain-logic-web-stays-generic.md
// (the orchestration sits in the plugin / CLI, web just routes user
// intent through to it).
package userlocal

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Tiny wrappers so the call-sites in HandleServiceAction read clean
// without dragging stdlib names through. Pure indirection — no other
// caller is the wiser.
func osGetenv(k string) string                                            { return os.Getenv(k) }
func contextWithTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, d)
}

// Allowed (service, action) pairs. Anything else returns 400.
// Mirrored against aikey-cli/src/commands_service/commands.rs whitelist
// — if those drift the trust-check Start button surfaces a clear
// error rather than silently invoking a foot-gun.
var allowedServiceActions = map[string]map[string]bool{
	"trust-local": {
		"start":   true,
		"stop":    true,
		"restart": true,
	},
	// web + proxy are deliberately NOT in this map; see header doc.
}

// aikeyBinaryPath returns the path to the aikey CLI binary. We don't
// rely on $PATH because aikey-local-server may be launched by launchd
// with a sparse PATH (no /usr/local/bin etc.). The CLI installer
// always lands the binary at ~/.aikey/bin/aikey, so we anchor there.
//
// Operators with a non-standard install can override via env
// AIKEY_BIN_PATH (kept undocumented for now — hard requirement only
// if the default path is unworkable on their machine).
func aikeyBinaryPath() string {
	if v := envOrDefault("AIKEY_BIN_PATH", ""); v != "" {
		return v
	}
	home := envOrDefault("HOME", "")
	return filepath.Join(home, ".aikey", "bin", "aikey")
}

func envOrDefault(k, def string) string {
	if v := getenv(k); v != "" {
		return v
	}
	return def
}

// indirection so the import surface is clear; not a stub for testing.
func getenv(k string) string { return strings.TrimSpace(osGetenv(k)) }

// HandleServiceAction routes POST /api/internal/services/{name}/{action}.
//
// Path placeholders are populated by Go 1.22+ mux pattern matching;
// we read them via r.PathValue so the SPA catch-all (registered
// elsewhere) can't shadow this route.
//
// Returns 200 with `{ok, action, service, detail}` on success, 4xx on
// rejection (unknown service, invalid action, malformed path).
func HandleServiceAction(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		action := r.PathValue("action")
		if name == "" || action == "" {
			writeJSONErr(w, http.StatusBadRequest, "INVALID_PATH",
				"expected /api/internal/services/<name>/<action>")
			return
		}

		actions, nameKnown := allowedServiceActions[name]
		if !nameKnown {
			writeJSONErr(w, http.StatusBadRequest, "SERVICE_NOT_WEB_CONTROLLABLE",
				"service '"+name+"' is not exposed via the web endpoint. "+
					"trust-local is the only web-controllable service today. "+
					"Use the aikey CLI (aikey service "+action+" "+name+") instead.")
			return
		}
		if !actions[action] {
			writeJSONErr(w, http.StatusBadRequest, "INVALID_ACTION",
				"action '"+action+"' not supported for "+name+
					". Allowed: start, stop, restart.")
			return
		}

		// Shell out to `aikey service <action> <name> --json`. The CLI
		// owns the launchctl / systemctl invocation + healthz probe,
		// so we don't re-implement that here — just translate the
		// JSON envelope into our HTTP response.
		binPath := aikeyBinaryPath()
		ctx, cancel := contextWithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, binPath, "service", action, name, "--json")
		out, err := cmd.CombinedOutput()
		// Even on non-zero exit the CLI emits the JSON envelope on
		// stdout — we still try to parse it before falling back to
		// the raw spawn error.
		var parsed map[string]any
		if jsonErr := json.Unmarshal(out, &parsed); jsonErr == nil && parsed != nil {
			w.Header().Set("Content-Type", "application/json")
			// Pass through the CLI's `ok` field as the HTTP status:
			// success → 200, anything else → 502 (bad gateway —
			// our upstream is the local CLI process).
			statusCode := http.StatusOK
			if ok, _ := parsed["ok"].(bool); !ok {
				statusCode = http.StatusBadGateway
			}
			w.WriteHeader(statusCode)
			_ = json.NewEncoder(w).Encode(parsed)
			return
		}
		if err != nil {
			logger.Warn("service control spawn failed",
				"event.name", "service.spawn_failed",
				"name", name, "action", action,
				"binary", binPath,
				"error.message", err.Error(),
				"raw_output", string(out),
			)
			writeJSONErr(w, http.StatusBadGateway, "CLI_SPAWN_FAILED",
				"aikey CLI invocation failed: "+err.Error())
			return
		}
		// Spawn succeeded but no JSON envelope — also abnormal.
		writeJSONErr(w, http.StatusBadGateway, "CLI_BAD_OUTPUT",
			"aikey CLI returned non-JSON output: "+string(out))
	}
}

func writeJSONErr(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     false,
		"error":  code,
		"detail": detail,
	})
}
