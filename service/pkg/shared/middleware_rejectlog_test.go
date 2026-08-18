package shared

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// localeStubWriter simulates the LocaleMiddleware wrapper sitting OUTSIDE the
// logging middleware (the real request path: locale wraps outermost).
type localeStubWriter struct {
	http.ResponseWriter
}

func (localeStubWriter) Locale() string { return "zh" }

// TestLoggingMiddleware_RejectionWarnAndLocalePassthrough pins the 2026-08-18
// decision "every 4xx rejection must land in the service log" AND the subtle
// hazard the recorder introduces: embedding the ResponseWriter interface does
// not promote Locale(), so without the explicit passthrough the zh locale would
// silently degrade to en behind the recorder.
func TestLoggingMiddleware_RejectionWarnAndLocalePassthrough(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	var seenLocale string
	handler := LoggingMiddleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenLocale = LocaleFromWriter(w)
		DomainErrorResponse(w, BizAuthAccessDenied())
	}))

	rr := httptest.NewRecorder()
	handler.ServeHTTP(localeStubWriter{rr}, httptest.NewRequest(http.MethodPost, "/orgs/o1/oauth-groups", nil))

	if seenLocale != "zh" {
		t.Fatalf("locale did not pass through the rejection recorder: got %q, want zh "+
			"(i18n would silently degrade)", seenLocale)
	}
	out := buf.String()
	wants := []string{
		EventControlHTTPRequestRejected,
		CodeBizAuthAccessDenied,
		"\"status\":403",
		"\"path\":\"/orgs/o1/oauth-groups\"",
		"\"level\":\"WARN\"",
	}
	for _, want := range wants {
		if !strings.Contains(out, want) {
			t.Fatalf("rejection WARN missing %q in log output:\n%s", want, out)
		}
	}
	if rr.Header().Get(HeaderErrorCode) != CodeBizAuthAccessDenied {
		t.Fatalf("response must carry %s=%s, got %q", HeaderErrorCode,
			CodeBizAuthAccessDenied, rr.Header().Get(HeaderErrorCode))
	}

	// A 200 must not produce a rejection line.
	buf.Reset()
	ok := LoggingMiddleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		JSON(w, http.StatusOK, map[string]string{"ok": "1"})
	}))
	ok.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/health", nil))
	if strings.Contains(buf.String(), EventControlHTTPRequestRejected) {
		t.Fatalf("a 200 response must not log a rejection: %s", buf.String())
	}
}
