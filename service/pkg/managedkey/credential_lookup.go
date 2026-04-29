package managedkey

import (
	"context"
	"database/sql"

	"github.com/AiKeyLabs/aikey-control/service/pkg/shared"
)

// postgresCredentialLookup implements CredentialLookup using a direct DB query.
// This avoids a hard package import cycle between managedkey ↔ provider.
type postgresCredentialLookup struct{ db *shared.DB }

// NewPostgresCredentialLookup creates a CredentialLookup backed by PostgreSQL.
func NewPostgresCredentialLookup(db *shared.DB) CredentialLookup {
	return &postgresCredentialLookup{db: db}
}

// GetRevision returns the current_revision for a credential.
func (l *postgresCredentialLookup) GetRevision(ctx context.Context, credentialID string) (string, error) {
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

// GetProviderID returns the provider_id associated with a credential.
func (l *postgresCredentialLookup) GetProviderID(ctx context.Context, credentialID string) (string, error) {
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

// GetProtocolType returns the protocol_type of the provider linked to a credential.
// Used to validate that binding.protocol_type stays consistent with the credential chain.
func (l *postgresCredentialLookup) GetProtocolType(ctx context.Context, credentialID string) (string, error) {
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
