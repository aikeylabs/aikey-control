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
//	  "family_base_urls":  {"anthropic":"https://api.anthropic.com", ...},
//	  "family_login_urls": {"anthropic":"https://claude.ai/login", ...}
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
		"family_base_urls": map[string]string{
			"anthropic":     "https://api.anthropic.com",
			"openai":        "https://api.openai.com/v1",
			"kimi":          "https://api.moonshot.cn/v1",
			"deepseek":      "https://api.deepseek.com/v1",
			"google_gemini": "https://generativelanguage.googleapis.com",
			"groq":          "https://api.groq.com/openai/v1",
			"xai_grok":      "https://api.x.ai/v1",
			"zhipu":         "https://open.bigmodel.cn/api/paas",
			"doubao":        "https://ark.cn-beijing.volces.com/api/v3",
			"qwen":          "https://dashscope.aliyuncs.com/compatible-mode/v1",
			"siliconflow":   "https://api.siliconflow.cn/v1",
			"huggingface":   "https://api-inference.huggingface.co/v1",
			"perplexity":    "https://api.perplexity.ai/v1",
			"openrouter":    "https://openrouter.ai/api/v1",
			"yunwu":         "https://yunwu.ai/v1",
			"zeroeleven":    "https://aicoding.2233.ai",
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
