package userlocal

// Invite local-API handler. Spec §6.14.2 — provides the loopback-only,
// CSRF-gated routes the local web UI calls to mint or revoke invite codes:
//
//   GET  /local-api/csrf-token      — page-load token issue (sets cookie,
//                                      returns body so JS can read + echo
//                                      via X-Aikey-Local-CSRF header)
//   POST /local-api/invite/create   — reads installer_id from
//                                      ~/.aikey/identity, forwards to
//                                      main-site POST /invite, returns
//                                      {code, url, created_at}
//   POST /local-api/invite/revoke   — reads installer_id, forwards code
//                                      to main-site POST /invite/revoke,
//                                      returns {status}
//
// Both POST routes go through shared.WrapLocalAPI which enforces:
//   - Origin / Host on the configured allowlist (loopback-scoped)
//   - CORS allow-list (no `*`, scoped to Origin echo)
//   - CSRF cookie + X-Aikey-Local-CSRF header double-submit
//   - per-process rate limit (default: 10 / minute, spec §6.14.2)
//   - audit log to ~/.aikey/logs/local-api.log
//
// installer_id is read fresh from disk on every request: identity is
// per-machine persistent state, so a snapshot at handler-init time
// would silently mis-attribute if a user reset their identity between
// requests (delete-the-file mechanism, §6.14.2).
//
// Why separate from NewHandler (the main user-local handler): cmd/full
// (Trial single-port) does NOT import this user-local package as its
// root handler — it uses fulllib. By exposing the invite local-API as
// its own NewInviteLocalAPI helper, cmd/full can mux it alongside the
// fulllib routes without pulling in the rest of user-local. Closes the
// [appkit-full-missing-user-local] gap.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// InviteLocalAPIConfig wires the local-API to its main-site upstream
// and to the shared middleware layer.
type InviteLocalAPIConfig struct {
	Logger *slog.Logger

	// MainSiteBaseURL is the origin the local API forwards to (e.g.
	// "https://aikeylabs.com" — no trailing slash). The local API
	// constructs `${MainSiteBaseURL}/invite` and `.../invite/revoke`.
	// Required.
	MainSiteBaseURL string

	// LocalAPICfg holds the shared middleware knobs (allowlist, CSRF
	// key, rate limiter, audit log). Required; build with
	// shared.LocalAPIConfig{...} and reuse across edition entries so
	// CSRF tokens minted by GET /local-api/csrf-token verify against
	// the same key in POST /local-api/invite/*.
	LocalAPICfg shared.LocalAPIConfig

	// IdentityPath overrides the on-disk installer_id file location.
	// Empty string = use the spec default (~/.aikey/identity on Unix
	// or %LOCALAPPDATA%\Aikey\identity on Windows). Tests inject a
	// tmpdir path.
	IdentityPath string

	// HTTPClient is used to call main-site. Nil = default with a 10s
	// timeout so the local API can't hang the web UI on a stalled
	// main-site.
	HTTPClient *http.Client
}

// NewInviteLocalAPI returns the http.Handler covering
// /local-api/csrf-token + /local-api/invite/create +
// /local-api/invite/revoke. Mount it under "/local-api/" in the
// edition's root mux.
func NewInviteLocalAPI(cfg InviteLocalAPIConfig) http.Handler {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	mainSiteBase := strings.TrimRight(cfg.MainSiteBaseURL, "/")

	mux := http.NewServeMux()

	// CSRF token issue: unprotected (no double-submit possible until
	// the cookie exists). Same-origin enforced by the browser; this
	// handler doesn't gate on Origin so a freshly-loaded SPA in a new
	// tab can prime its token. Audit-logged separately so abuse
	// (mass token issuance) is still observable.
	mux.HandleFunc("GET /local-api/csrf-token", func(w http.ResponseWriter, r *http.Request) {
		tok, err := shared.IssueCSRFToken(w, cfg.LocalAPICfg)
		if err != nil {
			logger.Error("issue csrf token failed", "error", err)
			http.Error(w, "csrf token issue failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": tok})
	})

	// Invite create + revoke: full middleware stack.
	mux.Handle("POST /local-api/invite/create", shared.WrapLocalAPI(cfg.LocalAPICfg,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			handleLocalAPICreate(w, r, cfg, mainSiteBase, logger)
		})))
	mux.Handle("POST /local-api/invite/revoke", shared.WrapLocalAPI(cfg.LocalAPICfg,
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			handleLocalAPIRevoke(w, r, cfg, mainSiteBase, logger)
		})))

	return mux
}

// localCreateRequest is the JSON shape the page sends. The page CANNOT
// supply installer_id — that's read from local disk for trust.
//
// Optional attribution snapshot fields are accepted from the page only
// because the page often has them in memory already (the user's current
// channel / version etc. from their /accounts/me response). The page is
// the inviter's own SPA; trusting it for self-reported snapshot fields
// is consistent with the "user owns their own machine" trust model.
type localCreateRequest struct {
	CreatorChannel *string `json:"creator_channel,omitempty"`
	CreatorVersion *string `json:"creator_version,omitempty"`
	CreatorLang    *string `json:"creator_lang,omitempty"`
	CreatorEdition *string `json:"creator_edition,omitempty"`
}

// localRevokeRequest is the JSON shape for revoke. The page provides the
// code; installer_id comes from disk so the page can't claim to be a
// different inviter.
type localRevokeRequest struct {
	Code string `json:"code"`
}

// handleLocalAPICreate reads installer_id from disk, calls main-site
// /invite, returns the resulting {code, url, created_at} to the page.
// The page is expected to surface a "save this link" prompt (the spec
// §6.14.2 hard requirement — we won't keep a copy for the user).
func handleLocalAPICreate(
	w http.ResponseWriter,
	r *http.Request,
	cfg InviteLocalAPIConfig,
	mainSiteBase string,
	logger *slog.Logger,
) {
	installerID, err := readInstallerID(cfg.IdentityPath)
	if err != nil {
		logger.Warn("read installer_id for invite create", "error", err)
		writeJSONStatus(w, http.StatusInternalServerError, map[string]string{
			"status":  "identity_missing",
			"message": "installer_id file is unreadable; cannot mint an invite",
		})
		return
	}

	var body localCreateRequest
	if r.ContentLength > 0 {
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil {
			writeJSONStatus(w, http.StatusBadRequest, map[string]string{
				"status":  "bad_request",
				"message": "request body must be JSON",
			})
			return
		}
	}

	upstreamBody, err := json.Marshal(map[string]any{
		"creator_installer_id": installerID,
		"creator_channel":      body.CreatorChannel,
		"creator_version":      body.CreatorVersion,
		"creator_lang":         body.CreatorLang,
		"creator_edition":      body.CreatorEdition,
	})
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]string{
			"status":  "internal_error",
			"message": "could not encode upstream request",
		})
		return
	}

	resp, err := forwardToMainSite(r.Context(), cfg.HTTPClient, http.MethodPost, mainSiteBase+"/invite", upstreamBody)
	if err != nil {
		logger.Warn("forward to main-site /invite failed", "error", err)
		writeJSONStatus(w, http.StatusBadGateway, map[string]string{
			"status":  "upstream_unreachable",
			"message": "main-site is not reachable; check network connectivity",
		})
		return
	}
	defer resp.Body.Close()
	relayUpstreamResponse(w, resp)
}

// handleLocalAPIRevoke mirrors create: read installer_id from disk,
// pass through to main-site POST /invite/revoke. The page can't supply
// installer_id, so a malicious page cannot revoke someone else's code.
func handleLocalAPIRevoke(
	w http.ResponseWriter,
	r *http.Request,
	cfg InviteLocalAPIConfig,
	mainSiteBase string,
	logger *slog.Logger,
) {
	installerID, err := readInstallerID(cfg.IdentityPath)
	if err != nil {
		logger.Warn("read installer_id for invite revoke", "error", err)
		writeJSONStatus(w, http.StatusInternalServerError, map[string]string{
			"status":  "identity_missing",
			"message": "installer_id file is unreadable; cannot revoke",
		})
		return
	}

	var body localRevokeRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{
			"status":  "bad_request",
			"message": "request body must be JSON",
		})
		return
	}
	code := strings.TrimSpace(body.Code)
	if code == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{
			"status":  "bad_request",
			"message": "code is required",
		})
		return
	}

	upstreamBody, err := json.Marshal(map[string]any{
		"installer_id": installerID,
		"code":         code,
	})
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]string{
			"status":  "internal_error",
			"message": "could not encode upstream request",
		})
		return
	}

	resp, err := forwardToMainSite(r.Context(), cfg.HTTPClient, http.MethodPost, mainSiteBase+"/invite/revoke", upstreamBody)
	if err != nil {
		logger.Warn("forward to main-site /invite/revoke failed", "error", err, "code", code)
		writeJSONStatus(w, http.StatusBadGateway, map[string]string{
			"status":  "upstream_unreachable",
			"message": "main-site is not reachable; check network connectivity",
		})
		return
	}
	defer resp.Body.Close()
	relayUpstreamResponse(w, resp)
}

// forwardToMainSite is the thin HTTP forwarder. Sets Content-Type;
// caller-supplied body is already JSON-encoded. Honours request context
// so an aborted browser fetch cancels the upstream call rather than
// holding a goroutine until the 10s client timeout.
func forwardToMainSite(ctx context.Context, client *http.Client, method, url string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build upstream request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	return client.Do(req)
}

// relayUpstreamResponse mirrors main-site's status code + JSON body to
// the page. Status codes are pass-through (400 for malformed input, 403
// for cross-creator revoke, 404 for unknown code, 500 for server error,
// 200 on success). This keeps the page's error-handling logic identical
// to the wire shape main-site already documents.
func relayUpstreamResponse(w http.ResponseWriter, resp *http.Response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 16<<10))
}

// writeJSONStatus is a tiny JSON envelope helper for local-side
// (not upstream-relayed) error paths. Distinguished from main-site
// errors by having a vocabulary ("identity_missing",
// "upstream_unreachable") that main-site never emits.
func writeJSONStatus(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// readInstallerID reads the per-machine installer_id from the canonical
// identity file. Path resolution mirrors workflow/CD/installer/lib/
// telemetry.sh + lib/telemetry.ps1:
//   - Unix:    $HOME/.aikey/identity
//   - Windows: %LOCALAPPDATA%\Aikey\identity (set via $env:LOCALAPPDATA)
//
// The IdentityPath override is for tests only. We read fresh every call
// so a user deleting / regenerating the identity file (the
// installer_id reset mechanism, §6.14.2) takes effect on the next
// request without restarting the local-server.
func readInstallerID(overridePath string) (string, error) {
	path := overridePath
	if path == "" {
		path = defaultIdentityPath()
	}
	if path == "" {
		return "", errors.New("could not resolve identity file path (HOME unset?)")
	}
	buf, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read identity file %s: %w", path, err)
	}
	id := strings.TrimSpace(string(buf))
	if id == "" {
		return "", fmt.Errorf("identity file %s is empty", path)
	}
	return id, nil
}

// defaultIdentityPath returns the spec-canonical identity path for the
// current OS. Splitting it into a function so tests + Windows-specific
// behaviour can be tweaked in one place without spreading os.Getenv
// across the package.
func defaultIdentityPath() string {
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		// Windows path is set even on non-Windows OS only by tests that
		// explicitly export it; that's an intentional override channel
		// — production never has LOCALAPPDATA outside Windows.
		return filepath.Join(local, "Aikey", "identity")
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".aikey", "identity")
}
