package shared

import (
	"errors"
	"fmt"

	"github.com/lib/pq"
)

// pgConstraintMap maps PostgreSQL unique constraint names to domain error factories.
// Keep this list in sync with the project migrations.
//
// pq.Error.Detail for unique violations contains:
//
//	"Key (col)=(val) already exists."  — included as meta["db_detail"] for debugging.
var pgConstraintMap = map[string]func(detail string) *DomainError{
	// identity
	"uq_global_accounts_email": func(detail string) *DomainError {
		return &DomainError{Code: CodeBizAuthEmailTaken,
			Message: "email is already registered",
			Meta:    map[string]any{"db_detail": detail}}
	},
	// organization — seat
	"uq_org_seats_org_email": func(detail string) *DomainError {
		return &DomainError{Code: CodeBizSeatEmailTaken,
			Message: "a seat for this email already exists in the org",
			Meta:    map[string]any{"db_detail": detail}}
	},
	// providers
	"uq_providers_code": func(detail string) *DomainError {
		return &DomainError{Code: CodeBizProvCodeTaken,
			Message: "a provider with this code already exists",
			Meta:    map[string]any{"db_detail": detail}}
	},
	// credentials
	"uq_managed_provider_credentials_org_name": func(detail string) *DomainError {
		return &DomainError{Code: CodeBizCredNameTaken,
			Message: "a credential with this name already exists for this provider in the org",
			Meta:    map[string]any{"db_detail": detail}}
	},
	// bindings: org-level template alias (virtual_key_id IS NULL)
	"uq_mpb_template_alias": func(detail string) *DomainError {
		return &DomainError{Code: CodeBizBindAliasTaken,
			Message: "a template binding with this alias already exists in the org",
			Meta:    map[string]any{"db_detail": detail}}
	},
	// bindings: one active binding per (VK, protocol, provider) triplet
	"uq_mpb_vk_protocol_provider": func(detail string) *DomainError {
		return &DomainError{Code: CodeBizBindDuplicateTarget,
			Message: "an active binding for this protocol/provider pair already exists on this virtual key",
			Meta:    map[string]any{"db_detail": detail}}
	},
	// virtual keys: (org_id, seat_id, alias) must be unique
	"uq_managed_virtual_keys_org_seat_alias": func(detail string) *DomainError {
		return &DomainError{Code: CodeBizKeyAliasTaken,
			Message: "a virtual key with this alias already exists for this seat",
			Meta:    map[string]any{"db_detail": detail}}
	},
}

// TranslatePGError converts a PostgreSQL driver error to a DomainError when a
// known constraint mapping exists.  Unknown DB errors are returned unchanged
// (they become SYS_INTERNAL in handleDomainErr).
//
// Rule: call this at the repository boundary immediately on INSERT/UPDATE errors,
// before any fmt.Errorf wrapping, so the domain error can be unwrapped by
// handleDomainErr via errors.As.
func TranslatePGError(err error) error {
	if err == nil {
		return nil
	}
	var pqErr *pq.Error
	if !errors.As(err, &pqErr) {
		return err
	}
	switch pqErr.Code {
	case "23505": // unique_violation
		if fn, ok := pgConstraintMap[pqErr.Constraint]; ok {
			return fn(pqErr.Detail)
		}
		// Unknown unique constraint: return 409 Conflict with the constraint name.
		return &DomainError{
			Code:    CodeBizBindAliasTaken, // 409 status; reuse any 409 code
			Message: fmt.Sprintf("unique constraint violated: %s", pqErr.Constraint),
			Meta:    map[string]any{"constraint": pqErr.Constraint, "db_detail": pqErr.Detail},
		}
	case "23503": // foreign_key_violation
		return &DomainError{
			Code:    CodeBizOrgNotFound,
			Message: fmt.Sprintf("referenced resource not found (constraint: %s)", pqErr.Constraint),
			Meta:    map[string]any{"constraint": pqErr.Constraint},
		}
	case "23502": // not_null_violation
		return DataInvalidField(pqErr.Column, "not_null",
			fmt.Sprintf("field %q must not be null", pqErr.Column))
	case "23514": // check_violation
		return DataInvalidField(pqErr.Constraint, "check_constraint",
			fmt.Sprintf("check constraint %q was violated", pqErr.Constraint))
	}
	return err
}
