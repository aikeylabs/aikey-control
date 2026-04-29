package snapshot

import (
	"testing"

	"github.com/AiKeyLabs/aikey-control-service/pkg/managedkey"
)

// TestComputeEffectiveStatus validates the priority order of the effective-status
// derivation used by RefreshSnapshot to populate account_managed_virtual_keys.
//
// Priority (highest to lowest):
//  1. account disabled          → inactive/account_disabled
//  2. seat suspended or revoked → inactive/seat_disabled
//  3. key revoked/expired       → inactive/key_revoked | key_expired
//  4. default                   → active/""
//
// share_status (pending_claim/claimed) is display-only and does NOT block delivery.
func TestComputeEffectiveStatus(t *testing.T) {
	type tc struct {
		name            string
		accountDisabled bool
		seatInactive    bool
		keyStatus       string
		shareStatus     string
		wantStatus      string
		wantReason      string
	}

	cases := []tc{
		// ── account disabled wins over everything ─────────────────────────
		{
			name:            "account disabled overrides active seat and key",
			accountDisabled: true,
			seatInactive:    false,
			keyStatus:       managedkey.VirtualKeyStatusActive,
			shareStatus:     managedkey.ShareStatusClaimed,
			wantStatus:      "inactive",
			wantReason:      "account_disabled",
		},
		{
			name:            "account disabled overrides suspended seat",
			accountDisabled: true,
			seatInactive:    true,
			keyStatus:       managedkey.VirtualKeyStatusActive,
			shareStatus:     managedkey.ShareStatusClaimed,
			wantStatus:      "inactive",
			wantReason:      "account_disabled",
		},
		// ── seat inactive ─────────────────────────────────────────────────
		{
			name:            "seat inactive produces seat_disabled",
			accountDisabled: false,
			seatInactive:    true,
			keyStatus:       managedkey.VirtualKeyStatusActive,
			shareStatus:     managedkey.ShareStatusClaimed,
			wantStatus:      "inactive",
			wantReason:      "seat_disabled",
		},
		// ── key status ────────────────────────────────────────────────────
		{
			name:            "revoked key produces key_revoked",
			accountDisabled: false,
			seatInactive:    false,
			keyStatus:       managedkey.VirtualKeyStatusRevoked,
			shareStatus:     managedkey.ShareStatusClaimed,
			wantStatus:      "inactive",
			wantReason:      "key_revoked",
		},
		{
			name:            "recycled key produces key_revoked",
			accountDisabled: false,
			seatInactive:    false,
			keyStatus:       managedkey.VirtualKeyStatusRecycled,
			shareStatus:     managedkey.ShareStatusClaimed,
			wantStatus:      "inactive",
			wantReason:      "key_revoked",
		},
		{
			name:            "expired key produces key_expired",
			accountDisabled: false,
			seatInactive:    false,
			keyStatus:       managedkey.VirtualKeyStatusExpired,
			shareStatus:     managedkey.ShareStatusClaimed,
			wantStatus:      "inactive",
			wantReason:      "key_expired",
		},
		// ── share status (display-only, does NOT block delivery) ─────────
		{
			name:            "pending_claim does not block delivery",
			accountDisabled: false,
			seatInactive:    false,
			keyStatus:       managedkey.VirtualKeyStatusActive,
			shareStatus:     managedkey.ShareStatusPendingClaim,
			wantStatus:      "active",
			wantReason:      "",
		},
		// ── happy path ────────────────────────────────────────────────────
		{
			name:            "active claimed key is active",
			accountDisabled: false,
			seatInactive:    false,
			keyStatus:       managedkey.VirtualKeyStatusActive,
			shareStatus:     managedkey.ShareStatusClaimed,
			wantStatus:      "active",
			wantReason:      "",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotStatus, gotReason := computeEffectiveStatus(
				c.accountDisabled, c.seatInactive, c.keyStatus, c.shareStatus,
			)
			if gotStatus != c.wantStatus || gotReason != c.wantReason {
				t.Errorf(
					"computeEffectiveStatus(accountDisabled=%v, seatInactive=%v, keyStatus=%q, shareStatus=%q) = (%q, %q), want (%q, %q)",
					c.accountDisabled, c.seatInactive, c.keyStatus, c.shareStatus,
					gotStatus, gotReason, c.wantStatus, c.wantReason,
				)
			}
		})
	}
}
