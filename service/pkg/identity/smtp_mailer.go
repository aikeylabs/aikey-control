package identity

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"strings"
	"sync"
	"time"
)

// Message-ID / Date headers use the sending brand's domain. Hardcoded because
// the From address itself is hardcoded to invite@aikeylabs.com at the mailer
// construction site; keeping these in sync avoids cross-module surprises.
const messageIDDomain = "aikeylabs.com"

// shanghaiLoc is UTC+8 (China Standard Time, no DST).  Loaded once at
// startup; falls back to a fixed zone if tzdata is missing (e.g. minimal
// containers). Using a named location is preferable because it makes the
// Date header render as "+0800" with a well-known offset rather than an
// anonymous zone.
var shanghaiLoc = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Shanghai"); err == nil {
		return loc
	}
	return time.FixedZone("CST", 8*3600)
}()

// boundaryMu guards crypto/rand reads for the MIME boundary. rand.Read is
// concurrent-safe on its own, but we lock here to keep the helper itself
// trivially verifiable in tests.
var boundaryMu sync.Mutex

// SMTPMailer sends activation emails via SMTP over implicit TLS (port 465).
// Suitable for Alibaba Enterprise Mail and other providers using SMTPS.
type SMTPMailer struct {
	host     string
	port     int
	user     string
	password string
	from     string // RFC 5322 display address, e.g. "AiKey Labs" <invite@aikeylabs.com>
	logger   *slog.Logger
}

// NewSMTPMailer creates a production-ready SMTP mailer.
func NewSMTPMailer(host string, port int, user, password, from string, logger *slog.Logger) *SMTPMailer {
	return &SMTPMailer{
		host:     host,
		port:     port,
		user:     user,
		password: password,
		from:     from,
		logger:   logger,
	}
}

// SendActivationEmail sends a styled activation link email to the given address.
func (m *SMTPMailer) SendActivationEmail(_ context.Context, am ActivationMessage) error {
	subject := buildActivationSubject(am)
	dateHeader := buildDateHeader(am.SentAt)
	messageID := buildMessageID(am)
	boundary := newBoundary()

	// multipart/alternative body: plain-text part + HTML part. Mail clients
	// prefer the HTML version; spam filters penalize HTML-only emails
	// (SpamAssassin rule MIME_HTML_ONLY), so we always ship both.
	textPart := buildActivationText(am.ToEmail, am.ActivationURL)
	htmlPart := buildActivationHTML(am.ToEmail, am.ActivationURL)

	msg := strings.Join([]string{
		"From: " + m.from,
		"To: " + am.ToEmail,
		"Subject: " + subject,
		"Date: " + dateHeader,
		"Message-ID: " + messageID,
		"MIME-Version: 1.0",
		`Content-Type: multipart/alternative; boundary="` + boundary + `"`,
		"",
		"--" + boundary,
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		textPart,
		"--" + boundary,
		"Content-Type: text/html; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		htmlPart,
		"--" + boundary + "--",
	}, "\r\n")

	addr := net.JoinHostPort(m.host, fmt.Sprintf("%d", m.port))

	// Implicit TLS (SMTPS): establish TLS first, then SMTP.
	tlsConn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: 10 * time.Second},
		"tcp", addr,
		&tls.Config{ServerName: m.host},
	)
	if err != nil {
		return fmt.Errorf("smtp tls dial: %w", err)
	}
	defer tlsConn.Close()

	client, err := smtp.NewClient(tlsConn, m.host)
	if err != nil {
		return fmt.Errorf("smtp new client: %w", err)
	}
	defer client.Close()

	// Authenticate.
	auth := smtp.PlainAuth("", m.user, m.password, m.host)
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}

	// Envelope sender — extract bare email from display address.
	sender := m.user
	if err := client.Mail(sender); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := client.Rcpt(am.ToEmail); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write([]byte(msg)); err != nil {
		return fmt.Errorf("smtp write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close data: %w", err)
	}

	client.Quit()

	m.logger.Info("activation email sent",
		slog.String("to", am.ToEmail),
		slog.String("subject", subject),
		slog.String("message_id", messageID),
		slog.String("smtp_host", m.host))
	return nil
}

// buildDateHeader renders an RFC 5322 Date header in Asia/Shanghai (UTC+8).
// Why UTC+8: this is a China-based product; CST is what our users expect to
// see in their inboxes ("04/21 23:23" not "04/21 15:23"). Mail clients all
// normalize to the viewer's TZ anyway, so the choice is purely cosmetic for
// receivers outside China.
func buildDateHeader(sentAt time.Time) string {
	if sentAt.IsZero() {
		sentAt = time.Now()
	}
	return sentAt.In(shanghaiLoc).Format(time.RFC1123Z)
}

// buildMessageID returns an RFC 5322 Message-ID of the form
//
//	<login-{LoginSessionID}@aikeylabs.com>
//
// Why this shape: every server-side log line already includes `session_id`,
// so from a bounced/delivered email we can grep the exact login attempt
// end-to-end (Begin → Send → Activate → Poll) without needing a separate
// correlation store. Falls back to a timestamped random when the caller
// omits LoginSessionID (e.g. unit tests) so the header is still unique.
func buildMessageID(am ActivationMessage) string {
	id := am.LoginSessionID
	if id == "" {
		id = fmt.Sprintf("nosession-%d-%s", time.Now().UnixNano(), randHex(4))
	}
	return "<login-" + id + "@" + messageIDDomain + ">"
}

// newBoundary returns a random 16-byte hex string suitable as a MIME
// multipart boundary. Must not appear anywhere in the body text — 32 hex
// chars prefixed with a fixed tag makes collision astronomically unlikely.
func newBoundary() string {
	return "AiKeyAltBdy_" + randHex(16)
}

func randHex(n int) string {
	boundaryMu.Lock()
	defer boundaryMu.Unlock()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand.Read on modern Go never fails on Linux/macOS; if it
		// does, fall back to nanosecond-derived bytes. Still unique-enough
		// for a MIME boundary — we only need intra-message uniqueness.
		now := time.Now().UnixNano()
		for i := range b {
			b[i] = byte(now >> (i * 8))
		}
	}
	return hex.EncodeToString(b)
}

// buildActivationSubject renders a per-send Subject that varies on device +
// server-clock HH:MM. Why: (a) vary per send so mailbox anti-spam engines
// don't see repeated identical Subject+Body as duplicates, and (b) give the
// user a visible cue to distinguish successive login mails in the inbox
// ("which one did I just trigger?").
//
// Why Asia/Shanghai (UTC+8) and no timezone suffix: this is a China-based
// product, users expect local clock time. Displaying "15:23 UTC" caused
// confusion — users read off-by-8h and thought the mail had stale metadata
// (see 2026-04-21 resend/change-email UX bugfix).
//
// Format examples:
//
//	AiKey Login · macOS · 14:20
//	AiKey Login · Linux · 04:07
//	AiKey Login · 14:20           (when OSPlatform is unknown)
func buildActivationSubject(am ActivationMessage) string {
	sentAt := am.SentAt
	if sentAt.IsZero() {
		sentAt = time.Now().UTC()
	}
	timeStr := sentAt.In(shanghaiLoc).Format("15:04")

	device := humanOSPlatform(am.OSPlatform)
	if device == "" {
		return "AiKey Login · " + timeStr
	}
	return "AiKey Login · " + device + " · " + timeStr
}

// humanOSPlatform maps a Go-style GOOS token (as reported by aikey-cli via
// std::env::consts::OS) to a human-readable device label. Unknown values
// pass through unchanged; empty/unset yields "".
func humanOSPlatform(osPlatform string) string {
	switch strings.ToLower(strings.TrimSpace(osPlatform)) {
	case "":
		return ""
	case "darwin":
		return "macOS"
	case "linux":
		return "Linux"
	case "windows":
		return "Windows"
	case "freebsd":
		return "FreeBSD"
	case "openbsd":
		return "OpenBSD"
	default:
		return osPlatform
	}
}

// buildActivationText returns a plain-text version of the activation email.
// Shipped alongside the HTML part as multipart/alternative. Why: mail clients
// that render plain-text first (some security gateways, accessibility tools)
// still get a sensible message, and SpamAssassin's MIME_HTML_ONLY penalty
// does not fire.
func buildActivationText(toEmail, activationURL string) string {
	return "Hi,\r\n\r\n" +
		"Click the link below to activate your AiKey account for " + toEmail + ":\r\n\r\n" +
		activationURL + "\r\n\r\n" +
		"This link expires in 10 minutes. If you didn't request this, you can ignore this email.\r\n\r\n" +
		"— AiKey Labs\r\n"
}

// buildActivationHTML returns a simple, styled HTML email body.
func buildActivationHTML(toEmail, activationURL string) string {
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:8px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="text-align:center;padding-bottom:24px;">
          <h1 style="margin:0;font-size:22px;color:#18181b;">AiKey Labs</h1>
        </td></tr>
        <tr><td style="font-size:15px;color:#3f3f46;line-height:1.6;">
          <p style="margin:0 0 16px;">Hi,</p>
          <p style="margin:0 0 16px;">Click the button below to activate your AiKey account for <strong>` + toEmail + `</strong>.</p>
        </td></tr>
        <tr><td align="center" style="padding:8px 0 24px;">
          <a href="` + activationURL + `"
             style="display:inline-block;padding:12px 32px;background-color:#18181b;color:#ffffff !important;
                    text-decoration:none;border-radius:6px;font-size:15px;font-weight:600;">
            Activate Account
          </a>
        </td></tr>
        <tr><td style="font-size:13px;color:#71717a;line-height:1.5;">
          <p style="margin:0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="margin:0;word-break:break-all;color:#18181b;">` + activationURL + `</p>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #e4e4e7;margin-top:24px;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">
            This link expires in 10 minutes. If you didn't request this, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
