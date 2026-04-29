package snapshot

// Snapshot Service + its DI wiring. AccountKeySnapshot lives in
// domain.go; SnapshotRepository interface lives in repository.go;
// concrete PG / SQLite implementations live in postgres.go / sqlite.go.
// NewServiceWithDialect is the factory called from cmd / appkit that
// picks the right repository implementation at assembly time.

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/AiKeyLabs/aikey-control-service/pkg/identity"
	"github.com/AiKeyLabs/aikey-control-service/pkg/managedkey"
	"github.com/AiKeyLabs/aikey-control-service/internal/organization"
	"github.com/AiKeyLabs/aikey-control-service/internal/provider"
)

// ProviderLookup is a narrow interface for resolving credential and provider metadata.
// Kept thin to avoid importing the full provider.Service in tests.
type ProviderLookup interface {
	GetCredential(ctx context.Context, credentialID string) (*provider.ManagedProviderCredential, error)
	GetProvider(ctx context.Context, providerID string) (*provider.Provider, error)
}

// Service maintains the account_managed_virtual_keys projection and the
// account_sync_versions counter.
//
// Responsibilities:
//   - GetOrInitSyncVersion: lightweight version check (used by GET /accounts/me/sync-version).
//   - RefreshSnapshot: recompute projection from live tables + bump sync_version
//     (used by GET /accounts/me/managed-keys-snapshot and key mutation paths).
//   - GetSnapshot: read current projection rows.
type Service struct {
	repo         SnapshotRepository
	seatRepo     organization.SeatRepository
	vkRepo       managedkey.VirtualKeyRepository
	bindingRepo  managedkey.BindingRepository
	providerSvc  ProviderLookup
	identityRepo identity.Repository
}

// NewService creates a Service backed by a real PostgreSQL database.
// This is the production constructor called from cmd/main.go.
func NewService(
	db *sql.DB,
	seatRepo organization.SeatRepository,
	vkRepo managedkey.VirtualKeyRepository,
	bindingRepo managedkey.BindingRepository,
	providerSvc *provider.Service,
	identityRepo identity.Repository,
) *Service {
	return &Service{
		repo:         &postgresSnapshotRepo{db: db},
		seatRepo:     seatRepo,
		vkRepo:       vkRepo,
		bindingRepo:  bindingRepo,
		providerSvc:  providerSvc,
		identityRepo: identityRepo,
	}
}

// NewServiceWithDialect creates a Service that picks the correct
// SnapshotRepository implementation based on dialect ("postgres" or "sqlite").
// Why: the postgresSnapshotRepo uses PG-specific SQL (NOW(), EXTRACT, pq.Array)
// that silently fails on SQLite, leaving account_managed_virtual_keys empty.
func NewServiceWithDialect(
	db *sql.DB,
	dialect string,
	seatRepo organization.SeatRepository,
	vkRepo managedkey.VirtualKeyRepository,
	bindingRepo managedkey.BindingRepository,
	providerSvc *provider.Service,
	identityRepo identity.Repository,
) *Service {
	var repo SnapshotRepository
	if dialect == "sqlite" {
		repo = &sqliteSnapshotRepo{db: db}
	} else {
		repo = &postgresSnapshotRepo{db: db}
	}
	return &Service{
		repo:         repo,
		seatRepo:     seatRepo,
		vkRepo:       vkRepo,
		bindingRepo:  bindingRepo,
		providerSvc:  providerSvc,
		identityRepo: identityRepo,
	}
}

// NewServiceWithRepository creates a Service with an explicit SnapshotRepository.
// Used in tests to inject a mock repo.
func NewServiceWithRepository(
	repo SnapshotRepository,
	seatRepo organization.SeatRepository,
	vkRepo managedkey.VirtualKeyRepository,
	bindingRepo managedkey.BindingRepository,
	providerSvc ProviderLookup,
	identityRepo identity.Repository,
) *Service {
	return &Service{
		repo:         repo,
		seatRepo:     seatRepo,
		vkRepo:       vkRepo,
		bindingRepo:  bindingRepo,
		providerSvc:  providerSvc,
		identityRepo: identityRepo,
	}
}

// GetOrInitSyncVersion returns the current sync_version for accountID.
// If no record exists yet, inserts sync_version=1 so the CLI (which starts
// with local_seen=0) always performs an initial sync on first run.
func (s *Service) GetOrInitSyncVersion(ctx context.Context, accountID string) (int64, error) {
	return s.repo.GetOrInitSyncVersion(ctx, accountID)
}

// BumpSyncVersion increments sync_version for accountID by 1 (or inserts with
// version=1 if no record exists). Called after every RefreshSnapshot and from
// key mutation paths so the CLI knows data has changed.
func (s *Service) BumpSyncVersion(ctx context.Context, accountID string) error {
	return s.repo.BumpSyncVersion(ctx, accountID)
}

// computeEffectiveStatus derives the effective (status, reason) pair for a virtual key
// given the current account, seat, and key states.
//
// Priority order: account disabled > seat inactive > key status > share status.
// This function is pure and has no side effects, making it independently testable.
func computeEffectiveStatus(
	accountDisabled bool,
	seatInactive bool,
	keyStatus string,
	shareStatus string,
) (status, reason string) {
	if accountDisabled {
		return "inactive", "account_disabled"
	}
	if seatInactive {
		return "inactive", "seat_disabled"
	}
	switch keyStatus {
	case managedkey.VirtualKeyStatusRevoked, managedkey.VirtualKeyStatusRecycled:
		return "inactive", "key_revoked"
	case managedkey.VirtualKeyStatusExpired:
		return "inactive", "key_expired"
	}
	// share_status (pending_claim / claimed) is display-only, not a delivery gate.
	// VK is deliverable as long as key_status is active and seat/account are OK.
	return "active", ""
}

// RefreshSnapshot recomputes the account's key snapshot from live tables
// and upserts rows into account_managed_virtual_keys using the current sync_version.
//
// Called from:
//   - GET /accounts/me/managed-keys-snapshot (always fresh on read)
//   - Key mutation paths: IssueVirtualKey, RevokeVirtualKey, RotateVirtualKey,
//     ClaimKey, SuspendSeat, ActivateSeat (so the CLI detects changes promptly)
func (s *Service) RefreshSnapshot(ctx context.Context, accountID string) error {
	currentVersion, err := s.repo.GetOrInitSyncVersion(ctx, accountID)
	if err != nil {
		return fmt.Errorf("get sync version: %w", err)
	}

	seats, err := s.seatRepo.ListByAccount(ctx, accountID)
	if err != nil {
		return fmt.Errorf("list seats for %s: %w", accountID, err)
	}

	acct, _ := s.identityRepo.FindByID(ctx, accountID)
	accountDisabled := acct != nil && !acct.IsActive()

	var processedIDs []string
	var hasFetchError bool

	for _, seat := range seats {
		vks, err := s.vkRepo.ListBySeat(ctx, seat.SeatID)
		if err != nil {
			// Non-fatal: log the error but continue with other seats.
			hasFetchError = true
			continue
		}

		// Derive seat-level effective status.
		seatInactive := seat.SeatStatus == organization.SeatStatusSuspended ||
			seat.SeatStatus == organization.SeatStatusRevoked

		for _, vk := range vks {
			effectiveStatus, effectiveReason := computeEffectiveStatus(
				accountDisabled, seatInactive, vk.KeyStatus, vk.ShareStatus,
			)

			// Collect binding metadata (provider_code, base_url, supported_providers, …).
			var providerCode, protocolType, baseURL, credentialID, credentialRevision string
			supportedProviders := []string{}
			providerBaseURLs := map[string]string{}

			if bindings, _ := s.bindingRepo.ListByVirtualKey(ctx, vk.VirtualKeyID); len(bindings) > 0 {
				for _, b := range bindings {
					if b.Status != managedkey.BindingStatusActive {
						continue
					}
					cred, _ := s.providerSvc.GetCredential(ctx, b.CredentialID)
					if cred == nil {
						continue
					}
					prov, _ := s.providerSvc.GetProvider(ctx, cred.ProviderID)
					if prov == nil {
						continue
					}
					bURL := prov.DefaultBaseURL
					if cred.BaseURLOverride != "" {
						bURL = cred.BaseURLOverride
					}
					supportedProviders = append(supportedProviders, prov.ProviderCode)
					providerBaseURLs[prov.ProviderCode] = bURL
					// Primary fields from the first active binding encountered.
					if providerCode == "" {
						providerCode = prov.ProviderCode
						protocolType = b.ProtocolType
						baseURL = bURL
						credentialID = b.CredentialID
						credentialRevision = cred.CurrentRevision
					}
				}
			}
			if protocolType == "" {
				protocolType = "openai_compatible"
			}

			var expiresAt *int64
			if vk.ExpiresAt != nil {
				unix := vk.ExpiresAt.Unix()
				expiresAt = &unix
			}

			snap := &AccountKeySnapshot{
				VirtualKeyID:       vk.VirtualKeyID,
				OrgID:              vk.OrgID,
				SeatID:             seat.SeatID,
				Alias:              vk.Alias,
				ProviderCode:       providerCode,
				ProtocolType:       protocolType,
				BaseURL:            baseURL,
				SupportedProviders: supportedProviders,
				ProviderBaseURLs:   providerBaseURLs,
				CredentialID:       credentialID,
				CredentialRevision: credentialRevision,
				VirtualKeyRevision: vk.CurrentRevision,
				KeyStatus:          vk.KeyStatus,
				ShareStatus:        vk.ShareStatus,
				EffectiveStatus:    effectiveStatus,
				EffectiveReason:    effectiveReason,
				ExpiresAt:          expiresAt,
				SyncVersion:        currentVersion,
			}

			if err := s.repo.UpsertSnapshot(ctx, accountID, snap); err != nil {
				// Non-fatal: keep going, but suppress the delete step so we don't
				// remove projection rows that we failed to re-upsert.
				hasFetchError = true
				continue
			}
			processedIDs = append(processedIDs, vk.VirtualKeyID)
		}
	}

	// Delete projection rows that are no longer part of this account's snapshot.
	// Only run if all seat fetches succeeded to avoid erasing keys on partial failure.
	if !hasFetchError {
		_ = s.repo.DeleteStaleSnapshots(ctx, accountID, processedIDs)
	}

	return nil
}

// GetSnapshot reads all projection rows for accountID from account_managed_virtual_keys.
func (s *Service) GetSnapshot(ctx context.Context, accountID string) ([]AccountKeySnapshot, error) {
	return s.repo.ListSnapshots(ctx, accountID)
}

// BumpForSeat looks up the account for seatID and bumps their sync_version.
// Non-fatal: errors are silently ignored since this is a best-effort signal.
func (s *Service) BumpForSeat(ctx context.Context, seatID string) {
	accountID, err := s.repo.ResolveAccountForSeat(ctx, seatID)
	if err != nil || accountID == "" {
		return
	}
	_ = s.repo.BumpSyncVersion(ctx, accountID)
}

// BumpForVirtualKey looks up the account for the seat that owns virtualKeyID
// and bumps their sync_version. Non-fatal.
func (s *Service) BumpForVirtualKey(ctx context.Context, virtualKeyID string) {
	accountID, err := s.repo.ResolveAccountForVirtualKey(ctx, virtualKeyID)
	if err != nil || accountID == "" {
		return
	}
	_ = s.repo.BumpSyncVersion(ctx, accountID)
}

// BumpForBindings looks up all accounts affected by the given binding IDs
// and bumps their sync_version. Non-fatal.
func (s *Service) BumpForBindings(ctx context.Context, bindingIDs []string) {
	if len(bindingIDs) == 0 {
		return
	}
	accountIDs, err := s.repo.ResolveAccountsForBindings(ctx, bindingIDs)
	if err != nil {
		return
	}
	for _, accountID := range accountIDs {
		_ = s.repo.BumpSyncVersion(ctx, accountID)
	}
}

// BumpForCredential looks up all accounts that have keys bound to credentialID
// and bumps their sync_version. Used after credential rotation or migration.
// Non-fatal: errors are silently ignored.
func (s *Service) BumpForCredential(ctx context.Context, credentialID string) {
	accountIDs, err := s.repo.ResolveAccountsForCredential(ctx, credentialID)
	if err != nil {
		return
	}
	for _, accountID := range accountIDs {
		_ = s.repo.BumpSyncVersion(ctx, accountID)
	}
}
