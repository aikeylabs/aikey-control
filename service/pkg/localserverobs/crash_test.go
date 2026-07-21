package localserverobs

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGoSafeIsolatedWritesCrashDump(t *testing.T) {
	dir := t.TempDir()
	SetCrashDumpDir(dir)
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	done := make(chan struct{})
	GoSafe("test.worker", Isolated, func() {
		defer close(done)
		panic("worker-boom")
	})
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("panic recovery did not complete")
	}
	time.Sleep(10 * time.Millisecond)

	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("expected one crash dump, entries=%v err=%v", entries, err)
	}
	body, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"panic=worker-boom", "goroutine=test.worker", "all_goroutines:"} {
		if !bytes.Contains(body, []byte(want)) {
			t.Fatalf("dump missing %q: %s", want, body)
		}
	}
	if !strings.Contains(logs.String(), "local_server.goroutine.panic") {
		t.Fatalf("structured panic event missing: %s", logs.String())
	}
}

func TestRecoverProcessWritesDumpAndExitsTwo(t *testing.T) {
	if os.Getenv("AIKEY_CRASH_HELPER") == "1" {
		SetCrashDumpDir(os.Getenv("AIKEY_CRASH_DIR"))
		defer RecoverProcess("main")
		panic("main-boom")
	}

	dir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestRecoverProcessWritesDumpAndExitsTwo$")
	cmd.Env = append(os.Environ(), "AIKEY_CRASH_HELPER=1", "AIKEY_CRASH_DIR="+dir)
	err := cmd.Run()
	exitErr, ok := err.(*exec.ExitError)
	if !ok || exitErr.ExitCode() != 2 {
		t.Fatalf("expected helper exit 2, got %v", err)
	}
	entries, readErr := os.ReadDir(dir)
	if readErr != nil || len(entries) != 1 {
		t.Fatalf("expected main crash dump, entries=%v err=%v", entries, readErr)
	}
	body, readErr := os.ReadFile(filepath.Join(dir, entries[0].Name()))
	if readErr != nil || !bytes.Contains(body, []byte("panic=main-boom")) {
		t.Fatalf("main dump missing panic, err=%v body=%s", readErr, body)
	}
}

func TestRecoverHTTPWritesDumpAnd500(t *testing.T) {
	dir := t.TempDir()
	SetCrashDumpDir(dir)
	h := RecoverHTTP(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("handler-boom")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "HANDLER_PANIC") {
		t.Fatalf("unexpected response: status=%d body=%s", rec.Code, rec.Body.String())
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("expected one crash dump, entries=%v err=%v", entries, err)
	}
}

func TestRecoverHTTPDoesNotReportAbortHandler(t *testing.T) {
	dir := t.TempDir()
	SetCrashDumpDir(dir)
	h := RecoverHTTP(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))
	func() {
		defer func() {
			if got := recover(); got != http.ErrAbortHandler {
				t.Fatalf("expected ErrAbortHandler, got %v", got)
			}
		}()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/stream", nil))
	}()
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("abort sentinel must not create dump, entries=%v err=%v", entries, err)
	}
}

func TestCrashDirForLogFile(t *testing.T) {
	got := CrashDirForLogFile("/var/log/aikey/control.log")
	want := "/var/log/aikey/aikey-local-server"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
