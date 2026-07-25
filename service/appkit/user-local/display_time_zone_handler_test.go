package userlocal

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDisplayTimeZoneHandlerReadsAndWritesCLISharedPreference(t *testing.T) {
	var stored = "auto"
	invoke := func(_ context.Context, value *string) (string, error) {
		if value != nil {
			stored = *value
		}
		return stored, nil
	}
	h := handleDisplayTimeZone(invoke, nil)

	put := httptest.NewRequest(http.MethodPut, "/system/display-time-zone", strings.NewReader(`{"value":"Asia/Shanghai"}`))
	putRecorder := httptest.NewRecorder()
	h.ServeHTTP(putRecorder, put)
	if putRecorder.Code != http.StatusOK || !strings.Contains(putRecorder.Body.String(), `"value":"Asia/Shanghai"`) {
		t.Fatalf("PUT response = %d %s", putRecorder.Code, putRecorder.Body.String())
	}

	getRecorder := httptest.NewRecorder()
	h.ServeHTTP(getRecorder, httptest.NewRequest(http.MethodGet, "/system/display-time-zone", nil))
	if !strings.Contains(getRecorder.Body.String(), `"value":"Asia/Shanghai"`) {
		t.Fatalf("GET response = %s", getRecorder.Body.String())
	}
}
