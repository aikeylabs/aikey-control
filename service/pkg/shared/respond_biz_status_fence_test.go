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
	// zhMessages is the registry every user-visible domain error must appear in,
	// so it is the honest enumeration of "codes that can reach a client".
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
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			if got := DomainErrorHTTPStatus(tc.code); got != tc.want {
				t.Fatalf("DomainErrorHTTPStatus(%q) = %d, want %d — %s", tc.code, got, tc.want, tc.why)
			}
		})
	}
}
