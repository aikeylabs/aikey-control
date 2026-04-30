package cli

import (
	"runtime"
	"strings"
	"testing"
)

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

func TestSanitizeForLog_RedactsRustDebugFormat(t *testing.T) {
	in := `thread 'main' panicked: BatchImportItem { secret_plaintext: "sk-ant-very-real-key" } at vault_op.rs:42`
	got := sanitizeForLog(in)
	if strings.Contains(got, "sk-ant-very-real-key") {
		t.Fatalf("rust Debug-format secret leaked: %q", got)
	}
	if !strings.Contains(got, "<redacted>") {
		t.Fatalf("expected redaction marker: %q", got)
	}
	if !strings.Contains(got, "vault_op.rs:42") {
		t.Fatalf("file:line context stripped (false positive): %q", got)
	}
}

func TestSanitizeForLog_RedactsAssignment(t *testing.T) {
	in := `env dump: AIKEY_VAULT_KEY=topsecret api_key=sk-ant-real-key authorization=Bearer-eyJabc`
	got := sanitizeForLog(in)
	for _, leak := range []string{"sk-ant-real-key", "topsecret"} {
		if strings.Contains(got, leak) {
			t.Fatalf("assignment-form secret survived: leaked %q in %q", leak, got)
		}
	}
}

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

func TestSanitizeForLog_EmptyAndNoMatch(t *testing.T) {
	if got := sanitizeForLog(""); got != "" {
		t.Fatalf("empty input mutated: %q", got)
	}
	clean := "regular cli stderr: parsed 3 candidates in 12ms"
	if got := sanitizeForLog(clean); got != clean {
		t.Fatalf("clean input modified: input=%q output=%q", clean, got)
	}
}

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
