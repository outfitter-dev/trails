package protocol

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"golang.org/x/time/rate"
)

func TestSecureCommand_Verify(t *testing.T) {
	secret := []byte("test-secret-key")
	
	// Create a valid command
	cmd := Command{
		ID:   "cmd-123",
		Type: CmdCreateSession,
	}
	
	nonce := "test-nonce"
	
	// Generate valid signature
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(cmd.ID + nonce))
	signature := hex.EncodeToString(mac.Sum(nil))
	
	t.Run("valid signature and token", func(t *testing.T) {
		secureCmd := SecureCommand{
			Command: cmd,
			Auth: AuthToken{
				SessionID:   "session-123",
				UserID:      "user-456",
				Permissions: []string{"create_session"},
				ExpiresAt:   time.Now().Add(time.Hour),
			},
			Nonce:     nonce,
			Signature: signature,
		}
		
		err := secureCmd.Verify(secret)
		assert.NoError(t, err)
	})
	
	t.Run("invalid signature", func(t *testing.T) {
		secureCmd := SecureCommand{
			Command: cmd,
			Auth: AuthToken{
				SessionID:   "session-123",
				UserID:      "user-456",
				Permissions: []string{"create_session"},
				ExpiresAt:   time.Now().Add(time.Hour),
			},
			Nonce:     nonce,
			Signature: "invalid-signature",
		}
		
		err := secureCmd.Verify(secret)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid command signature")
	})
	
	t.Run("expired token", func(t *testing.T) {
		secureCmd := SecureCommand{
			Command: cmd,
			Auth: AuthToken{
				SessionID:   "session-123",
				UserID:      "user-456",
				Permissions: []string{"create_session"},
				ExpiresAt:   time.Now().Add(-time.Hour), // Expired
			},
			Nonce:     nonce,
			Signature: signature,
		}
		
		err := secureCmd.Verify(secret)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "auth token expired")
	})
	
	t.Run("wrong secret", func(t *testing.T) {
		secureCmd := SecureCommand{
			Command: cmd,
			Auth: AuthToken{
				SessionID:   "session-123",
				UserID:      "user-456",
				Permissions: []string{"create_session"},
				ExpiresAt:   time.Now().Add(time.Hour),
			},
			Nonce:     nonce,
			Signature: signature,
		}
		
		wrongSecret := []byte("wrong-secret")
		err := secureCmd.Verify(wrongSecret)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid command signature")
	})
}

func TestRateLimiter(t *testing.T) {
	t.Run("basic functionality", func(t *testing.T) {
		limiter := NewRateLimiter(rate.Limit(2), 3) // 2 per second, burst 3
		sessionID := "session-123"
		
		// Should allow first few requests (within burst)
		assert.True(t, limiter.Allow(sessionID))
		assert.True(t, limiter.Allow(sessionID))
		assert.True(t, limiter.Allow(sessionID))
		
		// Should deny next request (burst exhausted)
		assert.False(t, limiter.Allow(sessionID))
		
		// Check size
		assert.Equal(t, 1, limiter.Size())
	})
	
	t.Run("different sessions independent", func(t *testing.T) {
		limiter := NewRateLimiter(rate.Limit(1), 1) // 1 per second, burst 1
		
		session1 := "session-1"
		session2 := "session-2"
		
		// Each session should have independent limits
		assert.True(t, limiter.Allow(session1))
		assert.True(t, limiter.Allow(session2))
		
		// Both should be rate limited now
		assert.False(t, limiter.Allow(session1))
		assert.False(t, limiter.Allow(session2))
		
		// Check size
		assert.Equal(t, 2, limiter.Size())
	})
	
	t.Run("cleanup old sessions", func(t *testing.T) {
		limiter := NewRateLimiter(rate.Limit(10), 10)
		
		// Add some sessions
		limiter.Allow("session-1")
		limiter.Allow("session-2")
		limiter.Allow("session-3")
		
		assert.Equal(t, 3, limiter.Size())
		
		// Cleanup sessions older than 1 nanosecond (should remove all)
		time.Sleep(time.Millisecond) // Ensure time passes
		removed := limiter.Cleanup(time.Nanosecond)
		
		assert.Equal(t, 3, removed)
		assert.Equal(t, 0, limiter.Size())
	})
	
	t.Run("cleanup preserves recent sessions", func(t *testing.T) {
		limiter := NewRateLimiter(rate.Limit(10), 10)
		
		// Add sessions
		limiter.Allow("session-1")
		limiter.Allow("session-2")
		
		// Cleanup with large duration (should keep all)
		removed := limiter.Cleanup(time.Hour)
		
		assert.Equal(t, 0, removed)
		assert.Equal(t, 2, limiter.Size())
	})
	
	t.Run("wait functionality", func(t *testing.T) {
		limiter := NewRateLimiter(rate.Limit(100), 1) // High rate, low burst
		sessionID := "session-wait"
		
		ctx := context.Background()
		
		// First request should succeed immediately
		err := limiter.Wait(ctx, sessionID)
		assert.NoError(t, err)
		
		// Second request should be delayed but succeed
		start := time.Now()
		err = limiter.Wait(ctx, sessionID)
		duration := time.Since(start)
		
		assert.NoError(t, err)
		assert.Greater(t, duration, time.Microsecond) // Should have waited
	})
	
	t.Run("wait with cancelled context", func(t *testing.T) {
		limiter := NewRateLimiter(rate.Limit(0.1), 1) // Very slow rate, burst 1
		sessionID := "session-cancel"
		
		// Exhaust burst
		limiter.Allow(sessionID)
		
		// Create cancelled context
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		
		// Wait should return context error
		err := limiter.Wait(ctx, sessionID)
		assert.Error(t, err)
		assert.Equal(t, context.Canceled, err)
	})
}

func TestRateLimiter_Concurrency(t *testing.T) {
	limiter := NewRateLimiter(rate.Limit(100), 10)
	sessionID := "concurrent-session"
	
	// Run multiple goroutines concurrently
	const numGoroutines = 10
	const requestsPerGoroutine = 5
	
	results := make(chan bool, numGoroutines*requestsPerGoroutine)
	
	for i := 0; i < numGoroutines; i++ {
		go func() {
			for j := 0; j < requestsPerGoroutine; j++ {
				results <- limiter.Allow(sessionID)
			}
		}()
	}
	
	// Collect results
	allowed := 0
	denied := 0
	
	for i := 0; i < numGoroutines*requestsPerGoroutine; i++ {
		if <-results {
			allowed++
		} else {
			denied++
		}
	}
	
	// Should have some allowed and some denied
	assert.Greater(t, allowed, 0)
	assert.Greater(t, denied, 0)
	assert.Equal(t, numGoroutines*requestsPerGoroutine, allowed+denied)
}

func TestAuthToken(t *testing.T) {
	token := AuthToken{
		SessionID:   "session-123",
		UserID:      "user-456",
		Permissions: []string{"read", "write"},
		ExpiresAt:   time.Now().Add(time.Hour),
	}
	
	assert.Equal(t, "session-123", token.SessionID)
	assert.Equal(t, "user-456", token.UserID)
	assert.Contains(t, token.Permissions, "read")
	assert.Contains(t, token.Permissions, "write")
	assert.True(t, token.ExpiresAt.After(time.Now()))
}