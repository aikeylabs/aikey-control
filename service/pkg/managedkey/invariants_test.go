package managedkey

import "testing"

// TestShouldAppendControlEvent covers the core domain invariant:
// events are written ONLY on credential_rotation or virtual_key_rotation
// AND only when the anchor tuple actually changed.

func TestShouldAppendControlEvent_NonRotationOperations(t *testing.T) {
	prev := AnchorTuple{VirtualKeyID: "vk1", SeatID: "s1", BindingID: "b1",
		CredentialID: "c1", VirtualKeyRevision: "r1", CredentialRevision: "cr1"}
	curr := AnchorTuple{VirtualKeyID: "vk1", SeatID: "s2", BindingID: "b1",
		CredentialID: "c1", VirtualKeyRevision: "r1", CredentialRevision: "cr1"}

	nonRotationOps := []string{
		"issue", "revoke", "claim", "update_policy",
		"rebind", "emergency_adjust", "",
	}
	for _, op := range nonRotationOps {
		if shouldAppendControlEvent(op, prev, curr) {
			t.Errorf("operation %q should NOT write event, got true", op)
		}
	}
}

func TestShouldAppendControlEvent_RotationWithAnchorChange(t *testing.T) {
	base := AnchorTuple{
		VirtualKeyID:       "vk1",
		SeatID:             "s1",
		BindingID:          "b1",
		CredentialID:       "c1",
		VirtualKeyRevision: "rev1",
		CredentialRevision: "crev1",
	}

	cases := []struct {
		name string
		curr AnchorTuple
	}{
		{"credential_revision changes", func() AnchorTuple {
			a := base; a.CredentialRevision = "crev2"; return a
		}()},
		{"virtual_key_revision changes", func() AnchorTuple {
			a := base; a.VirtualKeyRevision = "rev2"; return a
		}()},
		{"seat_id changes", func() AnchorTuple {
			a := base; a.SeatID = "s2"; return a
		}()},
		{"binding_id changes", func() AnchorTuple {
			a := base; a.BindingID = "b2"; return a
		}()},
		{"credential_id changes", func() AnchorTuple {
			a := base; a.CredentialID = "c2"; return a
		}()},
	}

	for _, op := range []string{OperationCredentialRotation, OperationVirtualKeyRotation} {
		for _, tc := range cases {
			if !shouldAppendControlEvent(op, base, tc.curr) {
				t.Errorf("op=%s case=%s: expected event to be written, got false", op, tc.name)
			}
		}
	}
}

func TestShouldAppendControlEvent_RotationWithNoAnchorChange(t *testing.T) {
	tuple := AnchorTuple{
		VirtualKeyID:       "vk1",
		SeatID:             "s1",
		BindingID:          "b1",
		CredentialID:       "c1",
		VirtualKeyRevision: "rev1",
		CredentialRevision: "crev1",
	}
	for _, op := range []string{OperationCredentialRotation, OperationVirtualKeyRotation} {
		if shouldAppendControlEvent(op, tuple, tuple) {
			t.Errorf("op=%s: no anchor change → must NOT write event, got true", op)
		}
	}
}

func TestShouldAppendControlEvent_FirstRotation_ZeroPrev(t *testing.T) {
	// When prev is zero-value (no prior event), any non-zero curr differs.
	prev := AnchorTuple{} // zero value
	curr := AnchorTuple{
		VirtualKeyID:       "vk1",
		SeatID:             "s1",
		BindingID:          "b1",
		CredentialID:       "c1",
		VirtualKeyRevision: "rev1",
		CredentialRevision: "crev1",
	}
	for _, op := range []string{OperationCredentialRotation, OperationVirtualKeyRotation} {
		if !shouldAppendControlEvent(op, prev, curr) {
			t.Errorf("op=%s: first rotation with zero prev should write event, got false", op)
		}
	}
}

func TestAnchorTuple_Equals(t *testing.T) {
	a := AnchorTuple{VirtualKeyID: "v", SeatID: "s", BindingID: "b",
		CredentialID: "c", VirtualKeyRevision: "vr", CredentialRevision: "cr"}
	b := a

	if !a.Equals(b) {
		t.Error("identical tuples should be equal")
	}
	b.CredentialRevision = "cr2"
	if a.Equals(b) {
		t.Error("tuples with different CredentialRevision should not be equal")
	}
}
