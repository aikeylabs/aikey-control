package vault

import (
	"testing"
	"time"
)

// The vault page reads the LOCAL VK cache; ListHandler kicks a best-effort
// background snapshot sync so the NEXT load reflects new server-side VKs — but
// it must NEVER hammer Control on rapid polls. claimSyncSlot is the debounce +
// single-flight gate. These tests fence that gate so a refactor can't turn a
// human opening the vault page into a subprocess storm, and can't run two
// overlapping syncs.

// First claim wins; an immediate second claim is debounced (same page, rapid
// re-fetch) until the window elapses.
func TestClaimSyncSlot_Debounce(t *testing.T) {
	h := &CRUDHandlers{}

	if !h.claimSyncSlot() {
		t.Fatal("first claim should win (no prior sync)")
	}
	// Release the in-flight flag — but the debounce window (from lastSyncAt)
	// must still block an immediate re-claim.
	h.releaseSyncSlot()
	if h.claimSyncSlot() {
		t.Fatal("second claim within the debounce window must be skipped")
	}

	// Simulate the window having elapsed → a fresh claim is allowed again.
	h.syncMu.Lock()
	h.lastSyncAt = time.Now().Add(-snapshotSyncDebounce - time.Second)
	h.syncMu.Unlock()
	if !h.claimSyncSlot() {
		t.Fatal("claim after the debounce window should win")
	}
}

// While a sync is in flight, a concurrent claim is refused (single-flight) even
// if the debounce window were to allow it — no two overlapping subprocesses.
func TestClaimSyncSlot_SingleFlight(t *testing.T) {
	h := &CRUDHandlers{}

	if !h.claimSyncSlot() {
		t.Fatal("first claim should win")
	}
	// syncing is now true (not yet released). Force the debounce window open to
	// prove single-flight is what blocks the second claim, not the debounce.
	h.syncMu.Lock()
	h.lastSyncAt = time.Now().Add(-snapshotSyncDebounce - time.Second)
	h.syncMu.Unlock()
	if h.claimSyncSlot() {
		t.Fatal("claim while a sync is in flight must be refused (single-flight)")
	}

	// After release (and with the window open) a new claim is allowed.
	h.releaseSyncSlot()
	if !h.claimSyncSlot() {
		t.Fatal("claim after release + open window should win")
	}
}

// triggerBackgroundSnapshotSync must be a no-op (and never panic) when no CLI
// bridge is wired — the read path stays intact regardless.
func TestTriggerBackgroundSnapshotSync_NilBridge(t *testing.T) {
	h := &CRUDHandlers{} // Bridge == nil
	h.triggerBackgroundSnapshotSync("")
	// A nil-bridge trigger must not claim a slot (nothing ran).
	if h.syncing {
		t.Fatal("nil-bridge trigger must not mark a sync in-flight")
	}
}
