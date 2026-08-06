package shared

import (
	"net/http"
	"sort"
	"strings"
	"testing"
)

// TestEveryBizCodeHasAnExplicitStatus is a CLASS fence, not a list of examples.
//
// 🔴 Why a fence and not two more table rows. DomainErrorHTTPStatus ends in
// `default: return 500`, so a BIZ_* code that nobody remembers to map does not
// fail anywhere — it ships, and the console renders a deliberate, carefully
// worded refusal as "an unexpected error occurred". The author of the refusal
// has no way to notice: their message is correct, their code is correct, and
// the only thing wrong is an omission in a switch they never touched.
//
// That is exactly how this was found. BIZ_BIND_DUPLICATE_TARGET was reported
// from staging (applying a route group twice → 500); auditing the whole family
// instead of patching the one line turned up BIZ_BIND_OAUTH_DIRECT sitting in
// the same state, unreported. One report, two defects — so the useful artefact
// is the fence, which makes the THIRD one impossible to introduce quietly.
//
// A BIZ_ code means "the server understood you and is declining on business
// grounds". 500 means "the server broke". Those can never be the same answer:
// 5xx tells clients and operators to retry and to go looking for a fault, and
// it is what pages an on-call engineer for a working system behaving correctly.
//
// 能红: delete `CodeBizBindDuplicateTarget` from the 409 case in respond.go and
// this test fails naming it.
//
// If a new BIZ_ code genuinely has no better status than 500, that is a
// contradiction in the code itself (it is not a business refusal) — rename it
// SYS_/EXT_ rather than adding an exemption here.
func TestEveryBizCodeHasAnExplicitStatus(t *testing.T) {
	var unmapped []string
	// ⚠️ CORRECTION (2026-08-06). This line used to read "zhMessages is the
	// registry every user-visible domain error must appear in, so it is the
	// honest enumeration of codes that can reach a client". That was FALSE, and
	// the comment above errors.go's own `zhMessages` says the opposite: codes
	// absent from the map fall back to the English message automatically. It is
	// OPTIONAL, so 23 of the 82 declared BIZ_ codes are not in it — and this loop
	// cannot see a single one of them.
	//
	// 🔴 A fence whose enumeration is an optional registry inherits that
	// registry's omissions. Worse here, the two gaps line up: the codes least
	// likely to have zh copy are the newest, which are also the likeliest to have
	// been missed in the status switch.
	//
	// This test is KEPT — it is cheap, and it does pin the zh-copied subset — but
	// it is no longer the fence. TestEveryDeclaredBizCodeHasAnExplicitStatus in
	// respond_biz_status_sourcescan_test.go enumerates the declarations
	// themselves, which cannot be incomplete.
	for code := range zhMessages {
		if !strings.HasPrefix(code, "BIZ_") {
			continue
		}
		if DomainErrorHTTPStatus(code) == http.StatusInternalServerError {
			unmapped = append(unmapped, code)
		}
	}
	sort.Strings(unmapped)
	if len(unmapped) > 0 {
		t.Fatalf("%d BIZ_ code(s) fall through to the 500 default in "+
			"DomainErrorHTTPStatus, so a deliberate refusal reaches the client as a "+
			"server fault: %v\n"+
			"Add each to the case group that matches its meaning (4xx). A business "+
			"refusal is never a 5xx.", len(unmapped), unmapped)
	}
}

// TestDomainErrorStatus_BindingConflictCodes pins the two codes the fence above
// caught, so the intent behind each choice survives a refactor that keeps the
// fence green by moving them somewhere arbitrary.
func TestDomainErrorStatus_BindingConflictCodes(t *testing.T) {
	cases := []struct {
		code string
		want int
		why  string
	}{
		{CodeBizBindDuplicateTarget, http.StatusConflict,
			"conflicts with a binding that already exists — resource state, like CodeBizCredHasActiveRefs"},
		{CodeBizBindOAuthDirect, http.StatusUnprocessableEntity,
			"the request cannot be processed as asked, like CodeBizVKGroupExclusive"},
		// The neighbour it must NOT be confused with: a duplicate inside the
		// submitted list is a bad request body, not a state conflict.
		{CodeBizKeyDuplicateProtocol, http.StatusUnprocessableEntity,
			"duplicate protocol inside the submitted binding list — a body problem"},

		// 2026-08-06, found the same way: driving the real endpoints and reading
		// the status the CLIENT receives. Both were introduced in the same window
		// as the route-group feature and both fell through to 500 — and neither
		// was in zhMessages, so the class fence above could not see them either.
		{CodeBizRouteGroupNotFound, http.StatusNotFound,
			"a template the org does not have — the same fact as CodeBizOauthGroupNotFound about a different object"},
		{CodeBizRouteGroupOriginConflict, http.StatusConflict,
			"the chain that already exists came from another origin — resource state, like CodeBizBindDuplicateTarget"},
		// The neighbour these must NOT be confused with: choosing a credential
		// that does not speak the template's protocol is a bad choice, not a
		// conflict with existing state.
		{CodeBizRouteGroupProtocolMismatch, http.StatusUnprocessableEntity,
			"the chosen credential cannot speak the template's protocol — the choice itself cannot work"},

		// The remaining two refusals of the same function, typed in the same pass
		// after auditing it whole rather than patching the reported lines.
		{CodeBizRouteGroupArchived, http.StatusUnprocessableEntity,
			"the chosen template is archived — an unusable object, like CodeBizCredInactive"},
		{CodeBizRouteGroupEmpty, http.StatusUnprocessableEntity,
			"the chosen template has no upstreams to generate hops from"},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			if got := DomainErrorHTTPStatus(tc.code); got != tc.want {
				t.Fatalf("DomainErrorHTTPStatus(%q) = %d, want %d — %s", tc.code, got, tc.want, tc.why)
			}
		})
	}
}
