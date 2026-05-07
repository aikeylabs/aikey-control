package cli

import (
	"regexp"
	"runtime"
	"strings"
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
