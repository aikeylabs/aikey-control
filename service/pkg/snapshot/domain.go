// Package snapshot maintains the account_managed_virtual_keys projection
// and the account_sync_versions counter.
//
// It is a projection (read-model) layer: SnapshotRepository defines how
// the projection rows are persisted, while Service orchestrates the
// recompute from live source-of-truth tables (seats, virtual keys,
// bindings, providers, identities). Split out of internal/api on
// 2026-04-24 for clearer layering.
package snapshot

// AccountKeySnapshot is one row from account_managed_virtual_keys —
// the server-computed current-state view of a virtual key visible to an account.
// JSON field names match the CLI's VirtualKeyCacheEntry for direct merge compatibility.
type AccountKeySnapshot struct {
	VirtualKeyID       string            `json:"virtual_key_id"`
	OrgID              string            `json:"org_id"`
	SeatID             string            `json:"seat_id"`
	Alias              string            `json:"alias"`
	ProviderCode       string            `json:"provider_code"`
	ProtocolType       string            `json:"protocol_type"`
	BaseURL            string            `json:"base_url"`
	SupportedProviders []string          `json:"supported_providers"`
	ProviderBaseURLs   map[string]string `json:"provider_base_urls"`
	CredentialID       string            `json:"credential_id"`
	CredentialRevision string            `json:"credential_revision"`
	VirtualKeyRevision string            `json:"virtual_key_revision"`
	KeyStatus          string            `json:"key_status"`
	ShareStatus        string            `json:"share_status"`
	// EffectiveStatus is "active" when the key can be used, "inactive" otherwise.
	EffectiveStatus string `json:"effective_status"`
	// EffectiveReason explains why EffectiveStatus is "inactive":
	// "" | "seat_disabled" | "key_revoked" | "key_expired" | "not_claimed"
	EffectiveReason string `json:"effective_reason"`
	ExpiresAt       *int64 `json:"expires_at,omitempty"`
	SyncVersion     int64  `json:"sync_version"`
}
