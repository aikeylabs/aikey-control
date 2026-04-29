package managedkey

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/AiKeyLabs/aikey-control-service/pkg/shared"
	"github.com/AiKeyLabs/pkg/aikeytime"
)

// ---- Binding repo ----

type postgresBindingRepo struct{ db *shared.DB }

// NewPostgresBindingRepository creates a PostgreSQL-backed binding repository.
func NewPostgresBindingRepository(db *shared.DB) BindingRepository {
	return &postgresBindingRepo{db: db}
}

func (r *postgresBindingRepo) Create(ctx context.Context, b *ManagedProviderBinding) error {
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

func (r *postgresBindingRepo) FindByID(ctx context.Context, id string) (*ManagedProviderBinding, error) {
	row := r.db.QueryRowContext(ctx,
		bindingSelectCols+` WHERE binding_id = ?`, id)
	return scanBinding(row)
}

func (r *postgresBindingRepo) ListByOrg(ctx context.Context, orgID string) ([]*ManagedProviderBinding, error) {
	rows, err := r.db.QueryContext(ctx,
		bindingSelectCols+` WHERE org_id = ? ORDER BY binding_alias`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBindings(rows)
}

func (r *postgresBindingRepo) ListByVirtualKey(ctx context.Context, virtualKeyID string) ([]*ManagedProviderBinding, error) {
	rows, err := r.db.QueryContext(ctx,
		bindingSelectCols+` WHERE virtual_key_id = ? ORDER BY protocol_type, priority ASC`, virtualKeyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBindings(rows)
}

// FindActiveByVirtualKeyAndProtocol returns all active bindings for a (VK, protocol) pair,
// ordered by priority ASC so the caller can implement primary → fallback ordering.
func (r *postgresBindingRepo) FindActiveByVirtualKeyAndProtocol(ctx context.Context, virtualKeyID, protocolType string) ([]*ManagedProviderBinding, error) {
	rows, err := r.db.QueryContext(ctx,
		bindingSelectCols+` WHERE virtual_key_id = ? AND protocol_type = ? AND binding_status = 'active' ORDER BY priority ASC`,
		virtualKeyID, protocolType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanBindings(rows)
}

// FindActiveByVirtualKeyProtocolAndProvider returns the single active binding for a
// (VK, protocol, provider_id) triplet, or nil. Used for uniqueness checks before insert.
func (r *postgresBindingRepo) FindActiveByVirtualKeyProtocolAndProvider(ctx context.Context, virtualKeyID, protocolType, providerID string) (*ManagedProviderBinding, error) {
	row := r.db.QueryRowContext(ctx,
		bindingSelectCols+` WHERE virtual_key_id = ? AND protocol_type = ? AND provider_id = ? AND binding_status = 'active'`,
		virtualKeyID, protocolType, providerID)
	return scanBinding(row)
}

func (r *postgresBindingRepo) UpdateCredential(ctx context.Context, bindingID, credentialID, updatedBy string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_provider_bindings
		SET credential_id = ?, updated_by = ?, updated_at = ?
		WHERE binding_id = ?`,
		credentialID, updatedBy, time.Now().UTC(), bindingID,
	)
	return err
}

func (r *postgresBindingRepo) UpdateStatus(ctx context.Context, bindingID, status string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_provider_bindings SET binding_status = ?, updated_at = ? WHERE binding_id = ?`,
		status, time.Now().UTC(), bindingID,
	)
	return err
}

// bindingSelectCols is the shared SELECT prefix for binding queries.
const bindingSelectCols = `
	SELECT binding_id, org_id, virtual_key_id, provider_id, credential_id, protocol_type,
	       priority, fallback_role, binding_alias, binding_status, updated_at, updated_by
	FROM managed_provider_bindings`

func scanBinding(row *sql.Row) (*ManagedProviderBinding, error) {
	var b ManagedProviderBinding
	var virtualKeyID sql.NullString
	err := row.Scan(
		&b.BindingID, &b.OrgID, &virtualKeyID, &b.ProviderID, &b.CredentialID, &b.ProtocolType,
		&b.Priority, &b.FallbackRole, &b.BindingAlias, &b.Status, &b.UpdatedAt, &b.UpdatedBy,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan binding: %w", err)
	}
	if virtualKeyID.Valid {
		b.VirtualKeyID = &virtualKeyID.String
	}
	return &b, nil
}

func scanBindings(rows *sql.Rows) ([]*ManagedProviderBinding, error) {
	var bs []*ManagedProviderBinding
	for rows.Next() {
		var b ManagedProviderBinding
		var virtualKeyID sql.NullString
		if err := rows.Scan(
			&b.BindingID, &b.OrgID, &virtualKeyID, &b.ProviderID, &b.CredentialID, &b.ProtocolType,
			&b.Priority, &b.FallbackRole, &b.BindingAlias, &b.Status, &b.UpdatedAt, &b.UpdatedBy,
		); err != nil {
			return nil, err
		}
		if virtualKeyID.Valid {
			b.VirtualKeyID = &virtualKeyID.String
		}
		bs = append(bs, &b)
	}
	return bs, rows.Err()
}

// ---- VirtualKey repo ----

type postgresVirtualKeyRepo struct{ db *shared.DB }

// NewPostgresVirtualKeyRepository creates a PostgreSQL-backed virtual key repository.
func NewPostgresVirtualKeyRepository(db *shared.DB) VirtualKeyRepository {
	return &postgresVirtualKeyRepo{db: db}
}

func (r *postgresVirtualKeyRepo) Create(ctx context.Context, vk *ManagedVirtualKey) error {
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

func (r *postgresVirtualKeyRepo) FindByID(ctx context.Context, id string) (*ManagedVirtualKey, error) {
	row := r.db.QueryRowContext(ctx, virtualKeySelectCols+` WHERE virtual_key_id = ?`, id)
	return scanVirtualKey(row)
}

func (r *postgresVirtualKeyRepo) FindByTokenHash(ctx context.Context, hash string) (*ManagedVirtualKey, error) {
	row := r.db.QueryRowContext(ctx, virtualKeySelectCols+` WHERE token_hash = ?`, hash)
	return scanVirtualKey(row)
}

func (r *postgresVirtualKeyRepo) ListByOrg(ctx context.Context, orgID string) ([]*ManagedVirtualKey, error) {
	rows, err := r.db.QueryContext(ctx, virtualKeySelectCols+` WHERE org_id = ? ORDER BY alias`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanVirtualKeys(rows)
}

func (r *postgresVirtualKeyRepo) ListBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error) {
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

func (r *postgresVirtualKeyRepo) ListPendingClaimBySeat(ctx context.Context, seatID string) ([]*ManagedVirtualKey, error) {
	rows, err := r.db.QueryContext(ctx,
		virtualKeySelectCols+` WHERE seat_id = ? AND share_status = 'pending_claim' ORDER BY alias`, seatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanVirtualKeys(rows)
}

func (r *postgresVirtualKeyRepo) UpdateStatus(ctx context.Context, id, status, updatedBy string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_virtual_keys
		SET key_status = ?, updated_by = ?, updated_at = ?,
		    revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END
		WHERE virtual_key_id = ?`,
		status, updatedBy, time.Now().UTC(), status, time.Now().UTC(), id,
	)
	return err
}

func (r *postgresVirtualKeyRepo) UpdateShareStatus(ctx context.Context, id, shareStatus string) error {
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
func (r *postgresVirtualKeyRepo) ReconcileShareStatusByEmail(ctx context.Context, email string) (int, error) {
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

func (r *postgresVirtualKeyRepo) RecordDelivery(ctx context.Context, id string) error {
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

func (r *postgresVirtualKeyRepo) RotateToken(ctx context.Context, id, newHash, newRevision, updatedBy string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE managed_virtual_keys
		SET token_hash = ?, current_revision = ?,
		    updated_by = ?, updated_at = ?
		WHERE virtual_key_id = ?`,
		newHash, newRevision, updatedBy, time.Now().UTC(), id,
	)
	return err
}

// LastAnchorTuple returns the anchor tuple from the most recent control event for
// this (virtual_key_id, binding_id) pair. With multi-protocol bindings each binding
// maintains its own independent anchor history.
func (r *postgresVirtualKeyRepo) LastAnchorTuple(ctx context.Context, virtualKeyID, bindingID string) (AnchorTuple, error) {
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
		return AnchorTuple{}, nil // no previous event → zero value
	}
	if err != nil {
		return AnchorTuple{}, fmt.Errorf("scan anchor tuple: %w", err)
	}
	if bindingIDVal.Valid {
		t.BindingID = bindingIDVal.String
	}
	return t, nil
}

// ---- ControlEvent repo ----

type postgresControlEventRepo struct{ db *shared.DB }

// NewPostgresControlEventRepository creates a PostgreSQL-backed control event repository.
func NewPostgresControlEventRepository(db *shared.DB) ControlEventRepository {
	return &postgresControlEventRepo{db: db}
}

func (r *postgresControlEventRepo) Insert(ctx context.Context, e *ControlEvent) error {
	// binding_id is nullable: lifecycle events store "" in the struct → NULL in DB.
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

func (r *postgresControlEventRepo) ListByOrg(ctx context.Context, orgID string) ([]*ControlEvent, error) {
	// LEFT JOIN global_accounts to resolve actor email for display (Issue #18).
	// changed_by stores account_id for admin-initiated events (ISSUED/REVOKED)
	// and seat_id for user-initiated events (CLAIMED). The JOIN resolves the
	// former; the latter will simply get NULL (no matching account row).
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

func (r *postgresControlEventRepo) ListByVirtualKey(ctx context.Context, virtualKeyID string) ([]*ControlEvent, error) {
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

// ---- scan helpers ----

const virtualKeySelectCols = `
	SELECT virtual_key_id, org_id, seat_id, alias, token_hash,
	       current_revision, key_status, share_status,
	       delivered_at, claimed_at, revoked_at, recycled_at, reissued_at,
	       last_delivery_at, delivery_count, expires_at, updated_at, updated_by
	FROM managed_virtual_keys`

func scanVirtualKey(row *sql.Row) (*ManagedVirtualKey, error) {
	var vk ManagedVirtualKey
	var (
		deliveredAt, claimedAt, revokedAt, recycledAt, reissuedAt sql.NullTime
		lastDeliveryAt, expiresAt                                  sql.NullTime
	)
	err := row.Scan(
		&vk.VirtualKeyID, &vk.OrgID, &vk.SeatID, &vk.Alias, &vk.TokenHash,
		&vk.CurrentRevision, &vk.KeyStatus, &vk.ShareStatus,
		&deliveredAt, &claimedAt, &revokedAt, &recycledAt, &reissuedAt,
		&lastDeliveryAt, &vk.DeliveryCount, &expiresAt, &vk.UpdatedAt, &vk.UpdatedBy,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan virtual key: %w", err)
	}
	vk.DeliveredAt = nullTimePtr(deliveredAt)
	vk.ClaimedAt = nullTimePtr(claimedAt)
	vk.RevokedAt = nullTimePtr(revokedAt)
	vk.RecycledAt = nullTimePtr(recycledAt)
	vk.ReissuedAt = nullTimePtr(reissuedAt)
	vk.LastDeliveryAt = nullTimePtr(lastDeliveryAt)
	vk.ExpiresAt = nullTimePtr(expiresAt)
	return &vk, nil
}

func scanVirtualKeys(rows *sql.Rows) ([]*ManagedVirtualKey, error) {
	var vks []*ManagedVirtualKey
	for rows.Next() {
		var vk ManagedVirtualKey
		var (
			deliveredAt, claimedAt, revokedAt, recycledAt, reissuedAt sql.NullTime
			lastDeliveryAt, expiresAt                                  sql.NullTime
		)
		if err := rows.Scan(
			&vk.VirtualKeyID, &vk.OrgID, &vk.SeatID, &vk.Alias, &vk.TokenHash,
			&vk.CurrentRevision, &vk.KeyStatus, &vk.ShareStatus,
			&deliveredAt, &claimedAt, &revokedAt, &recycledAt, &reissuedAt,
			&lastDeliveryAt, &vk.DeliveryCount, &expiresAt, &vk.UpdatedAt, &vk.UpdatedBy,
		); err != nil {
			return nil, err
		}
		vk.DeliveredAt = nullTimePtr(deliveredAt)
		vk.ClaimedAt = nullTimePtr(claimedAt)
		vk.RevokedAt = nullTimePtr(revokedAt)
		vk.RecycledAt = nullTimePtr(recycledAt)
		vk.ReissuedAt = nullTimePtr(reissuedAt)
		vk.LastDeliveryAt = nullTimePtr(lastDeliveryAt)
		vk.ExpiresAt = nullTimePtr(expiresAt)
		vks = append(vks, &vk)
	}
	return vks, rows.Err()
}

func scanEvents(rows *sql.Rows) ([]*ControlEvent, error) {
	var events []*ControlEvent
	for rows.Next() {
		var e ControlEvent
		// effective_to is nullable. aikeytime.Millis.Scan treats nil as
		// Millis(0) so we can scan straight into a Millis and then
		// decide whether to promote it to *Millis based on IsZero().
		var effectiveTo aikeytime.Millis
		var bindingID, accountID, actorEmail sql.NullString
		if err := rows.Scan(
			&e.EventID, &e.OrgID, &accountID, &e.ChangeSource, &e.ChangeType, &e.EntityType, &e.EntityID,
			&e.CorrelationID, &e.ProviderID, &e.SeatID, &e.VirtualKeyID, &e.VirtualKeyRevision,
			&bindingID, &e.CredentialID, &e.CredentialRevision, &e.Revision,
			&e.EffectiveFrom, &effectiveTo, &e.ChangedAt, &e.ChangedBy, &e.Reason,
			&e.BeforeSnapshotJSON, &e.AfterSnapshotJSON,
			&actorEmail, // LEFT JOIN global_accounts.email (Issue #18)
		); err != nil {
			return nil, err
		}
		if accountID.Valid {
			e.AccountID = accountID.String
		}
		if bindingID.Valid {
			e.BindingID = bindingID.String
		}
		if actorEmail.Valid {
			e.ActorEmail = actorEmail.String
		}
		if !effectiveTo.IsZero() {
			m := effectiveTo
			e.EffectiveTo = &m
		}
		events = append(events, &e)
	}
	return events, rows.Err()
}

func nullableTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}

func nullTimePtr(nt sql.NullTime) *time.Time {
	if !nt.Valid {
		return nil
	}
	return &nt.Time
}

func nullableStr(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}
