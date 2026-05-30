package shared

import (
	"strings"
	"testing"
)

// TestLocalizedResponseBody_English asserts that locale "en" leaves the
// English Message untouched for every representative error shape
// (static, interpolated, already-Meta, fallback). The English path must be a
// pure pass-through of ResponseBody()["message"] for backward compatibility.
func TestLocalizedResponseBody_English(t *testing.T) {
	cases := []struct {
		name string
		err  *DomainError
	}{
		{"static", BizAuthInvalidCredentials()},
		{"interpolated_email", BizAuthEmailTaken("x@y.com")},
		{"interpolated_id", BizKeyNotFound("vk_1")},
		{"already_meta", ExtProviderRateLimited("openai")},
		{"fallback_no_zh", DataInvalidField("alias", "format", "must be lowercase")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := tc.err.LocalizedResponseBody("en")["message"].(string)
			want := tc.err.Message
			if got != want {
				t.Fatalf("en message changed: got %q, want %q (the raw English Message)", got, want)
			}
		})
	}
}

// TestLocalizedResponseBody_Chinese asserts that locale "zh" renders the zh
// template with each dynamic value interpolated. We check the literal dynamic
// value is present (so a left-over {{key}} placeholder is caught as a FAIL),
// that no {{ }} placeholder survives, and that zh differs from English.
func TestLocalizedResponseBody_Chinese(t *testing.T) {
	cases := []struct {
		name string
		err  *DomainError
		// wantSubstrs must all appear in the rendered zh message. For
		// interpolated cases these are the dynamic values that prove the
		// {{key}} placeholder was actually filled, not left literal.
		wantSubstrs []string
	}{
		{"static", BizAuthInvalidCredentials(), nil},
		{"interpolated_email", BizAuthEmailTaken("x@y.com"), []string{"x@y.com"}},
		{"interpolated_id", BizKeyNotFound("vk_1"), []string{"vk_1"}},
		{"already_meta", ExtProviderRateLimited("openai"), []string{"openai"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			zh, _ := tc.err.LocalizedResponseBody("zh")["message"].(string)
			if zh == "" {
				t.Fatalf("zh message is empty for code %s", tc.err.Code)
			}
			if zh == tc.err.Message {
				t.Fatalf("zh message identical to English %q for code %s — zh template not applied",
					tc.err.Message, tc.err.Code)
			}
			// A surviving placeholder means interpolate() did not fill it.
			if strings.Contains(zh, "{{") || strings.Contains(zh, "}}") {
				t.Fatalf("zh message for code %s still contains an unfilled placeholder: %q",
					tc.err.Code, zh)
			}
			for _, sub := range tc.wantSubstrs {
				if !strings.Contains(zh, sub) {
					t.Fatalf("zh message for code %s missing interpolated value %q (placeholder left literal?): %q",
						tc.err.Code, sub, zh)
				}
			}
		})
	}
}

// TestLocalizedResponseBody_ChineseFallback asserts that a code with no zh
// template (DATA_INVALID_FIELD is intentionally absent from zhMessages) falls
// back to the English Message under locale "zh".
func TestLocalizedResponseBody_ChineseFallback(t *testing.T) {
	if _, ok := zhMessages[CodeDataInvalidField]; ok {
		t.Fatalf("test premise broken: %s is now present in zhMessages; "+
			"pick another code that is absent to exercise the fallback path", CodeDataInvalidField)
	}
	err := DataInvalidField("alias", "format", "must be lowercase")
	zh, _ := err.LocalizedResponseBody("zh")["message"].(string)
	if zh != err.Message {
		t.Fatalf("zh fallback for code %s did not return the English Message: got %q, want %q",
			err.Code, zh, err.Message)
	}
}

// TestParseAcceptLanguage covers the supported-locale negotiation: a
// multi-tag zh header, an empty header (default en), and an en-US header.
func TestParseAcceptLanguage(t *testing.T) {
	cases := []struct {
		header string
		want   string
	}{
		{"zh-CN,zh;q=0.9,en;q=0.8", "zh"},
		{"", "en"},
		{"en-US", "en"},
	}
	for _, tc := range cases {
		if got := ParseAcceptLanguage(tc.header); got != tc.want {
			t.Errorf("ParseAcceptLanguage(%q) = %q, want %q", tc.header, got, tc.want)
		}
	}
}
