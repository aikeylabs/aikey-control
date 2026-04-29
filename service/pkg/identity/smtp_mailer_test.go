package identity

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"
)

// TestSMTPMailer_SendActivationEmail_Real sends a real activation email
// via Alibaba Enterprise Mail SMTP. Skip in CI — run manually:
//
//	go test -v -run TestSMTPMailer_SendActivationEmail_Real ./pkg/identity/
func TestSMTPMailer_SendActivationEmail_Real(t *testing.T) {
	if os.Getenv("SMTP_LIVE_TEST") == "" {
		t.Skip("set SMTP_LIVE_TEST=1 to run live SMTP test")
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))

	mailer := NewSMTPMailer(
		"smtp.qiye.aliyun.com",
		465,
		"invite@aikeylabs.com",
		"idQkZg4DBt4d7iMn",
		`"AiKey Labs" <invite@aikeylabs.com>`,
		logger,
	)

	err := mailer.SendActivationEmail(
		context.Background(),
		ActivationMessage{
			ToEmail:       "335923591@qq.com",
			ActivationURL: "http://localhost:8080/v1/auth/cli/login/activate?token=test-token-abc123",
			OSPlatform:    "darwin",
			SentAt:        time.Now().UTC(),
		},
	)
	if err != nil {
		t.Fatalf("SendActivationEmail failed: %v", err)
	}

	t.Log("activation email sent successfully to 335923591@qq.com — check inbox")
}

func TestBuildActivationSubject(t *testing.T) {
	// 2026-04-20 06:20 UTC == 14:20 Asia/Shanghai — chosen so the UTC and
	// local wall clocks differ visibly, which guards against regressing back
	// to UTC rendering.
	ts := time.Date(2026, 4, 20, 6, 20, 0, 0, time.UTC)

	cases := []struct {
		name string
		msg  ActivationMessage
		want string
	}{
		{"darwin", ActivationMessage{OSPlatform: "darwin", SentAt: ts}, "AiKey Login · macOS · 14:20"},
		{"linux", ActivationMessage{OSPlatform: "linux", SentAt: ts}, "AiKey Login · Linux · 14:20"},
		{"windows upper", ActivationMessage{OSPlatform: "Windows", SentAt: ts}, "AiKey Login · Windows · 14:20"},
		{"unknown OS falls through", ActivationMessage{OSPlatform: "plan9", SentAt: ts}, "AiKey Login · plan9 · 14:20"},
		{"empty OS omits device", ActivationMessage{OSPlatform: "", SentAt: ts}, "AiKey Login · 14:20"},
		{"input already in CST is rendered as CST",
			ActivationMessage{OSPlatform: "darwin", SentAt: time.Date(2026, 4, 20, 14, 20, 0, 0, time.FixedZone("CST", 8*3600))},
			"AiKey Login · macOS · 14:20"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := buildActivationSubject(c.msg)
			if got != c.want {
				t.Fatalf("buildActivationSubject(%+v) = %q, want %q", c.msg, got, c.want)
			}
		})
	}
}

// Zero SentAt should fall back to now rather than epoch time, so offline/test
// call sites that forget to set SentAt still get a sensible, varying Subject.
func TestBuildActivationSubject_ZeroTimeDefaultsToNow(t *testing.T) {
	got := buildActivationSubject(ActivationMessage{OSPlatform: "darwin"})
	if got == "AiKey Login · macOS · 08:00" { // epoch rendered in CST
		t.Fatalf("zero SentAt rendered as epoch time: %q", got)
	}
	if len(got) < len("AiKey Login · macOS · 00:00") {
		t.Fatalf("unexpectedly short subject: %q", got)
	}
}

// Subject must never contain the "UTC" suffix (2026-04-21 user feedback).
func TestBuildActivationSubject_NoUTCSuffix(t *testing.T) {
	got := buildActivationSubject(ActivationMessage{
		OSPlatform: "darwin",
		SentAt:     time.Date(2026, 4, 20, 6, 20, 0, 0, time.UTC),
	})
	if strings.Contains(got, "UTC") {
		t.Fatalf("subject must not contain 'UTC': %q", got)
	}
}

func TestBuildDateHeader_ShanghaiOffset(t *testing.T) {
	// 2026-04-21 15:23 UTC = 2026-04-21 23:23 +0800
	ts := time.Date(2026, 4, 21, 15, 23, 0, 0, time.UTC)
	got := buildDateHeader(ts)
	// RFC 1123Z in Asia/Shanghai always ends with " +0800".
	if !strings.HasSuffix(got, " +0800") {
		t.Fatalf("Date header missing +0800 suffix: %q", got)
	}
	if !strings.Contains(got, "23:23:00") {
		t.Fatalf("Date header did not convert to CST wall clock (want 23:23:00): %q", got)
	}
}

func TestBuildMessageID(t *testing.T) {
	cases := []struct {
		name      string
		sessionID string
		wantExact string // empty ⇒ do pattern checks only
	}{
		{"with session id", "login_sess_abc123", "<login-login_sess_abc123@aikeylabs.com>"},
		{"empty session id falls back", "", ""}, // checked below
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := buildMessageID(ActivationMessage{LoginSessionID: c.sessionID})
			if c.wantExact != "" && got != c.wantExact {
				t.Fatalf("buildMessageID=%q want %q", got, c.wantExact)
			}
			if !strings.HasPrefix(got, "<login-") || !strings.HasSuffix(got, "@aikeylabs.com>") {
				t.Fatalf("Message-ID missing RFC 5322 angle brackets or domain: %q", got)
			}
		})
	}

	// Two empty-session calls must still yield distinct IDs — uniqueness is
	// the whole point of Message-ID, even in the fallback path.
	a := buildMessageID(ActivationMessage{})
	b := buildMessageID(ActivationMessage{})
	if a == b {
		t.Fatalf("empty-session fallback produced identical IDs: %q", a)
	}
}

func TestNewBoundary_UniqueAndSafe(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		b := newBoundary()
		if !strings.HasPrefix(b, "AiKeyAltBdy_") {
			t.Fatalf("boundary missing prefix: %q", b)
		}
		if seen[b] {
			t.Fatalf("duplicate boundary generated after %d calls: %q", i, b)
		}
		seen[b] = true
	}
}

func TestBuildActivationText_ContainsLinkAndEmail(t *testing.T) {
	got := buildActivationText("user@example.com", "https://aikeylabs.com/activate?t=xyz")
	if !strings.Contains(got, "user@example.com") {
		t.Fatalf("text body missing recipient email: %s", got)
	}
	if !strings.Contains(got, "https://aikeylabs.com/activate?t=xyz") {
		t.Fatalf("text body missing activation URL: %s", got)
	}
	// Plain-text body must be CRLF-terminated for SMTP wire format.
	if !strings.HasSuffix(got, "\r\n") {
		t.Fatalf("text body not CRLF-terminated: %q", got[len(got)-4:])
	}
}
