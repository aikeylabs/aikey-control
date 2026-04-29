package importpkg

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// sensitiveKeyPattern matches the keys that the cli's internal_log redaction
// already covers, applied here as a defense-in-depth layer for spawn-level
// log lines (cli stderr/stdout that the bridge writes to slog when it can't
// parse a reply or the cli crashes). The bridge has no schema awareness of
// the cli's reply shape; we err on the side of scrubbing too much rather
// than letting a real KEY land in the service log file.
//
// Three regexes catch the common shapes:
//   - structuredQuotedPattern: JSON-style `"<key>":"value"` (cli reply,
//     panic Debug-format on stable Rust)
//   - structuredBarePattern:   `<key>: "value"` or `<key>: value` without
//     quotes around key (Go fmt %v / Rust Debug variants)
//   - assignPattern:           `<key>=<token>` (URL-encoded form data,
//     shell var dumps, env var prints)
//
// On top of structural scrubbing we also strip any string that LOOKS like
// a known secret prefix (sk-, sk-ant-, aikey_team_<vk_id>, aikey_personal_<64-hex>,
// eyJ for JWTs) so a stray raw token in a backtrace's free-form text doesn't escape.
// Spec: roadmap20260320/技术实现/update/20260429-token前缀按角色重命名.md
//
// The keyword list mirrors aikey-cli/src/commands_internal/internal_log.rs::
// looks_sensitive — keep both lists in step.
var (
	sensitiveKeys = []string{
		"password", "master_password",
		"vault_key", "vault_key_hex",
		"secret", "secret_plaintext", "secret_value",
		"plaintext",
		"bearer", "authorization",
		"api_key", "apikey",
		"token", "refresh_token", "access_token",
		"oauth_identity",
		"text", "input", "body", "raw",
	}
	structuredQuotedPattern = regexp.MustCompile(
		`(?i)("(?:` + strings.Join(sensitiveKeys, "|") + `)"\s*:\s*)"[^"\\]*(?:\\.[^"\\]*)*"`,
	)
	structuredBarePattern = regexp.MustCompile(
		`(?i)\b(` + strings.Join(sensitiveKeys, "|") + `)\s*:\s*"[^"]*"`,
	)
	// assignPattern matches `<identifier>=<value>` when the identifier
	// CONTAINS a sensitive keyword (e.g. `AIKEY_VAULT_KEY=...` not just
	// `vault_key=...`). Plain `\b<keyword>\b` would miss shell-style
	// uppercase env-var names because `_` is a word character — so `Y_V`
	// in `AIKEY_VAULT_KEY` is not a `\b` transition.
	assignPattern = regexp.MustCompile(
		`(?i)((?:[A-Za-z_][A-Za-z_0-9]*)?(?:` + strings.Join(sensitiveKeys, "|") + `)(?:[A-Za-z_0-9]*)?)\s*=\s*\S+`,
	)
	// Free-text token shapes that are highly recognisable as real secrets
	// regardless of surrounding context. Stays narrow on purpose — false
	// positives turn diagnostics into nonsense.
	//
	// 2026-04-29 prefix rename: aikey_vk_<...> split into:
	//   - aikey_team_<vk_id>      — server-issued team identifier (output of `aikey route <team>`)
	//   - aikey_personal_<64-hex> — locally-generated random bearer (output of `aikey route <personal>`)
	// Both are user-pasteable into third-party clients → scrub from logs.
	// aikey_active_* / aikey_probe_* are internal-only (env / wrapper preflight)
	// — they don't enter the import stream, so they're not scrubbed here.
	rawSecretPatterns = []*regexp.Regexp{
		regexp.MustCompile(`sk-ant-[A-Za-z0-9_\-]+`),
		regexp.MustCompile(`sk-proj-[A-Za-z0-9_\-]+`),
		regexp.MustCompile(`sk-[A-Za-z0-9_\-]{20,}`),
		regexp.MustCompile(`aikey_team_[A-Za-z0-9_\-]+`),
		regexp.MustCompile(`aikey_personal_[0-9a-f]{64}`),
		regexp.MustCompile(`eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+`), // JWT
	}
)

// sanitizeForLog scrubs likely-sensitive substrings out of a free-form
// string before it lands in slog. Returns the scrubbed copy. Empty input
// returns empty.
//
// Why scrub instead of suppress: stderr is the operator's only window into
// a cli crash. Replacing values with `<redacted>` keeps the structural
// shape (key names, panic location, line numbers) which is what they
// actually need for diagnosis.
func sanitizeForLog(s string) string {
	if s == "" {
		return s
	}
	s = structuredQuotedPattern.ReplaceAllString(s, `$1"<redacted>"`)
	s = structuredBarePattern.ReplaceAllString(s, `$1: "<redacted>"`)
	s = assignPattern.ReplaceAllString(s, "$1=<redacted>")
	for _, re := range rawSecretPatterns {
		s = re.ReplaceAllString(s, "<redacted>")
	}
	return s
}

// aikeyBinaryName returns the installer-owned binary basename for the current
// platform. Windows ships `aikey.exe` (release.sh + local-install.ps1, see
// windows-compatibility.md F3); Unix ships `aikey`. Centralised here so the
// runtime resolver (resolveBinary) and any future caller stay in sync.
func aikeyBinaryName() string {
	if runtime.GOOS == "windows" {
		return "aikey.exe"
	}
	return "aikey"
}

// InvokeError carries both an I_* code and a human message so handlers can
// map to the correct HTTP status. Wrapping via fmt.Errorf with %s prefix
// worked for display but hid the code from writeErr's status table, which
// made every spawn-level failure surface as 500 regardless of its actual
// cause (the bug this type fixes — 2026-04-22 self-review).
type InvokeError struct {
	Code string
	Msg  string
}

func (e *InvokeError) Error() string { return e.Code + ": " + e.Msg }

// CliBridge spawns `aikey _internal <subcommand>` with a stdin envelope and
// parses the single-line stdout ResultEnvelope. One spawn per call — the cli
// is stateless and re-exec cost is acceptable (measured ~30ms on macOS, per
// Stage 0.3 subprocess latency baseline).
type CliBridge struct {
	// BinaryPath is the resolved aikey executable. Empty => look up lazily.
	BinaryPath string
	// Timeout applied to each invocation unless the caller's ctx deadline is sooner.
	Timeout time.Duration
	Logger  *slog.Logger
}

// NewCliBridge builds a bridge with a default 15s timeout. The binary is
// resolved lazily on first call so local-server can boot even if the cli
// isn't installed yet (the page still renders; only the action endpoints fail).
func NewCliBridge(logger *slog.Logger) *CliBridge {
	return &CliBridge{Timeout: 15 * time.Second, Logger: logger}
}

// stdinEnvelope matches aikey-cli's commands_internal::protocol::StdinEnvelope.
type stdinEnvelope struct {
	VaultKeyHex string          `json:"vault_key_hex"`
	Action      string          `json:"action"`
	RequestID   string          `json:"request_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
}

// resultEnvelope matches ResultEnvelope on the cli side.
type resultEnvelope struct {
	RequestID    string          `json:"request_id,omitempty"`
	Status       string          `json:"status"`
	Data         json.RawMessage `json:"data,omitempty"`
	ErrorCode    string          `json:"error_code,omitempty"`
	ErrorMessage string          `json:"error_message,omitempty"`
}

// Invoke spawns one `aikey _internal <subcommand>` and returns the parsed
// ResultEnvelope. A non-nil error is returned when the envelope's Status is
// not "ok", or when spawn / parse fails before the cli produced a valid
// reply; the caller is expected to surface ErrorCode / ErrorMessage to the
// browser via writeCliError.
//
// subcommand is the top-level `_internal` subcommand name ("parse",
// "vault-op", "query", "update-alias"). action is the sub-action inside
// vault-op (e.g. "verify", "metadata", "batch_import"); for subcommands
// that don't use the action field (parse), pass "".
func (b *CliBridge) Invoke(
	ctx context.Context,
	subcommand string,
	action string,
	vaultKeyHex string,
	requestID string,
	payload any,
) (*resultEnvelope, error) {
	if err := b.resolveBinary(); err != nil {
		return nil, &InvokeError{Code: ErrCliNotFound, Msg: err.Error()}
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, &InvokeError{Code: ErrBadRequest, Msg: "marshal payload: " + err.Error()}
	}
	env := stdinEnvelope{
		VaultKeyHex: vaultKeyHex,
		Action:      action,
		RequestID:   requestID,
		Payload:     payloadJSON,
	}
	envJSON, err := json.Marshal(env)
	if err != nil {
		return nil, &InvokeError{Code: ErrBadRequest, Msg: "marshal envelope: " + err.Error()}
	}

	callCtx, cancel := context.WithTimeout(ctx, b.Timeout)
	defer cancel()

	// --stdin-json is the mandatory IPC mode for every _internal subcommand.
	cmd := exec.CommandContext(callCtx, b.BinaryPath, "_internal", subcommand, "--stdin-json")
	cmd.Stdin = bytes.NewReader(envJSON)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if errors.Is(callCtx.Err(), context.DeadlineExceeded) {
			return nil, &InvokeError{
				Code: ErrCliTimeout,
				Msg:  fmt.Sprintf("cli did not respond within %s", b.Timeout),
			}
		}
		// Non-zero exit without a valid envelope on stdout = spawn-level failure.
		// When the cli writes a structured error it exits 0 with status=error on stdout.
		//
		// Security (evaluator review G-2, 2026-04-22 + 2026-04-28 audit):
		// never embed stderr/stdout into the user-facing Msg. stderr may
		// contain panic backtraces with memory addresses / file paths /
		// partial secret byte patterns; stdout may contain the malformed
		// JSON that still mentions vault key material. Even slog gets a
		// sanitized copy now — stderr ran through `sanitizeForLog` —
		// because slog persists to disk and operators do not want real
		// keys living there if the cli ever panics with a Debug-derived
		// secret in scope.
		if b.Logger != nil {
			b.Logger.Warn("cli spawn failed",
				slog.String("subcommand", subcommand),
				slog.String("action", action),
				slog.String("stderr", sanitizeForLog(strings.TrimSpace(stderr.String()))),
				slog.Any("err", err))
		}
		return nil, &InvokeError{
			Code: ErrCliSpawnFailed,
			Msg:  "cli invocation failed (see server logs for details)",
		}
	}

	var result resultEnvelope
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &result); err != nil {
		if b.Logger != nil {
			// Same sanitization rationale as the spawn-failed path: a
			// malformed reply may quote envelope inputs (incl. plaintext
			// secrets) we never want flushed to disk via slog.
			b.Logger.Warn("cli reply unparseable",
				slog.String("subcommand", subcommand),
				slog.String("action", action),
				slog.String("stdout", sanitizeForLog(stdout.String())),
				slog.Any("err", err))
		}
		return nil, &InvokeError{
			Code: ErrCliMalformedReply,
			Msg:  "cli reply was not valid JSON (see server logs for details)",
		}
	}
	return &result, nil
}

// writeInvokeError maps the CliBridge.Invoke error to an HTTP response with
// the correct status code. Uses the InvokeError.Code when available and
// falls back to ErrCliSpawnFailed (500) for anything else.
func writeInvokeError(w http.ResponseWriter, err error) {
	var ierr *InvokeError
	if errors.As(err, &ierr) {
		writeErr(w, ierr.Code, ierr.Msg)
		return
	}
	writeErr(w, ErrCliSpawnFailed, err.Error())
}

// resolveBinary finds aikey once, caching the result.
//
// Security (G-1 P0 review fix, 2026-04-23): the binary path is NOT resolved
// through $PATH. `exec.LookPath("aikey")` previously executed whichever
// binary was first on PATH — a PATH-poisoning attack (hostile $PATH entry,
// compromised shell RC, typosquatting in ~/bin/) would silently route every
// vault-unlocking IPC call (with `vault_key_hex` in stdin!) to an attacker
// binary, disclosing the vault derivation key.
//
// Resolution order:
//
//  1. `b.BinaryPath` if already set (test / caller override)
//  2. `AIKEY_CLI_PATH` env var (developer escape hatch — e.g. point at
//     `target/debug/aikey` while iterating). Non-empty + stat'able regular
//     file required.
//  3. `$HOME/.aikey/bin/aikey` (Unix) or `$HOME/.aikey/bin/aikey.exe`
//     (Windows). Installer-owned canonical path; all three install scripts
//     (local-install.sh / .ps1, trial-install.sh, server-install.sh) deliver
//     the binary here. The `.exe` suffix on Windows is mandatory: release.sh
//     packages the bundle as `aikey.exe` and `local-install.ps1` copies it
//     verbatim — without the suffix `os.Stat` fails on Windows even though
//     the binary is present (windows-compatibility.md F3, vault page 503
//     regression 2026-04-28).
//
// `LookPath` is no longer consulted.
func (b *CliBridge) resolveBinary() error {
	if b.BinaryPath != "" {
		return nil
	}
	if override := strings.TrimSpace(os.Getenv("AIKEY_CLI_PATH")); override != "" {
		if info, err := os.Stat(override); err == nil && !info.IsDir() {
			b.BinaryPath = override
			return nil
		}
		return fmt.Errorf(
			"AIKEY_CLI_PATH %q does not point at a regular file (unset the env var to fall back to ~/.aikey/bin/%s)",
			override,
			aikeyBinaryName(),
		)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("cannot resolve user home dir: %w", err)
	}
	candidate := filepath.Join(home, ".aikey", "bin", aikeyBinaryName())
	info, err := os.Stat(candidate)
	if err != nil {
		return fmt.Errorf(
			"aikey binary not found at %s — re-run the installer (local-install.sh / .ps1, trial-install.sh, server-install.sh)",
			candidate,
		)
	}
	if info.IsDir() {
		return fmt.Errorf("%s is a directory, not a binary — installer corruption; re-run installer", candidate)
	}
	b.BinaryPath = candidate
	return nil
}

// writeCliError writes a 4xx/5xx response mirroring the cli ResultEnvelope
// error branch. It maps a small set of known cli codes to HTTP status and
// falls back to 500 for the rest.
func writeCliError(w http.ResponseWriter, result *resultEnvelope) {
	writeErr(w, result.ErrorCode, result.ErrorMessage)
}

// writeErr writes a JSON error response with a status chosen from the code.
//
// Status-code mapping (kept deliberately narrow so the Web UI and CLI can
// both reason about it):
//
//   - 401 Unauthorized      — missing session cookie; top-level auth problem.
//   - 422 Unprocessable     — vault-specific business errors (wrong master
//                             password, cli says I_VAULT_KEY_INVALID).
//                             NOT 401 because the global httpClient interceptor
//                             treats 401 as "JWT expired" and redirects to
//                             /login, which would be wrong UX for a vault
//                             password typo. Self-review 2026-04-22 caught
//                             this.
//   - 400 Bad Request       — malformed JSON / schema violation.
//   - 503 Service Unavail.  — cli binary missing (production container).
//   - 504 Gateway Timeout   — cli spawn timed out.
//   - 500 Internal          — everything else.
func writeErr(w http.ResponseWriter, code, msg string) {
	status := http.StatusInternalServerError
	switch code {
	case ErrVaultNoSession:
		status = http.StatusUnauthorized
	case ErrVaultLocked, "I_VAULT_KEY_INVALID", ErrVaultUnlockFailed:
		status = http.StatusUnprocessableEntity
	case ErrBadRequest, ErrCliMalformedReply, "I_STDIN_INVALID_JSON", "I_CREDENTIAL_CONFLICT":
		status = http.StatusBadRequest
	case ErrOAuthAddViaCLI:
		// 403: the operation is valid protocol-wise but intentionally denied
		// for this target. The UI should stop trying and switch to the CLI
		// guidance affordance (done-like view for OAuth add). The earlier
		// companion case for I_OAUTH_REVEAL_FORBIDDEN was dropped when the
		// reveal endpoint itself was removed.
		status = http.StatusForbidden
	case ErrUnknownTarget:
		// 400: client sent an unknown target ("team" is valid in the protocol
		// but not implemented yet; other values are malformed). Either way
		// this is client error, not server.
		status = http.StatusBadRequest
	case "I_CREDENTIAL_NOT_FOUND":
		status = http.StatusNotFound
	case ErrAliasSuffixExhausted:
		// 409: we ran out of `-2/-3/...` suffixes (up to 20) which means the
		// user has twenty pre-existing collisions on the same stem — treat
		// as a Conflict rather than a server bug.
		status = http.StatusConflict
	case ErrUnlockRateLimited:
		status = http.StatusTooManyRequests
	case ErrCliNotFound:
		// 503: feature requires local cli; this happens when aikey is not on
		// the host (e.g., in a production control-service container that
		// doesn't ship the cli). The /user/import page still renders; only
		// action endpoints degrade.
		status = http.StatusServiceUnavailable
	case ErrCliTimeout:
		status = http.StatusGatewayTimeout
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(jsonError{Status: "error", ErrorCode: code, ErrorMessage: msg})
}
