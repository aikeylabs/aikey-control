package intake

import (
	"testing"
	"time"
)

func TestVKCache_HitAndMiss(t *testing.T) {
	c := NewVKCache(time.Minute)
	if _, ok := c.Get("k"); ok {
		t.Fatal("empty cache must miss")
	}
	c.Set("k", []byte("value"))
	v, ok := c.Get("k")
	if !ok || string(v) != "value" {
		t.Fatalf("hit failed: ok=%v value=%q", ok, v)
	}
}

func TestVKCache_Expired_EvictsOnRead(t *testing.T) {
	c := NewVKCache(10 * time.Millisecond)
	c.Set("k", []byte("v"))
	time.Sleep(20 * time.Millisecond)
	if _, ok := c.Get("k"); ok {
		t.Fatal("expired cache entry must not be returned")
	}
}

func TestVKCache_Invalidate(t *testing.T) {
	c := NewVKCache(time.Minute)
	c.Set("k", []byte("v"))
	c.Invalidate("k")
	if _, ok := c.Get("k"); ok {
		t.Fatal("invalidated key must miss")
	}
}
