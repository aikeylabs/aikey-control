package shared

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// logOnlyMarker is the phrase a declaration must carry to opt out of the status
// contract. See TestEveryDeclaredBizCodeHasAnExplicitStatus.
const logOnlyMarker = "log-only"

// TestEveryDeclaredBizCodeHasAnExplicitStatus is the COMPLETE class fence: it
// enumerates every `CodeBiz*` constant declared in this package's source and
// requires each one either to map to a non-500 status, or to say at its own
// declaration that it never reaches a client.
//
// # Why this exists next to TestEveryBizCodeHasAnExplicitStatus
//
// That test has the right idea and the wrong enumeration. It walks `zhMessages`
// — and `zhMessages` is OPTIONAL BY DESIGN: its own doc comment says "codes
// absent from this map fall back to the English Message automatically". So a
// code nobody added there is invisible to the fence, while
// `DomainErrorHTTPStatus` ends in `default: return 500` and will happily ship it
// as a server fault. Today that is 23 of 82 codes.
//
// The two gaps compound in the same direction, which is what let this survive:
// the codes least likely to have zh copy are the NEWEST ones, and the newest are
// also the likeliest to have been missed in the status switch. On 2026-08-06 that
// combination was worth five refusals of a single function — four of which
// reached clients as `500 SYS_INTERNAL` carrying no code at all.
//
// 🔴 The general rule this encodes: **a fence whose enumeration is an optional
// registry inherits that registry's omissions.** The enumeration has to come
// from something that cannot be incomplete. Here that is the declaration itself:
// a code that does not exist in the source cannot reach a client, and one that
// does is in this scan by construction.
//
// # Why the NAME and not the value
//
// `CodeBizProviderProtocolUnsupported = "PROVIDER_PROTOCOL_UNSUPPORTED"` — a
// business refusal whose wire value deliberately matches a frozen central enum
// rather than the BIZ_ house style. A scan keyed on the string literal would
// silently skip it. `CodeBiz` is the naming convention for "the server
// understood you and is declining on business grounds", so that is the honest
// membership test.
//
// # The one opt-out, and why it is not an exemption list
//
// A few `CodeBiz*` values are LOG FIELDS, not refusals: they are stamped into a
// WARN on a deliberately non-fatal path ("a failure here must not cost the member
// a login") and never travel in a `DomainError`. Requiring a status for those
// would mean inventing a client contract for something no client can receive.
//
// 🚫 The opt-out is NOT a list in this file. A list here goes stale silently and
// becomes the third registry this whole problem is made of. Instead the
// declaration must SAY SO — its doc comment carries the words "log-only" — so the
// claim lives where the author is, and adding a new one means writing the
// sentence that makes it true. And the claim is CHECKED: a code marked log-only
// must not appear in any `DomainError{Code: …}` in this package (below).
//
// If a code has no better answer than 500 and is genuinely returned to callers,
// it is not a business refusal — rename it SYS_/EXT_ rather than marking it.
//
// 能红: delete any `CodeBiz*` from its case group in respond.go and this fails,
// naming the constant and the file:line it was declared at.
func TestEveryDeclaredBizCodeHasAnExplicitStatus(t *testing.T) {
	codes := declaredBizCodes(t)
	assertScanSeesTheSurface(t, codes)

	returned := codesUsedInDomainErrors(t)

	var unmapped, mismarked []string
	var logOnly []string
	for name, c := range codes {
		if c.logOnly {
			logOnly = append(logOnly, name)
			// The marker is a claim about reachability, so verify it rather than
			// trusting it. This is the realistic mistake: a code is marked
			// log-only and later starts being returned, and the marker quietly
			// exempts a live refusal from the whole contract.
			if returned[name] {
				mismarked = append(mismarked, name+" ("+c.value+") declared at "+c.pos)
			}
			continue
		}
		if DomainErrorHTTPStatus(c.value) == 500 {
			unmapped = append(unmapped, name+" ("+c.value+") declared at "+c.pos)
		}
	}
	sort.Strings(unmapped)
	sort.Strings(mismarked)
	sort.Strings(logOnly)

	if len(mismarked) > 0 {
		t.Errorf("%d code(s) are marked %q but ARE constructed into a DomainError in this package, "+
			"so they can reach a client while exempt from the status contract:\n  %s\n"+
			"Either drop the marker and map the code, or stop returning it.",
			len(mismarked), logOnlyMarker, strings.Join(mismarked, "\n  "))
	}
	if len(unmapped) > 0 {
		t.Errorf("%d of %d declared BIZ_ code(s) fall through to the 500 default in "+
			"DomainErrorHTTPStatus, so a deliberate refusal reaches the client as a server fault:\n  %s\n\n"+
			"A BIZ_ code means \"the server understood you and is declining on business grounds\". "+
			"500 means \"the server broke\". A 5xx tells clients to retry something that cannot succeed "+
			"until the caller changes their input, tells operators to hunt a fault that does not exist, "+
			"and makes the console render a carefully worded refusal as \"an unexpected error occurred\".\n\n"+
			"Add each to the case group that matches its meaning. If one is a log field rather than a "+
			"refusal, say so in its doc comment (%q). If it is genuinely returned and genuinely has no "+
			"better status than 500, it is not a business refusal — rename it SYS_/EXT_.",
			len(unmapped), len(codes), strings.Join(unmapped, "\n  "), logOnlyMarker)
	}
	if !t.Failed() {
		t.Logf("✓ %d declared BIZ_ codes: %d mapped to an explicit status, %d declared %s and confirmed "+
			"never constructed into a DomainError here (%s)",
			len(codes), len(codes)-len(logOnly), len(logOnly), logOnlyMarker, strings.Join(logOnly, ", "))
	}
}

// TestZhMessageRegistryIsSmallerThanTheCodeSurface records, as an executable
// fact, WHY the registry-based fence cannot be the only one.
//
// 🔴 This is not a request to fill the registry in. `zhMessages` is optional by
// design — absent codes fall back to their English message, which is a deliberate
// choice, not a backlog. The point is the opposite: while it is optional it can
// never serve as an enumeration of "codes that can reach a client", so anything
// built on that assumption is unsound. If the two sets ever became equal, the
// registry-based fence would not have become safe to rely on alone — it would just
// have stopped being visibly unsafe.
func TestZhMessageRegistryIsSmallerThanTheCodeSurface(t *testing.T) {
	codes := declaredBizCodes(t)
	assertScanSeesTheSurface(t, codes)

	var missing []string
	for name, c := range codes {
		if _, ok := zhMessages[c.value]; !ok {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)

	if len(missing) == 0 {
		t.Logf("every declared BIZ_ code currently has zh copy — the registry-based fence happens to " +
			"cover the whole surface today, which is a coincidence of content, not a property of the " +
			"design. The registry stays optional, so keep the source scan.")
		return
	}
	t.Logf("%d of %d declared BIZ_ codes have no zh copy and are therefore INVISIBLE to "+
		"TestEveryBizCodeHasAnExplicitStatus:\n  %s\n"+
		"They are covered by TestEveryDeclaredBizCodeHasAnExplicitStatus instead. Informational: "+
		"zh copy is optional by design.",
		len(missing), len(codes), strings.Join(missing, "\n  "))
}

// assertScanSeesTheSurface is the vacuity guard both cases need.
//
// A parser that matched nothing — because the declarations moved, or changed
// shape — reports "0 unmapped codes" and reads exactly like a pass.
func assertScanSeesTheSurface(t *testing.T, codes map[string]bizCodeDecl) {
	t.Helper()
	// Deliberately well below the real count (82 at time of writing) so ordinary
	// additions and deletions never touch it. It only catches a scan that has
	// stopped seeing the surface at all.
	const floor = 60
	if len(codes) < floor {
		t.Fatalf("the source scan found only %d CodeBiz* constant(s), below the %d floor — "+
			"the declarations have moved or changed shape and this fence now measures almost nothing",
			len(codes), floor)
	}
	// Aimed at the specific ways this scan could go blind: a code whose wire value
	// is not BIZ_*, and codes from the two rounds of defects this fence exists for.
	for _, must := range []string{
		"CodeBizProviderProtocolUnsupported", // value is not BIZ_*
		"CodeBizRouteGroupNotFound",          // 2026-08-06 round
		"CodeBizBindDuplicateTarget",         // the original staging report
	} {
		if _, ok := codes[must]; !ok {
			t.Fatalf("the source scan did not find %s, a constant this test knows exists — "+
				"the scan is not seeing the declarations it claims to enumerate", must)
		}
	}
}

type bizCodeDecl struct {
	value   string // the wire string, e.g. "BIZ_KEY_NOT_FOUND"
	pos     string // file:line, so a failure is directly actionable
	logOnly bool   // the declaration claims this never reaches a client
}

// declaredBizCodes parses this package's non-test sources and returns every
// `CodeBiz*` constant bound to a string literal.
//
// It uses go/ast rather than a regular expression on purpose. A regex has to
// guess at line shape — alignment, grouping, a value split across lines — and the
// failure mode of a guess that stops matching is a fence that silently enumerates
// less than it did yesterday. The parser either understands the file or refuses
// to, and the refusal is loud.
func declaredBizCodes(t *testing.T) map[string]bizCodeDecl {
	t.Helper()
	out := map[string]bizCodeDecl{}
	forEachPackageFile(t, func(fset *token.FileSet, file *ast.File) {
		for _, decl := range file.Decls {
			gen, isGen := decl.(*ast.GenDecl)
			if !isGen || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				vs, isVS := spec.(*ast.ValueSpec)
				if !isVS {
					continue
				}
				for i, ident := range vs.Names {
					if !strings.HasPrefix(ident.Name, "CodeBiz") {
						continue
					}
					pos := fset.Position(ident.Pos()).String()
					if i >= len(vs.Values) {
						// A CodeBiz* with no value of its own (iota, or a
						// carried-over expression). 🚫 Not skipped quietly: this
						// fence's job is to enumerate the whole surface, and
						// something it cannot read is a hole in it.
						t.Errorf("%s at %s has no literal value the scan can read — "+
							"it would be enumerated but never checked", ident.Name, pos)
						continue
					}
					lit, isLit := vs.Values[i].(*ast.BasicLit)
					if !isLit || lit.Kind != token.STRING {
						t.Errorf("%s at %s is not bound to a string literal (%T) — "+
							"the scan cannot resolve the wire value it would check",
							ident.Name, pos, vs.Values[i])
						continue
					}
					value, unquoteErr := strconv.Unquote(lit.Value)
					if unquoteErr != nil {
						t.Errorf("%s at %s has an unreadable string literal %s: %v",
							ident.Name, pos, lit.Value, unquoteErr)
						continue
					}
					out[ident.Name] = bizCodeDecl{
						value:   value,
						pos:     pos,
						logOnly: declaresLogOnly(gen, vs),
					}
				}
			}
		}
	})
	return out
}

// declaresLogOnly reports whether the marker appears on the constant's own doc
// or trailing comment.
//
// 🔴 The enclosing GenDecl's doc is deliberately NOT consulted. A block comment
// above `const (` describes the whole group, so honouring it would let one
// sentence silently exempt every code in the block — the failure mode this
// marker exists to avoid. The claim has to be made per constant.
func declaresLogOnly(_ *ast.GenDecl, vs *ast.ValueSpec) bool {
	for _, group := range []*ast.CommentGroup{vs.Doc, vs.Comment} {
		if group == nil {
			continue
		}
		if strings.Contains(strings.ToLower(group.Text()), logOnlyMarker) {
			return true
		}
	}
	return false
}

// codesUsedInDomainErrors returns the `CodeBiz*` identifiers that this package
// puts into a `DomainError{Code: …}` — i.e. the ones it can hand to a client.
//
// ⚠️ Scoped to this package on purpose, and that scope is a real limit worth
// stating: other modules construct `shared.DomainError` directly (20 sites in
// aikey-control-master today), and this cannot see them. So it is used only to
// FALSIFY a log-only claim, never to establish one — a code absent here may
// still be returned elsewhere, which is exactly why the fence's default is "must
// be mapped" and the marker is the narrow, justified exception.
func codesUsedInDomainErrors(t *testing.T) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	forEachPackageFile(t, func(_ *token.FileSet, file *ast.File) {
		ast.Inspect(file, func(n ast.Node) bool {
			lit, isLit := n.(*ast.CompositeLit)
			if !isLit {
				return true
			}
			if name, ok := lit.Type.(*ast.Ident); !ok || name.Name != "DomainError" {
				return true
			}
			for _, elt := range lit.Elts {
				kv, isKV := elt.(*ast.KeyValueExpr)
				if !isKV {
					continue
				}
				if key, ok := kv.Key.(*ast.Ident); !ok || key.Name != "Code" {
					continue
				}
				if ident, ok := kv.Value.(*ast.Ident); ok {
					out[ident.Name] = true
				}
			}
			return true
		})
	})
	return out
}

// forEachPackageFile parses this package's non-test sources once per call and
// hands each file to fn.
func forEachPackageFile(t *testing.T, fn func(*token.FileSet, *ast.File)) {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve this test's own path, so the package source cannot be located")
	}
	dir := filepath.Dir(thisFile)

	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, parser.ParseComments)
	if err != nil {
		t.Fatalf("parse package sources in %s: %v", dir, err)
	}
	if len(pkgs) == 0 {
		t.Fatalf("parsed no packages in %s — the scan has nothing to enumerate", dir)
	}
	for _, pkg := range pkgs {
		for _, file := range pkg.Files {
			fn(fset, file)
		}
	}
}
