package importpkg

import (
	"sync"
	"time"
)

// VKCache is a tiny in-memory TTL cache for the user's virtual-key list. The
// Web UI queries /api/user/virtual-keys while composing the import manifest
// to look up aliases + provider bindings; those queries repeat within one
// editing session, so a short cache avoids hitting the delivery handler on
// every keystroke.
//
// Stage 4 ships the skeleton; actual wiring to the virtual-key delivery
// endpoint is Stage 5 work (together with the React interactions). The Get /
// Set methods are ready-to-call so Stage 5 can just bolt in a fetcher.
type VKCache struct {
	mu    sync.Mutex
	entry map[string]vkCacheEntry
	ttl   time.Duration
}

type vkCacheEntry struct {
	value     []byte
	expiresAt time.Time
}

// NewVKCache returns a cache with the given per-entry TTL. Defaults recommended:
// 5 * time.Minute per UX v2 "sliding TTL on read".
func NewVKCache(ttl time.Duration) *VKCache {
	return &VKCache{entry: make(map[string]vkCacheEntry), ttl: ttl}
}

// Get returns the cached value and a cache-hit flag. Expired entries are
// evicted lazily on read.
func (c *VKCache) Get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entry[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(e.expiresAt) {
		delete(c.entry, key)
		return nil, false
	}
	return e.value, true
}

// Set stores a value under key with the cache's configured TTL.
func (c *VKCache) Set(key string, value []byte) {
	c.mu.Lock()
	c.entry[key] = vkCacheEntry{value: value, expiresAt: time.Now().Add(c.ttl)}
	c.mu.Unlock()
}

// Invalidate drops a key (called after batch_import succeeds so the next VK
// list fetch reflects the newly imported aliases).
func (c *VKCache) Invalidate(key string) {
	c.mu.Lock()
	delete(c.entry, key)
	c.mu.Unlock()
}
