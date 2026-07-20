// Package localserverobs captures local-server panics without dumping heap
// contents or credential material.
package localserverobs

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sync/atomic"
	"time"
)

// Severity controls whether a recovered goroutine panic is isolated or makes
// the process exit so launchd/systemd can restart a degraded service.
type Severity int

const (
	Isolated Severity = iota
	Fatal
)

func (s Severity) String() string {
	if s == Fatal {
		return "fatal"
	}
	return "isolated"
}

var crashDumpDir atomic.Value // string

// SetCrashDumpDir selects the directory containing crash-*.log files.
func SetCrashDumpDir(dir string) { crashDumpDir.Store(dir) }

// CrashDirForLogFile keeps dumps beside the configured service log, in a
// dedicated directory so rotation and incident collection stay predictable.
func CrashDirForLogFile(logFile string) string {
	if logFile != "" {
		return filepath.Join(filepath.Dir(logFile), "aikey-local-server")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".aikey", "logs", "aikey-local-server")
}

// GoSafe runs fn with panic capture. Fatal workers exit(2) after the dump and
// synchronous slog record have been written, allowing the service manager to
// restart the process.
func GoSafe(name string, severity Severity, fn func()) {
	go func() {
		defer recoverPanic(name, severity)
		fn()
	}()
}

// RecoverProcess belongs at the top of the shared serve path. It covers
// startup and main-goroutine panics that HTTP and worker recovery cannot see.
func RecoverProcess(name string) {
	r := recover()
	if r != nil {
		handlePanic(name, Fatal, r)
	}
}

func recoverPanic(name string, severity Severity) {
	r := recover()
	if r == nil {
		return
	}
	handlePanic(name, severity, r)
}

func handlePanic(name string, severity Severity, r any) {
	stack := debug.Stack()
	dumpPath := writeCrashDump(name, r, stack, allGoroutineStacks())
	slog.Error("goroutine panic",
		"event.name", "local_server.goroutine.panic",
		"goroutine", name,
		"severity", severity.String(),
		"panic", fmt.Sprintf("%v", r),
		"crash_dump", dumpPath,
		"stack", string(stack),
	)
	if severity == Fatal {
		os.Exit(2)
	}
}

func writeCrashDump(name string, panicValue any, stack, allStacks []byte) string {
	dirValue := crashDumpDir.Load()
	dir, _ := dirValue.(string)
	if dir == "" {
		return ""
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return ""
	}
	path := filepath.Join(dir, fmt.Sprintf("crash-%s-%s.log",
		time.Now().UTC().Format("20060102T150405.000Z"), sanitizeName(name)))
	body := fmt.Appendf(nil, "time=%s\npid=%d\ngoroutine=%s\npanic=%v\nstack:\n",
		time.Now().UTC().Format(time.RFC3339Nano), os.Getpid(), name, panicValue)
	body = append(body, stack...)
	if len(allStacks) > 0 {
		body = append(body, "\nall_goroutines:\n"...)
		body = append(body, allStacks...)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return ""
	}
	return path
}

func allGoroutineStacks() []byte {
	const max = 8 * 1024 * 1024
	buf := make([]byte, 64*1024)
	for {
		n := runtime.Stack(buf, true)
		if n < len(buf) || len(buf) >= max {
			return buf[:n]
		}
		buf = make([]byte, len(buf)*2)
	}
}

func sanitizeName(name string) string {
	if name == "" {
		return "unnamed"
	}
	out := make([]byte, 0, len(name))
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' ||
			c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-' {
			out = append(out, c)
		} else {
			out = append(out, '_')
		}
	}
	return string(out)
}

// RecoverHTTP wraps an HTTP handler with isolated panic capture. The
// ErrAbortHandler sentinel is passed back to net/http because it represents a
// disconnected/aborted stream, not an application crash.
func RecoverHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tw := &trackedWriter{ResponseWriter: w}
		defer func() {
			panicValue := recover()
			if panicValue == nil {
				return
			}
			if panicValue == http.ErrAbortHandler {
				panic(panicValue)
			}
			stack := debug.Stack()
			name := "http." + r.URL.Path
			dumpPath := writeCrashDump(name, panicValue, stack, allGoroutineStacks())
			slog.Error("http handler panic",
				"event.name", "local_server.http.panic",
				"route", r.URL.Path,
				"panic", fmt.Sprintf("%v", panicValue),
				"crash_dump", dumpPath,
				"stack", string(stack),
			)
			if !tw.wrote {
				tw.Header().Set("Content-Type", "application/json")
				tw.WriteHeader(http.StatusInternalServerError)
				_, _ = tw.Write([]byte(`{"error":"internal_error","code":"HANDLER_PANIC"}`))
			}
		}()
		next.ServeHTTP(tw, r)
	})
}

type trackedWriter struct {
	http.ResponseWriter
	wrote bool
}

// Unwrap lets http.ResponseController reach optional interfaces implemented
// by the original writer.
func (w *trackedWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *trackedWriter) WriteHeader(code int) {
	w.wrote = true
	w.ResponseWriter.WriteHeader(code)
}
func (w *trackedWriter) Write(p []byte) (int, error) {
	w.wrote = true
	return w.ResponseWriter.Write(p)
}
func (w *trackedWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

//nolint:staticcheck // required by ReverseProxy's HTTP/1 disconnect path
func (w *trackedWriter) CloseNotify() <-chan bool {
	//nolint:staticcheck
	if n, ok := w.ResponseWriter.(http.CloseNotifier); ok {
		return n.CloseNotify()
	}
	return nil
}
func (w *trackedWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := w.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}
func (w *trackedWriter) Push(target string, opts *http.PushOptions) error {
	if p, ok := w.ResponseWriter.(http.Pusher); ok {
		return p.Push(target, opts)
	}
	return http.ErrNotSupported
}
