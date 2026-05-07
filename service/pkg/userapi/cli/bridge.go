package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// stdinEnvelope matches aikey-cli's commands_internal::protocol::StdinEnvelope.
type stdinEnvelope struct {
	VaultKeyHex string          `json:"vault_key_hex"`
	Action      string          `json:"action"`
	RequestID   string          `json:"request_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
}

// Result mirrors ResultEnvelope on the cli side. Exported so handlers in
// vault / intake packages can pattern-match on Status / ErrorCode.
type Result struct {
	RequestID    string          `json:"request_id,omitempty"`
	Status       string          `json:"status"`
	Data         json.RawMessage `json:"data,omitempty"`
	ErrorCode    string          `json:"error_code,omitempty"`
	ErrorMessage string          `json:"error_message,omitempty"`
}

// Bridge spawns `aikey _internal <subcommand>` with a stdin envelope and
// parses the single-line stdout Result. One spawn per call — the cli is
// stateless and re-exec cost is acceptable (measured ~30ms on macOS, per
// Stage 0.3 subprocess latency baseline).
type Bridge struct {
	// BinaryPath is the resolved aikey executable. Empty => look up lazily.
	BinaryPath string
	// Timeout applied to each invocation unless the caller's ctx deadline is sooner.
	Timeout time.Duration
	Logger  *slog.Logger
}

// New builds a bridge with a default 15s timeout. The binary is resolved
// lazily on first call so local-server can boot even if the cli isn't
// installed yet (the page still renders; only the action endpoints fail).
func New(logger *slog.Logger) *Bridge {
	return &Bridge{Timeout: 15 * time.Second, Logger: logger}
}

// Invoke spawns one `aikey _internal <subcommand>` and returns the parsed
// Result. A non-nil error is returned when the envelope's Status is not
// "ok" wrt spawn / parse failure (the caller is expected to surface
// ErrorCode / ErrorMessage to the browser via WriteCliError). Note: a
// well-formed cli error reply (status="error" with codes) returns a Result
// with no error here — caller decides what to do.
//
// subcommand is the top-level `_internal` subcommand name ("parse",
// "vault-op", "query", "update-alias"). action is the sub-action inside
// vault-op (e.g. "verify", "metadata", "batch_import"); for subcommands
// that don't use the action field (parse), pass "".
func (b *Bridge) Invoke(
	ctx context.Context,
	subcommand string,
	action string,
	vaultKeyHex string,
	requestID string,
	payload any,
) (*Result, error) {
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

	var result Result
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

// initEnvelope matches aikey-cli/src/commands_internal/init.rs::InitEnvelope.
// Distinct from stdinEnvelope because the init action precedes vault
// existence — there is no vault_key_hex to derive.
type initEnvelope struct {
	Password  string `json:"password"`
	RequestID string `json:"request_id,omitempty"`
}

// InvokeInit spawns `aikey _internal init --stdin-json` with `{password,
// request_id}` and returns the parsed Result. Used by the web-driven
// first-run flow (POST /api/user/vault/init) per
// 20260430-个人vault-Web首次设置-方案A.md.
//
// Why a separate method rather than reusing Invoke: init.rs reads its own
// envelope shape (no vault_key_hex; vault doesn't exist yet) so the
// standard envelope wrapper would just add fields the cli ignores.
func (b *Bridge) InvokeInit(
	ctx context.Context,
	password string,
	requestID string,
) (*Result, error) {
	if err := b.resolveBinary(); err != nil {
		return nil, &InvokeError{Code: ErrCliNotFound, Msg: err.Error()}
	}

	envJSON, err := json.Marshal(initEnvelope{Password: password, RequestID: requestID})
	if err != nil {
		return nil, &InvokeError{Code: ErrBadRequest, Msg: "marshal init envelope: " + err.Error()}
	}

	callCtx, cancel := context.WithTimeout(ctx, b.Timeout)
	defer cancel()

	cmd := exec.CommandContext(callCtx, b.BinaryPath, "_internal", "init", "--stdin-json")
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
		if b.Logger != nil {
			b.Logger.Warn("cli init spawn failed",
				slog.String("stderr", sanitizeForLog(strings.TrimSpace(stderr.String()))),
				slog.Any("err", err))
		}
		return nil, &InvokeError{
			Code: ErrCliSpawnFailed,
			Msg:  "cli invocation failed (see server logs for details)",
		}
	}

	var result Result
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &result); err != nil {
		if b.Logger != nil {
			b.Logger.Warn("cli init reply unparseable",
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
func (b *Bridge) resolveBinary() error {
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
