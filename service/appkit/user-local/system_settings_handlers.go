// system_settings_handlers.go — handlers for the Personal Web Console's
// Settings page (2026-06-01 / Phase 4G).
//
// All three endpoints are same-origin-only mutations on local CLI state
// (vault rows, config.json, proxy.yaml). They sit alongside the existing
// `GET /system/team-url` discovery endpoint:
//
//   POST /system/logout          — clear vault platform_account session
//   POST /system/team-url        — change the team-server control URL
//   POST /system/team-url/probe  — GET <new-url>/health to verify reachability
//                                  BEFORE the user commits the change
//
// SECURITY: no CORS headers on any of these. They mutate state the
// Personal user's CLI owns. The Personal Web Console SPA is the only
// legitimate caller and runs same-origin (http://localhost:8090). This
// matches the same-origin gate the existing vault / hook / system/team-jwt
// endpoints already use — see the 2026-04-24 vault-leak protection rule
// in pkg/shared/middleware.go.

package userlocal

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// handleLogout serves POST /system/logout. Invokes the injected
// LogoutCmd which under the hood subprocesses to `aikey logout --json`
// (clears vault platform_account, disables team keys, wipes ghost
// bindings — same behaviour as the user typing `aikey logout` in their
// terminal). After this returns ok, the SPA navigates to /user/login.
//
// 200 {"ok":true}                       — logout succeeded
// 500 {"error":"<msg>"}                 — logout failed (CLI invocation error)
// 405 {"error":"method not allowed"}    — wrong verb
func handleLogout(invoke func(ctx context.Context) error, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if err := invoke(ctx); err != nil {
			if logger != nil {
				logger.Warn("system.logout cli invocation failed", slog.Any("err", err))
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error": "logout failed; see server logs for details",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// handleSetTeamURL serves POST /system/team-url. Body shape:
//
//	{"url": "http://192.168.0.111:3000"}
//
// Invokes the injected SetControlURLCmd which subprocesses to
// `aikey account set-url <url> --json`. The CLI updates three places
// atomically — vault platform_account.control_url, config.json default
// URL, and aikey-proxy.yaml events.collector_routes.team. The proxy
// picks up the new collector URL on its next 5-second sync loop; no
// proxy restart is required.
//
// 200 {"ok":true}                       — saved
// 400 {"error":"invalid url"}           — URL parse failed
// 500 {"error":"<msg>"}                 — CLI invocation error
// 405 {"error":"method not allowed"}    — wrong verb
//
// NOT covered here: connectivity check. The SPA is expected to call
// /system/team-url/probe BEFORE this endpoint and only POST here when
// the probe succeeds. The probe / save split lets the user retry the
// probe without committing a bad URL, and keeps this endpoint a pure
// state mutation (cheap to test, predictable side effects).
func handleSetTeamURL(invoke func(ctx context.Context, url string) error, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 8*1024))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "read body"})
			return
		}
		var body struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
			return
		}
		clean := strings.TrimSpace(body.URL)
		clean = strings.TrimRight(clean, "/")
		if clean == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "url required"})
			return
		}
		// Validate URL shape early — refuse anything that can't parse so
		// the CLI never sees a malformed string and the user gets a
		// useful error in the SPA form rather than a generic CLI failure.
		parsed, err := url.Parse(clean)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid url (expected http://host:port or https://host)"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if err := invoke(ctx, clean); err != nil {
			if logger != nil {
				logger.Warn("system.set-team-url cli invocation failed", slog.Any("err", err))
			}
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error": "set control url failed; see server logs for details",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "url": clean})
	}
}

// handleProbeTeamURL serves POST /system/team-url/probe. Body shape:
//
//	{"url": "http://192.168.0.111:3000"}
//
// GETs <url>/health with a short timeout. Response shape:
//
//	200 {"reachable": true,  "status": 200, "elapsed_ms": 47}
//	200 {"reachable": false, "error": "connection refused"}
//	400 {"error": "invalid url"}
//
// Always returns 200 for reachable=false (the URL is invalid for the
// USER's intent, not for the SPA contract). Only returns 4xx/5xx when
// the SPA's request itself is malformed. This keeps the SPA's "Test
// connectivity" button binary: green check on reachable, red X on not
// — no third "your request was malformed" state to render.
//
// Why a server-side probe instead of letting the SPA fetch it directly:
// the SPA at http://localhost:8090 can't cross-fetch arbitrary HTTP
// origins (CORS), so it can't verify reachability of an arbitrary
// http://192.168.x.y:3000 URL the user types. The local-server has no
// such restriction.
func handleProbeTeamURL(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, 8*1024))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "read body"})
			return
		}
		var body struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
			return
		}
		clean := strings.TrimSpace(body.URL)
		clean = strings.TrimRight(clean, "/")
		if clean == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "url required"})
			return
		}
		parsed, err := url.Parse(clean)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid url (expected http://host:port or https://host)"})
			return
		}

		// Short timeout — the user is staring at the SPA waiting for
		// the dot to flip green or red. >5s and they think the page hung.
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		healthURL := clean + "/health"
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
		req.Header.Set("Accept", "application/json,text/plain,*/*")

		// Dedicated http.Client per request — no connection pooling
		// across probes since each user-typed URL is potentially a
		// different host with different TLS state.
		client := &http.Client{Timeout: 5 * time.Second}
		start := time.Now()
		resp, err := client.Do(req)
		elapsedMs := time.Since(start).Milliseconds()
		if err != nil {
			msg := classifyProbeError(err)
			if logger != nil {
				logger.Debug("system.probe-url failed",
					slog.String("url", healthURL),
					slog.String("classified", msg),
					slog.Any("err", err))
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"reachable":  false,
				"error":      msg,
				"elapsed_ms": elapsedMs,
			})
			return
		}
		defer resp.Body.Close()

		// 2xx = healthy. Anything else (4xx, 5xx) = the URL responds but
		// /health is not what we want. Still report reachable=false so
		// the user fixes the URL before saving (otherwise the SPA's
		// later auth calls would also fail in the same way).
		reachable := resp.StatusCode >= 200 && resp.StatusCode < 300
		writeJSON(w, http.StatusOK, map[string]any{
			"reachable":  reachable,
			"status":     resp.StatusCode,
			"elapsed_ms": elapsedMs,
		})
	}
}

// classifyProbeError turns a low-level transport error into a short,
// user-facing string for the SPA's red X tooltip. Keeps the SPA from
// having to parse Go-style "Get http://...: dial tcp ...: connect:
// connection refused" strings.
func classifyProbeError(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timed out (no response within 5 seconds)"
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "connection refused"):
		return "connection refused (no server listening on that port)"
	case strings.Contains(s, "no such host"):
		return "host not found (DNS lookup failed)"
	case strings.Contains(s, "network is unreachable"):
		return "network unreachable"
	case strings.Contains(s, "tls"):
		return "TLS handshake failed (certificate / scheme mismatch?)"
	case strings.Contains(s, "i/o timeout"):
		return "timed out (no response within 5 seconds)"
	default:
		// Generic fallback — surface just enough so a tech user can
		// guess, but strip the verbose Go error envelope.
		return "request failed"
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
