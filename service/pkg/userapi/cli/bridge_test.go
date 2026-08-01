package cli

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// TestResolveBinary_PicksPlatformSpecificName plants a regular file under
// $HOME/.aikey/bin/<aikeyBinaryName()> in a tmp HOME and asserts resolveBinary
// finds it via the canonical fallback (no AIKEY_CLI_PATH override). Also asserts
// that the bare-stem name (without .exe on Windows) is NOT picked, which was
// the original bug.
func TestResolveBinary_PicksPlatformSpecificName(t *testing.T) {
	tmpHome := t.TempDir()
	if err := os.Mkdir(filepath.Join(tmpHome, ".aikey"), 0o755); err != nil {
		t.Fatalf("mkdir .aikey: %v", err)
	}
	binDir := filepath.Join(tmpHome, ".aikey", "bin")
	if err := os.Mkdir(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}
	canonical := filepath.Join(binDir, aikeyBinaryName())
	if err := os.WriteFile(canonical, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write canonical binary: %v", err)
	}

	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)
	t.Setenv("AIKEY_CLI_PATH", "")

	b := &Bridge{}
	if err := b.resolveBinary(); err != nil {
		t.Fatalf("resolveBinary() under tmp HOME failed: %v", err)
	}
	if b.BinaryPath != canonical {
		t.Fatalf("resolved BinaryPath = %q; want %q", b.BinaryPath, canonical)
	}
}

// TestResolveBinary_WindowsRejectsBareStem ensures that on Windows a bare
// `aikey` (no .exe) sitting in the canonical bin dir is NOT picked up — the
// resolver must require the platform-specific name. Skipped on non-Windows
// because the bare name IS the canonical name there.
func TestResolveBinary_WindowsRejectsBareStem(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-specific guard")
	}
	tmpHome := t.TempDir()
	binDir := filepath.Join(tmpHome, ".aikey", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}
	bareStem := filepath.Join(binDir, "aikey")
	if err := os.WriteFile(bareStem, []byte("placeholder"), 0o755); err != nil {
		t.Fatalf("write bare stem: %v", err)
	}

	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)
	t.Setenv("AIKEY_CLI_PATH", "")

	b := &Bridge{}
	err := b.resolveBinary()
	if err == nil {
		t.Fatalf("resolveBinary() found bare stem on Windows; want I_CLI_NOT_FOUND-style error")
	}
	if !strings.Contains(err.Error(), "aikey.exe") {
		t.Fatalf("error message does not mention aikey.exe: %v", err)
	}
}

// TestResolveBinary_OverrideStillWorks asserts the AIKEY_CLI_PATH escape hatch
// remains a regular-file passthrough independent of platform suffix logic.
func TestResolveBinary_OverrideStillWorks(t *testing.T) {
	tmpHome := t.TempDir()
	override := filepath.Join(tmpHome, "anywhere-aikey")
	if err := os.WriteFile(override, []byte("ok"), 0o755); err != nil {
		t.Fatalf("write override binary: %v", err)
	}
	t.Setenv("AIKEY_CLI_PATH", override)

	b := &Bridge{}
	if err := b.resolveBinary(); err != nil {
		t.Fatalf("resolveBinary() with override: %v", err)
	}
	if b.BinaryPath != override {
		t.Fatalf("override path not honored: got %q want %q", b.BinaryPath, override)
	}
}

// TestInvoke_LogsStderrOnSuccessfulCall is the fence for the 2026-08-01
// bugfix: a cli call that SUCCEEDS while degrading (here: the vault list
// skipping an entry it could not decrypt) used to leave zero evidence,
// because stderr was only logged on the spawn-failed / unparseable-reply
// branches. Symptom in production: /user/vault rendered fewer keys after
// unlocking than before, and aikey-local-server.err.log was 0 bytes.
//
// Regression doc: workflow/CI/bugfix/2026-08-01-vault-unlocked-list-drops-undecryptable-entries.md
func TestInvoke_LogsStderrOnSuccessfulCall(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub cli is a /bin/sh script; the Windows spawn path is covered by the shared logDegradedStderr unit below")
	}
	stub := filepath.Join(t.TempDir(), "aikey")
	script := "#!/bin/sh\n" +
		"cat > /dev/null\n" +
		"echo \"[_internal query list_personal_with_masked WARN] decrypt 'rep' failed: Decryption failed\" >&2\n" +
		"echo '{\"status\":\"ok\",\"request_id\":\"req-42\",\"data\":{}}'\n"
	if err := os.WriteFile(stub, []byte(script), 0o755); err != nil {
		t.Fatalf("write stub cli: %v", err)
	}

	var logBuf bytes.Buffer
	b := &Bridge{
		BinaryPath: stub,
		Timeout:    10 * time.Second,
		Logger:     slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn})),
	}

	res, err := b.Invoke(
		context.Background(),
		"query",
		"list_personal_with_masked",
		strings.Repeat("0", 64),
		"req-42",
		struct{}{},
	)
	if err != nil {
		t.Fatalf("Invoke returned error: %v", err)
	}
	if res.Status != "ok" {
		t.Fatalf("stub reply not parsed as ok: %+v", res)
	}

	logged := logBuf.String()
	for _, want := range []string{
		shared.EventUserAPICliBridgeStderr,
		"list_personal_with_masked",
		"req-42",
		"decrypt",
	} {
		if !strings.Contains(logged, want) {
			t.Fatalf("degraded-call WARN missing %q; got: %s", want, logged)
		}
	}
}

// TestInvoke_QuietWhenStderrEmpty keeps the fence above from turning every
// healthy call into log noise.
func TestInvoke_QuietWhenStderrEmpty(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("stub cli is a /bin/sh script")
	}
	stub := filepath.Join(t.TempDir(), "aikey")
	script := "#!/bin/sh\ncat > /dev/null\necho '{\"status\":\"ok\",\"data\":{}}'\n"
	if err := os.WriteFile(stub, []byte(script), 0o755); err != nil {
		t.Fatalf("write stub cli: %v", err)
	}

	var logBuf bytes.Buffer
	b := &Bridge{
		BinaryPath: stub,
		Timeout:    10 * time.Second,
		Logger:     slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn})),
	}
	if _, err := b.Invoke(
		context.Background(), "query", "list_oauth", strings.Repeat("0", 64), "", struct{}{},
	); err != nil {
		t.Fatalf("Invoke returned error: %v", err)
	}
	if logBuf.Len() != 0 {
		t.Fatalf("clean call must not log: %s", logBuf.String())
	}
}
