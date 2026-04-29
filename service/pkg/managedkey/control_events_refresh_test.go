package managedkey

import (
	"context"
	"errors"
	"testing"
)

// =============================================================================
// Test: managed_key_control_events table refresh on tuple relationship changes
// and virtual key rotation.
//
// Tuple: (seat_id, binding_id, credential_id)
//
// Covered scenarios:
//   - Virtual key rotation triggers events per binding
//   - Credential rotation triggers events for affected bindings
//   - Credential migration triggers events (unconditional lifecycle)
//   - Batch rebind / batch switch write mutation events
//   - Multi-protocol bindings: independent per-binding events
//   - Edge cases: no bindings, revoked VK, retired bindings, org-level templates
//   - Error injection: repo failures
//   - Idempotency: repeated rotation with no anchor diff
// =============================================================================

// --- helpers ---

// seedMultiProtocolVK issues a VK with two bindings (openai_compatible + anthropic).
func seedMultiProtocolVK(t *testing.T, svc *Service, cLookup *stubCredentialLookup) *ManagedVirtualKey {
	t.Helper()
	cLookup.perCredProtocol = map[string]string{
		"cred-1": "openai_compatible",
		"cred-2": "anthropic",
	}
	result, err := svc.IssueVirtualKey(context.Background(), IssueVirtualKeyParams{
		OrgID:  "org-1",
		SeatID: "seat-1",
		Alias:  "multi-key",
		Bindings: []IssueBindingRef{
			{CredentialID: "cred-1", ProtocolType: "openai_compatible", Alias: "openai"},
			{CredentialID: "cred-2", ProtocolType: "anthropic", Alias: "anthropic"},
		},
		IssuedBy: "admin",
	})
	if err != nil {
		t.Fatalf("seedMultiProtocolVK: %v", err)
	}
	return result.VirtualKey
}

// countEventsByType returns the number of events with the given change_type.
func countEventsByType(events []*ControlEvent, changeType string) int {
	n := 0
	for _, e := range events {
		if e.ChangeType == changeType {
			n++
		}
	}
	return n
}

// --- errRepo: an event repo that returns errors ---

type errEventRepo struct {
	insertErr error
}

func (r *errEventRepo) Insert(_ context.Context, _ *ControlEvent) error   { return r.insertErr }
func (r *errEventRepo) ListByOrg(_ context.Context, _ string) ([]*ControlEvent, error) {
	return nil, nil
}
func (r *errEventRepo) ListByVirtualKey(_ context.Context, _ string) ([]*ControlEvent, error) {
	return nil, nil
}

// =============================================================================
// 1. Virtual key rotation
// =============================================================================

// VK rotation with a single binding must produce exactly one rotation event.
func TestVKRotation_SingleBinding_WritesOneEvent(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)
	beforeCount := len(eRepo.events)

	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID:  vk.VirtualKeyID,
		CorrelationID: "corr-rot-1",
		ChangedBy:     "admin",
		Reason:        "scheduled",
	})
	if err != nil {
		t.Fatalf("RotateVirtualKey: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationVirtualKeyRotation)
	if rotEvents != 1 {
		t.Errorf("expected 1 rotation event, got %d", rotEvents)
	}

	ev := eRepo.events[len(eRepo.events)-1]
	if ev.BindingID == "" {
		t.Error("rotation event must have non-empty binding_id")
	}
	if ev.VirtualKeyID != vk.VirtualKeyID {
		t.Errorf("event.VirtualKeyID = %q, want %q", ev.VirtualKeyID, vk.VirtualKeyID)
	}
	if ev.SeatID != "seat-1" {
		t.Errorf("event.SeatID = %q, want seat-1", ev.SeatID)
	}
	if ev.CorrelationID != "corr-rot-1" {
		t.Errorf("event.CorrelationID = %q, want corr-rot-1", ev.CorrelationID)
	}
}

// VK rotation with multi-protocol bindings must produce one event PER active binding.
func TestVKRotation_MultiProtocol_WritesEventPerBinding(t *testing.T) {
	svc, _, _, eRepo, cLookup := newTestService()
	vk := seedMultiProtocolVK(t, svc, cLookup)
	beforeCount := len(eRepo.events)

	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vk.VirtualKeyID,
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("RotateVirtualKey: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationVirtualKeyRotation)
	if rotEvents != 2 {
		t.Errorf("expected 2 rotation events (one per binding), got %d", rotEvents)
	}

	// Verify each event has a distinct binding_id.
	bindingIDs := make(map[string]bool)
	for _, ev := range eRepo.events[beforeCount:] {
		if ev.ChangeType == OperationVirtualKeyRotation {
			bindingIDs[ev.BindingID] = true
		}
	}
	if len(bindingIDs) != 2 {
		t.Errorf("expected 2 distinct binding_ids in rotation events, got %d", len(bindingIDs))
	}
}

// Consecutive rotations must each produce new events (revision changes every time).
func TestVKRotation_Consecutive_WritesNewEvents(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	for i := 0; i < 3; i++ {
		result, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
			VirtualKeyID: vk.VirtualKeyID,
			ChangedBy:    "admin",
		})
		if err != nil {
			t.Fatalf("rotation %d: %v", i, err)
		}
		vk = result.VirtualKey
	}

	rotEvents := countEventsByType(eRepo.events, OperationVirtualKeyRotation)
	if rotEvents != 3 {
		t.Errorf("expected 3 rotation events after 3 rotations, got %d", rotEvents)
	}

	// Verify all rotation events have distinct revisions.
	revisions := make(map[string]bool)
	for _, ev := range eRepo.events {
		if ev.ChangeType == OperationVirtualKeyRotation {
			revisions[ev.VirtualKeyRevision] = true
		}
	}
	if len(revisions) != 3 {
		t.Errorf("expected 3 distinct virtual_key_revisions, got %d", len(revisions))
	}
}

// Rotation on a VK with NO active bindings produces no rotation events.
func TestVKRotation_NoBindings_NoEvent(t *testing.T) {
	svc, bRepo, vkRepo, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	// Retire all bindings.
	for _, b := range bRepo.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == vk.VirtualKeyID {
			b.Status = BindingStatusRetired
		}
	}

	// Clear anchors so the only factor is the empty binding list.
	vkRepo.lastAnchors = make(map[string]AnchorTuple)
	beforeCount := len(eRepo.events)

	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vk.VirtualKeyID,
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("RotateVirtualKey: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationVirtualKeyRotation)
	if rotEvents != 0 {
		t.Errorf("expected 0 rotation events when no active bindings, got %d", rotEvents)
	}
}

// Rotation on a revoked VK: current implementation does NOT check KeyStatus before rotating.
// RotateVirtualKey only checks existence via getVirtualKey. If bindings are still active,
// rotation events will be written.
//
// NOTE: This test documents current behavior. If a KeyStatus guard is added to
// RotateVirtualKey in the future, this test should be updated to expect an error.
func TestVKRotation_RevokedVK_StillRotates(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	if err := svc.RevokeVirtualKey(context.Background(), vk.VirtualKeyID, "admin"); err != nil {
		t.Fatalf("RevokeVirtualKey: %v", err)
	}
	beforeCount := len(eRepo.events)

	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vk.VirtualKeyID,
		ChangedBy:    "admin",
	})
	// Currently succeeds — no KeyStatus guard in RotateVirtualKey.
	if err != nil {
		t.Fatalf("RotateVirtualKey on revoked VK: %v (unexpected — no guard exists yet)", err)
	}
	// Since bindings are still active, rotation events are written.
	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationVirtualKeyRotation)
	if rotEvents == 0 {
		t.Log("NOTE: no rotation events written for revoked VK — KeyStatus guard may have been added")
	}
}

// Rotation event must carry the updated VirtualKeyRevision, not the old one.
func TestVKRotation_EventCarriesNewRevision(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)
	oldRevision := vk.CurrentRevision

	result, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vk.VirtualKeyID,
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("RotateVirtualKey: %v", err)
	}
	newRevision := result.VirtualKey.CurrentRevision
	if newRevision == oldRevision {
		t.Fatal("rotation did not change revision")
	}

	// Find the rotation event.
	for _, ev := range eRepo.events {
		if ev.ChangeType == OperationVirtualKeyRotation {
			if ev.VirtualKeyRevision != newRevision {
				t.Errorf("rotation event VirtualKeyRevision = %q, want %q (new)", ev.VirtualKeyRevision, newRevision)
			}
		}
	}
}

// =============================================================================
// 2. Credential rotation
// =============================================================================

// Credential rotation triggers events for all per-VK active bindings using that credential.
func TestCredRotation_AffectedBindings_WritesEvents(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc) // binds cred-1 to one VK
	beforeCount := len(eRepo.events)

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID:  "cred-1",
		OrgID:         "org-1",
		NewRevision:   "crev2",
		OldRevision:   "crev1",
		CorrelationID: "corr-cr-1",
		ChangedBy:     "provider-svc",
		Reason:        "key compromise",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialRotation)
	if rotEvents < 1 {
		t.Errorf("expected at least 1 credential_rotation event, got %d", rotEvents)
	}

	// Verify event fields.
	for _, ev := range eRepo.events[beforeCount:] {
		if ev.ChangeType != OperationCredentialRotation {
			continue
		}
		if ev.CredentialRevision != "crev2" {
			t.Errorf("event CredentialRevision = %q, want crev2", ev.CredentialRevision)
		}
		if ev.BindingID == "" {
			t.Error("credential rotation event must have non-empty binding_id")
		}
	}
}

// Credential rotation on a credential NOT referenced by any binding produces no events.
func TestCredRotation_UnrelatedCredential_NoEvent(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc) // binds cred-1
	beforeCount := len(eRepo.events)

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-999",
		OrgID:        "org-1",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialRotation)
	if rotEvents != 0 {
		t.Errorf("expected 0 events for unrelated credential, got %d", rotEvents)
	}
}

// Credential rotation skips retired bindings.
func TestCredRotation_RetiredBinding_SkipsEvent(t *testing.T) {
	svc, bRepo, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	// Retire the binding.
	for _, b := range bRepo.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == vk.VirtualKeyID {
			b.Status = BindingStatusRetired
		}
	}
	beforeCount := len(eRepo.events)

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialRotation)
	if rotEvents != 0 {
		t.Errorf("expected 0 events for retired binding, got %d", rotEvents)
	}
}

// Credential rotation skips org-level template bindings (VirtualKeyID = nil).
func TestCredRotation_OrgLevelTemplate_SkipsEvent(t *testing.T) {
	svc, bRepo, _, eRepo, _ := newTestService()
	// Create an org-level template binding (no VK).
	bRepo.bindings["tmpl-1"] = &ManagedProviderBinding{
		BindingID:    "tmpl-1",
		OrgID:        "org-1",
		VirtualKeyID: nil, // org-level template
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}
	beforeCount := len(eRepo.events)

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialRotation)
	if rotEvents != 0 {
		t.Errorf("expected 0 events for org-level template, got %d", rotEvents)
	}
}

// Credential rotation skips bindings whose VK is revoked.
func TestCredRotation_RevokedVK_SkipsEvent(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	if err := svc.RevokeVirtualKey(context.Background(), vk.VirtualKeyID, "admin"); err != nil {
		t.Fatalf("RevokeVirtualKey: %v", err)
	}
	beforeCount := len(eRepo.events)

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialRotation)
	if rotEvents != 0 {
		t.Errorf("expected 0 events when VK is revoked, got %d", rotEvents)
	}
}

// Credential rotation with same revision (no anchor diff) should skip events
// when there is a matching prior anchor.
func TestCredRotation_SameRevision_NoEvent(t *testing.T) {
	svc, bRepo, vkRepo, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	// Find the binding and plant an anchor that matches the "new" revision.
	for _, b := range bRepo.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == vk.VirtualKeyID {
			vkRepo.lastAnchors[anchorKey(vk.VirtualKeyID, b.BindingID)] = AnchorTuple{
				VirtualKeyID:       vk.VirtualKeyID,
				SeatID:             vk.SeatID,
				BindingID:          b.BindingID,
				CredentialID:       b.CredentialID,
				VirtualKeyRevision: vk.CurrentRevision,
				CredentialRevision: "crev1", // same as NewRevision below
			}
		}
	}
	beforeCount := len(eRepo.events)

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev1", // same as existing anchor
		OldRevision:  "crev0",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialRotation)
	if rotEvents != 0 {
		t.Errorf("expected 0 events when anchor is unchanged, got %d", rotEvents)
	}
}

// Credential rotation with multi-protocol: only bindings using that credential fire events.
func TestCredRotation_MultiProtocol_OnlyAffectedBindings(t *testing.T) {
	svc, _, _, eRepo, cLookup := newTestService()
	_ = seedMultiProtocolVK(t, svc, cLookup) // cred-1=openai, cred-2=anthropic
	beforeCount := len(eRepo.events)

	// Rotate cred-1 only; cred-2 bindings should not be affected.
	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev-new",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialRotation)
	if rotEvents != 1 {
		t.Errorf("expected 1 credential_rotation event (only cred-1 binding), got %d", rotEvents)
	}
}

// =============================================================================
// 3. Credential migration (tuple change: credential_id changes on binding)
// =============================================================================

// MigrateCredential produces credential_migrated events for each affected per-VK binding.
func TestMigrateCredential_WritesEvents(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc) // binds cred-1 via openai_compatible
	beforeCount := len(eRepo.events)

	err := svc.MigrateCredential(context.Background(), MigrateCredentialParams{
		OrgID:            "org-1",
		FromCredentialID: "cred-1",
		ToCredentialID:   "cred-new",
		UpdatedBy:        "admin",
	})
	if err != nil {
		t.Fatalf("MigrateCredential: %v", err)
	}

	migEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialMigrated)
	if migEvents != 1 {
		t.Errorf("expected 1 credential_migrated event, got %d", migEvents)
	}

	// Verify the event carries the new credential_id.
	for _, ev := range eRepo.events[beforeCount:] {
		if ev.ChangeType == OperationCredentialMigrated {
			if ev.CredentialID != "cred-new" {
				t.Errorf("migration event CredentialID = %q, want cred-new", ev.CredentialID)
			}
			if ev.BindingID == "" {
				t.Error("migration event should carry binding_id")
			}
		}
	}
}

// MigrateCredential skips org-level template bindings (VirtualKeyID = nil).
func TestMigrateCredential_SkipsOrgTemplates(t *testing.T) {
	svc, bRepo, _, eRepo, _ := newTestService()
	bRepo.bindings["tmpl-1"] = &ManagedProviderBinding{
		BindingID:    "tmpl-1",
		OrgID:        "org-1",
		VirtualKeyID: nil,
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}
	beforeCount := len(eRepo.events)

	err := svc.MigrateCredential(context.Background(), MigrateCredentialParams{
		OrgID:            "org-1",
		FromCredentialID: "cred-1",
		ToCredentialID:   "cred-new",
		UpdatedBy:        "admin",
	})
	if err != nil {
		t.Fatalf("MigrateCredential: %v", err)
	}

	migEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialMigrated)
	if migEvents != 0 {
		t.Errorf("expected 0 migration events for org-level template, got %d", migEvents)
	}
}

// MigrateCredential skips bindings whose VK is revoked.
func TestMigrateCredential_SkipsRevokedVK(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	if err := svc.RevokeVirtualKey(context.Background(), vk.VirtualKeyID, "admin"); err != nil {
		t.Fatalf("RevokeVirtualKey: %v", err)
	}
	beforeCount := len(eRepo.events)

	err := svc.MigrateCredential(context.Background(), MigrateCredentialParams{
		OrgID:            "org-1",
		FromCredentialID: "cred-1",
		ToCredentialID:   "cred-new",
		UpdatedBy:        "admin",
	})
	if err != nil {
		t.Fatalf("MigrateCredential: %v", err)
	}

	migEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialMigrated)
	if migEvents != 0 {
		t.Errorf("expected 0 migration events for revoked VK, got %d", migEvents)
	}
}

// MigrateCredential is a lifecycle operation — it's unconditional (no anchor-diff gating).
func TestMigrateCredential_NoAnchorDiffGating(t *testing.T) {
	if !shouldAppendControlEvent(OperationCredentialMigrated,
		AnchorTuple{VirtualKeyID: "x", SeatID: "s", BindingID: "b",
			CredentialID: "c", VirtualKeyRevision: "r", CredentialRevision: "cr"},
		AnchorTuple{VirtualKeyID: "x", SeatID: "s", BindingID: "b",
			CredentialID: "c", VirtualKeyRevision: "r", CredentialRevision: "cr"},
	) {
		t.Error("credential_migrated is a lifecycle operation and must always return true")
	}
}

// =============================================================================
// 4. Batch rebind — binding_rebound and binding_created events
// =============================================================================

// BatchRebindSeats swapping credential on existing binding writes binding_rebound event.
func TestBatchRebind_ExistingBinding_WritesReboundEvent(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc) // seat-1, cred-1, openai_compatible
	beforeCount := len(eRepo.events)

	outcomes, err := svc.BatchRebindSeats(context.Background(), BatchRebindParams{
		OrgID: "org-1",
		Seats: []BatchRebindSeat{
			{SeatID: "seat-1", Bindings: []IssueBindingRef{
				{CredentialID: "cred-new", ProtocolType: "openai_compatible"},
			}},
		},
		UpdatedBy: "admin",
	})
	if err != nil {
		t.Fatalf("BatchRebindSeats: %v", err)
	}
	if len(outcomes) != 1 || !outcomes[0].Succeeded {
		t.Fatalf("expected 1 successful outcome, got %+v", outcomes)
	}

	reboundEvents := countEventsByType(eRepo.events[beforeCount:], OperationBindingRebound)
	if reboundEvents != 1 {
		t.Errorf("expected 1 binding_rebound event, got %d", reboundEvents)
	}

	// Verify the event captures old → new credential.
	for _, ev := range eRepo.events[beforeCount:] {
		if ev.ChangeType == OperationBindingRebound {
			if ev.CredentialID != "cred-new" {
				t.Errorf("rebound event CredentialID = %q, want cred-new", ev.CredentialID)
			}
			if ev.SeatID != "seat-1" {
				t.Errorf("rebound event SeatID = %q, want seat-1", ev.SeatID)
			}
		}
	}
}

// BatchRebindSeats with a new protocol creates a binding and writes binding_created event.
func TestBatchRebind_NewProtocol_WritesCreatedEvent(t *testing.T) {
	svc, _, _, eRepo, cLookup := newTestService()
	_ = seedVirtualKey(t, svc) // only openai_compatible
	cLookup.perCredProtocol = map[string]string{
		"cred-1":   "openai_compatible",
		"cred-ant": "anthropic",
	}
	beforeCount := len(eRepo.events)

	outcomes, err := svc.BatchRebindSeats(context.Background(), BatchRebindParams{
		OrgID: "org-1",
		Seats: []BatchRebindSeat{
			{SeatID: "seat-1", Bindings: []IssueBindingRef{
				{CredentialID: "cred-ant", ProtocolType: "anthropic"},
			}},
		},
		UpdatedBy: "admin",
	})
	if err != nil {
		t.Fatalf("BatchRebindSeats: %v", err)
	}
	if len(outcomes) != 1 || !outcomes[0].Succeeded {
		t.Fatalf("expected 1 successful outcome, got %+v", outcomes)
	}

	createdEvents := countEventsByType(eRepo.events[beforeCount:], OperationBindingCreated)
	if createdEvents != 1 {
		t.Errorf("expected 1 binding_created event, got %d", createdEvents)
	}
}

// =============================================================================
// 5. Batch switch credential — credential_switched event
// =============================================================================

func TestBatchSwitchCredential_WritesEvents(t *testing.T) {
	svc, bRepo, _, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc)

	// Find the binding ID.
	var bindingID string
	for _, b := range bRepo.bindings {
		bindingID = b.BindingID
		break
	}
	beforeCount := len(eRepo.events)

	outcomes, err := svc.BatchSwitchCredential(context.Background(), BatchSwitchCredentialParams{
		OrgID:          "org-1",
		BindingIDs:     []string{bindingID},
		ToCredentialID: "cred-switched",
		UpdatedBy:      "admin",
	})
	if err != nil {
		t.Fatalf("BatchSwitchCredential: %v", err)
	}
	if len(outcomes) != 1 || !outcomes[0].Succeeded {
		t.Fatalf("expected 1 successful outcome, got %+v", outcomes)
	}

	switchEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialSwitched)
	if switchEvents != 1 {
		t.Errorf("expected 1 credential_switched event, got %d", switchEvents)
	}

	for _, ev := range eRepo.events[beforeCount:] {
		if ev.ChangeType == OperationCredentialSwitched {
			if ev.CredentialID != "cred-switched" {
				t.Errorf("switch event CredentialID = %q, want cred-switched", ev.CredentialID)
			}
		}
	}
}

// BatchSwitchCredential on org-level template binding (VirtualKeyID=nil) should NOT write event.
func TestBatchSwitchCredential_OrgTemplate_NoEvent(t *testing.T) {
	svc, bRepo, _, eRepo, _ := newTestService()
	bRepo.bindings["tmpl-1"] = &ManagedProviderBinding{
		BindingID:    "tmpl-1",
		OrgID:        "org-1",
		VirtualKeyID: nil,
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}
	beforeCount := len(eRepo.events)

	outcomes, err := svc.BatchSwitchCredential(context.Background(), BatchSwitchCredentialParams{
		OrgID:          "org-1",
		BindingIDs:     []string{"tmpl-1"},
		ToCredentialID: "cred-switched",
		UpdatedBy:      "admin",
	})
	if err != nil {
		t.Fatalf("BatchSwitchCredential: %v", err)
	}
	if !outcomes[0].Succeeded {
		t.Fatalf("expected success, got %+v", outcomes[0])
	}

	switchEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialSwitched)
	if switchEvents != 0 {
		t.Errorf("expected 0 credential_switched events for org template, got %d", switchEvents)
	}
}

// =============================================================================
// 6. Lifecycle events carry correct seat_id in the tuple
// =============================================================================

func TestLifecycleEvents_CarrySeatID(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	// Issue event.
	issueEv := eRepo.events[0]
	if issueEv.SeatID != "seat-1" {
		t.Errorf("issue event SeatID = %q, want seat-1", issueEv.SeatID)
	}
	if issueEv.VirtualKeyID != vk.VirtualKeyID {
		t.Errorf("issue event VirtualKeyID mismatch")
	}

	// Revoke event.
	_ = svc.RevokeVirtualKey(context.Background(), vk.VirtualKeyID, "admin")
	revokeEv := eRepo.events[len(eRepo.events)-1]
	if revokeEv.SeatID != "seat-1" {
		t.Errorf("revoke event SeatID = %q, want seat-1", revokeEv.SeatID)
	}
}

// =============================================================================
// 7. Event field completeness: every event must have org_id, entity_type, entity_id
// =============================================================================

func TestAllEvents_HaveRequiredFields(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	// Generate a mix of events: issue, rotation, revoke.
	_, _ = svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vk.VirtualKeyID,
		ChangedBy:    "admin",
	})
	_ = svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})

	for i, ev := range eRepo.events {
		if ev.EventID == "" {
			t.Errorf("event[%d] missing EventID", i)
		}
		if ev.OrgID == "" {
			t.Errorf("event[%d] missing OrgID", i)
		}
		if ev.ChangeType == "" {
			t.Errorf("event[%d] missing ChangeType", i)
		}
		if ev.EntityType == "" {
			t.Errorf("event[%d] missing EntityType", i)
		}
		if ev.EntityID == "" {
			t.Errorf("event[%d] missing EntityID", i)
		}
		if ev.VirtualKeyID == "" {
			t.Errorf("event[%d] missing VirtualKeyID", i)
		}
		if ev.SeatID == "" {
			t.Errorf("event[%d] missing SeatID", i)
		}
		if ev.Revision == "" {
			t.Errorf("event[%d] missing Revision", i)
		}
		if ev.ChangedBy == "" {
			t.Errorf("event[%d] missing ChangedBy", i)
		}
	}
}

// =============================================================================
// 8. Anchor-diff edge cases
// =============================================================================

// Both VK revision AND credential revision change simultaneously — still one event per binding.
func TestAnchorDiff_BothRevisionsChange(t *testing.T) {
	prev := AnchorTuple{
		VirtualKeyID: "vk1", SeatID: "s1", BindingID: "b1",
		CredentialID: "c1", VirtualKeyRevision: "v1", CredentialRevision: "c1",
	}
	curr := AnchorTuple{
		VirtualKeyID: "vk1", SeatID: "s1", BindingID: "b1",
		CredentialID: "c1", VirtualKeyRevision: "v2", CredentialRevision: "c2",
	}
	if !shouldAppendControlEvent(OperationVirtualKeyRotation, prev, curr) {
		t.Error("both revision fields changed — event must be written")
	}
	if !shouldAppendControlEvent(OperationCredentialRotation, prev, curr) {
		t.Error("both revision fields changed — event must be written")
	}
}

// Zero-value prev (first rotation after issue) always triggers event.
func TestAnchorDiff_ZeroPrev_AlwaysTriggers(t *testing.T) {
	curr := AnchorTuple{
		VirtualKeyID: "vk1", SeatID: "s1", BindingID: "b1",
		CredentialID: "c1", VirtualKeyRevision: "v1", CredentialRevision: "c1",
	}
	for _, op := range []string{OperationVirtualKeyRotation, OperationCredentialRotation} {
		if !shouldAppendControlEvent(op, AnchorTuple{}, curr) {
			t.Errorf("op=%s: zero prev must trigger event", op)
		}
	}
}

// Unknown operation types return false (safety catch).
func TestAnchorDiff_UnknownOperation_ReturnsFalse(t *testing.T) {
	changed := AnchorTuple{VirtualKeyID: "vk1", SeatID: "s1"}
	if shouldAppendControlEvent("unknown_op", AnchorTuple{}, changed) {
		t.Error("unknown operation must return false")
	}
	if shouldAppendControlEvent("", AnchorTuple{}, changed) {
		t.Error("empty operation must return false")
	}
}

// Binding mutation operations (rebound, created, switched) are NOT in shouldAppendControlEvent.
// They're written unconditionally via writeBindingMutationEvent, not through the anchor-diff path.
func TestAnchorDiff_BindingMutationOps_ReturnFalse(t *testing.T) {
	prev := AnchorTuple{VirtualKeyID: "vk1", SeatID: "s1", BindingID: "b1",
		CredentialID: "c1", VirtualKeyRevision: "r1", CredentialRevision: "cr1"}
	curr := AnchorTuple{VirtualKeyID: "vk1", SeatID: "s1", BindingID: "b1",
		CredentialID: "c2", VirtualKeyRevision: "r1", CredentialRevision: "cr1"}

	for _, op := range []string{OperationBindingRebound, OperationBindingCreated, OperationCredentialSwitched} {
		if shouldAppendControlEvent(op, prev, curr) {
			t.Errorf("op=%s should not go through anchor-diff path, but returned true", op)
		}
	}
}

// =============================================================================
// 9. Error handling
// =============================================================================

// Event repo failure during VK rotation propagates error.
func TestVKRotation_EventInsertFailure_ReturnsError(t *testing.T) {
	bRepo := newMemBindingRepo()
	vkRepo := newMemVirtualKeyRepo()
	eRepo := &errEventRepo{insertErr: errors.New("db connection lost")}
	cLookup := &stubCredentialLookup{revision: "crev1", providerID: "prov1", protocolType: "openai_compatible"}

	// We need to manually set up a VK + binding since we can't use seedVirtualKey
	// (it calls IssueVirtualKey which inserts an event — that will fail).
	vkID := "vk-err-test"
	bID := "b-err-test"
	vkRepo.keys[vkID] = &ManagedVirtualKey{
		VirtualKeyID:    vkID,
		OrgID:           "org-1",
		SeatID:          "seat-1",
		TokenHash:       "hash1",
		CurrentRevision: "rev1",
		KeyStatus:       VirtualKeyStatusActive,
		ShareStatus:     ShareStatusClaimed,
	}
	bRepo.bindings[bID] = &ManagedProviderBinding{
		BindingID:    bID,
		OrgID:        "org-1",
		VirtualKeyID: &vkID,
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}

	svc := NewService(bRepo, vkRepo, eRepo, cLookup)
	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vkID,
		ChangedBy:    "admin",
	})
	if err == nil {
		t.Error("expected error when event insert fails, got nil")
	}
}

// Event repo failure during credential rotation propagates error.
func TestCredRotation_EventInsertFailure_ReturnsError(t *testing.T) {
	bRepo := newMemBindingRepo()
	vkRepo := newMemVirtualKeyRepo()
	eRepo := &errEventRepo{insertErr: errors.New("db connection lost")}
	cLookup := &stubCredentialLookup{revision: "crev1", providerID: "prov1", protocolType: "openai_compatible"}

	vkID := "vk-err-test"
	bID := "b-err-test"
	vkRepo.keys[vkID] = &ManagedVirtualKey{
		VirtualKeyID:    vkID,
		OrgID:           "org-1",
		SeatID:          "seat-1",
		TokenHash:       "hash1",
		CurrentRevision: "rev1",
		KeyStatus:       VirtualKeyStatusActive,
	}
	bRepo.bindings[bID] = &ManagedProviderBinding{
		BindingID:    bID,
		OrgID:        "org-1",
		VirtualKeyID: &vkID,
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}

	svc := NewService(bRepo, vkRepo, eRepo, cLookup)
	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err == nil {
		t.Error("expected error when event insert fails, got nil")
	}
}

// Batch mutation event insert failures are best-effort — they do NOT fail the batch.
func TestBatchRebind_EventInsertFailure_DoesNotFailBatch(t *testing.T) {
	bRepo := newMemBindingRepo()
	vkRepo := newMemVirtualKeyRepo()
	eRepo := &errEventRepo{insertErr: errors.New("db write error")}
	cLookup := &stubCredentialLookup{revision: "crev1", providerID: "prov1", protocolType: "openai_compatible"}

	vkID := "vk-batch"
	bID := "b-batch"
	vkRepo.keys[vkID] = &ManagedVirtualKey{
		VirtualKeyID:    vkID,
		OrgID:           "org-1",
		SeatID:          "seat-1",
		TokenHash:       "hash1",
		CurrentRevision: "rev1",
		KeyStatus:       VirtualKeyStatusActive,
	}
	bRepo.bindings[bID] = &ManagedProviderBinding{
		BindingID:    bID,
		OrgID:        "org-1",
		VirtualKeyID: &vkID,
		ProviderID:   "prov1",
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}

	svc := NewService(bRepo, vkRepo, eRepo, cLookup)
	outcomes, err := svc.BatchRebindSeats(context.Background(), BatchRebindParams{
		OrgID: "org-1",
		Seats: []BatchRebindSeat{
			{SeatID: "seat-1", Bindings: []IssueBindingRef{
				{CredentialID: "cred-new", ProtocolType: "openai_compatible", ProviderID: "prov1"},
			}},
		},
		UpdatedBy: "admin",
	})
	if err != nil {
		t.Fatalf("BatchRebindSeats should not fail: %v", err)
	}
	// The batch itself succeeds — event failure is swallowed.
	if len(outcomes) != 1 || !outcomes[0].Succeeded {
		t.Errorf("expected success despite event insert failure, got %+v", outcomes)
	}
}

// =============================================================================
// 10. Cross-org isolation
// =============================================================================

// Credential rotation in org-1 does not affect bindings in org-2.
func TestCredRotation_CrossOrgIsolation(t *testing.T) {
	svc, bRepo, vkRepo, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc) // org-1, cred-1

	// Manually create a VK + binding in org-2 with the same credential_id.
	vk2ID := "vk-org2"
	b2ID := "b-org2"
	vkRepo.keys[vk2ID] = &ManagedVirtualKey{
		VirtualKeyID:    vk2ID,
		OrgID:           "org-2",
		SeatID:          "seat-2",
		TokenHash:       "hash2",
		CurrentRevision: "rev2",
		KeyStatus:       VirtualKeyStatusActive,
	}
	bRepo.bindings[b2ID] = &ManagedProviderBinding{
		BindingID:    b2ID,
		OrgID:        "org-2",
		VirtualKeyID: &vk2ID,
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}
	beforeCount := len(eRepo.events)

	// Rotate for org-1 only.
	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-1",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	// Only org-1 events should be written.
	for _, ev := range eRepo.events[beforeCount:] {
		if ev.OrgID != "org-1" {
			t.Errorf("credential rotation leaked to org %q, expected org-1 only", ev.OrgID)
		}
	}
}

// =============================================================================
// 11. Snapshot completeness
// =============================================================================

// Rotation events carry before/after snapshots.
func TestVKRotation_HasSnapshots(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	vk := seedVirtualKey(t, svc)

	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vk.VirtualKeyID,
		ChangedBy:    "admin",
		Reason:       "test",
	})
	if err != nil {
		t.Fatalf("RotateVirtualKey: %v", err)
	}

	for _, ev := range eRepo.events {
		if ev.ChangeType == OperationVirtualKeyRotation {
			if len(ev.BeforeSnapshotJSON) == 0 {
				t.Error("rotation event missing BeforeSnapshotJSON")
			}
			if len(ev.AfterSnapshotJSON) == 0 {
				t.Error("rotation event missing AfterSnapshotJSON")
			}
		}
	}
}

// Issue event has after_snapshot but no before_snapshot (new entity).
func TestIssue_SnapshotOnlyAfter(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc)

	for _, ev := range eRepo.events {
		if ev.ChangeType == OperationVirtualKeyIssued {
			if len(ev.AfterSnapshotJSON) == 0 {
				t.Error("issue event missing AfterSnapshotJSON")
			}
			// BeforeSnapshot should be nil/empty for new entity.
			if len(ev.BeforeSnapshotJSON) != 0 {
				t.Error("issue event should not have BeforeSnapshotJSON")
			}
		}
	}
}

// =============================================================================
// 12. Rotation on VK with mixed binding statuses
// =============================================================================

// VK rotation only produces events for active bindings, not retired ones.
func TestVKRotation_MixedBindingStatus_OnlyActiveGetEvents(t *testing.T) {
	svc, bRepo, _, eRepo, cLookup := newTestService()
	vk := seedMultiProtocolVK(t, svc, cLookup) // 2 active bindings

	// Retire one binding.
	for _, b := range bRepo.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == vk.VirtualKeyID && b.ProtocolType == "anthropic" {
			b.Status = BindingStatusRetired
			break
		}
	}
	beforeCount := len(eRepo.events)

	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: vk.VirtualKeyID,
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("RotateVirtualKey: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events[beforeCount:], OperationVirtualKeyRotation)
	if rotEvents != 1 {
		t.Errorf("expected 1 rotation event (only active binding), got %d", rotEvents)
	}
}

// =============================================================================
// 13. Credential migration across multiple VKs
// =============================================================================

// When multiple VKs bind to the same credential, migration writes one event per VK binding.
func TestMigrateCredential_MultipleVKs_WritesEventPerVK(t *testing.T) {
	svc, bRepo, vkRepo, eRepo, cLookup := newTestService()
	_ = seedVirtualKey(t, svc) // vk-1 in seat-1 with cred-1

	// Create a second VK in seat-2 also using cred-1.
	vk2ID := "vk-2"
	b2ID := "b-2"
	cLookup.revision = "crev1"
	vkRepo.keys[vk2ID] = &ManagedVirtualKey{
		VirtualKeyID:    vk2ID,
		OrgID:           "org-1",
		SeatID:          "seat-2",
		TokenHash:       "hash-2",
		CurrentRevision: "rev-2",
		KeyStatus:       VirtualKeyStatusActive,
	}
	bRepo.bindings[b2ID] = &ManagedProviderBinding{
		BindingID:    b2ID,
		OrgID:        "org-1",
		VirtualKeyID: &vk2ID,
		CredentialID: "cred-1",
		ProtocolType: "openai_compatible",
		Status:       BindingStatusActive,
	}
	beforeCount := len(eRepo.events)

	err := svc.MigrateCredential(context.Background(), MigrateCredentialParams{
		OrgID:            "org-1",
		FromCredentialID: "cred-1",
		ToCredentialID:   "cred-new",
		UpdatedBy:        "admin",
	})
	if err != nil {
		t.Fatalf("MigrateCredential: %v", err)
	}

	migEvents := countEventsByType(eRepo.events[beforeCount:], OperationCredentialMigrated)
	if migEvents != 2 {
		t.Errorf("expected 2 migration events (one per VK), got %d", migEvents)
	}

	// Verify distinct seat_ids in events.
	seats := make(map[string]bool)
	for _, ev := range eRepo.events[beforeCount:] {
		if ev.ChangeType == OperationCredentialMigrated {
			seats[ev.SeatID] = true
		}
	}
	if len(seats) != 2 {
		t.Errorf("expected events for 2 distinct seats, got %d", len(seats))
	}
}

// =============================================================================
// 14. Rotation on non-existent VK
// =============================================================================

func TestVKRotation_NonExistentVK_ReturnsError(t *testing.T) {
	svc, _, _, _, _ := newTestService()
	_, err := svc.RotateVirtualKey(context.Background(), RotateVirtualKeyParams{
		VirtualKeyID: "does-not-exist",
		ChangedBy:    "admin",
	})
	if err == nil {
		t.Error("expected error for non-existent VK, got nil")
	}
}

func TestCredRotation_WrongOrg_NoEvent(t *testing.T) {
	svc, _, _, eRepo, _ := newTestService()
	_ = seedVirtualKey(t, svc) // org-1

	err := svc.HandleCredentialRotation(context.Background(), RotateCredentialParams{
		CredentialID: "cred-1",
		OrgID:        "org-wrong",
		NewRevision:  "crev2",
		OldRevision:  "crev1",
		ChangedBy:    "admin",
	})
	if err != nil {
		t.Fatalf("HandleCredentialRotation: %v", err)
	}

	rotEvents := countEventsByType(eRepo.events, OperationCredentialRotation)
	if rotEvents != 0 {
		t.Errorf("expected 0 events for wrong org, got %d", rotEvents)
	}
}
