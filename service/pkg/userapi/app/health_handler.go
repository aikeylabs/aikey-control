package app

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
)

// defaultProxyPort matches the aikey-cli proxy default and the OAuth
// handler's own constant (intentionally duplicated here so adding the
// Health surface doesn't tie the app package to the oauth package; both
// fall back to the same port and the same AIKEY_PROXY_PORT override).
const defaultProxyPort = "27200"

func proxyBase() string {
	if p := os.Getenv("AIKEY_PROXY_PORT"); p != "" {
		return "http://127.0.0.1:" + p
	}
	return "http://127.0.0.1:" + defaultProxyPort
}

// healthForwardClient is reused across requests — the proxy is on
// localhost, so connection reuse is cheap and avoids socket churn under
// a chatty Web UI (refresh-on-focus, list page mount).
//
// Timeout: 5s. The proxy's AppHealth handler reads from an in-memory map
// behind a RWMutex — no I/O, no upstream call. A 5s ceiling catches the
// pathological "proxy is hung" case without making the Web UI block.
var healthForwardClient = &http.Client{
	Timeout: 5 * time.Second,
}

// HealthHandler relays GET /api/user/apps/health → GET /admin/apps/health
// on the local proxy. The proxy serves an in-memory snapshot of "most
// recent app pipeline call per app_slug"; the Web "Connected Apps" list
// reads it to render the Health column.
//
// Why a thin forwarder vs going through the CLI bridge: the data is
// proxy-process-local (in-memory observability), not vault state. Going
// through cli.Bridge would force the data through a Rust subprocess that
// has no view of the proxy's memory — pointless detour. Following the
// existing oauth/handler.go pattern (browser → local-server → proxy)
// keeps the Web-CORS gateway responsibility in local-server while leaving
// the data-source in the only process that has it.
//
// Edition note: this endpoint is wired only on Personal / Trial (the
// local-server / trial-full editions). Production has the proxy on a
// different machine than the Web UI, so the forwarder would 502; the
// Production read path (when we build it) will go through collector
// events instead. See 2026-05-26 decision.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	target := proxyBase() + "/admin/apps/health"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		http.Error(w,
			`{"error":{"code":"BAD_GATEWAY","message":"failed to build proxy request"}}`,
			http.StatusBadGateway)
		return
	}

	resp, err := healthForwardClient.Do(req)
	if err != nil {
		// PROXY_UNREACHABLE rather than a generic 502 so the Web UI can
		// show "Health temporarily unavailable — is aikey-proxy running?"
		// rather than rendering "undefined" or crashing on a missing
		// `apps` field. Mirrors the oauth handler's broker-down behaviour.
		slog.Warn("user-apps-health forward: proxy unreachable",
			"event.name", "userapi.apps.health_forward_failed",
			"target", target,
			"error", err.Error())
		cli.WriteErr(w, "PROXY_UNREACHABLE", "aikey-proxy is not reachable on 127.0.0.1")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Warn("user-apps-health forward: read body",
			"event.name", "userapi.apps.health_read_failed",
			"error", err.Error())
		cli.WriteErr(w, "BAD_GATEWAY", "failed to read proxy response")
		return
	}

	// Wrap the proxy's raw JSON in the OkEnvelope shape the Web UI
	// expects from every /api/user/apps/* endpoint. The proxy admin
	// endpoint emits `{"apps":[...]}` directly; we wrap to
	// `{"status":"ok","data":{"apps":[...]}}` so callWithErrorExtraction
	// in apps.ts unwraps it identically to list / get / register / etc.
	//
	// json.RawMessage avoids re-parsing + re-marshalling the inner JSON
	// (preserves field ordering, avoids per-row alloc cost). If the proxy
	// returned non-2xx (e.g. its own 503 when the cache isn't wired), we
	// surface it as an ENVELOPE error so the UI sees a consistent shape
	// rather than an HTTP-level surprise.
	if resp.StatusCode != http.StatusOK {
		// Proxy 503 = "app health cache not wired" (e.g. an old proxy
		// build). Treat as a soft failure: empty list, distinguishable
		// error_code, so the UI shows a banner without breaking the list.
		cli.WriteErr(w, "HEALTH_NOT_AVAILABLE", "proxy admin endpoint did not return 200")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	envelope := map[string]any{
		"status": "ok",
		"data":   json.RawMessage(body),
	}
	_ = json.NewEncoder(w).Encode(envelope)
}
