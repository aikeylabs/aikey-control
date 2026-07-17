package shared

import "strings"

// NormalizeEmail canonicalises an email address for storage and lookup:
// trimmed and lower-cased.
//
// Why this lives in shared rather than in one domain package: an email is the
// join key between the invite side (org_seats.invited_email) and the login side
// (global_accounts.email). Those live in different packages but must agree
// byte-for-byte, because seat claiming compares them with SQL `=`. When only
// the login side normalised, an admin inviting "User@Acme.com" produced a seat
// that the user logging in as "user@acme.com" could never claim — the seat sat
// in pending_claim forever, and the case-sensitive UNIQUE(org_id, invited_email)
// happily accepted a second seat for the same person. One exported function is
// what keeps the two sides from drifting apart again.
//
// Every path that stores or looks up an email must go through this — do not
// re-implement TrimSpace+ToLower locally.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
