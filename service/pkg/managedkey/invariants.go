package managedkey

// shouldAppendControlEvent is the single decision point for whether a
// managed_key_control_events row should be written.
//
// Two classes of operations:
//
//  1. Rotation operations (anchor-diff gated):
//     credential_rotation, virtual_key_rotation
//     → written only when curr anchor tuple differs from prev.
//
//  2. Lifecycle operations (unconditional):
//     virtual_key_issued, virtual_key_revoked, virtual_key_claimed, credential_migrated
//     → always written; prev/curr are ignored.
//
// This function MUST NOT be called from HTTP handlers; it belongs in the
// application service so it can be unit-tested independently.
func shouldAppendControlEvent(operationType string, prev, curr AnchorTuple) bool {
	switch operationType {
	case OperationCredentialRotation, OperationVirtualKeyRotation:
		return !curr.Equals(prev)
	case OperationVirtualKeyIssued, OperationVirtualKeyRevoked,
		OperationVirtualKeyClaimed, OperationCredentialMigrated:
		return true
	default:
		return false
	}
}
