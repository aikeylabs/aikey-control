package snapshot

import (
	"context"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/AiKeyLabs/aikey-control-service/pkg/identity"
	"github.com/AiKeyLabs/aikey-control-service/pkg/managedkey"
	"github.com/AiKeyLabs/aikey-control-service/internal/organization"
	"github.com/AiKeyLabs/aikey-control-service/internal/provider"
)

// =============================================================================
// Test: account_managed_virtual_keys projection refresh on tuple changes
// (seat_id, binding_id, credential_id) and virtual key rotation.
//
// Covered scenarios:
//   - RefreshSnapshot builds correct projection from live tables
//   - Tuple changes (credential swap, binding rebind, seat reassign) update projection
//   - VK rotation updates virtual_key_revision in projection
//   - Credential rotation updates credential_revision in projection
//   - Effective status derivation (account/seat/key/share gates)
//   - Stale row cleanup after VK removal
//   - Multi-seat, multi-VK, multi-binding scenarios
//   - Partial failure resilience (hasFetchError suppresses delete)
//   - BumpForSeat / BumpForVirtualKey / BumpForBindings / BumpForCredential
//   - Edge: no seats, no VKs, no bindings, retired bindings, missing provider
// =============================================================================

// ---- in-memory SnapshotRepository mock ----

type memSnapshotRepo struct {
	versions  map[string]int64                // accountID → sync_version
	snapshots map[string][]AccountKeySnapshot // accountID → rows

	// resolve maps for bump tests
	seatToAccount    map[string]string   // seatID → accountID
	vkToAccount      map[string]string   // virtualKeyID → accountID
	bindingToAccount map[string]string   // bindingID → accountID
	credToAccounts   map[string][]string // credentialID → []accountID

	// error injection
	upsertErr error
}

func newMemSnapshotRepo() *memSnapshotRepo {
	return &memSnapshotRepo{
		versions:         make(map[string]int64),
		snapshots:        make(map[string][]AccountKeySnapshot),
		seatToAccount:    make(map[string]string),
		vkToAccount:      make(map[string]string),
		bindingToAccount: make(map[string]string),
		credToAccounts:   make(map[string][]string),
	}
}

func (s *memSnapshotRepo) GetOrInitSyncVersion(_ context.Context, accountID string) (int64, error) {
	if v, ok := s.versions[accountID]; ok {
		return v, nil
	}
	s.versions[accountID] = 1
	return 1, nil
}

func (s *memSnapshotRepo) BumpSyncVersion(_ context.Context, accountID string) error {
	if v, ok := s.versions[accountID]; ok {
		s.versions[accountID] = v + 1
	} else {
		s.versions[accountID] = 1
	}
	return nil
}

func (s *memSnapshotRepo) UpsertSnapshot(_ context.Context, accountID string, snap *AccountKeySnapshot) error {
	if s.upsertErr != nil {
		return s.upsertErr
	}
	rows := s.snapshots[accountID]
	for i, r := range rows {
		if r.VirtualKeyID == snap.VirtualKeyID {
			rows[i] = *snap
			s.snapshots[accountID] = rows
			return nil
		}
	}
	s.snapshots[accountID] = append(rows, *snap)
	return nil
}

func (s *memSnapshotRepo) DeleteStaleSnapshots(_ context.Context, accountID string, processedVKIDs []string) error {
	if len(processedVKIDs) == 0 {
		delete(s.snapshots, accountID)
		return nil
	}
	keep := make(map[string]bool, len(processedVKIDs))
	for _, id := range processedVKIDs {
		keep[id] = true
	}
	var filtered []AccountKeySnapshot
	for _, r := range s.snapshots[accountID] {
		if keep[r.VirtualKeyID] {
			filtered = append(filtered, r)
		}
	}
	s.snapshots[accountID] = filtered
	return nil
}

func (s *memSnapshotRepo) ListSnapshots(_ context.Context, accountID string) ([]AccountKeySnapshot, error) {
	rows := s.snapshots[accountID]
	if rows == nil {
		return []AccountKeySnapshot{}, nil
	}
	result := make([]AccountKeySnapshot, len(rows))
	copy(result, rows)
	sort.Slice(result, func(i, j int) bool { return result[i].Alias < result[j].Alias })
	return result, nil
}

func (s *memSnapshotRepo) ResolveAccountForSeat(_ context.Context, seatID string) (string, error) {
	return s.seatToAccount[seatID], nil
}

func (s *memSnapshotRepo) ResolveAccountForVirtualKey(_ context.Context, virtualKeyID string) (string, error) {
	return s.vkToAccount[virtualKeyID], nil
}

func (s *memSnapshotRepo) ResolveAccountsForBindings(_ context.Context, bindingIDs []string) ([]string, error) {
	seen := make(map[string]bool)
	var result []string
	for _, bID := range bindingIDs {
		if acctID, ok := s.bindingToAccount[bID]; ok && !seen[acctID] {
			seen[acctID] = true
			result = append(result, acctID)
		}
	}
	return result, nil
}

func (s *memSnapshotRepo) ResolveAccountsForCredential(_ context.Context, credentialID string) ([]string, error) {
	return s.credToAccounts[credentialID], nil
}

// ---- in-memory SeatRepository mock ----

type memSeatRepo struct {
	seats []*organization.OrgSeat
	err   error // inject error for ListByAccount
}

func (r *memSeatRepo) Create(_ context.Context, _ *organization.OrgSeat) error { return nil }
func (r *memSeatRepo) FindByID(_ context.Context, seatID string) (*organization.OrgSeat, error) {
	for _, s := range r.seats {
		if s.SeatID == seatID {
			return s, nil
		}
	}
	return nil, nil
}
func (r *memSeatRepo) FindByOrgAndEmail(_ context.Context, _, _ string) (*organization.OrgSeat, error) {
	return nil, nil
}
func (r *memSeatRepo) ListByOrg(_ context.Context, orgID string) ([]*organization.OrgSeat, error) {
	var out []*organization.OrgSeat
	for _, s := range r.seats {
		if s.OrgID == orgID {
			out = append(out, s)
		}
	}
	return out, nil
}
func (r *memSeatRepo) ListByAccount(_ context.Context, accountID string) ([]*organization.OrgSeat, error) {
	if r.err != nil {
		return nil, r.err
	}
	var out []*organization.OrgSeat
	for _, s := range r.seats {
		if s.AccountID == accountID {
			out = append(out, s)
		}
	}
	return out, nil
}
func (r *memSeatRepo) Claim(_ context.Context, _, _ string) error      { return nil }
func (r *memSeatRepo) UpdateStatus(_ context.Context, _, _ string) error { return nil }
func (r *memSeatRepo) ReconcileByEmail(_ context.Context, _, _ string) (int, error) {
	return 0, nil
}

// ---- in-memory VirtualKeyRepository mock (reusing managedkey types) ----

type memVKRepo struct {
	keys []*managedkey.ManagedVirtualKey
	err  error // inject error for ListBySeat
}

func (r *memVKRepo) Create(_ context.Context, _ *managedkey.ManagedVirtualKey) error { return nil }
func (r *memVKRepo) FindByID(_ context.Context, id string) (*managedkey.ManagedVirtualKey, error) {
	for _, k := range r.keys {
		if k.VirtualKeyID == id {
			return k, nil
		}
	}
	return nil, nil
}
func (r *memVKRepo) FindByTokenHash(_ context.Context, _ string) (*managedkey.ManagedVirtualKey, error) {
	return nil, nil
}
func (r *memVKRepo) ListByOrg(_ context.Context, _ string) ([]*managedkey.ManagedVirtualKey, error) {
	return nil, nil
}
func (r *memVKRepo) ListBySeat(_ context.Context, seatID string) ([]*managedkey.ManagedVirtualKey, error) {
	if r.err != nil {
		return nil, r.err
	}
	var out []*managedkey.ManagedVirtualKey
	for _, k := range r.keys {
		if k.SeatID == seatID {
			out = append(out, k)
		}
	}
	return out, nil
}
func (r *memVKRepo) ListPendingClaimBySeat(_ context.Context, _ string) ([]*managedkey.ManagedVirtualKey, error) {
	return nil, nil
}
func (r *memVKRepo) UpdateStatus(_ context.Context, id, status, _ string) error {
	for _, k := range r.keys {
		if k.VirtualKeyID == id {
			k.KeyStatus = status
		}
	}
	return nil
}
func (r *memVKRepo) UpdateShareStatus(_ context.Context, id, status string) error {
	for _, k := range r.keys {
		if k.VirtualKeyID == id {
			k.ShareStatus = status
		}
	}
	return nil
}
func (r *memVKRepo) ReconcileShareStatusByEmail(_ context.Context, _ string) (int, error) {
	return 0, nil
}
func (r *memVKRepo) RecordDelivery(_ context.Context, _ string) error { return nil }
func (r *memVKRepo) RotateToken(_ context.Context, id, hash, rev, _ string) error {
	for _, k := range r.keys {
		if k.VirtualKeyID == id {
			k.TokenHash = hash
			k.CurrentRevision = rev
		}
	}
	return nil
}
func (r *memVKRepo) LastAnchorTuple(_ context.Context, _, _ string) (managedkey.AnchorTuple, error) {
	return managedkey.AnchorTuple{}, nil
}

// ---- in-memory BindingRepository mock ----

type memBindingRepoSnap struct {
	bindings []*managedkey.ManagedProviderBinding
}

func (r *memBindingRepoSnap) Create(_ context.Context, _ *managedkey.ManagedProviderBinding) error {
	return nil
}
func (r *memBindingRepoSnap) FindByID(_ context.Context, id string) (*managedkey.ManagedProviderBinding, error) {
	for _, b := range r.bindings {
		if b.BindingID == id {
			return b, nil
		}
	}
	return nil, nil
}
func (r *memBindingRepoSnap) ListByOrg(_ context.Context, _ string) ([]*managedkey.ManagedProviderBinding, error) {
	return nil, nil
}
func (r *memBindingRepoSnap) ListByVirtualKey(_ context.Context, vkID string) ([]*managedkey.ManagedProviderBinding, error) {
	var out []*managedkey.ManagedProviderBinding
	for _, b := range r.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == vkID {
			out = append(out, b)
		}
	}
	return out, nil
}
func (r *memBindingRepoSnap) FindActiveByVirtualKeyAndProtocol(_ context.Context, vkID, proto string) ([]*managedkey.ManagedProviderBinding, error) {
	var out []*managedkey.ManagedProviderBinding
	for _, b := range r.bindings {
		if b.VirtualKeyID != nil && *b.VirtualKeyID == vkID &&
			b.ProtocolType == proto && b.Status == managedkey.BindingStatusActive {
			out = append(out, b)
		}
	}
	return out, nil
}
func (r *memBindingRepoSnap) FindActiveByVirtualKeyProtocolAndProvider(_ context.Context, _, _, _ string) (*managedkey.ManagedProviderBinding, error) {
	return nil, nil
}
func (r *memBindingRepoSnap) UpdateCredential(_ context.Context, id, credID, _ string) error {
	for _, b := range r.bindings {
		if b.BindingID == id {
			b.CredentialID = credID
		}
	}
	return nil
}
func (r *memBindingRepoSnap) UpdateStatus(_ context.Context, id, status string) error {
	for _, b := range r.bindings {
		if b.BindingID == id {
			b.Status = status
		}
	}
	return nil
}

// ---- in-memory IdentityRepository mock ----

type memIdentityRepo struct {
	accounts map[string]*identity.GlobalAccount
}

func (r *memIdentityRepo) Create(_ context.Context, _ *identity.GlobalAccount) error { return nil }
func (r *memIdentityRepo) FindByID(_ context.Context, accountID string) (*identity.GlobalAccount, error) {
	if acct, ok := r.accounts[accountID]; ok {
		return acct, nil
	}
	return nil, nil
}
func (r *memIdentityRepo) FindByEmail(_ context.Context, _ string) (*identity.GlobalAccount, error) {
	return nil, nil
}
func (r *memIdentityRepo) UpdateLastLogin(_ context.Context, _ string) error { return nil }

// ---- in-memory ProviderLookup mock ----

type memProviderLookup struct {
	credentials map[string]*provider.ManagedProviderCredential
	providers   map[string]*provider.Provider
}

func (m *memProviderLookup) GetCredential(_ context.Context, credentialID string) (*provider.ManagedProviderCredential, error) {
	if c, ok := m.credentials[credentialID]; ok {
		return c, nil
	}
	return nil, errors.New("credential not found")
}

func (m *memProviderLookup) GetProvider(_ context.Context, providerID string) (*provider.Provider, error) {
	if p, ok := m.providers[providerID]; ok {
		return p, nil
	}
	return nil, errors.New("provider not found")
}

// ---- test harness ----

type testHarness struct {
	store    *memSnapshotRepo
	seatRepo *memSeatRepo
	vkRepo   *memVKRepo
	bRepo    *memBindingRepoSnap
	idRepo   *memIdentityRepo
	provLkp  *memProviderLookup
	svc      *Service
}

func newTestHarness() *testHarness {
	store := newMemSnapshotRepo()
	seatRepo := &memSeatRepo{}
	vkRepo := &memVKRepo{}
	bRepo := &memBindingRepoSnap{}
	idRepo := &memIdentityRepo{accounts: map[string]*identity.GlobalAccount{
		"acct-1": {AccountID: "acct-1", Email: "user@test.com", AccountStatus: identity.AccountStatusActive},
	}}
	provLkp := &memProviderLookup{
		credentials: map[string]*provider.ManagedProviderCredential{
			"cred-1": {CredentialID: "cred-1", ProviderID: "prov-1", CurrentRevision: "crev-1"},
		},
		providers: map[string]*provider.Provider{
			"prov-1": {ProviderID: "prov-1", ProviderCode: "openai", DefaultBaseURL: "https://api.openai.com/v1"},
		},
	}

	svc := NewServiceWithRepository(store, seatRepo, vkRepo, bRepo, provLkp, idRepo)
	return &testHarness{
		store: store, seatRepo: seatRepo, vkRepo: vkRepo,
		bRepo: bRepo, idRepo: idRepo, provLkp: provLkp, svc: svc,
	}
}

func strPtr(s string) *string { return &s }

// seedStandardSetup creates: acct-1 → seat-1 → vk-1 (active, claimed) → binding-1 → cred-1 → prov-1.
func (h *testHarness) seedStandardSetup() {
	h.seatRepo.seats = []*organization.OrgSeat{
		{SeatID: "seat-1", OrgID: "org-1", AccountID: "acct-1", SeatStatus: organization.SeatStatusActive},
	}
	h.vkRepo.keys = []*managedkey.ManagedVirtualKey{
		{
			VirtualKeyID: "vk-1", OrgID: "org-1", SeatID: "seat-1", Alias: "dev-key",
			CurrentRevision: "vkrev-1", KeyStatus: managedkey.VirtualKeyStatusActive,
			ShareStatus: managedkey.ShareStatusClaimed,
		},
	}
	h.bRepo.bindings = []*managedkey.ManagedProviderBinding{
		{
			BindingID: "bind-1", OrgID: "org-1", VirtualKeyID: strPtr("vk-1"),
			ProviderID: "prov-1", CredentialID: "cred-1", ProtocolType: "openai_compatible",
			Status: managedkey.BindingStatusActive,
		},
	}
	h.store.seatToAccount["seat-1"] = "acct-1"
	h.store.vkToAccount["vk-1"] = "acct-1"
	h.store.bindingToAccount["bind-1"] = "acct-1"
	h.store.credToAccounts["cred-1"] = []string{"acct-1"}
}

// findSnap returns the snapshot row for a given virtual key, or nil.
func findSnap(snaps []AccountKeySnapshot, vkID string) *AccountKeySnapshot {
	for i := range snaps {
		if snaps[i].VirtualKeyID == vkID {
			return &snaps[i]
		}
	}
	return nil
}

// =============================================================================
// 1. Basic RefreshSnapshot — projection built correctly
// =============================================================================

func TestRefreshSnapshot_BasicProjection(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot row, got %d", len(snaps))
	}

	snap := snaps[0]
	if snap.VirtualKeyID != "vk-1" {
		t.Errorf("VirtualKeyID = %q, want vk-1", snap.VirtualKeyID)
	}
	if snap.SeatID != "seat-1" {
		t.Errorf("SeatID = %q, want seat-1", snap.SeatID)
	}
	if snap.CredentialID != "cred-1" {
		t.Errorf("CredentialID = %q, want cred-1", snap.CredentialID)
	}
	if snap.CredentialRevision != "crev-1" {
		t.Errorf("CredentialRevision = %q, want crev-1", snap.CredentialRevision)
	}
	if snap.VirtualKeyRevision != "vkrev-1" {
		t.Errorf("VirtualKeyRevision = %q, want vkrev-1", snap.VirtualKeyRevision)
	}
	if snap.ProviderCode != "openai" {
		t.Errorf("ProviderCode = %q, want openai", snap.ProviderCode)
	}
	if snap.BaseURL != "https://api.openai.com/v1" {
		t.Errorf("BaseURL = %q, want https://api.openai.com/v1", snap.BaseURL)
	}
	if snap.EffectiveStatus != "active" {
		t.Errorf("EffectiveStatus = %q, want active", snap.EffectiveStatus)
	}
	if snap.KeyStatus != managedkey.VirtualKeyStatusActive {
		t.Errorf("KeyStatus = %q, want active", snap.KeyStatus)
	}
	if snap.ShareStatus != managedkey.ShareStatusClaimed {
		t.Errorf("ShareStatus = %q, want claimed", snap.ShareStatus)
	}
	if snap.SyncVersion != 1 {
		t.Errorf("SyncVersion = %d, want 1", snap.SyncVersion)
	}
}

// =============================================================================
// 2. Credential change — credential_id and credential_revision update
// =============================================================================

func TestRefreshSnapshot_CredentialSwap_UpdatesProjection(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	// Initial refresh.
	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	// Swap credential on the binding.
	h.bRepo.bindings[0].CredentialID = "cred-2"
	h.provLkp.credentials["cred-2"] = &provider.ManagedProviderCredential{
		CredentialID: "cred-2", ProviderID: "prov-1", CurrentRevision: "crev-2",
	}

	// Refresh again.
	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot row, got %d", len(snaps))
	}
	if snaps[0].CredentialID != "cred-2" {
		t.Errorf("CredentialID = %q, want cred-2", snaps[0].CredentialID)
	}
	if snaps[0].CredentialRevision != "crev-2" {
		t.Errorf("CredentialRevision = %q, want crev-2", snaps[0].CredentialRevision)
	}
}

// =============================================================================
// 3. Credential rotation — credential_revision updates
// =============================================================================

func TestRefreshSnapshot_CredentialRotation_UpdatesRevision(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	// Simulate credential rotation by bumping revision.
	h.provLkp.credentials["cred-1"].CurrentRevision = "crev-rotated"

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].CredentialRevision != "crev-rotated" {
		t.Errorf("CredentialRevision = %q, want crev-rotated", snaps[0].CredentialRevision)
	}
}

// =============================================================================
// 4. VK rotation — virtual_key_revision updates
// =============================================================================

func TestRefreshSnapshot_VKRotation_UpdatesRevision(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	// Simulate VK rotation by updating revision.
	h.vkRepo.keys[0].CurrentRevision = "vkrev-rotated"

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].VirtualKeyRevision != "vkrev-rotated" {
		t.Errorf("VirtualKeyRevision = %q, want vkrev-rotated", snaps[0].VirtualKeyRevision)
	}
}

// =============================================================================
// 5. Binding rebind — provider and base_url update
// =============================================================================

func TestRefreshSnapshot_BindingRebind_UpdatesProvider(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	// Add a new provider and credential, rebind.
	h.provLkp.providers["prov-2"] = &provider.Provider{
		ProviderID: "prov-2", ProviderCode: "anthropic", DefaultBaseURL: "https://api.anthropic.com/v1",
	}
	h.provLkp.credentials["cred-ant"] = &provider.ManagedProviderCredential{
		CredentialID: "cred-ant", ProviderID: "prov-2", CurrentRevision: "crev-ant-1",
	}
	h.bRepo.bindings[0].CredentialID = "cred-ant"

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].ProviderCode != "anthropic" {
		t.Errorf("ProviderCode = %q, want anthropic", snaps[0].ProviderCode)
	}
	if snaps[0].BaseURL != "https://api.anthropic.com/v1" {
		t.Errorf("BaseURL = %q, want https://api.anthropic.com/v1", snaps[0].BaseURL)
	}
}

// =============================================================================
// 6. BaseURL override from credential
// =============================================================================

func TestRefreshSnapshot_BaseURLOverride(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.provLkp.credentials["cred-1"].BaseURLOverride = "https://custom-proxy.example.com/v1"

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].BaseURL != "https://custom-proxy.example.com/v1" {
		t.Errorf("BaseURL = %q, want custom override", snaps[0].BaseURL)
	}
}

// =============================================================================
// 7. VK revocation — effective_status becomes inactive
// =============================================================================

func TestRefreshSnapshot_RevokedVK_InactiveStatus(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.vkRepo.keys[0].KeyStatus = managedkey.VirtualKeyStatusRevoked

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveStatus != "inactive" {
		t.Errorf("EffectiveStatus = %q, want inactive", snaps[0].EffectiveStatus)
	}
	if snaps[0].EffectiveReason != "key_revoked" {
		t.Errorf("EffectiveReason = %q, want key_revoked", snaps[0].EffectiveReason)
	}
}

// =============================================================================
// 8. Seat suspended — effective_status becomes inactive
// =============================================================================

func TestRefreshSnapshot_SuspendedSeat_InactiveStatus(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.seatRepo.seats[0].SeatStatus = organization.SeatStatusSuspended

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveStatus != "inactive" {
		t.Errorf("EffectiveStatus = %q, want inactive", snaps[0].EffectiveStatus)
	}
	if snaps[0].EffectiveReason != "seat_disabled" {
		t.Errorf("EffectiveReason = %q, want seat_disabled", snaps[0].EffectiveReason)
	}
}

// =============================================================================
// 9. Account disabled — overrides everything
// =============================================================================

func TestRefreshSnapshot_AccountDisabled_InactiveStatus(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.idRepo.accounts["acct-1"].AccountStatus = identity.AccountStatusSuspended

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveStatus != "inactive" {
		t.Errorf("EffectiveStatus = %q, want inactive", snaps[0].EffectiveStatus)
	}
	if snaps[0].EffectiveReason != "account_disabled" {
		t.Errorf("EffectiveReason = %q, want account_disabled", snaps[0].EffectiveReason)
	}
}

// =============================================================================
// 10. Pending claim — not_claimed
// =============================================================================

func TestRefreshSnapshot_PendingClaim_StillActive(t *testing.T) {
	// share_status is display-only; pending_claim does not block delivery.
	h := newTestHarness()
	h.seedStandardSetup()
	h.vkRepo.keys[0].ShareStatus = managedkey.ShareStatusPendingClaim

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveStatus != "active" {
		t.Errorf("EffectiveStatus = %q, want active", snaps[0].EffectiveStatus)
	}
	if snaps[0].EffectiveReason != "" {
		t.Errorf("EffectiveReason = %q, want empty", snaps[0].EffectiveReason)
	}
}

// =============================================================================
// 11. Stale row cleanup — VK removed
// =============================================================================

func TestRefreshSnapshot_VKRemoved_RowDeleted(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	if len(h.store.snapshots["acct-1"]) != 1 {
		t.Fatal("expected 1 row after initial refresh")
	}

	// Remove VK from the fact table (revoked and purged, or seat reassigned).
	h.vkRepo.keys = nil

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 0 {
		t.Errorf("expected 0 rows after VK removed, got %d", len(snaps))
	}
}

// =============================================================================
// 12. Multi-VK — each VK gets its own row
// =============================================================================

func TestRefreshSnapshot_MultipleVKs(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	// Add second VK.
	h.vkRepo.keys = append(h.vkRepo.keys, &managedkey.ManagedVirtualKey{
		VirtualKeyID: "vk-2", OrgID: "org-1", SeatID: "seat-1", Alias: "staging-key",
		CurrentRevision: "vkrev-2", KeyStatus: managedkey.VirtualKeyStatusActive,
		ShareStatus: managedkey.ShareStatusClaimed,
	})
	h.bRepo.bindings = append(h.bRepo.bindings, &managedkey.ManagedProviderBinding{
		BindingID: "bind-2", OrgID: "org-1", VirtualKeyID: strPtr("vk-2"),
		ProviderID: "prov-1", CredentialID: "cred-1", ProtocolType: "openai_compatible",
		Status: managedkey.BindingStatusActive,
	})

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 2 {
		t.Fatalf("expected 2 snapshot rows, got %d", len(snaps))
	}

	vkIDs := map[string]bool{}
	for _, s := range snaps {
		vkIDs[s.VirtualKeyID] = true
	}
	if !vkIDs["vk-1"] || !vkIDs["vk-2"] {
		t.Error("expected both vk-1 and vk-2 in snapshot")
	}
}

// =============================================================================
// 13. Multi-binding (multi-protocol) — supported_providers aggregated
// =============================================================================

func TestRefreshSnapshot_MultiBinding_SupportedProviders(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	// Add second provider + credential + binding.
	h.provLkp.providers["prov-2"] = &provider.Provider{
		ProviderID: "prov-2", ProviderCode: "anthropic", DefaultBaseURL: "https://api.anthropic.com/v1",
	}
	h.provLkp.credentials["cred-2"] = &provider.ManagedProviderCredential{
		CredentialID: "cred-2", ProviderID: "prov-2", CurrentRevision: "crev-2",
	}
	h.bRepo.bindings = append(h.bRepo.bindings, &managedkey.ManagedProviderBinding{
		BindingID: "bind-2", OrgID: "org-1", VirtualKeyID: strPtr("vk-1"),
		ProviderID: "prov-2", CredentialID: "cred-2", ProtocolType: "anthropic",
		Status: managedkey.BindingStatusActive,
	})

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	snap := snaps[0]

	if len(snap.SupportedProviders) != 2 {
		t.Fatalf("expected 2 supported_providers, got %d: %v", len(snap.SupportedProviders), snap.SupportedProviders)
	}
	// Primary fields should be from first binding (openai).
	if snap.ProviderCode != "openai" {
		t.Errorf("primary ProviderCode = %q, want openai", snap.ProviderCode)
	}
	// provider_base_urls should have both.
	if len(snap.ProviderBaseURLs) != 2 {
		t.Errorf("expected 2 provider_base_urls entries, got %d", len(snap.ProviderBaseURLs))
	}
}

// =============================================================================
// 14. Retired binding skipped — only active bindings in projection
// =============================================================================

func TestRefreshSnapshot_RetiredBinding_Skipped(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.bRepo.bindings[0].Status = managedkey.BindingStatusRetired

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	// VK still exists but has no active binding → empty provider metadata.
	if snaps[0].ProviderCode != "" {
		t.Errorf("ProviderCode = %q, want empty (retired binding)", snaps[0].ProviderCode)
	}
	if snaps[0].CredentialID != "" {
		t.Errorf("CredentialID = %q, want empty", snaps[0].CredentialID)
	}
	// Default protocol_type fallback.
	if snaps[0].ProtocolType != "openai_compatible" {
		t.Errorf("ProtocolType = %q, want openai_compatible (default)", snaps[0].ProtocolType)
	}
}

// =============================================================================
// 15. No bindings — VK still appears with default protocol
// =============================================================================

func TestRefreshSnapshot_NoBindings_DefaultProtocol(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.bRepo.bindings = nil // no bindings at all

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 1 {
		t.Fatalf("expected 1 row (VK exists), got %d", len(snaps))
	}
	if snaps[0].ProtocolType != "openai_compatible" {
		t.Errorf("ProtocolType = %q, want openai_compatible default", snaps[0].ProtocolType)
	}
}

// =============================================================================
// 16. No seats — empty snapshot
// =============================================================================

func TestRefreshSnapshot_NoSeats_EmptySnapshot(t *testing.T) {
	h := newTestHarness()
	// acct-1 exists but has no seats.

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 0 {
		t.Errorf("expected 0 rows for account with no seats, got %d", len(snaps))
	}
}

// =============================================================================
// 17. No VKs on seat — no snapshot rows for that seat
// =============================================================================

func TestRefreshSnapshot_NoVKsOnSeat(t *testing.T) {
	h := newTestHarness()
	h.seatRepo.seats = []*organization.OrgSeat{
		{SeatID: "seat-1", OrgID: "org-1", AccountID: "acct-1", SeatStatus: organization.SeatStatusActive},
	}
	// No VKs.

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 0 {
		t.Errorf("expected 0 rows when no VKs, got %d", len(snaps))
	}
}

// =============================================================================
// 18. Missing provider — binding skipped gracefully
// =============================================================================

func TestRefreshSnapshot_MissingProvider_Skipped(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	// Remove provider from lookup.
	delete(h.provLkp.providers, "prov-1")

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	// VK exists, but binding's provider missing → empty metadata.
	if snaps[0].ProviderCode != "" {
		t.Errorf("ProviderCode = %q, want empty (missing provider)", snaps[0].ProviderCode)
	}
}

// =============================================================================
// 19. Missing credential — binding skipped gracefully
// =============================================================================

func TestRefreshSnapshot_MissingCredential_Skipped(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	delete(h.provLkp.credentials, "cred-1")

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].CredentialID != "" {
		t.Errorf("CredentialID = %q, want empty (missing credential)", snaps[0].CredentialID)
	}
}

// =============================================================================
// 20. Multi-seat — keys from different seats aggregated
// =============================================================================

func TestRefreshSnapshot_MultiSeat(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	// Add second seat with its own VK.
	h.seatRepo.seats = append(h.seatRepo.seats, &organization.OrgSeat{
		SeatID: "seat-2", OrgID: "org-1", AccountID: "acct-1", SeatStatus: organization.SeatStatusActive,
	})
	h.vkRepo.keys = append(h.vkRepo.keys, &managedkey.ManagedVirtualKey{
		VirtualKeyID: "vk-2", OrgID: "org-1", SeatID: "seat-2", Alias: "seat2-key",
		CurrentRevision: "vkrev-2", KeyStatus: managedkey.VirtualKeyStatusActive,
		ShareStatus: managedkey.ShareStatusClaimed,
	})
	h.bRepo.bindings = append(h.bRepo.bindings, &managedkey.ManagedProviderBinding{
		BindingID: "bind-2", OrgID: "org-1", VirtualKeyID: strPtr("vk-2"),
		ProviderID: "prov-1", CredentialID: "cred-1", ProtocolType: "openai_compatible",
		Status: managedkey.BindingStatusActive,
	})

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 2 {
		t.Fatalf("expected 2 rows (one per VK), got %d", len(snaps))
	}
	seats := map[string]bool{}
	for _, s := range snaps {
		seats[s.SeatID] = true
	}
	if !seats["seat-1"] || !seats["seat-2"] {
		t.Error("expected rows from both seats")
	}
}

// =============================================================================
// 21. Partial failure — ListBySeat error suppresses delete
// =============================================================================

func TestRefreshSnapshot_ListBySeatError_SuppressesDelete(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	// Initial refresh populates snapshot.
	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")
	if len(h.store.snapshots["acct-1"]) != 1 {
		t.Fatal("expected 1 row after initial refresh")
	}

	// Inject error on ListBySeat.
	h.vkRepo.err = errors.New("db timeout")

	// Refresh again — should NOT delete existing rows due to hasFetchError.
	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 1 {
		t.Errorf("expected existing rows preserved on partial failure, got %d", len(snaps))
	}
}

// =============================================================================
// 22. Upsert error — suppresses delete
// =============================================================================

func TestRefreshSnapshot_UpsertError_SuppressesDelete(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	// Pre-populate a stale row.
	h.store.snapshots["acct-1"] = []AccountKeySnapshot{
		{VirtualKeyID: "vk-stale", Alias: "stale"},
	}

	// Inject upsert error.
	h.store.upsertErr = errors.New("db write error")

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	// Stale row must NOT be deleted because hasFetchError was set.
	found := false
	for _, s := range h.store.snapshots["acct-1"] {
		if s.VirtualKeyID == "vk-stale" {
			found = true
		}
	}
	if !found {
		t.Error("stale row should be preserved when upsert fails")
	}
}

// =============================================================================
// 23. ExpiresAt — populated when VK has expiry
// =============================================================================

func TestRefreshSnapshot_ExpiresAt(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	expiry := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	h.vkRepo.keys[0].ExpiresAt = &expiry

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].ExpiresAt == nil {
		t.Fatal("ExpiresAt should not be nil")
	}
	if *snaps[0].ExpiresAt != expiry.Unix() {
		t.Errorf("ExpiresAt = %d, want %d", *snaps[0].ExpiresAt, expiry.Unix())
	}
}

// =============================================================================
// 24. Expired VK — effective_status is inactive/key_expired
// =============================================================================

func TestRefreshSnapshot_ExpiredVK(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.vkRepo.keys[0].KeyStatus = managedkey.VirtualKeyStatusExpired

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveStatus != "inactive" || snaps[0].EffectiveReason != "key_expired" {
		t.Errorf("got (%q, %q), want (inactive, key_expired)", snaps[0].EffectiveStatus, snaps[0].EffectiveReason)
	}
}

// =============================================================================
// 25. Account not found (nil) — treated as NOT disabled
// =============================================================================

func TestRefreshSnapshot_AccountNotFound_TreatedAsActive(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	delete(h.idRepo.accounts, "acct-1") // account not in repo

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveStatus != "active" {
		t.Errorf("EffectiveStatus = %q, want active (nil account = not disabled)", snaps[0].EffectiveStatus)
	}
}

// =============================================================================
// 26. Seat revoked — treated as inactive
// =============================================================================

func TestRefreshSnapshot_RevokedSeat_InactiveStatus(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.seatRepo.seats[0].SeatStatus = organization.SeatStatusRevoked

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveReason != "seat_disabled" {
		t.Errorf("EffectiveReason = %q, want seat_disabled", snaps[0].EffectiveReason)
	}
}

// =============================================================================
// 27. BumpForSeat — bumps correct account
// =============================================================================

func TestBumpForSeat(t *testing.T) {
	h := newTestHarness()
	h.store.seatToAccount["seat-1"] = "acct-1"
	h.store.versions["acct-1"] = 5

	h.svc.BumpForSeat(context.Background(), "seat-1")

	if h.store.versions["acct-1"] != 6 {
		t.Errorf("sync_version = %d, want 6", h.store.versions["acct-1"])
	}
}

// BumpForSeat with unclaimed seat (no account) — no-op.
func TestBumpForSeat_UnclaimedSeat_NoOp(t *testing.T) {
	h := newTestHarness()
	// seat-99 has no mapping.
	h.svc.BumpForSeat(context.Background(), "seat-99")
	// No panic, no error, no version bumped.
	if _, ok := h.store.versions["seat-99"]; ok {
		t.Error("should not create version for unknown seat")
	}
}

// =============================================================================
// 28. BumpForVirtualKey — bumps correct account
// =============================================================================

func TestBumpForVirtualKey(t *testing.T) {
	h := newTestHarness()
	h.store.vkToAccount["vk-1"] = "acct-1"
	h.store.versions["acct-1"] = 3

	h.svc.BumpForVirtualKey(context.Background(), "vk-1")

	if h.store.versions["acct-1"] != 4 {
		t.Errorf("sync_version = %d, want 4", h.store.versions["acct-1"])
	}
}

func TestBumpForVirtualKey_UnknownVK_NoOp(t *testing.T) {
	h := newTestHarness()
	h.svc.BumpForVirtualKey(context.Background(), "vk-unknown")
	// No panic or error.
}

// =============================================================================
// 29. BumpForBindings — bumps all affected accounts
// =============================================================================

func TestBumpForBindings(t *testing.T) {
	h := newTestHarness()
	h.store.bindingToAccount["b1"] = "acct-1"
	h.store.bindingToAccount["b2"] = "acct-2"
	h.store.versions["acct-1"] = 1
	h.store.versions["acct-2"] = 1

	h.svc.BumpForBindings(context.Background(), []string{"b1", "b2"})

	if h.store.versions["acct-1"] != 2 {
		t.Errorf("acct-1 version = %d, want 2", h.store.versions["acct-1"])
	}
	if h.store.versions["acct-2"] != 2 {
		t.Errorf("acct-2 version = %d, want 2", h.store.versions["acct-2"])
	}
}

func TestBumpForBindings_EmptyList_NoOp(t *testing.T) {
	h := newTestHarness()
	h.svc.BumpForBindings(context.Background(), []string{})
	// No panic or error.
}

// =============================================================================
// 30. BumpForCredential — bumps all affected accounts
// =============================================================================

func TestBumpForCredential(t *testing.T) {
	h := newTestHarness()
	h.store.credToAccounts["cred-1"] = []string{"acct-1", "acct-2"}
	h.store.versions["acct-1"] = 1
	h.store.versions["acct-2"] = 1

	h.svc.BumpForCredential(context.Background(), "cred-1")

	if h.store.versions["acct-1"] != 2 {
		t.Errorf("acct-1 version = %d, want 2", h.store.versions["acct-1"])
	}
	if h.store.versions["acct-2"] != 2 {
		t.Errorf("acct-2 version = %d, want 2", h.store.versions["acct-2"])
	}
}

func TestBumpForCredential_UnknownCred_NoOp(t *testing.T) {
	h := newTestHarness()
	h.svc.BumpForCredential(context.Background(), "cred-unknown")
	// No panic or error.
}

// =============================================================================
// 31. Refresh then remove one of two VKs — stale row deleted
// =============================================================================

func TestRefreshSnapshot_RemoveOneVK_StaleRowDeleted(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.vkRepo.keys = append(h.vkRepo.keys, &managedkey.ManagedVirtualKey{
		VirtualKeyID: "vk-2", OrgID: "org-1", SeatID: "seat-1", Alias: "temp-key",
		CurrentRevision: "vkrev-2", KeyStatus: managedkey.VirtualKeyStatusActive,
		ShareStatus: managedkey.ShareStatusClaimed,
	})

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")
	if len(h.store.snapshots["acct-1"]) != 2 {
		t.Fatal("expected 2 rows after initial refresh")
	}

	// Remove vk-2 from fact table.
	h.vkRepo.keys = h.vkRepo.keys[:1]

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 1 {
		t.Fatalf("expected 1 row after removing vk-2, got %d", len(snaps))
	}
	if snaps[0].VirtualKeyID != "vk-1" {
		t.Errorf("remaining VK = %q, want vk-1", snaps[0].VirtualKeyID)
	}
}

// =============================================================================
// 32. Idempotency — refreshing twice with same data produces same result
// =============================================================================

func TestRefreshSnapshot_Idempotent(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")
	snaps1 := make([]AccountKeySnapshot, len(h.store.snapshots["acct-1"]))
	copy(snaps1, h.store.snapshots["acct-1"])

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")
	snaps2 := h.store.snapshots["acct-1"]

	if len(snaps1) != len(snaps2) {
		t.Fatalf("row count changed: %d → %d", len(snaps1), len(snaps2))
	}
	for i := range snaps1 {
		if snaps1[i].VirtualKeyID != snaps2[i].VirtualKeyID {
			t.Errorf("row %d VirtualKeyID changed", i)
		}
		if snaps1[i].CredentialRevision != snaps2[i].CredentialRevision {
			t.Errorf("row %d CredentialRevision changed", i)
		}
	}
}

// =============================================================================
// 33. Concurrent tuple changes — credential + binding + VK revision all change
// =============================================================================

func TestRefreshSnapshot_SimultaneousTupleChanges(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	// Change everything at once.
	h.vkRepo.keys[0].CurrentRevision = "vkrev-new"
	h.bRepo.bindings[0].CredentialID = "cred-new"
	h.provLkp.credentials["cred-new"] = &provider.ManagedProviderCredential{
		CredentialID: "cred-new", ProviderID: "prov-1", CurrentRevision: "crev-new",
	}

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snap := h.store.snapshots["acct-1"][0]
	if snap.VirtualKeyRevision != "vkrev-new" {
		t.Errorf("VirtualKeyRevision = %q, want vkrev-new", snap.VirtualKeyRevision)
	}
	if snap.CredentialID != "cred-new" {
		t.Errorf("CredentialID = %q, want cred-new", snap.CredentialID)
	}
	if snap.CredentialRevision != "crev-new" {
		t.Errorf("CredentialRevision = %q, want crev-new", snap.CredentialRevision)
	}
}

// =============================================================================
// 34. Mixed seat statuses — one active, one suspended
// =============================================================================

func TestRefreshSnapshot_MixedSeatStatuses(t *testing.T) {
	h := newTestHarness()
	h.seatRepo.seats = []*organization.OrgSeat{
		{SeatID: "seat-1", OrgID: "org-1", AccountID: "acct-1", SeatStatus: organization.SeatStatusActive},
		{SeatID: "seat-2", OrgID: "org-1", AccountID: "acct-1", SeatStatus: organization.SeatStatusSuspended},
	}
	h.vkRepo.keys = []*managedkey.ManagedVirtualKey{
		{VirtualKeyID: "vk-1", OrgID: "org-1", SeatID: "seat-1", Alias: "active-seat-key",
			CurrentRevision: "r1", KeyStatus: managedkey.VirtualKeyStatusActive, ShareStatus: managedkey.ShareStatusClaimed},
		{VirtualKeyID: "vk-2", OrgID: "org-1", SeatID: "seat-2", Alias: "suspended-seat-key",
			CurrentRevision: "r2", KeyStatus: managedkey.VirtualKeyStatusActive, ShareStatus: managedkey.ShareStatusClaimed},
	}
	h.bRepo.bindings = []*managedkey.ManagedProviderBinding{
		{BindingID: "b1", OrgID: "org-1", VirtualKeyID: strPtr("vk-1"), ProviderID: "prov-1",
			CredentialID: "cred-1", ProtocolType: "openai_compatible", Status: managedkey.BindingStatusActive},
		{BindingID: "b2", OrgID: "org-1", VirtualKeyID: strPtr("vk-2"), ProviderID: "prov-1",
			CredentialID: "cred-1", ProtocolType: "openai_compatible", Status: managedkey.BindingStatusActive},
	}

	if err := h.svc.RefreshSnapshot(context.Background(), "acct-1"); err != nil {
		t.Fatalf("RefreshSnapshot: %v", err)
	}

	snaps := h.store.snapshots["acct-1"]
	if len(snaps) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(snaps))
	}

	for _, s := range snaps {
		switch s.VirtualKeyID {
		case "vk-1":
			if s.EffectiveStatus != "active" {
				t.Errorf("vk-1 (active seat) EffectiveStatus = %q, want active", s.EffectiveStatus)
			}
		case "vk-2":
			if s.EffectiveStatus != "inactive" || s.EffectiveReason != "seat_disabled" {
				t.Errorf("vk-2 (suspended seat) got (%q, %q), want (inactive, seat_disabled)",
					s.EffectiveStatus, s.EffectiveReason)
			}
		}
	}
}

// =============================================================================
// 35. SyncVersion initialized on first call
// =============================================================================

func TestGetOrInitSyncVersion_InitializesOnFirstCall(t *testing.T) {
	h := newTestHarness()

	v, err := h.svc.GetOrInitSyncVersion(context.Background(), "acct-new")
	if err != nil {
		t.Fatalf("GetOrInitSyncVersion: %v", err)
	}
	if v != 1 {
		t.Errorf("sync_version = %d, want 1", v)
	}

	// Second call returns same version.
	v2, _ := h.svc.GetOrInitSyncVersion(context.Background(), "acct-new")
	if v2 != 1 {
		t.Errorf("second call sync_version = %d, want 1 (no bump)", v2)
	}
}

// =============================================================================
// 36. BumpSyncVersion — increments monotonically
// =============================================================================

func TestBumpSyncVersion_Monotonic(t *testing.T) {
	h := newTestHarness()
	h.store.versions["acct-1"] = 5

	for i := 0; i < 3; i++ {
		if err := h.svc.BumpSyncVersion(context.Background(), "acct-1"); err != nil {
			t.Fatalf("BumpSyncVersion: %v", err)
		}
	}

	if h.store.versions["acct-1"] != 8 {
		t.Errorf("sync_version = %d, want 8", h.store.versions["acct-1"])
	}
}

// =============================================================================
// 37. ListByAccount error — RefreshSnapshot returns error
// =============================================================================

func TestRefreshSnapshot_ListByAccountError_ReturnsError(t *testing.T) {
	h := newTestHarness()
	h.seatRepo.err = errors.New("db connection lost")

	err := h.svc.RefreshSnapshot(context.Background(), "acct-1")
	if err == nil {
		t.Error("expected error from ListByAccount failure, got nil")
	}
}

// =============================================================================
// 38. Recycled VK — treated as key_revoked
// =============================================================================

func TestRefreshSnapshot_RecycledVK(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.vkRepo.keys[0].KeyStatus = managedkey.VirtualKeyStatusRecycled

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].EffectiveReason != "key_revoked" {
		t.Errorf("EffectiveReason = %q, want key_revoked for recycled VK", snaps[0].EffectiveReason)
	}
}

// =============================================================================
// 39. BumpForBindings — deduplicates accounts
// =============================================================================

func TestBumpForBindings_DeduplicatesAccounts(t *testing.T) {
	h := newTestHarness()
	// Both bindings belong to same account.
	h.store.bindingToAccount["b1"] = "acct-1"
	h.store.bindingToAccount["b2"] = "acct-1"
	h.store.versions["acct-1"] = 10

	h.svc.BumpForBindings(context.Background(), []string{"b1", "b2"})

	// Should bump only once (dedup).
	if h.store.versions["acct-1"] != 11 {
		t.Errorf("sync_version = %d, want 11 (bumped once, not twice)", h.store.versions["acct-1"])
	}
}

// =============================================================================
// 40. Alias preserved in projection
// =============================================================================

func TestRefreshSnapshot_AliasPreserved(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()
	h.vkRepo.keys[0].Alias = "my-custom-alias"

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].Alias != "my-custom-alias" {
		t.Errorf("Alias = %q, want my-custom-alias", snaps[0].Alias)
	}
}

// =============================================================================
// 41. OrgID preserved in projection
// =============================================================================

func TestRefreshSnapshot_OrgIDPreserved(t *testing.T) {
	h := newTestHarness()
	h.seedStandardSetup()

	_ = h.svc.RefreshSnapshot(context.Background(), "acct-1")

	snaps := h.store.snapshots["acct-1"]
	if snaps[0].OrgID != "org-1" {
		t.Errorf("OrgID = %q, want org-1", snaps[0].OrgID)
	}
}
