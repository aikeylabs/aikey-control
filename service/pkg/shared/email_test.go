package shared

import "testing"

// The invariant these protect: the invite side and the login side must produce
// the same bytes for the same human, because seat claiming compares them with
// SQL `=`. See NormalizeEmail's doc comment for the incident this prevents.
func TestNormalizeEmail(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"lowercases the local part", "User@acme.com", "user@acme.com"},
		{"lowercases the domain", "user@ACME.COM", "user@acme.com"},
		{"lowercases both", "User.Name@Acme.Corp", "user.name@acme.corp"},
		{"trims surrounding whitespace", "  user@acme.com  ", "user@acme.com"},
		{"trims and lowercases together", "  User@Acme.COM \n", "user@acme.com"},
		{"leaves an already-canonical address untouched", "user@acme.com", "user@acme.com"},
		{"leaves the empty string empty", "", ""},
		{"collapses a whitespace-only value to empty", "   ", ""},
		{"keeps the synthetic digital-employee address stable", "bot+abc123@openclaw.local", "bot+abc123@openclaw.local"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := NormalizeEmail(c.in); got != c.want {
				t.Fatalf("NormalizeEmail(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// The invite side and the login side must converge on the same key — this is
// the exact pair that used to diverge (admin types mixed case, user logs in
// lower-cased) and left the seat unclaimable.
func TestNormalizeEmail_InviteAndLoginConverge(t *testing.T) {
	invited := NormalizeEmail("Repro.Case@Example.COM")
	loggedIn := NormalizeEmail("repro.case@example.com")
	if invited != loggedIn {
		t.Fatalf("invite %q and login %q must normalise to the same key", invited, loggedIn)
	}
}

func TestNormalizeEmail_IsIdempotent(t *testing.T) {
	once := NormalizeEmail("  User@Acme.COM  ")
	if twice := NormalizeEmail(once); twice != once {
		t.Fatalf("NormalizeEmail is not idempotent: %q then %q", once, twice)
	}
}
