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
