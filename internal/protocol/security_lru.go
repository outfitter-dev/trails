// Package protocol implements a thread-safe LRU rate limiter.
// This prevents memory exhaustion from unbounded rate limiter growth
// while still providing effective rate limiting per session.
package protocol

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// LRURateLimiter implements rate limiting with automatic LRU eviction.
// When the limiter reaches capacity, it evicts the least recently used
// entries to make room for new ones. This prevents unbounded memory growth.
// All methods are thread-safe.
type LRURateLimiter struct {
	mu          sync.RWMutex
	maxSize     int
	requests    map[string]*rateLimiterEntry
	accessOrder []string // Track access order for LRU
	limit       rate.Limit
	burst       int
}

// NewLRURateLimiter creates a new LRU rate limiter.
// Parameters:
//   - requestsPerSecond: sustained request rate per session
//   - burst: maximum burst size per session
//   - maxSize: maximum number of sessions to track (defaults to 10000)
func NewLRURateLimiter(requestsPerSecond int, burst int, maxSize int) *LRURateLimiter {
	if maxSize <= 0 {
		maxSize = 10000 // Default max size
	}
	return &LRURateLimiter{
		requests:    make(map[string]*rateLimiterEntry),
		accessOrder: make([]string, 0, maxSize),
		limit:       rate.Limit(requestsPerSecond),
		burst:       burst,
		maxSize:     maxSize,
	}
}

// Allow checks if a request from the given session is allowed.
// Creates a new rate limiter for unknown sessions.
// Evicts the least recently used session if at capacity.
// Returns true if the request should be allowed.
func (rl *LRURateLimiter) Allow(sessionID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	entry, exists := rl.requests[sessionID]
	if !exists {
		// Evict oldest if at capacity
		if len(rl.requests) >= rl.maxSize {
			rl.evictOldestLocked()
		}
		
		// Create new limiter
		limiter := rate.NewLimiter(rl.limit, rl.burst)
		entry = &rateLimiterEntry{
			limiter:    limiter,
			lastAccess: time.Now(),
		}
		rl.requests[sessionID] = entry
		rl.accessOrder = append(rl.accessOrder, sessionID)
	} else {
		// Update access time and move to end of access order
		entry.lastAccess = time.Now()
		rl.moveToEndLocked(sessionID)
	}
	
	return entry.limiter.Allow()
}

// evictOldestLocked removes the least recently used entry.
// Caller must hold the write lock.
func (rl *LRURateLimiter) evictOldestLocked() {
	if len(rl.accessOrder) == 0 {
		return
	}
	
	oldest := rl.accessOrder[0]
	delete(rl.requests, oldest)
	rl.accessOrder = rl.accessOrder[1:]
}

// moveToEndLocked moves a session to the end of the access order.
// This marks it as most recently used.
// Caller must hold the write lock.
func (rl *LRURateLimiter) moveToEndLocked(sessionID string) {
	// Find and remove from current position
	for i, id := range rl.accessOrder {
		if id == sessionID {
			rl.accessOrder = append(rl.accessOrder[:i], rl.accessOrder[i+1:]...)
			break
		}
	}
	// Add to end
	rl.accessOrder = append(rl.accessOrder, sessionID)
}

// Size returns the current number of tracked sessions.
// Thread-safe method for monitoring limiter size.
func (rl *LRURateLimiter) Size() int {
	rl.mu.RLock()
	defer rl.mu.RUnlock()
	return len(rl.requests)
}

// Cleanup removes entries that haven't been accessed within maxAge.
// This supplements LRU eviction for removing truly stale entries.
// Returns the number of entries removed.
// Thread-safe method for periodic maintenance.
func (rl *LRURateLimiter) Cleanup(maxAge time.Duration) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	newAccessOrder := make([]string, 0, len(rl.accessOrder))
	
	for _, sessionID := range rl.accessOrder {
		if entry, exists := rl.requests[sessionID]; exists {
			if entry.lastAccess.Before(cutoff) {
				delete(rl.requests, sessionID)
				removed++
			} else {
				newAccessOrder = append(newAccessOrder, sessionID)
			}
		}
	}
	
	rl.accessOrder = newAccessOrder
	return removed
}