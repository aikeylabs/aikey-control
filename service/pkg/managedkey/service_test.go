package managedkey

import (
	"context"
	"testing"
)

// ---- minimal in-memory mocks ----

type memBindingRepo struct {
	bindings map[string]*ManagedProviderBinding
}

func newMemBindingRepo() *memBindingRepo {
	return &memBindingRepo{bindings: make(map[string]*ManagedProviderBinding)}
}

func (r *memBindingRepo) Create(_ context.Context, b *ManagedProviderBinding) error {
	r.bindings[b.BindingID] = b
	return nil
}
func (r *memBindingRepo) FindByID(_ context.Context, id string) (*ManagedProviderBinding, error) {
	return r.bindings[id], nil
}
func (r *memBindingRepo) ListByOrg(_ context.Context, orgID string) ([]*ManagedProviderBinding, error) {
	var out []*ManagedProviderBinding
	for _, b := range r.bindings {
		if b.OrgID == orgID {
			out = append(out, b)
		}
	}
	return out, nil
}
func (r *memBindingRepo) ListByVirtualKey(_ context.Context, virtualKeyID string) ([]*ManagedProviderBinding, error) {
	var out []*ManagedProviderBinding
	for _, b := range r.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == virtualKeyID {
			out = append(out, b)
		}
	}
	return out, nil
}
func (r *memBindingRepo) FindActiveByVirtualKeyAndProtocol(_ context.Context, virtualKeyID, protocolType string) ([]*ManagedProviderBinding, error) {
	var out []*ManagedProviderBinding
	for _, b := range r.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == virtualKeyID &&
			b.ProtocolType == protocolType && b.Status == BindingStatusActive {
			out = append(out, b)
		}
	}
	return out, nil
}
func (r *memBindingRepo) FindActiveByVirtualKeyProtocolAndProvider(_ context.Context, virtualKeyID, protocolType, providerID string) (*ManagedProviderBinding, error) {
	for _, b := range r.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == virtualKeyID &&
			b.ProtocolType == protocolType && b.ProviderID == providerID && b.Status == BindingStatusActive {
			return b, nil
		}
	}
	return nil, nil
}
func (r *memBindingRepo) UpdateCredential(_ context.Context, bindingID, credentialID, updatedBy string) error {
	if b := r.bindings[bindingID]; b != nil {
		b.CredentialID = credentialID
	}
	return nil
}
func (r *memBindingRepo) UpdateStatus(_ context.Context, bindingID, status string) error {
	if b := r.bindings[bindingID]; b != nil {
		b.Status = status
	}
	return nil
}

type memVirtualKeyRepo struct {
	keys        map[string]*ManagedVirtualKey
	// lastAnchors keyed by "virtualKeyID:bindingID" for per-binding anchor storage.
	lastAnchors map[string]AnchorTuple
}

func newMemVirtualKeyRepo() *memVirtualKeyRepo {
	return &memVirtualKeyRepo{
		keys:        make(map[string]*ManagedVirtualKey),
		lastAnchors: make(map[string]AnchorTuple),
	}
}

func anchorKey(virtualKeyID, bindingID string) string {
	return virtualKeyID + ":" + bindingID
}

func (r *memVirtualKeyRepo) Create(_ context.Context, vk *ManagedVirtualKey) error {
	r.keys[vk.VirtualKeyID] = vk
	return nil
}
func (r *memVirtualKeyRepo) FindByID(_ context.Context, id string) (*ManagedVirtualKey, error) {
	return r.keys[id], nil
}
func (r *memVirtualKeyRepo) FindByTokenHash(_ context.Context, hash string) (*ManagedVirtualKey, error) {
	for _, vk := range r.keys {
		if vk.TokenHash == hash {
			return vk, nil
		}
	}
	return nil, nil
}
func (r *memVirtualKeyRepo) ListByOrg(_ context.Context, orgID string) ([]*ManagedVirtualKey, error) {
	var out []*ManagedVirtualKey
	for _, vk := range r.keys {
		if vk.OrgID == orgID {
			out = append(out, vk)
		}
	}
	return out, nil
}
func (r *memVirtualKeyRepo) ListBySeat(_ context.Context, seatID string) ([]*ManagedVirtualKey, error) {
	var out []*ManagedVirtualKey
	for _, vk := range r.keys {
		if vk.SeatID == seatID {
			out = append(out, vk)
		}
	}
	return out, nil
}
func (r *memVirtualKeyRepo) ListPendingClaimBySeat(_ context.Context, seatID string) ([]*ManagedVirtualKey, error) {
	var out []*ManagedVirtualKey
	for _, vk := range r.keys {
		if vk.SeatID == seatID && vk.ShareStatus == ShareStatusPendingClaim {
			out = append(out, vk)
		}
	}
	return out, nil
}
func (r *memVirtualKeyRepo) UpdateStatus(_ context.Context, id, status, _ string) error {
	if vk := r.keys[id]; vk != nil {
		vk.KeyStatus = status
	}
	return nil
}
func (r *memVirtualKeyRepo) UpdateShareStatus(_ context.Context, id, shareStatus string) error {
	if vk := r.keys[id]; vk != nil {
		vk.ShareStatus = shareStatus
	}
	return nil
}
func (r *memVirtualKeyRepo) ReconcileShareStatusByEmail(_ context.Context, _ string) (int, error) {
	// In-memory mock: no org_seats join possible; return 0 for unit tests.
	return 0, nil
}
func (r *memVirtualKeyRepo) RecordDelivery(_ context.Context, id string) error {
	if vk := r.keys[id]; vk != nil {
		vk.DeliveryCount++
	}
	return nil
}
func (r *memVirtualKeyRepo) RotateToken(_ context.Context, id, newHash, newRevision, _ string) error {
	if vk := r.keys[id]; vk != nil {
		vk.TokenHash = newHash
		vk.CurrentRevision = newRevision
	}
	return nil
}
func (r *memVirtualKeyRepo) LastAnchorTuple(_ context.Context, virtualKeyID, bindingID string) (AnchorTuple, error) {
	return r.lastAnchors[anchorKey(virtualKeyID, bindingID)], nil
}

type memEventRepo struct {
	events []*ControlEvent
}

func (r *memEventRepo) Insert(_ context.Context, e *ControlEvent) error {
	r.events = append(r.events, e)
	return nil
}
func (r *memEventRepo) ListByOrg(_ context.Context, _ string) ([]*ControlEvent, error) {
	return r.events, nil
}
func (r *memEventRepo) ListByVirtualKey(_ context.Context, id string) ([]*ControlEvent, error) {
	var out []*ControlEvent
	for _, e := range r.events {
		if e.VirtualKeyID == id {
			out = append(out, e)
		}
	}
	return out, nil
}

type stubCredentialLookup struct {
	revision        string
	providerID      string
	protocolType    string
	// perCredProtocol overrides protocolType for specific credential IDs.
	perCredProtocol map[string]string
}

func (s *stubCredentialLookup) GetRevision(_ context.Context, _ string) (string, error) {
	return s.revision, nil
}
func (s *stubCredentialLookup) GetProviderID(_ context.Context, _ string) (string, error) {
	return s.providerID, nil
}
func (s *stubCredentialLookup) GetProtocolType(_ context.Context, credentialID string) (string, error) {
	if s.perCredProtocol != nil {
		if pt, ok := s.perCredProtocol[credentialID]; ok {
			return pt, nil
		}
	}
	return s.protocolType, nil
}

// ---- helpers ----

func newTestService() (*Service, *memBindingRepo, *memVirtualKeyRepo, *memEventRepo, *stubCredentialLookup) {
	bRepo := newMemBindingRepo()
	vkRepo := newMemVirtualKeyRepo()
	eRepo := &memEventRepo{}
	cLookup := &stubCredentialLookup{revision: "crev1", providerID: "prov1", protocolType: "openai_compatible"}
	svc := NewService(bRepo, vkRepo, eRepo, cLookup)
	return svc, bRepo, vkRepo, eRepo, cLookup
}

// seedVirtualKey issues a virtual key with one openai_compatible binding on cred-1.
func seedVirtualKey(t *testing.T, svc *Service) *ManagedVirtualKey {
	t.Helper()
	result, err := svc.IssueVirtualKey(context.Background(), IssueVirtualKeyParams{
		OrgID:  "org-1",
		SeatID: "seat-1",
		Alias:  "dev-key",
		Bindings: []IssueBindingRef{
			{CredentialID: "cred-1", ProtocolType: "openai_compatible", Alias: "default"},
		},
		IssuedBy: "admin",
	})
	if err != nil {
		t.Fatalf("IssueVirtualKey: %v", err)
	}
	return result.VirtualKey
}

// ---- tests ----

// Invariant 3.1: one virtual key → one seat_id.
func TestVirtualKey_SingleSeat(t *testing.T) {
	svc, _, vkRepo, _, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	stored := vkRepo.keys[vk.VirtualKeyID]
	if stored == nil {
		t.Fatal("virtual key not stored")
	}
	if stored.SeatID != "seat-1" {
		t.Errorf("seat_id = %q, want seat-1", stored.SeatID)
	}

	count := 0
	for _, k := range vkRepo.keys {
		if k.VirtualKeyID == vk.VirtualKeyID {
			count++
		}
	}
	if count != 1 {
		t.Errorf("expected 1 entry for virtual_key_id, got %d", count)
	}
}

// Invariant 3.3: one VK has exactly one binding per protocol after issue.
func TestVirtualKey_SingleBindingPerProtocol(t *testing.T) {
	svc, bRepo, _, _, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	bindings, err := bRepo.ListByVirtualKey(context.Background(), vk.VirtualKeyID)
	if err != nil {
		t.Fatalf("ListByVirtualKey: %v", err)
	}
	if len(bindings) != 1 {
		t.Errorf("expected 1 binding after issue, got %d", len(bindings))
	}
	if bindings[0].ProtocolType != "openai_compatible" {
		t.Errorf("binding protocol_type = %q, want openai_compatible", bindings[0].ProtocolType)
	}
	if bindings[0].CredentialID != "cred-1" {
		t.Errorf("binding credential_id = %q, want cred-1", bindings[0].CredentialID)
	}
	if bindings[0].VirtualKeyID == nil || *bindings[0].VirtualKeyID != vk.VirtualKeyID {
		t.Errorf("binding virtual_key_id mismatch, want %q", vk.VirtualKeyID)
	}
}

// Invariant: multi-protocol issue creates one binding per protocol.
func TestVirtualKey_MultiProtocolBindings(t *testing.T) {
	svc, bRepo, _, eRepo, cLookup := newTestService()
	// Configure per-credential protocol types so cred-2 is recognized as "anthropic".
	cLookup.perCredProtocol = map[string]string{
		"cred-1": "openai_compatible",
		"cred-2": "anthropic",
	}
	result, err := svc.IssueVirtualKey(context.Background(), IssueVirtualKeyParams{
		OrgID:  "org-1",
		SeatID: "seat-1",
		Alias:  "multi-key",
		Bindings: []IssueBindingRef{
			{CredentialID: "cred-1", ProtocolType: "openai_compatible"},
			{CredentialID: "cred-2", ProtocolType: "anthropic"},
		},
		IssuedBy: "admin",
	})
	if err != nil {
		t.Fatalf("IssueVirtualKey: %v", err)
	}
	vk := result.VirtualKey

	bindings, _ := bRepo.ListByVirtualKey(context.Background(), vk.VirtualKeyID)
	if len(bindings) != 2 {
		t.Errorf("expected 2 bindings, got %d", len(bindings))
	}
	// Issue generates exactly 1 lifecycle event (VK-level, not per-binding).
	if len(eRepo.events) != 1 {
		t.Errorf("expected 1 issue event, got %d", len(eRepo.events))
	}
}

// Invariant: duplicate protocol_type in IssueVirtualKeyParams is rejected.
func TestVirtualKey_DuplicateProtocolRejected(t *testing.T) {
	svc, _, _, _, _ := newTestService()
	_, err := svc.IssueVirtualKey(context.Background(), IssueVirtualKeyParams{
		OrgID:  "org-1",
		SeatID: "seat-1",
		Alias:  "dup-key",
		Bindings: []IssueBindingRef{
			{CredentialID: "cred-1", ProtocolType: "openai_compatible"},
			{CredentialID: "cred-2", ProtocolType: "openai_compatible"}, // duplicate
		},
		IssuedBy: "admin",
	})
	if err == nil {
		t.Error("expected error for duplicate protocol_type, got nil")
	}
}

// Lifecycle operations (issue, revoke, claim) MUST always write control events.
func TestLifecycle_AlwaysWritesControlEvent(t *testing.T) {
	// Issue: writes virtual_key_issued event.
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)
	if len(eRepo.events) != 1 {
		t.Errorf("issue wrote %d event(s), expected 1", len(eRepo.events))
	} else if eRepo.events[0].ChangeType != OperationVirtualKeyIssued {
		t.Errorf("issue event type = %q, want %q", eRepo.events[0].ChangeType, OperationVirtualKeyIssued)
	}
	// Lifecycle issue event has no specific binding.
	if eRepo.events[0].BindingID != "" {
		t.Errorf("issue event should have empty binding_id, got %q", eRepo.events[0].BindingID)
	}

	// Revoke: writes virtual_key_revoked event.
	if err := svc.RevokeVirtualKey(context.Background(), vk.VirtualKeyID, "admin"); err != nil {
		t.Fatalf("RevokeVirtualKey: %v", err)
	}
	if len(eRepo.events) != 2 {
		t.Errorf("after revoke: %d event(s), expected 2", len(eRepo.events))
	} else if eRepo.events[1].ChangeType != OperationVirtualKeyRevoked {
		t.Errorf("revoke event type = %q, want %q", eRepo.events[1].ChangeType, OperationVirtualKeyRevoked)
	}

	// Claim: writes virtual_key_claimed event.
	svc2, _, _, eRepo2, _ := newTestService()
	res, err := svc2.IssueVirtualKey(context.Background(), IssueVirtualKeyParams{
		OrgID:  "org-1",
		SeatID: "seat-1",
		Alias:  "dev-key",
		Bindings: []IssueBindingRef{
			{CredentialID: "cred-1", ProtocolType: "openai_compatible"},
		},
		IssuedBy: "admin",
	})
	if err != nil {
		t.Fatalf("IssueVirtualKey: %v", err)
	}
	if err := svc2.ClaimVirtualKey(context.Background(), res.VirtualKey.VirtualKeyID); err != nil {
		t.Fatalf("ClaimVirtualKey: %v", err)
	}
	if len(eRepo2.events) != 2 {
		t.Errorf("after claim: %d event(s), expected 2 (issue + claim)", len(eRepo2.events))
	} else if eRepo2.events[1].ChangeType != OperationVirtualKeyClaimed {
		t.Errorf("claim event type = %q, want %q", eRepo2.events[1].ChangeType, OperationVirtualKeyClaimed)
	}
}

// Invariant 3.3: virtual_key_rotation with anchor change MUST write a control event per binding.
func TestVirtualKeyRotation_WritesEvent_WhenAnchorChanges(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID:  vk.VirtualKeyID,
		CorrelationID: "corr-1",
		ChangedBy:     "admin",
		Reason:        "scheduled rotation",
	})
	if err != nil {
		t.Fatalf("RotateVirtualKey: %v", err)
	}
	// seedVirtualKey writes 1 issue event; rotation adds 1 more (one per binding).
	if len(eRepo.events) != 2 {
		t.Errorf("expected 2 control events (issue + rotation), got %d", len(eRepo.events))
	}
	ev := eRepo.events[len(eRepo.events)-1]
	if ev.ChangeType != OperationVirtualKeyRotation {
		t.Errorf("rotation event change_type = %q, want %q", ev.ChangeType, OperationVirtualKeyRotation)
	}
	// Rotation event must carry a specific binding_id.
	if ev.BindingID == "" {
		t.Error("rotation event must have a non-empty binding_id")
	}
}

// Invariant 3.3: virtual_key_rotation with NO anchor change must NOT write an event.
func TestVirtualKeyRotation_NoEvent_WhenAnchorUnchanged(t *testing.T) {
	if shouldAppendControlEvent(OperationVirtualKeyRotation,
		AnchorTuple{VirtualKeyID: "x", SeatID: "s", BindingID: "b",
			CredentialID: "c", VirtualKeyRevision: "r", CredentialRevision: "cr"},
		AnchorTuple{VirtualKeyID: "x", SeatID: "s", BindingID: "b",
			CredentialID: "c", VirtualKeyRevision: "r", CredentialRevision: "cr"},
	) {
		t.Error("identical anchor tuples must not trigger event write")
	}
}

// Invariant 3.3: credential_rotation with anchor change MUST write events for affected bindings.
func TestCredentialRotation_WritesEvent_WhenAnchorChanges(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)
	_ = vk

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID:  "cred-1",
		OrgID:         "org-1",
		NewRevision:   "crev2",
		OldRevision:   "crev1",
		CorrelationID: "corr-2",
		ChangedBy:     "admin",
		Reason:        "key compromise",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}
	// Expect: 1 issue event + at least 1 credential_rotation event.
	if len(eRepo.events) < 2 {
		t.Errorf("expected at least 2 events (issue + rotation), got %d", len(eRepo.events))
	}
	for _, ev := range eRepo.events {
		if ev.ChangeType == OperationVirtualKeyIssued {
			continue
		}
		if ev.ChangeType != OperationCredentialRotation {
			t.Errorf("unexpected event change_type = %q, want %q", ev.ChangeType, OperationCredentialRotation)
		}
	}
}
