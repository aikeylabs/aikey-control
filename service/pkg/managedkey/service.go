package managedkey

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/AiKeyLabs/aikey-control-service/pkg/shared"
	"github.com/AiKeyLabs/pkg/aikeytime"
)

// Service handles all managed key use cases:
//   - binding management (create, list, migrate credential)
//   - virtual key issue / revoke / claim / rotate
//   - control event writing (lifecycle: always; rotation: only on anchor change)
//
// Key invariants enforced here:
//
//	3.1 one virtual key → one seat_id
//	3.2 one binding → one credential_id; protocol_type must match credential's provider
//	3.3 one VK may have multiple active bindings (one per protocol_type)
//	3.4 lifecycle events always written; rotation events gated on anchor tuple diff per (VK, binding)
type Service struct {
	bindings    BindingRepository
	virtualKeys VirtualKeyRepository
	events      ControlEventRepository
	// credentialLookup resolves current credential_id+revision+protocol for a binding.
	// Injected to avoid a hard import cycle between managedkey ↔ provider packages.
	credentialLookup CredentialLookup
}

// CredentialLookup is a narrow interface to fetch credential metadata.
// Kept thin on purpose — avoids importing the full provider package here.
type CredentialLookup interface {
	GetRevision(ctx context.Context, credentialID string) (revision string, err error)
	GetProviderID(ctx context.Context, credentialID string) (providerID string, err error)
	// GetProtocolType returns the protocol_type of the provider linked to the credential.
	// Used to validate that binding.protocol_type stays consistent with the credential chain.
	GetProtocolType(ctx context.Context, credentialID string) (protocolType string, err error)
}

// NewService creates a managed key Service.
func NewService(
	bindings BindingRepository,
	virtualKeys VirtualKeyRepository,
	events ControlEventRepository,
	credLookup CredentialLookup,
) *Service {
	return &Service{
		bindings:         bindings,
		virtualKeys:      virtualKeys,
		events:           events,
		credentialLookup: credLookup,
	}
}

// ---- Binding use cases ----

// CreateBindingParams carries input for creating a stable binding.
// ProtocolType must match the provider linked to CredentialID.
type CreateBindingParams struct {
	OrgID        string
	ProviderID   string // identifies the upstream provider/aggregator
	CredentialID string
	ProtocolType string // must match credential → provider.protocol_type
	Priority     int    // try order within (VK, protocol) group; 1 = primary
	FallbackRole string // "primary" | "fallback"; defaults to FallbackRolePrimary
	BindingAlias string
	VirtualKeyID string // optional; if non-empty, creates a per-VK binding instead of an org-level template
	UpdatedBy    string
}

// CreateBinding creates a new binding.
// When VirtualKeyID is empty, an org-level template binding (VirtualKeyID = nil) is created.
// When VirtualKeyID is non-empty, a per-VK binding scoped to that virtual key is created.
// Returns an error if ProtocolType does not match the credential's provider protocol.
func (s *Service) CreateBinding(ctx context.Context, p CreateBindingParams) (*ManagedProviderBinding, error) {
	if err := s.validateProtocolMatch(ctx, p.CredentialID, p.ProtocolType); err != nil {
		return nil, err
	}
	priority := p.Priority
	if priority <= 0 {
		priority = 1
	}
	fallbackRole := p.FallbackRole
	if fallbackRole == "" {
		if priority == 1 {
			fallbackRole = FallbackRolePrimary
		} else {
			fallbackRole = FallbackRoleFallback
		}
	}
	var vkID *string
	if p.VirtualKeyID != "" {
		vkID = &p.VirtualKeyID
	}
	b := &ManagedProviderBinding{
		BindingID:    shared.NewID(),
		OrgID:        p.OrgID,
		VirtualKeyID: vkID,
		ProviderID:   p.ProviderID,
		CredentialID: p.CredentialID,
		ProtocolType: p.ProtocolType,
		Priority:     priority,
		FallbackRole: fallbackRole,
		BindingAlias: p.BindingAlias,
		Status:       BindingStatusActive,
		UpdatedBy:    p.UpdatedBy,
	}
	if err := s.bindings.Create(ctx, b); err != nil {
		return nil, fmt.Errorf("create binding: %w", err)
	}
	return b, nil
}

// GetBinding retrieves a binding by ID.
func (s *Service) GetBinding(ctx context.Context, bindingID string) (*ManagedProviderBinding, error) {
	b, err := s.bindings.FindByID(ctx, bindingID)
	if err != nil || b == nil {
		return nil, shared.BizBindNotFound(bindingID)
	}
	return b, nil
}

// ListBindings returns all bindings for an org.
func (s *Service) ListBindings(ctx context.Context, orgID string) ([]*ManagedProviderBinding, error) {
	return s.bindings.ListByOrg(ctx, orgID)
}

// ListBindingsByVirtualKey returns all bindings for a specific virtual key.
func (s *Service) ListBindingsByVirtualKey(ctx context.Context, virtualKeyID string) ([]*ManagedProviderBinding, error) {
	return s.bindings.ListByVirtualKey(ctx, virtualKeyID)
}

// MigrateCredentialParams carries input for migrating all active bindings of one credential to another.
type MigrateCredentialParams struct {
	OrgID            string
	FromCredentialID string
	ToCredentialID   string
	UpdatedBy        string
}

// MigrateCredential swaps the credential on all active bindings within the org that currently
// point to FromCredentialID, replacing them with ToCredentialID.
// The new credential must share the same protocol_type as each affected binding.
// A credential_migrated event is written for every affected per-VK binding.
func (s *Service) MigrateCredential(ctx context.Context, p MigrateCredentialParams) error {
	allBindings, err := s.bindings.ListByOrg(ctx, p.OrgID)
	if err != nil {
		return fmt.Errorf("list bindings for migration: %w", err)
	}

	toRevision, _ := s.credentialLookup.GetRevision(ctx, p.ToCredentialID)
	fromRevision, _ := s.credentialLookup.GetRevision(ctx, p.FromCredentialID)
	providerID, _ := s.credentialLookup.GetProviderID(ctx, p.ToCredentialID)

	for _, b := range allBindings {
		if b.CredentialID != p.FromCredentialID || b.Status != BindingStatusActive {
			continue
		}
		// Validate that the new credential uses the same protocol as the binding.
		if err := s.validateProtocolMatch(ctx, p.ToCredentialID, b.ProtocolType); err != nil {
			return fmt.Errorf("binding %s: %w", b.BindingID, err)
		}
		if err := s.bindings.UpdateCredential(ctx, b.BindingID, p.ToCredentialID, p.UpdatedBy); err != nil {
			return fmt.Errorf("migrate binding %s: %w", b.BindingID, err)
		}
		// Only write migration events for bindings that belong to a VK.
		if b.VirtualKeyID == nil {
			continue
		}
		vk, err := s.virtualKeys.FindByID(ctx, *b.VirtualKeyID)
		if err != nil || vk == nil || vk.KeyStatus != VirtualKeyStatusActive {
			continue
		}
		beforeJSON, _ := json.Marshal(map[string]string{
			"virtual_key_id":      vk.VirtualKeyID,
			"binding_id":          b.BindingID,
			"protocol_type":       b.ProtocolType,
			"credential_id":       p.FromCredentialID,
			"credential_revision": fromRevision,
		})
		afterJSON, _ := json.Marshal(map[string]string{
			"virtual_key_id":      vk.VirtualKeyID,
			"binding_id":          b.BindingID,
			"protocol_type":       b.ProtocolType,
			"credential_id":       p.ToCredentialID,
			"credential_revision": toRevision,
		})
		migrateEvent := &ControlEvent{
			EventID:            shared.NewID(),
			OrgID:              p.OrgID,
			ChangeSource:       "master_console",
			ChangeType:         OperationCredentialMigrated,
			EntityType:         "managed_provider_binding",
			EntityID:           b.BindingID,
			ProviderID:         providerID,
			SeatID:             vk.SeatID,
			VirtualKeyID:       vk.VirtualKeyID,
			VirtualKeyRevision: vk.CurrentRevision,
			BindingID:          b.BindingID,
			CredentialID:       p.ToCredentialID,
			CredentialRevision: toRevision,
			Revision:           shared.NewRevision(),
			EffectiveFrom:      aikeytime.Now(),
			ChangedAt:          aikeytime.Now(),
			ChangedBy:          p.UpdatedBy,
			BeforeSnapshotJSON: beforeJSON,
			AfterSnapshotJSON:  afterJSON,
		}
		if err := s.events.Insert(ctx, migrateEvent); err != nil {
			return fmt.Errorf("insert migration event for binding %s: %w", b.BindingID, err)
		}
	}
	return nil
}

// ---- Virtual key use cases ----

// IssueBindingRef describes one protocol lane to provision when issuing a virtual key.
type IssueBindingRef struct {
	ProviderID   string // identifies the upstream provider/aggregator
	CredentialID string
	ProtocolType string // must match credential → provider.protocol_type
	Priority     int    // try order within (VK, protocol) group; 0/1 = primary
	FallbackRole string // "primary" | "fallback"; defaults to FallbackRolePrimary when Priority == 1
	Alias        string // binding alias; defaults to protocol_type if empty
}

// IssueVirtualKeyParams carries input for issuing a new virtual key.
// Bindings specifies which protocol lanes to activate for this key.
// Each entry creates one ManagedProviderBinding with virtual_key_id = new VK.
type IssueVirtualKeyParams struct {
	OrgID     string
	SeatID    string
	Alias     string
	Bindings  []IssueBindingRef // one per desired protocol; must have distinct ProtocolType values
	ExpiresAt *time.Time
	IssuedBy  string
}

// IssueVirtualKeyResult carries the issued key and plaintext token.
// The plaintext token is returned ONCE and never stored.
type IssueVirtualKeyResult struct {
	VirtualKey     *ManagedVirtualKey
	PlaintextToken string
}

// IssueVirtualKey issues a new virtual key to a seat and creates one binding per IssueBindingRef.
// Returns an error if any ProtocolType does not match the linked credential's provider protocol,
// or if two refs share the same (ProtocolType, ProviderID) pair (duplicate targets rejected).
func (s *Service) IssueVirtualKey(ctx context.Context, p IssueVirtualKeyParams) (*IssueVirtualKeyResult, error) {
	// Validate all binding refs before writing anything.
	// Uniqueness is now per (protocol_type, provider_id) — multiple providers per protocol allowed.
	type targetKey struct{ protocol, providerID string }
	seen := make(map[targetKey]bool, len(p.Bindings))
	for _, ref := range p.Bindings {
		k := targetKey{ref.ProtocolType, ref.ProviderID}
		if seen[k] {
			return nil, shared.BizBindDuplicateTarget(ref.ProtocolType, ref.ProviderID)
		}
		seen[k] = true
		if err := s.validateProtocolMatch(ctx, ref.CredentialID, ref.ProtocolType); err != nil {
			return nil, err
		}
	}

	token := shared.NewID()
	hash := sha256Token(token)

	vk := &ManagedVirtualKey{
		VirtualKeyID:    shared.NewID(),
		OrgID:           p.OrgID,
		SeatID:          p.SeatID,
		Alias:           p.Alias,
		TokenHash:       hash,
		CurrentRevision: shared.NewRevision(),
		KeyStatus:       VirtualKeyStatusActive,
		ShareStatus:     ShareStatusPendingClaim,
		ExpiresAt:       p.ExpiresAt,
		UpdatedBy:       p.IssuedBy,
	}
	if err := s.virtualKeys.Create(ctx, vk); err != nil {
		return nil, fmt.Errorf("issue virtual key: %w", err)
	}

	// Create one binding per protocol ref, scoped to this VK.
	for i, ref := range p.Bindings {
		alias := ref.Alias
		if alias == "" {
			alias = ref.ProtocolType
		}
		priority := ref.Priority
		if priority <= 0 {
			priority = i + 1 // auto-assign: first ref = 1 (primary), subsequent = 2+ (fallback)
		}
		fallbackRole := ref.FallbackRole
		if fallbackRole == "" {
			if priority == 1 {
				fallbackRole = FallbackRolePrimary
			} else {
				fallbackRole = FallbackRoleFallback
			}
		}
		b := &ManagedProviderBinding{
			BindingID:    shared.NewID(),
			OrgID:        p.OrgID,
			VirtualKeyID: &vk.VirtualKeyID,
			ProviderID:   ref.ProviderID,
			CredentialID: ref.CredentialID,
			ProtocolType: ref.ProtocolType,
			Priority:     priority,
			FallbackRole: fallbackRole,
			BindingAlias: alias,
			Status:       BindingStatusActive,
			UpdatedBy:    p.IssuedBy,
		}
		if err := s.bindings.Create(ctx, b); err != nil {
			return nil, fmt.Errorf("create binding for protocol %s: %w", ref.ProtocolType, err)
		}
	}

	// Record issuance event — unconditional lifecycle write.
	// The event is VK-scoped (not per-binding); binding_id is left empty (stored as NULL).
	// Use first credential for provider context; full binding list is in the snapshot.
	var firstCredentialID, credRevision, providerID string
	if len(p.Bindings) > 0 {
		firstCredentialID = p.Bindings[0].CredentialID
		credRevision, _ = s.credentialLookup.GetRevision(ctx, firstCredentialID)
		providerID, _ = s.credentialLookup.GetProviderID(ctx, firstCredentialID)
	}
	afterJSON, _ := json.Marshal(snapshotVirtualKey(vk, p.Bindings))
	issueEvent := &ControlEvent{
		EventID:            shared.NewID(),
		OrgID:              vk.OrgID,
		ChangeSource:       "master_console",
		ChangeType:         OperationVirtualKeyIssued,
		EntityType:         "managed_virtual_key",
		EntityID:           vk.VirtualKeyID,
		ProviderID:         providerID,
		SeatID:             vk.SeatID,
		VirtualKeyID:       vk.VirtualKeyID,
		VirtualKeyRevision: vk.CurrentRevision,
		BindingID:          "", // lifecycle event: no specific binding (stored as NULL)
		CredentialID:       firstCredentialID,
		CredentialRevision: credRevision,
		Revision:           shared.NewRevision(),
		EffectiveFrom:      aikeytime.Now(),
		ChangedAt:          aikeytime.Now(),
		ChangedBy:          p.IssuedBy,
		AfterSnapshotJSON:  afterJSON,
	}
	if err := s.events.Insert(ctx, issueEvent); err != nil {
		return nil, fmt.Errorf("insert issue event: %w", err)
	}

	return &IssueVirtualKeyResult{VirtualKey: vk, PlaintextToken: token}, nil
}

// RevokeVirtualKey marks a virtual key as revoked (soft-delete).
func (s *Service) RevokeVirtualKey(ctx context.Context, virtualKeyID, revokedBy string) error {
	vk, err := s.getVirtualKey(ctx, virtualKeyID)
	if err != nil {
		return err
	}
	if vk.KeyStatus == VirtualKeyStatusRevoked {
		return shared.BizKeyNotActive()
	}
	if err := s.virtualKeys.UpdateStatus(ctx, virtualKeyID, VirtualKeyStatusRevoked, revokedBy); err != nil {
		return err
	}

	// Record revocation event — unconditional lifecycle write, not binding-specific.
	// Use first active binding for provider context (best-effort).
	providerID, credentialID, credRevision := s.firstBindingContext(ctx, virtualKeyID)
	beforeJSON, _ := json.Marshal(snapshotVirtualKey(vk, nil))
	vk.KeyStatus = VirtualKeyStatusRevoked
	afterJSON, _ := json.Marshal(snapshotVirtualKey(vk, nil))
	revokeEvent := &ControlEvent{
		EventID:            shared.NewID(),
		OrgID:              vk.OrgID,
		ChangeSource:       "master_console",
		ChangeType:         OperationVirtualKeyRevoked,
		EntityType:         "managed_virtual_key",
		EntityID:           vk.VirtualKeyID,
		ProviderID:         providerID,
		SeatID:             vk.SeatID,
		VirtualKeyID:       vk.VirtualKeyID,
		VirtualKeyRevision: vk.CurrentRevision,
		BindingID:          "", // lifecycle event
		CredentialID:       credentialID,
		CredentialRevision: credRevision,
		Revision:           shared.NewRevision(),
		EffectiveFrom:      aikeytime.Now(),
		ChangedAt:          aikeytime.Now(),
		ChangedBy:          revokedBy,
		BeforeSnapshotJSON: beforeJSON,
		AfterSnapshotJSON:  afterJSON,
	}
	if err := s.events.Insert(ctx, revokeEvent); err != nil {
		return fmt.Errorf("insert revoke event: %w", err)
	}
	return nil
}

// ClaimVirtualKey transitions share_status to claimed.
func (s *Service) ClaimVirtualKey(ctx context.Context, virtualKeyID string) error {
	vk, err := s.getVirtualKey(ctx, virtualKeyID)
	if err != nil {
		return err
	}
	if vk.KeyStatus != VirtualKeyStatusActive {
		return shared.BizKeyNotActive()
	}
	if err := s.virtualKeys.UpdateShareStatus(ctx, virtualKeyID, ShareStatusClaimed); err != nil {
		return err
	}

	// Record claim event — unconditional lifecycle write, not binding-specific.
	providerID, credentialID, credRevision := s.firstBindingContext(ctx, virtualKeyID)
	beforeJSON, _ := json.Marshal(snapshotVirtualKey(vk, nil))
	vk.ShareStatus = ShareStatusClaimed
	afterJSON, _ := json.Marshal(snapshotVirtualKey(vk, nil))
	claimEvent := &ControlEvent{
		EventID:            shared.NewID(),
		OrgID:              vk.OrgID,
		ChangeSource:       "user_console",
		ChangeType:         OperationVirtualKeyClaimed,
		EntityType:         "managed_virtual_key",
		EntityID:           vk.VirtualKeyID,
		ProviderID:         providerID,
		SeatID:             vk.SeatID,
		VirtualKeyID:       vk.VirtualKeyID,
		VirtualKeyRevision: vk.CurrentRevision,
		BindingID:          "", // lifecycle event
		CredentialID:       credentialID,
		CredentialRevision: credRevision,
		Revision:           shared.NewRevision(),
		EffectiveFrom:      aikeytime.Now(),
		ChangedAt:          aikeytime.Now(),
		ChangedBy:          vk.SeatID, // claimed by the seat owner
		BeforeSnapshotJSON: beforeJSON,
		AfterSnapshotJSON:  afterJSON,
	}
	if err := s.events.Insert(ctx, claimEvent); err != nil {
		return fmt.Errorf("insert claim event: %w", err)
	}
	return nil
}

// GetVirtualKey retrieves a virtual key by ID.
func (s *Service) GetVirtualKey(ctx context.Context, virtualKeyID string) (*ManagedVirtualKey, error) {
	return s.getVirtualKey(ctx, virtualKeyID)
}

// ListVirtualKeys returns all virtual keys for an org.
func (s *Service) ListVirtualKeys(ctx context.Context, orgID string) ([]*ManagedVirtualKey, error) {
	return s.virtualKeys.ListByOrg(ctx, orgID)
}

// ListVirtualKeysBySeat returns virtual keys for a specific seat (user-side query).
func (s *Service) ListVirtualKeysBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error) {
	return s.virtualKeys.ListBySeat(ctx, seatID)
}

// ListPendingClaimBySeat returns pending-claim keys for a seat.
func (s *Service) ListPendingClaimBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error) {
	return s.virtualKeys.ListPendingClaimBySeat(ctx, seatID)
}

// ReconcileVKShareStatusByEmail batch-transitions share_status from pending_claim
// to claimed for all active VKs on seats whose invited_email matches and whose
// seat is now active. Called during login activation after seat reconciliation.
//
// Satisfies the identity.VKShareReconciler interface via Go structural typing.
func (s *Service) ReconcileVKShareStatusByEmail(ctx context.Context, email string) (int, error) {
	return s.virtualKeys.ReconcileShareStatusByEmail(ctx, email)
}

// ---- Rotation use cases ----

// RotateVirtualKeyParams carries input for virtual_key_rotation.
type RotateVirtualKeyParams struct {
	VirtualKeyID  string
	CorrelationID string
	ChangedBy     string
	Reason        string
}

// RotateVirtualKeyResult carries the rotated key and its new plaintext token.
// The plaintext token is returned ONCE and never stored.
type RotateVirtualKeyResult struct {
	VirtualKey     *ManagedVirtualKey
	PlaintextToken string
}

// RotateVirtualKey generates a new token+revision for the virtual key.
// For each active binding, if the anchor tuple changes a control event is appended.
// With multi-protocol bindings each binding gets an independent anchor comparison.
func (s *Service) RotateVirtualKey(ctx context.Context, p RotateVirtualKeyParams) (*RotateVirtualKeyResult, error) {
	vk, err := s.getVirtualKey(ctx, p.VirtualKeyID)
	if err != nil {
		return nil, err
	}

	// Rotate token and revision before reading anchors, so the new revision is the current truth.
	newToken := shared.NewID()
	newHash := sha256Token(newToken)
	newRevision := shared.NewRevision()
	if err := s.virtualKeys.RotateToken(ctx, vk.VirtualKeyID, newHash, newRevision, p.ChangedBy); err != nil {
		return nil, fmt.Errorf("rotate virtual key token: %w", err)
	}

	// For each active binding, check anchor and write event if changed.
	activeBindings, err := s.bindings.ListByVirtualKey(ctx, vk.VirtualKeyID)
	if err != nil {
		return nil, fmt.Errorf("list bindings for rotation: %w", err)
	}

	for _, binding := range activeBindings {
		if binding.Status != BindingStatusActive {
			continue
		}
		prev, err := s.virtualKeys.LastAnchorTuple(ctx, vk.VirtualKeyID, binding.BindingID)
		if err != nil {
			return nil, fmt.Errorf("load last anchor for binding %s: %w", binding.BindingID, err)
		}

		credRevision, _ := s.credentialLookup.GetRevision(ctx, binding.CredentialID)
		providerID, _ := s.credentialLookup.GetProviderID(ctx, binding.CredentialID)

		curr := AnchorTuple{
			VirtualKeyID:       vk.VirtualKeyID,
			SeatID:             vk.SeatID,
			BindingID:          binding.BindingID,
			CredentialID:       binding.CredentialID,
			VirtualKeyRevision: newRevision,
			CredentialRevision: credRevision,
		}

		if !shouldAppendControlEvent(OperationVirtualKeyRotation, prev, curr) {
			continue
		}

		beforeJSON, _ := json.Marshal(snapshotVirtualKey(vk, nil))
		vk.CurrentRevision = newRevision
		vk.TokenHash = newHash
		afterJSON, _ := json.Marshal(snapshotVirtualKey(vk, nil))

		event := &ControlEvent{
			EventID:            shared.NewID(),
			OrgID:              vk.OrgID,
			ChangeSource:       "master_console",
			ChangeType:         OperationVirtualKeyRotation,
			EntityType:         "managed_virtual_key",
			EntityID:           vk.VirtualKeyID,
			CorrelationID:      p.CorrelationID,
			ProviderID:         providerID,
			SeatID:             curr.SeatID,
			VirtualKeyID:       curr.VirtualKeyID,
			VirtualKeyRevision: curr.VirtualKeyRevision,
			BindingID:          curr.BindingID,
			CredentialID:       curr.CredentialID,
			CredentialRevision: curr.CredentialRevision,
			Revision:           shared.NewRevision(),
			EffectiveFrom:      aikeytime.Now(),
			ChangedAt:          aikeytime.Now(),
			ChangedBy:          p.ChangedBy,
			Reason:             p.Reason,
			BeforeSnapshotJSON: beforeJSON,
			AfterSnapshotJSON:  afterJSON,
		}
		if err := s.events.Insert(ctx, event); err != nil {
			return nil, fmt.Errorf("insert rotation event for binding %s: %w", binding.BindingID, err)
		}
	}

	vk.CurrentRevision = newRevision
	vk.TokenHash = newHash
	return &RotateVirtualKeyResult{VirtualKey: vk, PlaintextToken: newToken}, nil
}

// RotateCredentialParams carries context for a credential_rotation event.
// The actual credential rotation is done by provider.Service; this method
// checks whether a control event is needed for each affected virtual key binding.
type RotateCredentialParams struct {
	CredentialID  string
	OrgID         string
	NewRevision   string
	OldRevision   string
	CorrelationID string
	ChangedBy     string
	Reason        string
}

// HandleCredentialRotation checks all per-VK bindings pointing to the rotated credential,
// and appends a control event for each whose anchor changed.
func (s *Service) HandleCredentialRotation(ctx context.Context, p RotateCredentialParams) error {
	allBindings, err := s.bindings.ListByOrg(ctx, p.OrgID)
	if err != nil {
		return fmt.Errorf("list bindings: %w", err)
	}

	for _, binding := range allBindings {
		if binding.CredentialID != p.CredentialID {
			continue
		}
		if binding.Status != BindingStatusActive {
			continue
		}
		if binding.VirtualKeyID == nil {
			continue // skip org-level templates; they have no VK to notify
		}

		vk, err := s.virtualKeys.FindByID(ctx, *binding.VirtualKeyID)
		if err != nil || vk == nil || vk.KeyStatus != VirtualKeyStatusActive {
			continue
		}

		prev, err := s.virtualKeys.LastAnchorTuple(ctx, vk.VirtualKeyID, binding.BindingID)
		if err != nil {
			continue
		}

		curr := AnchorTuple{
			VirtualKeyID:       vk.VirtualKeyID,
			SeatID:             vk.SeatID,
			BindingID:          binding.BindingID,
			CredentialID:       p.CredentialID,
			VirtualKeyRevision: vk.CurrentRevision,
			CredentialRevision: p.NewRevision,
		}

		if !shouldAppendControlEvent(OperationCredentialRotation, prev, curr) {
			continue
		}

		beforeJSON, _ := json.Marshal(map[string]string{
			"virtual_key_id":      vk.VirtualKeyID,
			"binding_id":          binding.BindingID,
			"protocol_type":       binding.ProtocolType,
			"credential_id":       p.CredentialID,
			"credential_revision": p.OldRevision,
		})
		afterJSON, _ := json.Marshal(map[string]string{
			"virtual_key_id":      vk.VirtualKeyID,
			"binding_id":          binding.BindingID,
			"protocol_type":       binding.ProtocolType,
			"credential_id":       p.CredentialID,
			"credential_revision": p.NewRevision,
		})
		providerID, _ := s.credentialLookup.GetProviderID(ctx, p.CredentialID)

		event := &ControlEvent{
			EventID:            shared.NewID(),
			OrgID:              p.OrgID,
			ChangeSource:       "master_console",
			ChangeType:         OperationCredentialRotation,
			EntityType:         "managed_provider_credential",
			EntityID:           p.CredentialID,
			CorrelationID:      p.CorrelationID,
			ProviderID:         providerID,
			SeatID:             curr.SeatID,
			VirtualKeyID:       curr.VirtualKeyID,
			VirtualKeyRevision: curr.VirtualKeyRevision,
			BindingID:          curr.BindingID,
			CredentialID:       curr.CredentialID,
			CredentialRevision: curr.CredentialRevision,
			Revision:           shared.NewRevision(),
			EffectiveFrom:      aikeytime.Now(),
			ChangedAt:          aikeytime.Now(),
			ChangedBy:          p.ChangedBy,
			Reason:             p.Reason,
			BeforeSnapshotJSON: beforeJSON,
			AfterSnapshotJSON:  afterJSON,
		}
		if err := s.events.Insert(ctx, event); err != nil {
			return fmt.Errorf("insert credential rotation event for binding %s: %w", binding.BindingID, err)
		}
	}
	return nil
}

// ListControlEvents returns control events for an org.
func (s *Service) ListControlEvents(ctx context.Context, orgID string) ([]*ControlEvent, error) {
	return s.events.ListByOrg(ctx, orgID)
}

// ---- Operational APIs: protocol channel management ----

// AddBindingToVirtualKeyParams carries input for adding a new protocol channel to an existing VK.
type AddBindingToVirtualKeyParams struct {
	OrgID        string
	VirtualKeyID string
	ProviderID   string // identifies the upstream provider; required for uniqueness check
	CredentialID string
	ProtocolType string // must match credential → provider.protocol_type
	Priority     int    // try order within (VK, protocol) group; 0/1 = primary
	FallbackRole string // "primary" | "fallback"; derived from Priority if empty
	Alias        string // defaults to protocol_type if empty
	UpdatedBy    string
}

// AddBindingToVirtualKey adds a new protocol channel to an already-issued virtual key.
// Returns BizBindDuplicateTarget if an active binding for the same (VK, protocol, provider) triplet
// already exists. Multiple bindings per protocol are allowed as long as they target different providers.
func (s *Service) AddBindingToVirtualKey(ctx context.Context, p AddBindingToVirtualKeyParams) (*ManagedProviderBinding, error) {
	vk, err := s.getVirtualKey(ctx, p.VirtualKeyID)
	if err != nil {
		return nil, err
	}
	if vk.OrgID != p.OrgID {
		return nil, shared.BizKeyNotFound(p.VirtualKeyID)
	}
	if err := s.validateProtocolMatch(ctx, p.CredentialID, p.ProtocolType); err != nil {
		return nil, err
	}
	// Reject if an active binding already exists for this (VK, protocol, provider) triplet.
	existing, err := s.bindings.FindActiveByVirtualKeyProtocolAndProvider(ctx, p.VirtualKeyID, p.ProtocolType, p.ProviderID)
	if err != nil {
		return nil, fmt.Errorf("check existing binding: %w", err)
	}
	if existing != nil {
		return nil, shared.BizBindDuplicateTarget(p.ProtocolType, p.ProviderID)
	}
	alias := p.Alias
	if alias == "" {
		alias = p.ProtocolType
	}
	priority := p.Priority
	if priority <= 0 {
		priority = 1
	}
	fallbackRole := p.FallbackRole
	if fallbackRole == "" {
		if priority == 1 {
			fallbackRole = FallbackRolePrimary
		} else {
			fallbackRole = FallbackRoleFallback
		}
	}
	b := &ManagedProviderBinding{
		BindingID:    shared.NewID(),
		OrgID:        p.OrgID,
		VirtualKeyID: &p.VirtualKeyID,
		ProviderID:   p.ProviderID,
		CredentialID: p.CredentialID,
		ProtocolType: p.ProtocolType,
		Priority:     priority,
		FallbackRole: fallbackRole,
		BindingAlias: alias,
		Status:       BindingStatusActive,
		UpdatedBy:    p.UpdatedBy,
	}
	if err := s.bindings.Create(ctx, b); err != nil {
		return nil, fmt.Errorf("create binding: %w", err)
	}
	return b, nil
}

// BindingImpact describes how many virtual keys and seats reference a binding or credential.
type BindingImpact struct {
	VirtualKeyCount int      `json:"virtual_key_count"`
	SeatIDs         []string `json:"seat_ids"`
}

// GetBindingImpact returns the set of VKs and seats that would be affected if this binding
// were retired or its credential switched.
// For org-level template bindings (VirtualKeyID = nil) VirtualKeyCount is 0.
func (s *Service) GetBindingImpact(ctx context.Context, bindingID, orgID string) (*BindingImpact, error) {
	b, err := s.bindings.FindByID(ctx, bindingID)
	if err != nil || b == nil {
		return nil, shared.BizBindNotFound(bindingID)
	}
	if b.OrgID != orgID {
		return nil, shared.BizBindNotFound(bindingID)
	}
	if b.VirtualKeyID == nil {
		return &BindingImpact{VirtualKeyCount: 0, SeatIDs: []string{}}, nil
	}
	vk, err := s.virtualKeys.FindByID(ctx, *b.VirtualKeyID)
	if err != nil || vk == nil {
		return &BindingImpact{VirtualKeyCount: 0, SeatIDs: []string{}}, nil
	}
	return &BindingImpact{VirtualKeyCount: 1, SeatIDs: []string{vk.SeatID}}, nil
}

// CredentialImpact describes how many bindings, virtual keys, and seats reference a credential.
type CredentialImpact struct {
	BindingCount    int      `json:"binding_count"`
	VirtualKeyCount int      `json:"virtual_key_count"`
	SeatIDs         []string `json:"seat_ids"`
}

// GetCredentialImpact returns the scope of active bindings pointing to this credential within the org.
func (s *Service) GetCredentialImpact(ctx context.Context, credentialID, orgID string) (*CredentialImpact, error) {
	allBindings, err := s.bindings.ListByOrg(ctx, orgID)
	if err != nil {
		return nil, fmt.Errorf("list bindings: %w", err)
	}
	seenVKs := make(map[string]bool)
	seenSeats := make(map[string]bool)
	bindingCount := 0
	for _, b := range allBindings {
		if b.CredentialID != credentialID || b.Status != BindingStatusActive {
			continue
		}
		bindingCount++
		if b.VirtualKeyID == nil {
			continue
		}
		if seenVKs[*b.VirtualKeyID] {
			continue
		}
		seenVKs[*b.VirtualKeyID] = true
		vk, err := s.virtualKeys.FindByID(ctx, *b.VirtualKeyID)
		if err == nil && vk != nil {
			seenSeats[vk.SeatID] = true
		}
	}
	seatIDs := make([]string, 0, len(seenSeats))
	for id := range seenSeats {
		seatIDs = append(seatIDs, id)
	}
	return &CredentialImpact{
		BindingCount:    bindingCount,
		VirtualKeyCount: len(seenVKs),
		SeatIDs:         seatIDs,
	}, nil
}

// BatchRebindSeat describes one seat's rebind target: which protocols to add/replace.
type BatchRebindSeat struct {
	SeatID   string
	Bindings []IssueBindingRef // protocol_type → credential_id replacements
}

// BatchRebindParams carries input for batch-rebinding seats to new protocol channels.
type BatchRebindParams struct {
	OrgID     string
	Seats     []BatchRebindSeat
	UpdatedBy string
}

// BatchRebindOutcome is the per-seat result.
type BatchRebindOutcome struct {
	SeatID       string `json:"seat_id"`
	VirtualKeyID string `json:"virtual_key_id"`
	Succeeded    bool   `json:"succeeded"`
	ErrorCode    string `json:"error_code,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
}

// BatchRebindSeats replaces or adds protocol-level bindings on the active VK for each seat.
// For each (seat, protocol_type) pair:
//   - if an active binding already exists for that protocol on the VK, its credential is swapped
//   - otherwise a new binding is created
//
// Failures on individual seats are collected and returned — they do NOT abort the batch.
func (s *Service) BatchRebindSeats(ctx context.Context, p BatchRebindParams) ([]BatchRebindOutcome, error) {
	outcomes := make([]BatchRebindOutcome, 0, len(p.Seats))
	for _, seat := range p.Seats {
		// Find the active VK for this seat.
		vks, err := s.virtualKeys.ListBySeat(ctx, seat.SeatID)
		if err != nil {
			outcomes = append(outcomes, batchRebindFail(seat.SeatID, "", shared.BizSeatNotFound(seat.SeatID)))
			continue
		}
		var activeVK *ManagedVirtualKey
		for _, vk := range vks {
			if vk.KeyStatus == VirtualKeyStatusActive {
				activeVK = vk
				break
			}
		}
		if activeVK == nil {
			outcomes = append(outcomes, batchRebindFail(seat.SeatID, "", shared.BizKeyNotFound(seat.SeatID)))
			continue
		}

		seatFailed := false
		for i, ref := range seat.Bindings {
			if err := s.validateProtocolMatch(ctx, ref.CredentialID, ref.ProtocolType); err != nil {
				outcomes = append(outcomes, batchRebindFail(seat.SeatID, activeVK.VirtualKeyID, err))
				seatFailed = true
				break
			}
			// Check by (VK, protocol, provider) triplet so multiple fallback targets per protocol are supported.
			existing, err := s.bindings.FindActiveByVirtualKeyProtocolAndProvider(ctx, activeVK.VirtualKeyID, ref.ProtocolType, ref.ProviderID)
			if err != nil {
				outcomes = append(outcomes, batchRebindFail(seat.SeatID, activeVK.VirtualKeyID, fmt.Errorf("check binding: %w", err)))
				seatFailed = true
				break
			}
			if existing != nil {
				// Swap credential on existing binding.
				oldCredentialID := existing.CredentialID
				if err := s.bindings.UpdateCredential(ctx, existing.BindingID, ref.CredentialID, p.UpdatedBy); err != nil {
					outcomes = append(outcomes, batchRebindFail(seat.SeatID, activeVK.VirtualKeyID, fmt.Errorf("update binding: %w", err)))
					seatFailed = true
					break
				}
				// Write control event for credential swap on existing binding.
				s.writeBindingMutationEvent(ctx, OperationBindingRebound, p.OrgID, activeVK,
					existing.BindingID, ref.ProtocolType, oldCredentialID, ref.CredentialID, p.UpdatedBy)
			} else {
				alias := ref.Alias
				if alias == "" {
					alias = ref.ProtocolType
				}
				priority := ref.Priority
				if priority <= 0 {
					priority = i + 1
				}
				fallbackRole := ref.FallbackRole
				if fallbackRole == "" {
					if priority == 1 {
						fallbackRole = FallbackRolePrimary
					} else {
						fallbackRole = FallbackRoleFallback
					}
				}
				b := &ManagedProviderBinding{
					BindingID:    shared.NewID(),
					OrgID:        p.OrgID,
					VirtualKeyID: &activeVK.VirtualKeyID,
					ProviderID:   ref.ProviderID,
					CredentialID: ref.CredentialID,
					ProtocolType: ref.ProtocolType,
					Priority:     priority,
					FallbackRole: fallbackRole,
					BindingAlias: alias,
					Status:       BindingStatusActive,
					UpdatedBy:    p.UpdatedBy,
				}
				if err := s.bindings.Create(ctx, b); err != nil {
					outcomes = append(outcomes, batchRebindFail(seat.SeatID, activeVK.VirtualKeyID, fmt.Errorf("create binding: %w", err)))
					seatFailed = true
					break
				}
				// Write control event for new binding creation.
				s.writeBindingMutationEvent(ctx, OperationBindingCreated, p.OrgID, activeVK,
					b.BindingID, ref.ProtocolType, "", ref.CredentialID, p.UpdatedBy)
			}
		}
		if !seatFailed {
			outcomes = append(outcomes, BatchRebindOutcome{
				SeatID:       seat.SeatID,
				VirtualKeyID: activeVK.VirtualKeyID,
				Succeeded:    true,
			})
		}
	}
	return outcomes, nil
}

func batchRebindFail(seatID, vkID string, err error) BatchRebindOutcome {
	code := "SYS_INTERNAL"
	msg := "internal error"
	var de *shared.DomainError
	if errors.As(err, &de) {
		code = de.Code
		msg = de.Message
	}
	return BatchRebindOutcome{
		SeatID:       seatID,
		VirtualKeyID: vkID,
		Succeeded:    false,
		ErrorCode:    code,
		ErrorMessage: msg,
	}
}

// BatchSwitchCredentialParams carries input for switching all specified bindings to a new credential.
type BatchSwitchCredentialParams struct {
	OrgID            string
	BindingIDs       []string
	ToCredentialID   string
	UpdatedBy        string
}

// BatchSwitchCredentialOutcome is the per-binding result.
type BatchSwitchCredentialOutcome struct {
	BindingID    string `json:"binding_id"`
	Succeeded    bool   `json:"succeeded"`
	ErrorCode    string `json:"error_code,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
}

// BatchSwitchCredential migrates a list of bindings to a new credential.
// The new credential must share the same protocol_type as each binding.
// Failures are collected per-binding; they do NOT abort the batch.
func (s *Service) BatchSwitchCredential(ctx context.Context, p BatchSwitchCredentialParams) ([]BatchSwitchCredentialOutcome, error) {
	outcomes := make([]BatchSwitchCredentialOutcome, 0, len(p.BindingIDs))
	for _, bindingID := range p.BindingIDs {
		b, err := s.bindings.FindByID(ctx, bindingID)
		if err != nil || b == nil {
			outcomes = append(outcomes, batchSwitchFail(bindingID, shared.BizBindNotFound(bindingID)))
			continue
		}
		if b.OrgID != p.OrgID {
			outcomes = append(outcomes, batchSwitchFail(bindingID, shared.BizBindNotFound(bindingID)))
			continue
		}
		if err := s.validateProtocolMatch(ctx, p.ToCredentialID, b.ProtocolType); err != nil {
			outcomes = append(outcomes, batchSwitchFail(bindingID, err))
			continue
		}
		oldCredentialID := b.CredentialID
		if err := s.bindings.UpdateCredential(ctx, bindingID, p.ToCredentialID, p.UpdatedBy); err != nil {
			outcomes = append(outcomes, batchSwitchFail(bindingID, fmt.Errorf("update binding: %w", err)))
			continue
		}
		// Write control event for credential switch.
		if b.VirtualKeyID != nil {
			if vk, err := s.virtualKeys.FindByID(ctx, *b.VirtualKeyID); err == nil && vk != nil {
				s.writeBindingMutationEvent(ctx, OperationCredentialSwitched, p.OrgID, vk,
					bindingID, b.ProtocolType, oldCredentialID, p.ToCredentialID, p.UpdatedBy)
			}
		}
		outcomes = append(outcomes, BatchSwitchCredentialOutcome{BindingID: bindingID, Succeeded: true})
	}
	return outcomes, nil
}

func batchSwitchFail(bindingID string, err error) BatchSwitchCredentialOutcome {
	code := "SYS_INTERNAL"
	msg := "internal error"
	var de *shared.DomainError
	if errors.As(err, &de) {
		code = de.Code
		msg = de.Message
	}
	return BatchSwitchCredentialOutcome{
		BindingID:    bindingID,
		Succeeded:    false,
		ErrorCode:    code,
		ErrorMessage: msg,
	}
}

// ---- helpers ----

func (s *Service) getVirtualKey(ctx context.Context, id string) (*ManagedVirtualKey, error) {
	vk, err := s.virtualKeys.FindByID(ctx, id)
	if err != nil || vk == nil {
		return nil, shared.BizKeyNotFound(id)
	}
	return vk, nil
}

// validateProtocolMatch returns an error if the credential's provider protocol does not match
// the given protocolType. An empty response from GetProtocolType is treated as a match
// (e.g. credential not found) to avoid blocking operations when the lookup is unavailable.
func (s *Service) validateProtocolMatch(ctx context.Context, credentialID, protocolType string) error {
	credProtocol, err := s.credentialLookup.GetProtocolType(ctx, credentialID)
	if err != nil {
		return fmt.Errorf("lookup protocol for credential %s: %w", credentialID, err)
	}
	if credProtocol != "" && credProtocol != protocolType {
		return shared.BizBindProtocolMismatch(protocolType, credProtocol)
	}
	return nil
}

// firstBindingContext returns (providerID, credentialID, credRevision) from the first active
// binding for a virtual key. Used to populate provider context on lifecycle events that are
// not scoped to a specific binding. Returns empty strings if no binding is found.
func (s *Service) firstBindingContext(ctx context.Context, virtualKeyID string) (providerID, credentialID, credRevision string) {
	bindings, err := s.bindings.ListByVirtualKey(ctx, virtualKeyID)
	if err != nil || len(bindings) == 0 {
		return "", "", ""
	}
	for _, b := range bindings {
		if b.Status == BindingStatusActive {
			credentialID = b.CredentialID
			credRevision, _ = s.credentialLookup.GetRevision(ctx, credentialID)
			providerID, _ = s.credentialLookup.GetProviderID(ctx, credentialID)
			return
		}
	}
	return "", "", ""
}

// writeBindingMutationEvent writes a control event for batch binding mutations
// (rebind, create, credential switch). Best-effort: errors are logged but do not
// fail the batch operation, because the fact-table mutation already succeeded.
func (s *Service) writeBindingMutationEvent(
	ctx context.Context,
	changeType string,
	orgID string,
	vk *ManagedVirtualKey,
	bindingID, protocolType, oldCredentialID, newCredentialID, changedBy string,
) {
	oldRevision, _ := s.credentialLookup.GetRevision(ctx, oldCredentialID)
	newRevision, _ := s.credentialLookup.GetRevision(ctx, newCredentialID)
	providerID, _ := s.credentialLookup.GetProviderID(ctx, newCredentialID)

	beforeJSON, _ := json.Marshal(map[string]string{
		"virtual_key_id":      vk.VirtualKeyID,
		"binding_id":          bindingID,
		"protocol_type":       protocolType,
		"credential_id":       oldCredentialID,
		"credential_revision": oldRevision,
	})
	afterJSON, _ := json.Marshal(map[string]string{
		"virtual_key_id":      vk.VirtualKeyID,
		"binding_id":          bindingID,
		"protocol_type":       protocolType,
		"credential_id":       newCredentialID,
		"credential_revision": newRevision,
	})

	event := &ControlEvent{
		EventID:            shared.NewID(),
		OrgID:              orgID,
		ChangeSource:       "master_console",
		ChangeType:         changeType,
		EntityType:         "managed_provider_binding",
		EntityID:           bindingID,
		ProviderID:         providerID,
		SeatID:             vk.SeatID,
		VirtualKeyID:       vk.VirtualKeyID,
		VirtualKeyRevision: vk.CurrentRevision,
		BindingID:          bindingID,
		CredentialID:       newCredentialID,
		CredentialRevision: newRevision,
		Revision:           shared.NewRevision(),
		EffectiveFrom:      aikeytime.Now(),
		ChangedAt:          aikeytime.Now(),
		ChangedBy:          changedBy,
		BeforeSnapshotJSON: beforeJSON,
		AfterSnapshotJSON:  afterJSON,
	}
	// Best-effort: event insert failure does not roll back the already-committed
	// fact-table mutation. A missing event is less harmful than a failed batch item.
	_ = s.events.Insert(ctx, event)
}

func sha256Token(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// snapshotVirtualKey returns a minimal JSON-serializable snapshot of a virtual key.
// bindings is optional: when non-nil the initial binding refs are included (e.g. on issue).
func snapshotVirtualKey(vk *ManagedVirtualKey, bindings []IssueBindingRef) map[string]any {
	snap := map[string]any{
		"virtual_key_id":   vk.VirtualKeyID,
		"seat_id":          vk.SeatID,
		"current_revision": vk.CurrentRevision,
		"key_status":       vk.KeyStatus,
	}
	if bindings != nil {
		refs := make([]map[string]string, 0, len(bindings))
		for _, b := range bindings {
			refs = append(refs, map[string]string{
				"credential_id": b.CredentialID,
				"protocol_type": b.ProtocolType,
			})
		}
		snap["bindings"] = refs
	}
	return snap
}
