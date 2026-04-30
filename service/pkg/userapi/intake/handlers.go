package intake

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/cli"
	"github.com/AiKeyLabs/aikey-control/service/pkg/userapi/vault"
)

// ParseHandler: POST /api/user/import/parse
// Body: forwarded as the `payload` of cli `_internal parse` envelope.
// No vault unlock required — parse runs on plaintext input only.
func (h *ImportHandlers) ParseHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1 MiB cap (UX v2: >200 KB folds source)
	if err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, err.Error())
		return
	}
	var payload json.RawMessage = body
	if len(body) == 0 {
		payload = json.RawMessage("{}")
	}

	result, err := h.Bridge.Invoke(r.Context(), "parse", "", cli.PlaceholderHex, "", payload)
	if err != nil {
		cli.WriteInvokeError(w, err)
		return
	}
	cli.WriteEnvelope(w, result)
}

// ConfirmHandler: POST /api/user/import/confirm
// Body: forwarded as the `payload` of cli `_internal vault-op` action="batch_import".
// Requires unlocked session (caller wraps with vault.Store.RequireUnlock).
func (h *ImportHandlers) ConfirmHandler(w http.ResponseWriter, r *http.Request) {
	hex, ok := vault.KeyFrom(r.Context())
	if !ok {
		cli.WriteErr(w, cli.ErrVaultLocked, "vault not unlocked")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20)) // 4 MiB cap for batch items
	if err != nil {
		cli.WriteErr(w, cli.ErrBadRequest, err.Error())
		return
	}
	var payload json.RawMessage = body
	if len(body) == 0 {
		payload = json.RawMessage("{}")
	}

	result, err := h.Bridge.Invoke(r.Context(), "vault-op", "batch_import", hex, "", payload)
	if err != nil {
		cli.WriteInvokeError(w, err)
		return
	}
	if result.Status == "ok" && h.VKCache != nil {
		// New aliases have landed — stale VK list invalidated.
		h.VKCache.Invalidate("virtual-keys:me")
	}
	cli.WriteEnvelope(w, result)
}

// RulesHandler: GET /api/user/import/rules
//
// Delegates to `aikey _internal rules` so the YAML stays the single source
// of truth (the cli reads aikey-cli/data/provider_fingerprint.yaml).
//
// Returned JSON shape:
//
//	{
//	  "layer_versions":    {"rules":"...", "crf":"...", "fingerprint":"..."},
//	  "sample_providers":  [...],
//	  "family_login_urls": {"anthropic":"https://claude.ai/login", ...},
//	  "provider_routes":   [
//	    {"host":"api.anthropic.com","protocol":"anthropic","provider":"anthropic",
//	     "base_url":"https://api.anthropic.com","version":"/v1"},
//	    ...
//	  ]
//	}
//
// FALLBACK: if the cli is missing or fails, we serve a hardcoded snapshot so
// the Web UI keeps working with stale-but-valid data. The fallback WILL drift
// if the YAML is updated without redeploying the service binary, but a stale
// fallback is strictly better than a 5xx that breaks the import page entirely.
func (h *ImportHandlers) RulesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if h.Bridge != nil {
		// `_internal rules` doesn't read the vault; PlaceholderHex satisfies
		// the IPC envelope's mandatory 64-char vault_key_hex field.
		result, err := h.Bridge.Invoke(r.Context(), "rules", "", cli.PlaceholderHex, "", struct{}{})
		if err == nil && result != nil && result.Status == "ok" && len(result.Data) > 0 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "ok",
				"data":   json.RawMessage(result.Data),
			})
			return
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"status": "ok",
		"data":   rulesFallback(),
	})
}

// rulesFallback returns the last-known-good snapshot of the rules payload
// for the case where the cli isn't reachable. Keep keys/values in step
// with aikey-cli/data/provider_fingerprint.yaml.
func rulesFallback() map[string]any {
	return map[string]any{
		"layer_versions": map[string]string{
			"rules":       "2.0-full",
			"crf":         "1.0",
			"fingerprint": "1.0",
		},
		"sample_providers": []string{
			"anthropic_api", "openai_project", "openai_admin", "google_gemini",
			"groq", "xai_grok", "github_classic", "github_fine_grained",
			"aws_access_key", "stripe_live", "stripe_restricted", "sendgrid",
			"slack_bot", "slack_user", "huggingface", "perplexity",
			"openrouter", "anthropic_oauth", "generic_jwt", "pem_block",
			"generic_sk", "short_hex_raw", "uuid",
		},
		// v4.3 (2026-05-01): per-host upstream routing table. Single source
		// of truth — replaces former family_base_urls + host_to_base_url +
		// proxy applyBaseURL dedup algorithm. Every row declares one host's
		// full route (protocol + canonical provider_code + base_url root +
		// API version path). Keep in sync with
		// aikey-cli/data/provider_fingerprint.yaml's `provider_routes`.
		"provider_routes": []map[string]string{
			{"host": "api.anthropic.com", "protocol": "anthropic", "provider": "anthropic", "base_url": "https://api.anthropic.com", "version": "/v1"},
			{"host": "api.openai.com", "protocol": "openai_compatible", "provider": "openai", "base_url": "https://api.openai.com", "version": "/v1"},
			{"host": "api.kimi.com", "protocol": "openai_compatible", "provider": "kimi", "base_url": "https://api.kimi.com/coding", "version": "/v1"},
			{"host": "www.kimi.com", "protocol": "openai_compatible", "provider": "kimi", "base_url": "https://api.kimi.com/coding", "version": "/v1"},
			{"host": "api.moonshot.cn", "protocol": "openai_compatible", "provider": "kimi", "base_url": "https://api.moonshot.cn", "version": "/v1"},
			{"host": "platform.moonshot.cn", "protocol": "openai_compatible", "provider": "kimi", "base_url": "https://api.moonshot.cn", "version": "/v1"},
			{"host": "api.deepseek.com", "protocol": "openai_compatible", "provider": "deepseek", "base_url": "https://api.deepseek.com", "version": "/v1"},
			{"host": "api.groq.com", "protocol": "openai_compatible", "provider": "groq", "base_url": "https://api.groq.com/openai", "version": "/v1"},
			{"host": "api.x.ai", "protocol": "openai_compatible", "provider": "xai_grok", "base_url": "https://api.x.ai", "version": "/v1"},
			{"host": "openrouter.ai", "protocol": "openai_compatible", "provider": "openrouter", "base_url": "https://openrouter.ai/api", "version": "/v1"},
			{"host": "api.perplexity.ai", "protocol": "openai_compatible", "provider": "perplexity", "base_url": "https://api.perplexity.ai", "version": ""},
			{"host": "generativelanguage.googleapis.com", "protocol": "gemini", "provider": "google_gemini", "base_url": "https://generativelanguage.googleapis.com", "version": "/v1beta"},
			{"host": "open.bigmodel.cn", "protocol": "openai_compatible", "provider": "zhipu", "base_url": "https://open.bigmodel.cn/api/paas", "version": ""},
			{"host": "ark.cn-beijing.volces.com", "protocol": "openai_compatible", "provider": "doubao", "base_url": "https://ark.cn-beijing.volces.com/api", "version": "/v3"},
			{"host": "dashscope.aliyuncs.com", "protocol": "openai_compatible", "provider": "qwen", "base_url": "https://dashscope.aliyuncs.com/compatible-mode", "version": "/v1"},
			{"host": "api.siliconflow.cn", "protocol": "openai_compatible", "provider": "siliconflow", "base_url": "https://api.siliconflow.cn", "version": "/v1"},
			{"host": "api-inference.huggingface.co", "protocol": "openai_compatible", "provider": "huggingface", "base_url": "https://api-inference.huggingface.co", "version": "/v1"},
			{"host": "yunwu.ai", "protocol": "openai_compatible", "provider": "yunwu", "base_url": "https://yunwu.ai", "version": "/v1"},
			{"host": "aicoding.2233.ai", "protocol": "openai_compatible", "provider": "zeroeleven", "base_url": "https://aicoding.2233.ai", "version": "/v1"},
		},
		"family_login_urls": map[string]string{
			"anthropic":     "https://claude.ai/login",
			"openai":        "https://chatgpt.com",
			"kimi":          "https://www.kimi.com",
			"google_gemini": "https://aistudio.google.com/app/apikey",
			"groq":          "https://console.groq.com/login",
			"deepseek":      "https://platform.deepseek.com/sign_in",
			"xai_grok":      "https://console.x.ai",
			"zhipu":         "https://bigmodel.cn/login",
			"doubao":        "https://console.volcengine.com/ark",
			"qwen":          "https://dashscope.console.aliyun.com/apiKey",
			"siliconflow":   "https://cloud.siliconflow.cn",
			"huggingface":   "https://huggingface.co/login",
			"perplexity":    "https://www.perplexity.ai",
			"openrouter":    "https://openrouter.ai/sign-in",
			"yunwu":         "https://yunwu.ai",
			"zeroeleven":    "https://0011.ai",
		},
	}
}
