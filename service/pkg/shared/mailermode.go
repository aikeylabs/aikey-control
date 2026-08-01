package shared

// Mailer-mode enum — the single source of truth for BOTH the mailer wiring
// (control-service cmd/main.go, appkit/core/base.go) and the externally
// readable "mailer" field on GET /health (control router + trial router).
//
// Why this lives in shared: aikey-trial-server must report the same value on
// its own /health without importing control-service internals (physical
// isolation of master code), and shared is the one package every edition
// already depends on. Deriving the mode twice from raw config was the drift
// risk that let servers silently run with the LogMailer fallback while the
// login page claimed emails were sent (bugfix
// 20260731-cli-login-email-silent-success).
const (
	// MailerModeSMTP — real SMTP delivery only.
	MailerModeSMTP = "smtp"
	// MailerModeSMTPLog — SMTP delivery + activation URL mirrored to the log
	// (MAIL_LOG_ACTIVATION_URL=1 / trial sandbox).
	MailerModeSMTPLog = "smtp+log"
	// MailerModeLogOnly — NO email is ever delivered; activation URLs go to
	// the server log only. Any user-facing deployment in this mode is
	// misconfigured — /health exposes it so release E2E can assert against it.
	MailerModeLogOnly = "log-only"
)

// ResolveMailerMode maps SMTP config to the mailer mode. Callers that
// construct the mailer must switch on this result (not re-derive the
// condition) so wiring and health reporting cannot disagree.
func ResolveMailerMode(smtpPassword string, alwaysLogActivationURL bool) string {
	if smtpPassword == "" {
		return MailerModeLogOnly
	}
	if alwaysLogActivationURL {
		return MailerModeSMTPLog
	}
	return MailerModeSMTP
}
