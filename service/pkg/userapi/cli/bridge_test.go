package cli

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
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
