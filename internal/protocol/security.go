package protocol

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// AuthToken for command authentication
type AuthToken struct {
	SessionID   string    `json:"session_id"`
	UserID      string    `json:"user_id"`
	Permissions []string  `json:"permissions"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// SecureCommand wraps commands with security
type SecureCommand struct {
	Command
	Auth      AuthToken `json:"auth"`
	Nonce     string    `json:"nonce"`
	Signature string    `json:"signature"`
}

// Verify command integrity
func (sc SecureCommand) Verify(secret []byte) error {
	// Verify signature
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(sc.Command.ID + sc.Nonce))
	expectedMAC := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(sc.Signature), []byte(expectedMAC)) {
		return errors.New("invalid command signature")
	}

	// Verify token expiration
	if time.Now().After(sc.Auth.ExpiresAt) {
		return errors.New("auth token expired")
	}

	return nil
}

// rateLimiterEntry tracks a rate limiter with last access time
type rateLimiterEntry struct {
	limiter    *rate.Limiter
	lastAccess time.Time
}

// RateLimiter implements per-session rate limiting
type RateLimiter struct {
	requests map[string]*rateLimiterEntry
	mu       sync.RWMutex
	limit    rate.Limit
	burst    int
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(limit rate.Limit, burst int) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string]*rateLimiterEntry),
		limit:    limit,
		burst:    burst,
	}
}

// Allow checks if a request is allowed for the given session
func (rl *RateLimiter) Allow(sessionID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	entry, exists := rl.requests[sessionID]
	if !exists {
		entry = &rateLimiterEntry{
			limiter:    rate.NewLimiter(rl.limit, rl.burst),
			lastAccess: time.Now(),
		}
		rl.requests[sessionID] = entry
	} else {
		entry.lastAccess = time.Now()
	}

	return entry.limiter.Allow()
}

// Wait blocks until a request is allowed or context is cancelled
func (rl *RateLimiter) Wait(ctx context.Context, sessionID string) error {
	rl.mu.Lock()
	entry, exists := rl.requests[sessionID]
	if !exists {
		entry = &rateLimiterEntry{
			limiter:    rate.NewLimiter(rl.limit, rl.burst),
			lastAccess: time.Now(),
		}
		rl.requests[sessionID] = entry
	} else {
		entry.lastAccess = time.Now()
	}
	limiter := entry.limiter
	rl.mu.Unlock()

	return limiter.Wait(ctx)
}

// Cleanup removes old limiters to prevent memory leaks
func (rl *RateLimiter) Cleanup(olderThan time.Duration) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	cutoff := time.Now().Add(-olderThan)
	removed := 0
	
	for id, entry := range rl.requests {
		if entry.lastAccess.Before(cutoff) {
			delete(rl.requests, id)
			removed++
		}
	}
	
	return removed
}

// Size returns the number of tracked sessions
func (rl *RateLimiter) Size() int {
	rl.mu.RLock()
	defer rl.mu.RUnlock()
	return len(rl.requests)
}