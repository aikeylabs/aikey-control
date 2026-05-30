package cli

// Phase E-2: locale-aware error_message for the web-reachable I_* surface.
//
// WHY: The user-local mux is wrapped by shared.LocaleMiddleware (Phase E), so
// every web request that reaches WriteErr carries a negotiated locale on the
// ResponseWriter (shared.LocaleFromWriter(w)). When the browser sends
// Accept-Language: zh we want the visible error_message in zh; the response
// SHAPE ({status, error_code, error_message}) is unchanged — only the text
// localizes, so the Web UI's single parser keeps working unchanged.
//
// SCOPE (what stays English):
//   - CLI HTTP callers / curl send no Accept-Language → locale "en" → passthrough.
//   - The subprocess IPC path (`aikey _internal *` stdout envelope) does NOT go
//     through this HTTP WriteErr; its writer is untouched and stays en. The
//     error_code is the machine-stable contract across both layers; only the
//     human-facing message differs by locale.
//   - Any code without a zh template (e.g. a future or test-only code) falls
//     back to the passed English msg unchanged.
//
// The messages are concise factual zh templates keyed by the stable I_* code.
// These are static state errors; when the English msg carries dynamic detail
// the generic zh template is an acceptable trade (web users get a clear,
// localized state; full detail remains in logs and the error_code).
var zhWriteErrMessages = map[string]string{
	// Protocol + spawn layer
	ErrCliNotFound:       "未找到 aikey 命令行程序",
	ErrCliSpawnFailed:    "启动命令行程序失败",
	ErrCliTimeout:        "命令行程序响应超时",
	ErrCliMalformedReply: "命令行程序返回了无法解析的结果",

	// Vault session layer
	ErrVaultLocked:       "保管库已锁定",
	ErrVaultUnlockFailed: "解锁失败：主密码错误",
	ErrVaultNoSession:    "会话已失效，请重新登录",

	// Request-level
	ErrBadRequest: "请求无效",

	// User Vault CRUD layer
	ErrOAuthAddViaCLI:       "OAuth 授权请在命令行中完成",
	ErrUnknownTarget:        "请求的目标类型不受支持",
	ErrAliasSuffixExhausted: "别名后缀已用尽，请更换名称",
	ErrUnlockRateLimited:    "解锁尝试过于频繁，请稍后再试",

	// App mutation policy layer
	ErrAppMutationDenied: "该操作已被策略禁止",

	// Vault-state codes emitted by the Rust cli (string literals, no Go const)
	"I_VAULT_KEY_INVALID":         "主密码错误",
	"I_VAULT_KEY_MALFORMED":       "保管库密钥格式无效",
	"I_VAULT_NOT_INITIALIZED":     "保管库尚未初始化",
	"I_VAULT_ALREADY_INITIALIZED": "保管库已初始化",
	"I_STDIN_INVALID_JSON":        "请求数据格式无效",

	// Credential / team-key business-state codes
	"I_CREDENTIAL_CONFLICT":  "凭据已存在，发生冲突",
	"I_CREDENTIAL_NOT_FOUND": "未找到对应凭据",
	"I_KEY_DISABLED":         "该密钥已被禁用",
	"I_KEY_NOT_DELIVERED":    "该密钥尚未下发",
	"I_KEY_STALE":            "密钥缓存已过期，请重新同步",
	"I_KEY_NO_PROVIDER":      "该密钥未分配服务提供方",

	// Dependency / internal
	"I_PROXY_NOT_RUNNING": "代理未运行",
	"I_INTERNAL":          "发生内部错误",
}

// localizeWriteErrMessage returns the zh template for code when locale=="zh"
// and a template exists; otherwise it returns the passed English msg unchanged.
// Keeping this as a small pure function makes the locale branch trivially
// testable without spinning up an HTTP writer.
func localizeWriteErrMessage(locale, code, msg string) string {
	if locale == "zh" {
		if zh, ok := zhWriteErrMessages[code]; ok {
			return zh
		}
	}
	return msg
}
