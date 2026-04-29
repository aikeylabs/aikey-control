// Package importpkg implements the Go local-server HTTP surface for the
// bulk-import flow. It is a thin orchestration shell: every vault-touching
// operation (parse / verify / batch_import / query) is delegated to the Rust
// aikey CLI via stdin-JSON IPC (see aikey-cli/src/commands_internal). Go
// never reads or writes vault.db and never performs AES-GCM; only Argon2id
// key derivation runs on the Go side because the derived `vault_key_hex`
// must outlive the single unlock HTTP request and be reused by subsequent
// actions within the session.
//
// Package name note: Go keyword `import` cannot be used for a package name,
// hence `importpkg` (documented decision in
// roadmap20260320/技术实现/阶段3-增强版KEY管理/批量导入-实施计划.md §Stage 4).
package importpkg

// I_* error codes surfaced to the Web UI. Mirror the set emitted by the Rust
// cli where applicable (aikey-cli/src/error_codes.rs); additional codes here
// cover Go-side orchestration failures (cli not found / spawn timeout /
// session missing) that have no cli analogue.
const (
	// Protocol + spawn layer
	ErrCliNotFound       = "I_CLI_NOT_FOUND"        // aikey binary missing in PATH and ~/.aikey/bin
	ErrCliSpawnFailed    = "I_CLI_SPAWN_FAILED"     // os/exec returned an error before cli ran
	ErrCliTimeout        = "I_CLI_TIMEOUT"          // ctx deadline reached while waiting for cli stdout
	ErrCliMalformedReply = "I_CLI_MALFORMED_REPLY"  // stdout JSON unparseable or missing required fields

	// Vault session layer
	ErrVaultLocked       = "I_VAULT_LOCKED"         // request targets an unlock-required route while session is absent
	ErrVaultUnlockFailed = "I_VAULT_UNLOCK_FAILED"  // password did not produce a verifying key (wraps cli I_VAULT_KEY_INVALID)
	ErrVaultNoSession    = "I_VAULT_NO_SESSION"     // session id cookie missing or expired

	// Request-level
	ErrBadRequest = "I_BAD_REQUEST" // malformed JSON body or missing required field

	// User Vault CRUD layer (Web page /user/vault — 2026-04-23 decision set)
	ErrOAuthAddViaCLI       = "I_OAUTH_ADD_VIA_CLI"      // POST /vault/entry called with target=oauth (OAuth add flow lives in CLI)
	ErrUnknownTarget        = "I_UNKNOWN_TARGET"         // target is not personal|oauth|team, or team is not yet implemented
	ErrAliasSuffixExhausted = "I_ALIAS_SUFFIX_EXHAUSTED" // auto -2/-3 retry ran 20× and still conflicted (extreme edge case)
	ErrUnlockRateLimited    = "I_UNLOCK_RATE_LIMITED"    // too many unlock attempts from one source; online brute-force defense
	// I_REVEAL_RATE_LIMITED and I_OAUTH_REVEAL_FORBIDDEN removed 2026-04-24
	// along with POST /api/user/vault/reveal. OAuth-never-revealed is now
	// enforced by the absence of any plaintext endpoint rather than a 403
	// branch; see vault_crud.go.
)

// jsonError is the HTTP-side error envelope. Shape intentionally matches the
// cli's ResultEnvelope error branch ({status, error_code, error_message}) so
// the Web UI has one parser for both layers.
type jsonError struct {
	Status       string `json:"status"` // always "error"
	ErrorCode    string `json:"error_code"`
	ErrorMessage string `json:"error_message"`
}
