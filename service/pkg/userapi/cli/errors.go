// Package cli provides the IPC bridge to `aikey _internal *` and the
// shared HTTP error model used by every handler that talks to the cli.
//
// Why a separate package: vault, vault-CRUD, and import all spawn the cli with
// the same envelope shape and report errors with the same I_* code surface.
// Centralising them here keeps the contract single-sourced; each consumer
// imports cli instead of redeclaring envelopes / error codes.
package cli

// I_* error codes surfaced to the Web UI. Mirror the set emitted by the Rust
// cli where applicable (aikey-cli/src/error_codes.rs); additional codes here
// cover Go-side orchestration failures (cli not found / spawn timeout /
// session missing) that have no cli analogue.
const (
	// Protocol + spawn layer
	ErrCliNotFound       = "I_CLI_NOT_FOUND"       // aikey binary missing in PATH and ~/.aikey/bin
	ErrCliSpawnFailed    = "I_CLI_SPAWN_FAILED"    // os/exec returned an error before cli ran
	ErrCliTimeout        = "I_CLI_TIMEOUT"         // ctx deadline reached while waiting for cli stdout
	ErrCliMalformedReply = "I_CLI_MALFORMED_REPLY" // stdout JSON unparseable or missing required fields

	// Vault session layer
	ErrVaultLocked       = "I_VAULT_LOCKED"        // request targets an unlock-required route while session is absent
	ErrVaultUnlockFailed = "I_VAULT_UNLOCK_FAILED" // password did not produce a verifying key (wraps cli I_VAULT_KEY_INVALID)
	ErrVaultNoSession    = "I_VAULT_NO_SESSION"    // session id cookie missing or expired

	// Request-level
	ErrBadRequest = "I_BAD_REQUEST" // malformed JSON body or missing required field

	// User Vault CRUD layer (Web page /user/vault — 2026-04-23 decision set)
	ErrOAuthAddViaCLI       = "I_OAUTH_ADD_VIA_CLI"      // POST /vault/entry called with target=oauth (OAuth add flow lives in CLI)
	ErrUnknownTarget        = "I_UNKNOWN_TARGET"         // target is not personal|oauth|team, or team is not yet implemented
	ErrAliasSuffixExhausted = "I_ALIAS_SUFFIX_EXHAUSTED" // auto -2/-3 retry ran 20× and still conflicted (extreme edge case)
	ErrUnlockRateLimited    = "I_UNLOCK_RATE_LIMITED"    // too many unlock attempts from one source; online brute-force defense
)

// JSONError is the HTTP-side error envelope. Shape intentionally matches the
// cli's ResultEnvelope error branch ({status, error_code, error_message}) so
// the Web UI has one parser for both layers.
type JSONError struct {
	Status       string `json:"status"` // always "error"
	ErrorCode    string `json:"error_code"`
	ErrorMessage string `json:"error_message"`
}

// PlaceholderHex is the 64-char all-zero vault_key_hex used for cli actions
// that perform only format validation (parse, metadata). See
// aikey-cli/src/commands_internal/parse.rs docblock: "only checks format,
// does not verify against vault".
const PlaceholderHex = "0000000000000000000000000000000000000000000000000000000000000000"

// InvokeError carries both an I_* code and a human message so handlers can
// map to the correct HTTP status. Wrapping via fmt.Errorf with %s prefix
// worked for display but hid the code from WriteErr's status table, which
// made every spawn-level failure surface as 500 regardless of its actual
// cause (the bug this type fixes — 2026-04-22 self-review).
type InvokeError struct {
	Code string
	Msg  string
}

func (e *InvokeError) Error() string { return e.Code + ": " + e.Msg }
