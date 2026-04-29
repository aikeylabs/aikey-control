package snapshot

// PostgreSQL implementation of SnapshotRepository. Used in
// production (aikey-control-service). The SQLite counterpart lives
// in sqlite.go; dialect dispatch (factory) is in
// NewServiceWithDialect inside service.go.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/lib/pq"
)

type postgresSnapshotRepo struct {
	db *sql.DB
}

func (s *postgresSnapshotRepo) GetOrInitSyncVersion(ctx context.Context, accountID string) (int64, error) {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO account_sync_versions (account_id, sync_version, updated_at)
		VALUES ($1, 1, NOW())
		ON CONFLICT (account_id) DO NOTHING
	`, accountID)
	if err != nil {
		return 0, fmt.Errorf("init sync version: %w", err)
	}
	var version int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT sync_version FROM account_sync_versions WHERE account_id = $1`,
		accountID,
	).Scan(&version); err != nil {
		return 0, fmt.Errorf("get sync version: %w", err)
	}
	return version, nil
}

func (s *postgresSnapshotRepo) BumpSyncVersion(ctx context.Context, accountID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO account_sync_versions (account_id, sync_version, updated_at)
		VALUES ($1, 1, NOW())
		ON CONFLICT (account_id) DO UPDATE
		    SET sync_version = account_sync_versions.sync_version + 1,
		        updated_at   = NOW()
	`, accountID)
	if err != nil {
		return fmt.Errorf("bump sync version for %s: %w", accountID, err)
	}
	return nil
}

func (s *postgresSnapshotRepo) UpsertSnapshot(ctx context.Context, accountID string, snap *AccountKeySnapshot) error {
	spJSON, _ := json.Marshal(snap.SupportedProviders)
	buJSON, _ := json.Marshal(snap.ProviderBaseURLs)

	var expiresAt *time.Time
	if snap.ExpiresAt != nil {
		t := time.Unix(*snap.ExpiresAt, 0).UTC()
		expiresAt = &t
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO account_managed_virtual_keys (
		    account_id, virtual_key_id, org_id, seat_id, alias,
		    provider_code, protocol_type, base_url,
		    supported_providers, provider_base_urls,
		    credential_id, credential_revision, virtual_key_revision,
		    key_status, share_status,
		    effective_status, effective_reason,
		    expires_at, sync_version, updated_at
		) VALUES (
		    $1, $2, $3, $4, $5,
		    $6, $7, $8,
		    $9, $10,
		    $11, $12, $13,
		    $14, $15,
		    $16, $17,
		    $18, $19, NOW()
		)
		ON CONFLICT (account_id, virtual_key_id) DO UPDATE SET
		    org_id               = EXCLUDED.org_id,
		    seat_id              = EXCLUDED.seat_id,
		    alias                = EXCLUDED.alias,
		    provider_code        = EXCLUDED.provider_code,
		    protocol_type        = EXCLUDED.protocol_type,
		    base_url             = EXCLUDED.base_url,
		    supported_providers  = EXCLUDED.supported_providers,
		    provider_base_urls   = EXCLUDED.provider_base_urls,
		    credential_id        = EXCLUDED.credential_id,
		    credential_revision  = EXCLUDED.credential_revision,
		    virtual_key_revision = EXCLUDED.virtual_key_revision,
		    key_status           = EXCLUDED.key_status,
		    share_status         = EXCLUDED.share_status,
		    effective_status     = EXCLUDED.effective_status,
		    effective_reason     = EXCLUDED.effective_reason,
		    expires_at           = EXCLUDED.expires_at,
		    sync_version         = EXCLUDED.sync_version,
		    updated_at           = NOW()
	`, accountID, snap.VirtualKeyID, snap.OrgID, snap.SeatID, snap.Alias,
		snap.ProviderCode, snap.ProtocolType, snap.BaseURL,
		string(spJSON), string(buJSON),
		snap.CredentialID, snap.CredentialRevision, snap.VirtualKeyRevision,
		snap.KeyStatus, snap.ShareStatus,
		snap.EffectiveStatus, snap.EffectiveReason,
		expiresAt, snap.SyncVersion)
	return err
}

func (s *postgresSnapshotRepo) DeleteStaleSnapshots(ctx context.Context, accountID string, processedVKIDs []string) error {
	if len(processedVKIDs) > 0 {
		_, err := s.db.ExecContext(ctx, `
			DELETE FROM account_managed_virtual_keys
			 WHERE account_id = $1
			   AND NOT (virtual_key_id = ANY($2))
		`, accountID, pq.Array(processedVKIDs))
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM account_managed_virtual_keys
		 WHERE account_id = $1
	`, accountID)
	return err
}

func (s *postgresSnapshotRepo) ListSnapshots(ctx context.Context, accountID string) ([]AccountKeySnapshot, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT virtual_key_id, org_id, seat_id, alias,
		       provider_code, protocol_type, base_url,
		       supported_providers, provider_base_urls,
		       credential_id, credential_revision, virtual_key_revision,
		       key_status, share_status,
		       effective_status, effective_reason,
		       EXTRACT(EPOCH FROM expires_at)::bigint AS expires_at, sync_version
		  FROM account_managed_virtual_keys
		 WHERE account_id = $1
		 ORDER BY alias
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	defer rows.Close()

	var result []AccountKeySnapshot
	for rows.Next() {
		var snap AccountKeySnapshot
		var spJSON, buJSON string
		var expiresAt sql.NullInt64
		if err := rows.Scan(
			&snap.VirtualKeyID, &snap.OrgID, &snap.SeatID, &snap.Alias,
			&snap.ProviderCode, &snap.ProtocolType, &snap.BaseURL,
			&spJSON, &buJSON,
			&snap.CredentialID, &snap.CredentialRevision, &snap.VirtualKeyRevision,
			&snap.KeyStatus, &snap.ShareStatus,
			&snap.EffectiveStatus, &snap.EffectiveReason,
			&expiresAt, &snap.SyncVersion,
		); err != nil {
			return nil, fmt.Errorf("scan snapshot row: %w", err)
		}
		_ = json.Unmarshal([]byte(spJSON), &snap.SupportedProviders)
		_ = json.Unmarshal([]byte(buJSON), &snap.ProviderBaseURLs)
		if expiresAt.Valid {
			snap.ExpiresAt = &expiresAt.Int64
		}
		if snap.SupportedProviders == nil {
			snap.SupportedProviders = []string{}
		}
		if snap.ProviderBaseURLs == nil {
			snap.ProviderBaseURLs = map[string]string{}
		}
		result = append(result, snap)
	}
	if result == nil {
		result = []AccountKeySnapshot{}
	}
	return result, rows.Err()
}

func (s *postgresSnapshotRepo) ResolveAccountForSeat(ctx context.Context, seatID string) (string, error) {
	var accountID string
	err := s.db.QueryRowContext(ctx,
		`SELECT account_id FROM org_seats WHERE seat_id = $1 AND account_id IS NOT NULL AND account_id != ''`,
		seatID,
	).Scan(&accountID)
	if err != nil {
		return "", err
	}
	return accountID, nil
}

func (s *postgresSnapshotRepo) ResolveAccountForVirtualKey(ctx context.Context, virtualKeyID string) (string, error) {
	var accountID string
	err := s.db.QueryRowContext(ctx, `
		SELECT s.account_id
		  FROM managed_virtual_keys vk
		  JOIN org_seats s ON vk.seat_id = s.seat_id
		 WHERE vk.virtual_key_id = $1
		   AND s.account_id IS NOT NULL
		   AND s.account_id != ''
	`, virtualKeyID).Scan(&accountID)
	if err != nil {
		return "", err
	}
	return accountID, nil
}

func (s *postgresSnapshotRepo) ResolveAccountsForBindings(ctx context.Context, bindingIDs []string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT s.account_id
		  FROM managed_provider_bindings b
		  JOIN managed_virtual_keys vk ON b.virtual_key_id = vk.virtual_key_id
		  JOIN org_seats s ON vk.seat_id = s.seat_id
		 WHERE b.binding_id = ANY($1)
		   AND s.account_id IS NOT NULL
		   AND s.account_id != ''
	`, pq.Array(bindingIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			continue
		}
		result = append(result, accountID)
	}
	return result, nil
}

func (s *postgresSnapshotRepo) ResolveAccountsForCredential(ctx context.Context, credentialID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT s.account_id
		  FROM managed_provider_bindings b
		  JOIN managed_virtual_keys vk ON b.virtual_key_id = vk.virtual_key_id
		  JOIN org_seats s ON vk.seat_id = s.seat_id
		 WHERE b.credential_id = $1
		   AND s.account_id IS NOT NULL
		   AND s.account_id != ''
	`, credentialID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var accountID string
		if err := rows.Scan(&accountID); err != nil {
			continue
		}
		result = append(result, accountID)
	}
	return result, nil
}
