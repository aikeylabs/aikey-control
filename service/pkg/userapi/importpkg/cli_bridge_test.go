package importpkg

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// ── sanitizeForLog (defense-in-depth secret scrub before slog persists) ─────

// TestSanitizeForLog_RedactsStructuredSecrets covers the JSON-style payload
// shape (cli reply / Rust panic Debug formatter on the stable channel both
// emit `"key":"value"`). If we don't strip these, a cli panic that leaks a
// `BatchImportItem { secret_plaintext: "sk-real" }` Debug print can land
// the raw key in the service log file.
func TestSanitizeForLog_RedactsStructuredSecrets(t *testing.T) {
	cases := []struct{ name, in string }{
		{"json secret_plaintext", `panic at vault_op.rs: BatchImportItem { "alias":"k", "secret_plaintext":"sk-ant-api03-real-key-do-not-leak" }`},
		{"json api_key", `request body: {"alias":"k","api_key":"sk-proj-leak123","base_url":"https://x"}`},
		{"json bearer", `Authorization header: {"bearer":"aikey_team_xyz123abc"}`},
		{"json password", `unlock attempt: {"password":"hunter2-real"}`},
		{"json vault_key_hex", `envelope: {"vault_key_hex":"deadbeef000000000000000000000000000000000000000000000000cafebabe"}`},
		{"json refresh_token", `oauth: {"refresh_token":"1//0gREALrefreshTOKENvalueXYZ"}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := sanitizeForLog(c.in)
			// The literal secret bodies must not appear; the keyword still should.
			if strings.Contains(got, "sk-ant-api03-real-key-do-not-leak") ||
				strings.Contains(got, "sk-proj-leak123") ||
				strings.Contains(got, "aikey_team_xyz123abc") ||
				strings.Contains(got, "hunter2-real") ||
				strings.Contains(got, "deadbeef000000000000000000000000000000000000000000000000cafebabe") ||
				strings.Contains(got, "1//0gREALrefreshTOKENvalueXYZ") {
				t.Fatalf("raw secret survived sanitization: %q", got)
			}
			if !strings.Contains(got, "<redacted>") {
				t.Fatalf("expected <redacted> marker in output: %q", got)
			}
		})
	}
}

// TestSanitizeForLog_RedactsRustDebugFormat covers the `key: "value"` shape
// that Rust's `#[derive(Debug)]` produces when a panic captures a struct
// without a custom Debug impl. This is the most likely real-world leak
// channel because cli battle-tests with `unwrap()` in panic-able paths.
func TestSanitizeForLog_RedactsRustDebugFormat(t *testing.T) {
	in := `thread 'main' panicked: BatchImportItem { secret_plaintext: "sk-ant-very-real-key" } at vault_op.rs:42`
	got := sanitizeForLog(in)
	if strings.Contains(got, "sk-ant-very-real-key") {
		t.Fatalf("rust Debug-format secret leaked: %q", got)
	}
	if !strings.Contains(got, "<redacted>") {
		t.Fatalf("expected redaction marker: %q", got)
	}
	// Diagnostic context (file, line, panic noun) must survive — operators
	// need this to debug the cli crash itself.
	if !strings.Contains(got, "vault_op.rs:42") {
		t.Fatalf("file:line context stripped (false positive): %q", got)
	}
}

// TestSanitizeForLog_RedactsAssignment catches the URL-encoded / shell
// var dump shape (`api_key=sk-...`) which appears if env vars or query
// strings end up in panic messages.
func TestSanitizeForLog_RedactsAssignment(t *testing.T) {
	in := `env dump: AIKEY_VAULT_KEY=topsecret api_key=sk-ant-real-key authorization=Bearer-eyJabc`
	got := sanitizeForLog(in)
	for _, leak := range []string{"sk-ant-real-key", "topsecret"} {
		if strings.Contains(got, leak) {
			t.Fatalf("assignment-form secret survived: leaked %q in %q", leak, got)
		}
	}
}

// TestSanitizeForLog_RedactsRawSecretPrefixes catches loose tokens that
// appear in free-form text (e.g. CLI debug print without surrounding
// key=value structure). Narrow-prefix heuristics — overzealous matchers
// would break harmless diagnostics.
func TestSanitizeForLog_RedactsRawSecretPrefixes(t *testing.T) {
	cases := []string{
		`error mentions sk-ant-api03-LEAKED-KEY-EXAMPLE in flight`,
		`vk reference: aikey_team_some-virtual-key-id-here ended unexpectedly`,
		`jwt stuck: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart was malformed`,
	}
	for _, in := range cases {
		got := sanitizeForLog(in)
		if strings.Contains(got, "sk-ant-api03-LEAKED-KEY-EXAMPLE") ||
			strings.Contains(got, "aikey_team_some-virtual-key-id-here") ||
			strings.Contains(got, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart") {
			t.Fatalf("raw secret prefix not redacted: %q", got)
		}
	}
}

// TestSanitizeForLog_PreservesDiagnosticContext makes sure we don't over-
// redact and turn debug logs into useless noise. File paths, function
// names, error messages, line numbers, version strings should all pass
// through.
func TestSanitizeForLog_PreservesDiagnosticContext(t *testing.T) {
	in := `panic at /home/user/cli/vault_op.rs:142 in handle_batch_import: I_VAULT_LOCKED at version 1.0.4-alpha`
	got := sanitizeForLog(in)
	for _, want := range []string{
		"/home/user/cli/vault_op.rs:142",
		"handle_batch_import",
		"I_VAULT_LOCKED",
		"1.0.4-alpha",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("diagnostic context %q stripped: input=%q output=%q", want, in, got)
		}
	}
}

// TestSanitizeForLog_EmptyAndNoMatch is the boring control: empty strings
// stay empty, strings without secrets pass through byte-identical.
func TestSanitizeForLog_EmptyAndNoMatch(t *testing.T) {
	if got := sanitizeForLog(""); got != "" {
		t.Fatalf("empty input mutated: %q", got)
	}
	clean := "regular cli stderr: parsed 3 candidates in 12ms"
	if got := sanitizeForLog(clean); got != clean {
		t.Fatalf("clean input modified: input=%q output=%q", clean, got)
	}
}

// TestAikeyBinaryName_PlatformSuffix locks the installer-owned basename: Windows
// must look for `aikey.exe`, Unix must look for `aikey`. release.sh packages and
// local-install.ps1 copy the binary under that exact name (windows-compatibility.md
// F3); the runtime resolver has to mirror it or every /api/user/vault/* call on
// Windows comes back as 503 I_CLI_NOT_FOUND (regression 2026-04-28).
func TestAikeyBinaryName_PlatformSuffix(t *testing.T) {
	got := aikeyBinaryName()
	want := "aikey"
	if runtime.GOOS == "windows" {
		want = "aikey.exe"
	}
	if got != want {
		t.Fatalf("aikeyBinaryName() = %q; want %q (GOOS=%s)", got, want, runtime.GOOS)
	}
}

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

	// Override HOME for both Unix (HOME) and Windows (USERPROFILE) so
	// os.UserHomeDir picks our tmp dir regardless of OS. Restore via t.Setenv.
	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)
	t.Setenv("AIKEY_CLI_PATH", "")

	b := &CliBridge{}
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
	// Plant the wrong-name file (bare stem, the pre-fix expectation).
	bareStem := filepath.Join(binDir, "aikey")
	if err := os.WriteFile(bareStem, []byte("placeholder"), 0o755); err != nil {
		t.Fatalf("write bare stem: %v", err)
	}

	t.Setenv("HOME", tmpHome)
	t.Setenv("USERPROFILE", tmpHome)
	t.Setenv("AIKEY_CLI_PATH", "")

	b := &CliBridge{}
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

	b := &CliBridge{}
	if err := b.resolveBinary(); err != nil {
		t.Fatalf("resolveBinary() with override: %v", err)
	}
	if b.BinaryPath != override {
		t.Fatalf("override path not honored: got %q want %q", b.BinaryPath, override)
	}
}
