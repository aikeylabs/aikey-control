// Package shared provides cross-cutting utilities used by all domain modules.
package shared

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
)

// NewID generates a new UUID-based string ID.
func NewID() string {
	return uuid.New().String()
}

// NewRevision generates a short random hex string used as an object revision token.
// Revisions are opaque, monotonically increasing only by convention (latest wins in fact tables).
func NewRevision() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback: should never happen in practice.
		return fmt.Sprintf("%d", randFallback())
	}
	return hex.EncodeToString(b)
}

// randFallback is a last-resort counter for environments where crypto/rand fails.
var _fallbackCounter uint64

func randFallback() uint64 {
	_fallbackCounter++
	return _fallbackCounter
}
