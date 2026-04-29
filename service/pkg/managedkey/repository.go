package managedkey

import "context"

// BindingRepository is the storage contract for ManagedProviderBinding.
type BindingRepository interface {
	Create(ctx context.Context, b *ManagedProviderBinding) error
	FindByID(ctx context.Context, bindingID string) (*ManagedProviderBinding, error)
	ListByOrg(ctx context.Context, orgID string) ([]*ManagedProviderBinding, error)
	// ListByVirtualKey returns all bindings for a given virtual key (any status).
	ListByVirtualKey(ctx context.Context, virtualKeyID string) ([]*ManagedProviderBinding, error)
	// FindActiveByVirtualKeyAndProtocol returns all active bindings for a (VK, protocol) pair,
	// ordered by priority ASC. A VK may have multiple fallback targets per protocol.
	FindActiveByVirtualKeyAndProtocol(ctx context.Context, virtualKeyID, protocolType string) ([]*ManagedProviderBinding, error)
	// FindActiveByVirtualKeyProtocolAndProvider returns the single active binding for a
	// (VK, protocol, provider_id) triplet, or nil if none exists.
	// Used for uniqueness checks before insert.
	FindActiveByVirtualKeyProtocolAndProvider(ctx context.Context, virtualKeyID, protocolType, providerID string) (*ManagedProviderBinding, error)
	UpdateCredential(ctx context.Context, bindingID, credentialID, updatedBy string) error
	UpdateStatus(ctx context.Context, bindingID, status string) error
}

// VirtualKeyRepository is the storage contract for ManagedVirtualKey.
type VirtualKeyRepository interface {
	Create(ctx context.Context, vk *ManagedVirtualKey) error
	FindByID(ctx context.Context, virtualKeyID string) (*ManagedVirtualKey, error)
	FindByTokenHash(ctx context.Context, tokenHash string) (*ManagedVirtualKey, error)
	ListByOrg(ctx context.Context, orgID string) ([]*ManagedVirtualKey, error)
	ListBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error)
	// ListPendingClaimBySeat returns keys with share_status = pending_claim for a seat.
	ListPendingClaimBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error)
	UpdateStatus(ctx context.Context, virtualKeyID, keyStatus, updatedBy string) error
	UpdateShareStatus(ctx context.Context, virtualKeyID, shareStatus string) error
	RotateToken(ctx context.Context, virtualKeyID, newTokenHash, newRevision, updatedBy string) error
	// ReconcileShareStatusByEmail batch-updates share_status from pending_claim
	// to claimed for all active VKs on seats whose invited_email matches email
	// and whose seat_status is now active. Returns the number of VKs updated.
	// Called during login activation to fix VKs issued before the member logged in.
	ReconcileShareStatusByEmail(ctx context.Context, email string) (int, error)
	// RecordDelivery increments delivery_count, sets last_delivery_at, and
	// sets delivered_at on the first delivery.
	RecordDelivery(ctx context.Context, virtualKeyID string) error
	// LastAnchorTuple returns the anchor tuple of the most recent control event for
	// the given (virtual_key_id, binding_id) pair, or a zero-value AnchorTuple if none exists.
	// With multi-protocol bindings each binding has its own independent anchor history.
	LastAnchorTuple(ctx context.Context, virtualKeyID, bindingID string) (AnchorTuple, error)
}

// ControlEventRepository is the append-only storage contract for ControlEvent.
// UPDATE is prohibited by the interface; only Insert is exposed.
type ControlEventRepository interface {
	Insert(ctx context.Context, e *ControlEvent) error
	ListByOrg(ctx context.Context, orgID string) ([]*ControlEvent, error)
	ListByVirtualKey(ctx context.Context, virtualKeyID string) ([]*ControlEvent, error)
}
