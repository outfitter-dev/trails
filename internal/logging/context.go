package logging

import (
	"context"

	"github.com/oklog/ulid/v2"
)

// Context keys for logging metadata
type contextKey string

const (
	requestIDKey   contextKey = "request_id"
	commandIDKey   contextKey = "command_id"
	sessionIDKey   contextKey = "session_id"
	userIDKey      contextKey = "user_id"
	correlationKey contextKey = "correlation_id"
)

// WithRequestID adds a request ID to the context
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDKey, requestID)
}

// WithNewRequestID generates and adds a new request ID to the context
func WithNewRequestID(ctx context.Context) context.Context {
	return WithRequestID(ctx, ulid.Make().String())
}

// GetRequestID retrieves the request ID from context
func GetRequestID(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey).(string); ok {
		return id
	}
	return ""
}

// WithCommandID adds a command ID to the context
func WithCommandID(ctx context.Context, commandID string) context.Context {
	return context.WithValue(ctx, commandIDKey, commandID)
}

// GetCommandID retrieves the command ID from context
func GetCommandID(ctx context.Context) string {
	if id, ok := ctx.Value(commandIDKey).(string); ok {
		return id
	}
	return ""
}

// WithSessionID adds a session ID to the context
func WithSessionID(ctx context.Context, sessionID string) context.Context {
	return context.WithValue(ctx, sessionIDKey, sessionID)
}

// GetSessionID retrieves the session ID from context
func GetSessionID(ctx context.Context) string {
	if id, ok := ctx.Value(sessionIDKey).(string); ok {
		return id
	}
	return ""
}

// WithUserID adds a user ID to the context
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

// GetUserID retrieves the user ID from context
func GetUserID(ctx context.Context) string {
	if id, ok := ctx.Value(userIDKey).(string); ok {
		return id
	}
	return ""
}

// WithCorrelationID adds a correlation ID to the context
func WithCorrelationID(ctx context.Context, correlationID string) context.Context {
	return context.WithValue(ctx, correlationKey, correlationID)
}

// GetCorrelationID retrieves the correlation ID from context
func GetCorrelationID(ctx context.Context) string {
	if id, ok := ctx.Value(correlationKey).(string); ok {
		return id
	}
	return ""
}

// EnrichContext adds all relevant IDs to the context
func EnrichContext(ctx context.Context, opts ...func(context.Context) context.Context) context.Context {
	for _, opt := range opts {
		ctx = opt(ctx)
	}
	return ctx
}