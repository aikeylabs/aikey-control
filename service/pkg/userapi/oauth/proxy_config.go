package oauth

// proxy_config.go — same-origin relays for the egress (upstream) proxy config the
// local web "Settings → Upstream proxy" card drives. After R25 出口收敛 the egress
// proxy lives on the PROXY NODE (cfg.UpstreamProxy.URL), so these forward to the
// proxy's /admin/upstream-proxy endpoint (which validates, persists to
// aikey-user.yaml, and hot-swaps the live transport + impersonate client). The
// browser can't reach aikey-proxy:27200 directly (CORS / different origin); the
// local-server stands in as the relay, exactly like the OAuth broker forwards above.

import "net/http"

// UpstreamProxyGetHandler relays GET /api/user/system/upstream-proxy →
// GET /admin/upstream-proxy. Response: {"url": "..."} ("" = direct / no proxy).
func UpstreamProxyGetHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodGet, proxyBase()+"/admin/upstream-proxy", false)
}

// UpstreamProxySetHandler relays PUT /api/user/system/upstream-proxy →
// PUT /admin/upstream-proxy. Body {"url"}; the proxy validates + persists + hot-swaps.
func UpstreamProxySetHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodPut, proxyBase()+"/admin/upstream-proxy", true)
}

// UpstreamProxyProbeHandler relays POST /api/user/system/upstream-proxy/probe →
// POST /admin/upstream-proxy/probe. Body {"url"}; the proxy tests the candidate URL
// end-to-end to a provider WITHOUT saving it (test-before-save).
func UpstreamProxyProbeHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodPost, proxyBase()+"/admin/upstream-proxy/probe", true)
}

// MappingDiagnosticsHandler relays GET /api/user/diagnostics/mapping →
// GET /v1/diagnostics/pipeline (task 7.9). Read-only; backs the model-mapping
// visibility banner (3.5, four surfaces). The browser can't reach aikey-proxy
// directly (CORS / different origin), so the local-server relays — same pattern
// as the upstream-proxy config forwards. Response: {registry, model_mapping}.
func MappingDiagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodGet, proxyBase()+"/v1/diagnostics/pipeline", false)
}

// EgressSelfCheckHandler relays GET /api/user/system/egress-selfcheck →
// GET /admin/egress/selfcheck (presence mode — NO ?dial, so no network probe).
// Response: {"dialed":false,"paths":[{"label":"<account identity>"}]} — which pool
// accounts have an ADMIN-configured per-account egress proxy. The Settings →
// Upstream proxy card renders this as the ② layer row, so the user can see that
// pool-account traffic may leave through an account egress rather than this node's
// layers. Presence-only by design: the spec may embed credentials (never echoed to
// the browser) and the exit IP needs a real dial (that's `aikey doctor`).
func EgressSelfCheckHandler(w http.ResponseWriter, r *http.Request) {
	forward(w, r, http.MethodGet, proxyBase()+"/admin/egress/selfcheck", false)
}
