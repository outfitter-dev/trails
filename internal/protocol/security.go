package protocol

import (
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

// RateLimiter implements per-session rate limiting
type RateLimiter struct {
	requests map[string]*rate.Limiter
	mu       sync.RWMutex
	limit    rate.Limit
	burst    int
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(limit rate.Limit, burst int) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string]*rate.Limiter),
		limit:    limit,
		burst:    burst,
	}
}

// Allow checks if a request is allowed for the given session
func (rl *RateLimiter) Allow(sessionID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	limiter, exists := rl.requests[sessionID]
	if !exists {
		limiter = rate.NewLimiter(rl.limit, rl.burst)
		rl.requests[sessionID] = limiter
	}

	return limiter.Allow()
}

// Cleanup removes old limiters to prevent memory leaks
func (rl *RateLimiter) Cleanup(olderThan time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	// In a production system, we'd track last access time
	// For now, we'll just provide the structure
}