package snapshot

import "context"

// SnapshotRepository abstracts persistence for the
// account_managed_virtual_keys projection and the
// account_sync_versions counter. Naming is "Repository" for uniformity
// with other domain packages (identity.Repository,
// managedkey.BindingRepository, organization.SeatRepository), scoped
// by the "Snapshot" prefix so the responsibility is explicit: it is
// the snapshot-layer repository, not the repository of an
// arbitrary aggregate root.
//
// It is not a pure DDD aggregate-root repository — snapshot is a
// projection derived from multiple source aggregates — but neither
// are several sibling repositories in this codebase (e.g.
// SeatRepository, CredentialRepository manage entities that belong
// to larger aggregates). The Snapshot prefix makes the projection
// flavour explicit without introducing a new term.
type SnapshotRepository interface {
	// GetOrInitSyncVersion returns the current sync_version for the account,
	// initializing to 1 if no record exists.
	GetOrInitSyncVersion(ctx context.Context, accountID string) (int64, error)
	// BumpSyncVersion increments the sync_version by 1 (or inserts with 1).
	BumpSyncVersion(ctx context.Context, accountID string) error
	// UpsertSnapshot upserts one projection row.
	UpsertSnapshot(ctx context.Context, accountID string, snap *AccountKeySnapshot) error
	// DeleteStaleSnapshots removes projection rows not in processedVKIDs.
	// If processedVKIDs is empty, deletes all rows for accountID.
	DeleteStaleSnapshots(ctx context.Context, accountID string, processedVKIDs []string) error
	// ListSnapshots reads all projection rows for an account, ordered by alias.
	ListSnapshots(ctx context.Context, accountID string) ([]AccountKeySnapshot, error)
	// ResolveAccountForSeat returns the account_id for a seat, or "" if unclaimed.
	ResolveAccountForSeat(ctx context.Context, seatID string) (string, error)
	// ResolveAccountForVirtualKey returns the account_id for the seat owning the VK.
	ResolveAccountForVirtualKey(ctx context.Context, virtualKeyID string) (string, error)
	// ResolveAccountsForBindings returns distinct account_ids affected by binding IDs.
	ResolveAccountsForBindings(ctx context.Context, bindingIDs []string) ([]string, error)
	// ResolveAccountsForCredential returns distinct account_ids with keys bound to credentialID.
	ResolveAccountsForCredential(ctx context.Context, credentialID string) ([]string, error)
}
