package managedkey

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// ---- Binding repo (SQLite) ----

type sqliteBindingRepo struct{ db *shared.DB }

// NewSQLiteBindingRepository creates a SQLite-backed binding repository.
func NewSQLiteBindingRepository(db *shared.DB) BindingRepository {
	return &sqliteBindingRepo{db: db}
}

func (r *sqliteBindingRepo) Create(ctx context.Context, b *ManagedProviderBinding) error {
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO managed_provider_bindings
			(binding_id, org_id, virtual_key_id, provider_id, credential_id, protocol_type,
			 priority, fallback_role, binding_alias, binding_status, updated_at, updated_by)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		b.BindingID, b.OrgID, nullableStr(b.VirtualKeyID), b.ProviderID, b.CredentialID, b.ProtocolType,
		b.Priority, b.FallbackRole, b.BindingAlias, b.Status, now, b.UpdatedBy,
	)
	return r.db.TranslateError(err)
}

func (r *sqliteBindingRepo) FindByID(ctx context.Context, id string) (*ManagedProviderBinding, error) {
	row := r.db.QueryRowContext(ctx,
		bindingSelectCols+` WHERE binding_id = ?`, id)
	return scanBinding(row)
}

func (r *sqliteBindingRepo) ListByOrg(ctx context.Context, orgID string) ([]*ManagedProviderBinding, error) {
	rows, err := r.db.QueryContext(ctx,
		bindingSelectCols+` WHERE org_id = ? ORDER BY binding_alias`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBindings(rows)
}

func (r *sqliteBindingRepo) ListByVirtualKey(ctx context.Context, virtualKeyID string) ([]*ManagedProviderBinding, error) {
	rows, err := r.db.QueryContext(ctx,
		bindingSelectCols+` WHERE virtual_key_id = ? ORDER BY protocol_type, priority ASC`, virtualKeyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBindings(rows)
}

func (r *sqliteBindingRepo) FindActiveByVirtualKeyAndProtocol(ctx context.Context, virtualKeyID, protocolType string) ([]*ManagedProviderBinding, error) {
	rows, err := r.db.QueryContext(ctx,
		bindingSelectCols+` WHERE virtual_key_id = ? AND protocol_type = ? AND binding_status = 'active' ORDER BY priority ASC`,
		virtualKeyID, protocolType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBindings(rows)
}

func (r *sqliteBindingRepo) FindActiveByVirtualKeyProtocolAndProvider(ctx context.Context, virtualKeyID, protocolType, providerID string) (*ManagedProviderBinding, error) {
	row := r.db.QueryRowContext(ctx,
		bindingSelectCols+` WHERE virtual_key_id = ? AND protocol_type = ? AND provider_id = ? AND binding_status = 'active'`,
		virtualKeyID, protocolType, providerID)
	return scanBinding(row)
}

func (r *sqliteBindingRepo) UpdateCredential(ctx context.Context, bindingID, credentialID, updatedBy string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_provider_bindings
		SET credential_id = ?, updated_by = ?, updated_at = ?
		WHERE binding_id = ?`,
		credentialID, updatedBy, time.Now().UTC(), bindingID,
	)
	return err
}

func (r *sqliteBindingRepo) UpdateStatus(ctx context.Context, bindingID, status string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_provider_bindings SET binding_status = ?, updated_at = ? WHERE binding_id = ?`,
		status, time.Now().UTC(), bindingID,
	)
	return err
}

// ---- VirtualKey repo (SQLite) ----

type sqliteVirtualKeyRepo struct{ db *shared.DB }

// NewSQLiteVirtualKeyRepository creates a SQLite-backed virtual key repository.
func NewSQLiteVirtualKeyRepository(db *shared.DB) VirtualKeyRepository {
	return &sqliteVirtualKeyRepo{db: db}
}

func (r *sqliteVirtualKeyRepo) Create(ctx context.Context, vk *ManagedVirtualKey) error {
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO managed_virtual_keys
			(virtual_key_id, org_id, seat_id, alias, token_hash,
			 current_revision, key_status, share_status,
			 delivered_at, claimed_at, revoked_at, recycled_at, reissued_at,
			 last_delivery_at, delivery_count, expires_at, updated_at, updated_by)
		VALUES (?,?,?,?,?,?,?,?,
		        ?,?,?,?,?,?,?,?,?,?)`,
		vk.VirtualKeyID, vk.OrgID, vk.SeatID, vk.Alias, vk.TokenHash,
		vk.CurrentRevision, vk.KeyStatus, vk.ShareStatus,
		nullableTime(vk.DeliveredAt), nullableTime(vk.ClaimedAt),
		nullableTime(vk.RevokedAt), nullableTime(vk.RecycledAt),
		nullableTime(vk.ReissuedAt), nullableTime(vk.LastDeliveryAt),
		vk.DeliveryCount, nullableTime(vk.ExpiresAt), now, vk.UpdatedBy,
	)
	return r.db.TranslateError(err)
}

func (r *sqliteVirtualKeyRepo) FindByID(ctx context.Context, id string) (*ManagedVirtualKey, error) {
	row := r.db.QueryRowContext(ctx, virtualKeySelectCols+` WHERE virtual_key_id = ?`, id)
	return scanVirtualKey(row)
}

func (r *sqliteVirtualKeyRepo) FindByTokenHash(ctx context.Context, hash string) (*ManagedVirtualKey, error) {
	row := r.db.QueryRowContext(ctx, virtualKeySelectCols+` WHERE token_hash = ?`, hash)
	return scanVirtualKey(row)
}

func (r *sqliteVirtualKeyRepo) ListByOrg(ctx context.Context, orgID string) ([]*ManagedVirtualKey, error) {
	rows, err := r.db.QueryContext(ctx, virtualKeySelectCols+` WHERE org_id = ? ORDER BY alias`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanVirtualKeys(rows)
}

func (r *sqliteVirtualKeyRepo) ListBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error) {
	if seatID == "" {
		return nil, nil
	}
	rows, err := r.db.QueryContext(ctx, virtualKeySelectCols+` WHERE seat_id = ? ORDER BY alias`, seatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanVirtualKeys(rows)
}

func (r *sqliteVirtualKeyRepo) ListPendingClaimBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error) {
	rows, err := r.db.QueryContext(ctx,
		virtualKeySelectCols+` WHERE seat_id = ? AND share_status = 'pending_claim' ORDER BY alias`, seatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanVirtualKeys(rows)
}

func (r *sqliteVirtualKeyRepo) UpdateStatus(ctx context.Context, id, status, updatedBy string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_virtual_keys
		SET key_status = ?, updated_by = ?, updated_at = ?,
		    revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END
		WHERE virtual_key_id = ?`,
		status, updatedBy, time.Now().UTC(), status, time.Now().UTC(), id,
	)
	return err
}

func (r *sqliteVirtualKeyRepo) UpdateShareStatus(ctx context.Context, id, shareStatus string) error {
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_virtual_keys
		SET share_status = ?, updated_at = ?,
		    claimed_at = CASE WHEN ? = 'claimed' THEN ? ELSE claimed_at END
		WHERE virtual_key_id = ?`,
		shareStatus, now, shareStatus, now, id,
	)
	return err
}

// ReconcileShareStatusByEmail batch-transitions share_status from pending_claim
// to claimed for VKs on seats that just became active for this email.
// Why: when a VK is issued BEFORE the member logs in, share_status stays
// pending_claim even after seat reconciliation. This closes that gap.
func (r *sqliteVirtualKeyRepo) ReconcileShareStatusByEmail(ctx context.Context, email string) (int, error) {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx, `
		UPDATE managed_virtual_keys
		SET share_status = 'claimed',
		    claimed_at   = COALESCE(claimed_at, ?),
		    updated_at   = ?
		WHERE share_status = 'pending_claim'
		  AND key_status   = 'active'
		  AND seat_id IN (
		      SELECT seat_id FROM org_seats
		      WHERE invited_email = ?
		        AND seat_status   = 'active'
		  )`,
		now, now, email,
	)
	if err != nil {
		return 0, fmt.Errorf("reconcile VK share_status by email: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (r *sqliteVirtualKeyRepo) RecordDelivery(ctx context.Context, id string) error {
	now := time.Now().UTC()
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_virtual_keys
		SET delivery_count   = delivery_count + 1,
		    last_delivery_at = ?,
		    delivered_at     = COALESCE(delivered_at, ?),
		    updated_at       = ?
		WHERE virtual_key_id = ?`,
		now, now, now, id,
	)
	return err
}

func (r *sqliteVirtualKeyRepo) RotateToken(ctx context.Context, id, newHash, newRevision, updatedBy string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_virtual_keys
		SET token_hash = ?, current_revision = ?,
		    updated_by = ?, updated_at = ?
		WHERE virtual_key_id = ?`,
		newHash, newRevision, updatedBy, time.Now().UTC(), id,
	)
	return err
}

func (r *sqliteVirtualKeyRepo) LastAnchorTuple(ctx context.Context, virtualKeyID, bindingID string) (AnchorTuple, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT virtual_key_id, seat_id, binding_id, credential_id,
		       virtual_key_revision, credential_revision
		FROM managed_key_control_events
		WHERE virtual_key_id = ? AND binding_id = ?
		ORDER BY changed_at DESC
		LIMIT 1`, virtualKeyID, bindingID)

	var t AnchorTuple
	var bindingIDVal sql.NullString
	err := row.Scan(&t.VirtualKeyID, &t.SeatID, &bindingIDVal, &t.CredentialID,
		&t.VirtualKeyRevision, &t.CredentialRevision)
	if err == sql.ErrNoRows {
		return AnchorTuple{}, nil
	}
	if err != nil {
		return AnchorTuple{}, fmt.Errorf("scan anchor tuple: %w", err)
	}
	if bindingIDVal.Valid {
		t.BindingID = bindingIDVal.String
	}
	return t, nil
}

// ---- ControlEvent repo (SQLite) ----

type sqliteControlEventRepo struct{ db *shared.DB }

// NewSQLiteControlEventRepository creates a SQLite-backed control event repository.
func NewSQLiteControlEventRepository(db *shared.DB) ControlEventRepository {
	return &sqliteControlEventRepo{db: db}
}

func (r *sqliteControlEventRepo) Insert(ctx context.Context, e *ControlEvent) error {
	var bindingID sql.NullString
	if e.BindingID != "" {
		bindingID = sql.NullString{String: e.BindingID, Valid: true}
	}
	var accountID sql.NullString
	if e.AccountID != "" {
		accountID = sql.NullString{String: e.AccountID, Valid: true}
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO managed_key_control_events
			(event_id, org_id, account_id, change_source, change_type, entity_type, entity_id,
			 correlation_id, provider_id, seat_id, virtual_key_id, virtual_key_revision,
			 binding_id, credential_id, credential_revision, revision,
			 effective_from, effective_to, changed_at, changed_by, reason,
			 before_snapshot_json, after_snapshot_json)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		e.EventID, e.OrgID, accountID, e.ChangeSource, e.ChangeType, e.EntityType, e.EntityID,
		e.CorrelationID, e.ProviderID, e.SeatID, e.VirtualKeyID, e.VirtualKeyRevision,
		bindingID, e.CredentialID, e.CredentialRevision, e.Revision,
		r.db.BindMillis(e.EffectiveFrom), r.db.BindMillisPtr(e.EffectiveTo), r.db.BindMillis(e.ChangedAt), e.ChangedBy, e.Reason,
		e.BeforeSnapshotJSON, e.AfterSnapshotJSON,
	)
	return err
}

func (r *sqliteControlEventRepo) ListByOrg(ctx context.Context, orgID string) ([]*ControlEvent, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT e.event_id, e.org_id, e.account_id, e.change_source, e.change_type, e.entity_type, e.entity_id,
		       e.correlation_id, e.provider_id, e.seat_id, e.virtual_key_id, e.virtual_key_revision,
		       e.binding_id, e.credential_id, e.credential_revision, e.revision,
		       e.effective_from, e.effective_to, e.changed_at, e.changed_by, e.reason,
		       e.before_snapshot_json, e.after_snapshot_json,
		       ga.email
		FROM managed_key_control_events e
		LEFT JOIN global_accounts ga ON e.changed_by = ga.account_id
		WHERE e.org_id = ? ORDER BY e.changed_at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEvents(rows)
}

func (r *sqliteControlEventRepo) ListByVirtualKey(ctx context.Context, virtualKeyID string) ([]*ControlEvent, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT e.event_id, e.org_id, e.account_id, e.change_source, e.change_type, e.entity_type, e.entity_id,
		       e.correlation_id, e.provider_id, e.seat_id, e.virtual_key_id, e.virtual_key_revision,
		       e.binding_id, e.credential_id, e.credential_revision, e.revision,
		       e.effective_from, e.effective_to, e.changed_at, e.changed_by, e.reason,
		       e.before_snapshot_json, e.after_snapshot_json,
		       ga.email
		FROM managed_key_control_events e
		LEFT JOIN global_accounts ga ON e.changed_by = ga.account_id
		WHERE e.virtual_key_id = ? ORDER BY e.changed_at DESC`, virtualKeyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEvents(rows)
}

// ---- CredentialLookup (SQLite) ----

type sqliteCredentialLookup struct{ db *shared.DB }

// NewSQLiteCredentialLookup creates a CredentialLookup backed by SQLite.
func NewSQLiteCredentialLookup(db *shared.DB) CredentialLookup {
	return &sqliteCredentialLookup{db: db}
}

func (l *sqliteCredentialLookup) GetRevision(ctx context.Context, credentialID string) (string, error) {
	var revision string
	err := l.db.QueryRowContext(ctx,
		`SELECT current_revision FROM managed_provider_credentials WHERE credential_id = ?`,
		credentialID,
	).Scan(&revision)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return revision, err
}

func (l *sqliteCredentialLookup) GetProviderID(ctx context.Context, credentialID string) (string, error) {
	var providerID string
	err := l.db.QueryRowContext(ctx,
		`SELECT provider_id FROM managed_provider_credentials WHERE credential_id = ?`,
		credentialID,
	).Scan(&providerID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return providerID, err
}

func (l *sqliteCredentialLookup) GetProtocolType(ctx context.Context, credentialID string) (string, error) {
	var protocolType string
	err := l.db.QueryRowContext(ctx, `
		SELECT p.protocol_type
		FROM managed_provider_credentials c
		JOIN providers p ON c.provider_id = p.provider_id
		WHERE c.credential_id = ?`,
		credentialID,
	).Scan(&protocolType)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return protocolType, err
}
