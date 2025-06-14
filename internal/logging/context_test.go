package logging

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRequestIDContext(t *testing.T) {
	ctx := context.Background()

	// Test WithRequestID
	ctx = WithRequestID(ctx, "req-123")
	assert.Equal(t, "req-123", GetRequestID(ctx))

	// Test WithNewRequestID
	ctx2 := WithNewRequestID(context.Background())
	reqID := GetRequestID(ctx2)
	assert.NotEmpty(t, reqID)
	assert.Len(t, reqID, 26) // ULID length

	// Test missing request ID
	assert.Empty(t, GetRequestID(context.Background()))
}

func TestCommandIDContext(t *testing.T) {
	ctx := context.Background()

	// Test WithCommandID
	ctx = WithCommandID(ctx, "cmd-456")
	assert.Equal(t, "cmd-456", GetCommandID(ctx))

	// Test missing command ID
	assert.Empty(t, GetCommandID(context.Background()))
}

func TestSessionIDContext(t *testing.T) {
	ctx := context.Background()

	// Test WithSessionID
	ctx = WithSessionID(ctx, "session-789")
	assert.Equal(t, "session-789", GetSessionID(ctx))

	// Test missing session ID
	assert.Empty(t, GetSessionID(context.Background()))
}

func TestUserIDContext(t *testing.T) {
	ctx := context.Background()

	// Test WithUserID
	ctx = WithUserID(ctx, "user-123")
	assert.Equal(t, "user-123", GetUserID(ctx))

	// Test missing user ID
	assert.Empty(t, GetUserID(context.Background()))
}

func TestCorrelationIDContext(t *testing.T) {
	ctx := context.Background()

	// Test WithCorrelationID
	ctx = WithCorrelationID(ctx, "corr-abc")
	assert.Equal(t, "corr-abc", GetCorrelationID(ctx))

	// Test missing correlation ID
	assert.Empty(t, GetCorrelationID(context.Background()))
}

func TestEnrichContext(t *testing.T) {
	ctx := EnrichContext(
		context.Background(),
		func(c context.Context) context.Context {
			return WithRequestID(c, "req-123")
		},
		func(c context.Context) context.Context {
			return WithSessionID(c, "session-456")
		},
		func(c context.Context) context.Context {
			return WithUserID(c, "user-789")
		},
	)

	assert.Equal(t, "req-123", GetRequestID(ctx))
	assert.Equal(t, "session-456", GetSessionID(ctx))
	assert.Equal(t, "user-789", GetUserID(ctx))
}

func TestContextIsolation(t *testing.T) {
	// Ensure context values don't leak between contexts
	ctx1 := WithRequestID(context.Background(), "req-1")
	ctx2 := WithRequestID(context.Background(), "req-2")

	assert.Equal(t, "req-1", GetRequestID(ctx1))
	assert.Equal(t, "req-2", GetRequestID(ctx2))
}

func TestNestedContext(t *testing.T) {
	// Test that values are preserved when creating derived contexts
	ctx := context.Background()
	ctx = WithRequestID(ctx, "req-123")
	ctx = WithSessionID(ctx, "session-456")

	// Create a derived context
	ctx2 := WithCommandID(ctx, "cmd-789")

	// Original values should still be present
	assert.Equal(t, "req-123", GetRequestID(ctx2))
	assert.Equal(t, "session-456", GetSessionID(ctx2))
	assert.Equal(t, "cmd-789", GetCommandID(ctx2))
}