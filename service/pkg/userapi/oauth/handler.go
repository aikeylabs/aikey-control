// Package oauth forwards browser OAuth flow requests from the Web Add-Key
// Guided modal (spec §6) to the local aikey-proxy's broker endpoints. The
// browser cannot speak directly to the proxy (CORS + same-origin policy +
// the user has no idea what port the proxy is on), so local-server stands
// in as a same-origin relay.
//
// This package is intentionally thin — every endpoint is a single-shot
// HTTP forward to `127.0.0.1:<proxy_port>/oauth/<action>`. The broker
// (aikey-auth-broker) owns all state (session store, token store,
// provider-specific flow handling) — local-server is just plumbing.
//
// Endpoints exposed (mirror the broker's, prefixed with `/api/user/`):
//   - POST /api/user/oauth/login   — start a session OR submit code
//                                    (Phase-1 / Phase-2 of the broker's
//                                    `POST /oauth/login`)
//   - GET  /api/user/oauth/status  — poll session status (used by Codex
//                                    auth_code flow waiting for the
//                                    localhost callback the broker hosts)
//   - POST /api/user/oauth/poll    — Device-Code poll (Kimi)
//
// Why not also expose logout / accounts / display-identity here: those
// are management actions that already have first-class CLI commands and
// a separate `aikey app` UI surface. The Add-Key Guided modal only needs
// the three above to complete a new login flow.
package oauth

import (
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"time"
)

// defaultProxyPort matches aikey-cli's `commands_proxy::proxy_port`
// fallback (kept in sync intentionally — when CLI changes the default,
// both sides update together). Override with AIKEY_PROXY_PORT for
// non-default deployments.
const defaultProxyPort = "27200"

func proxyBase() string {
	if p := os.Getenv("AIKEY_PROXY_PORT"); p != "" {
		return "http://127.0.0.1:" + p
	}
	return "http://127.0.0.1:" + defaultProxyPort
}

// forwardClient is reused so we don't re-establish a connection for
// every relay call (broker is on localhost; keepalive is cheap).
var forwardClient = &http.Client{
	// Codex / Kimi flows hold an open HTTP request while waiting for
	// the user's browser callback / device-code authorization. 60s is
	// generous: the broker handles waits internally with its own
	// timeout and returns a polling-style response, so each forward
	// call is short.
	Timeout: 60 * time.Second,
}

// LoginHandler relays POST /api/user/oauth/login → POST /oauth/login.
// Phase-1 body: {"provider":"claude|codex|kimi"}; Phase-2 body:
// {"provider":"<x>","session_id":"<id>","code":"<authcode#state>"}.
func LoginHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodPost, proxyBase()+"/oauth/login", true)
}

// StatusHandler relays GET /api/user/oauth/status?session_id=<id>.
// Web polls this while waiting on Codex's localhost callback or Kimi's
// Device-Code authorization to complete.
func StatusHandler(w http.ResponseWriter, r *http.Request) {
	sid := r.URL.Query().Get("session_id")
	if sid == "" {
		http.Error(w, `{"error":{"code":"MISSING_SESSION_ID","message":"session_id query param is required"}}`, http.StatusBadRequest)
		return
	}
	u, err := url.Parse(proxyBase() + "/oauth/status")
	if err != nil {
		http.Error(w, "internal: bad proxy url", http.StatusInternalServerError)
		return
	}
	q := u.Query()
	q.Set("session_id", sid)
	u.RawQuery = q.Encode()
	forward(w, r, http.MethodGet, u.String(), false)
}

// PollHandler relays POST /api/user/oauth/poll → POST /oauth/poll.
// Body: {"session_id":"<id>"}. Used by Kimi's Device-Code flow.
func PollHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodPost, proxyBase()+"/oauth/poll", true)
}

// PoolAuthorizeURLHandler relays POST /api/user/oauth/pool/authorize-url →
// POST /oauth/pool/authorize-url (C10/RW8 per-member POOL login). Unlike the
// personal /oauth/login (vault-backed), the pool flow uses the proxy's
// memory-store broker and writes the exchanged token back to master — the token
// never lands in the local vault. Body: {"provider","credential_id"}.
func PoolAuthorizeURLHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodPost, proxyBase()+"/oauth/pool/authorize-url", true)
}

// PoolSubmitCodeHandler relays POST /api/user/oauth/pool/submit-code →
// POST /oauth/pool/submit-code. Body: {"session_id","code"}. The proxy exchanges
// + writes the per-member token back to master; the response carries no token.
func PoolSubmitCodeHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodPost, proxyBase()+"/oauth/pool/submit-code", true)
}

// forward issues a single HTTP request to the broker and streams the
// response straight back. It preserves status code and a minimal set
// of response headers (Content-Type, Content-Length) — broker error
// envelopes are JSON, so the body passes through unchanged and the
// browser's fetch() sees the broker's structured error directly.
func forward(w http.ResponseWriter, r *http.Request, method, target string, withBody bool) {
	var body io.Reader
	if withBody {
		body = r.Body
	}
	req, err := http.NewRequestWithContext(r.Context(), method, target, body)
	if err != nil {
		http.Error(w, `{"error":{"code":"BAD_GATEWAY","message":"failed to build proxy request"}}`, http.StatusBadGateway)
		return
	}
	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}

	res, err := forwardClient.Do(req)
	if err != nil {
		// Most common cause: proxy not running. The web modal's
		// friendly-error mapping (friendlyTestError) catches the 502
		// and points the user to `aikey service start proxy`.
		slog.Warn("oauth.forward proxy unreachable",
			slog.String("target", target), slog.String("err", err.Error()))
		http.Error(w, `{"error":{"code":"PROXY_UNAVAILABLE","message":"aikey-proxy is not reachable. Run `+"`aikey proxy start`"+`."}}`, http.StatusBadGateway)
		return
	}
	defer res.Body.Close()

	if ct := res.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(res.StatusCode)
	_, _ = io.Copy(w, res.Body)
}
