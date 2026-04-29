// Package managedkey covers the Credential Control Plane — stable bindings,
// virtual keys, and the append-only control event table.
//
// Bounded context: Credential Control Plane (managedkey sub-domain)
// Ubiquitous language:
//
//	ManagedProviderBinding, ManagedVirtualKey, managed_key_control_events
//	credential_rotation, virtual_key_rotation
package managedkey

import (
	"time"

	"github.com/AiKeyLabs/pkg/aikeytime"
)

// BindingStatus values for ManagedProviderBinding.
const (
	BindingStatusActive  = "active"
	BindingStatusRetired = "retired"
)

// FallbackRole values for ManagedProviderBinding.
// Within a (virtual_key, protocol_type) group, bindings are tried in priority ASC order.
// The proxy falls back to the next candidate only on retryable upstream errors.
const (
	FallbackRolePrimary  = "primary"
	FallbackRoleFallback = "fallback"
)

// VirtualKeyStatus values for ManagedVirtualKey.
const (
	VirtualKeyStatusActive   = "active"
	VirtualKeyStatusRevoked  = "revoked"
	VirtualKeyStatusRecycled = "recycled"
	VirtualKeyStatusExpired  = "expired"
)

// ShareStatus values for ManagedVirtualKey.
const (
	ShareStatusPendingClaim = "pending_claim"
	ShareStatusClaimed      = "claimed"
	ShareStatusInactive     = "inactive"
)

// OperationType values used to decide whether a control event is written.
//
// Rotation operations require an anchor-tuple diff before writing.
// Lifecycle operations are unconditional — they always produce an event.
//
// Naming convention: past-tense verbs to mirror frontend filter values exactly.
const (
	// Rotation operations (anchor-diff gated).
	OperationCredentialRotation = "credential_rotated"
	OperationVirtualKeyRotation = "virtual_key_rotated"

	// Lifecycle operations (always written).
	OperationVirtualKeyIssued   = "virtual_key_issued"
	OperationVirtualKeyRevoked  = "virtual_key_revoked"
	OperationVirtualKeyClaimed  = "virtual_key_claimed"
	OperationCredentialMigrated = "credential_migrated"

	// Binding mutation operations (always written).
	OperationBindingRebound     = "binding_rebound"      // batch rebind swapped a binding's credential
	OperationBindingCreated     = "binding_created"      // batch rebind created a new binding
	OperationCredentialSwitched = "credential_switched"  // batch switch changed a binding's credential
)

// ManagedProviderBinding is one protocol lane between a virtual key and a real credential.
//
// Invariant (3.2): each binding points to exactly one credential_id at a time.
// Invariant (multi-protocol, multi-provider): each virtual key has at most one active binding
// per (protocol_type, provider_id) pair — allowing multiple fallback targets per protocol.
//
// VirtualKeyID is nullable: a NULL value means this is an org-level template binding
// not yet assigned to any virtual key. Non-null means it is scoped to a specific VK.
//
// ProtocolType is redundant with credential → provider.protocol_type.
// The application layer MUST keep them in sync: validate on create and reject
// credential migrations that would cross protocol boundaries.
//
// Priority determines the try order within a (VK, protocol_type) group.
// Lower value = higher preference. 1 = primary, 2+ = fallback candidates.
// Proxy retries on retryable upstream errors only (5xx / timeout / rate-limit).
type ManagedProviderBinding struct {
	BindingID    string    `json:"binding_id"`
	OrgID        string    `json:"org_id"`
	VirtualKeyID *string   `json:"virtual_key_id,omitempty"` // nil = org-level template
	ProviderID   string    `json:"provider_id"`               // identifies the upstream provider
	CredentialID string    `json:"credential_id"`
	ProtocolType string    `json:"protocol_type"`  // kept in sync with provider.protocol_type
	Priority     int       `json:"priority"`        // try order; 1 = primary
	FallbackRole string    `json:"fallback_role"`   // "primary" | "fallback"
	BindingAlias string    `json:"binding_alias"`
	Status       string    `json:"status"`
	UpdatedAt    time.Time `json:"updated_at"`
	UpdatedBy    string    `json:"updated_by"`
}

// ManagedVirtualKey is the current-fact object for a virtual key issued to a seat.
//
// Invariant (3.1): exactly one seat_id at any time.
// Multi-protocol: bindings are stored in managed_provider_bindings with virtual_key_id = this key's ID.
type ManagedVirtualKey struct {
	VirtualKeyID    string     `json:"virtual_key_id"`
	OrgID           string     `json:"org_id"`
	SeatID          string     `json:"seat_id"`
	Alias           string     `json:"alias"`
	TokenHash       string     `json:"-"` // never expose hash
	CurrentRevision string     `json:"current_revision"`
	KeyStatus       string     `json:"key_status"`
	ShareStatus     string     `json:"share_status"`
	DeliveredAt     *time.Time `json:"delivered_at,omitempty"`
	ClaimedAt       *time.Time `json:"claimed_at,omitempty"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
	RecycledAt      *time.Time `json:"recycled_at,omitempty"`
	ReissuedAt      *time.Time `json:"reissued_at,omitempty"`
	LastDeliveryAt  *time.Time `json:"last_delivery_at,omitempty"`
	DeliveryCount   int        `json:"delivery_count"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	UpdatedAt       time.Time  `json:"updated_at"`
	UpdatedBy       string     `json:"updated_by"`
}

// AnchorTuple captures the relation tuple used to decide whether a
// control event must be written.
//
// With multi-protocol bindings, an anchor is scoped to a specific (VK, binding) pair.
// The LastAnchorTuple query takes both virtual_key_id and binding_id.
//
// An event is written iff:
//
//	operationType ∈ {credential_rotation, virtual_key_rotation}
//	AND curr != prev (at least one field differs)
type AnchorTuple struct {
	VirtualKeyID       string
	SeatID             string
	BindingID          string
	CredentialID       string
	VirtualKeyRevision string
	CredentialRevision string
}

// Equals returns true when all anchor fields match.
func (a AnchorTuple) Equals(b AnchorTuple) bool {
	return a.VirtualKeyID == b.VirtualKeyID &&
		a.SeatID == b.SeatID &&
		a.BindingID == b.BindingID &&
		a.CredentialID == b.CredentialID &&
		a.VirtualKeyRevision == b.VirtualKeyRevision &&
		a.CredentialRevision == b.CredentialRevision
}

// ControlEvent is one immutable row in managed_key_control_events.
//
// BindingID is empty ("") for lifecycle events (issued/revoked/claimed) that are not
// scoped to a specific binding. The postgres layer stores "" as NULL.
//
// AccountID is the global_accounts.account_id of the actor (when known).
// For operations triggered from the master console, this may be empty.
//
// ActorEmail is resolved via LEFT JOIN with global_accounts on read queries.
// It is NOT persisted — it exists only to enrich API responses so the frontend
// can display a human-readable actor without extra lookups. (Issue #18)
type ControlEvent struct {
	EventID            string
	OrgID              string
	AccountID          string // global_accounts.account_id of the actor (nullable in DB)
	ActorEmail         string // resolved from global_accounts.email via JOIN (read-only, not persisted)
	ChangeSource       string
	ChangeType         string // credential_rotation | virtual_key_rotation | issued | revoked | claimed | ...
	EntityType         string
	EntityID           string
	CorrelationID      string
	ProviderID         string
	SeatID             string
	VirtualKeyID       string
	VirtualKeyRevision string
	BindingID          string // empty = lifecycle event with no specific binding (stored as NULL)
	CredentialID       string
	CredentialRevision string
	Revision           string
	// Timestamps: int64 Unix millis (UTC) after v1.0.3-alpha. SQLite
	// column is INTEGER; Postgres keeps TIMESTAMPTZ via BindMillis.
	EffectiveFrom      aikeytime.Millis
	EffectiveTo        *aikeytime.Millis
	ChangedAt          aikeytime.Millis
	ChangedBy          string
	Reason             string
	BeforeSnapshotJSON []byte
	AfterSnapshotJSON  []byte
}
