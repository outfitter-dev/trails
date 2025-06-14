// Package logging provides structured logging for Trails
package logging

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/outfitter-dev/trails/internal/protocol"
)

// Logger wraps slog.Logger with Trails-specific methods
type Logger struct {
	*slog.Logger
}

// New creates a new structured logger
func New(level slog.Level, jsonOutput bool) *Logger {
	opts := &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			// Customize time format
			if a.Key == slog.TimeKey {
				if t, ok := a.Value.Any().(time.Time); ok {
					a.Value = slog.StringValue(t.Format(time.RFC3339))
				}
			}
			return a
		},
	}

	var handler slog.Handler
	if jsonOutput {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return &Logger{
		Logger: slog.New(handler),
	}
}

// Default creates a logger with default settings
func Default() *Logger {
	return New(slog.LevelInfo, false)
}

// WithContext adds context values to the logger
func (l *Logger) WithContext(ctx context.Context) *Logger {
	// Extract common context values
	attrs := []slog.Attr{}

	if reqID := GetRequestID(ctx); reqID != "" {
		attrs = append(attrs, slog.String("request_id", reqID))
	}

	if cmdID := GetCommandID(ctx); cmdID != "" {
		attrs = append(attrs, slog.String("command_id", cmdID))
	}

	if sessionID := GetSessionID(ctx); sessionID != "" {
		attrs = append(attrs, slog.String("session_id", sessionID))
	}

	if len(attrs) > 0 {
		args := make([]any, len(attrs))
		for i, attr := range attrs {
			args[i] = attr
		}
		return &Logger{Logger: l.With(args...)}
	}

	return l
}

// LogCommand logs a command with context
func (l *Logger) LogCommand(ctx context.Context, msg string, cmd protocol.Command) {
	l.WithContext(ctx).InfoContext(ctx, msg,
		slog.String("command_id", cmd.ID),
		slog.String("command_type", string(cmd.Type)),
		slog.Time("timestamp", cmd.Timestamp),
	)
}

// LogCommandProcessed logs successful command processing
func (l *Logger) LogCommandProcessed(ctx context.Context, cmd protocol.Command, duration time.Duration) {
	l.WithContext(ctx).InfoContext(ctx, "Command processed",
		slog.String("command_id", cmd.ID),
		slog.String("command_type", string(cmd.Type)),
		slog.Duration("duration", duration),
	)
}

// LogCommandError logs command processing errors
func (l *Logger) LogCommandError(ctx context.Context, cmd protocol.Command, err error, duration time.Duration) {
	l.WithContext(ctx).ErrorContext(ctx, "Command failed",
		slog.String("command_id", cmd.ID),
		slog.String("command_type", string(cmd.Type)),
		slog.Duration("duration", duration),
		slog.String("error", err.Error()),
	)
}

// LogEvent logs an event
func (l *Logger) LogEvent(ctx context.Context, msg string, event protocol.Event) {
	attrs := []slog.Attr{
		slog.String("event_id", event.ID),
		slog.String("event_type", string(event.Type)),
		slog.Time("timestamp", event.Timestamp),
	}

	if event.CommandID != "" {
		attrs = append(attrs, slog.String("command_id", event.CommandID))
	}

	args := make([]any, len(attrs))
	for i, attr := range attrs {
		args[i] = attr
	}
	l.WithContext(ctx).InfoContext(ctx, msg, args...)
}

// LogEnhancedEvent logs an enhanced event with metadata
func (l *Logger) LogEnhancedEvent(ctx context.Context, msg string, event protocol.EnhancedEvent) {
	attrs := []slog.Attr{
		slog.String("event_id", event.Metadata.EventID),
		slog.String("event_type", string(event.Type)),
		slog.Time("timestamp", event.Metadata.Timestamp),
	}

	if event.Metadata.CommandID != "" {
		attrs = append(attrs, slog.String("command_id", event.Metadata.CommandID))
	}

	if event.Metadata.SessionID != "" {
		attrs = append(attrs, slog.String("session_id", event.Metadata.SessionID))
	}

	if event.Metadata.CorrelationID != "" {
		attrs = append(attrs, slog.String("correlation_id", event.Metadata.CorrelationID))
	}

	if event.Metadata.Source != "" {
		attrs = append(attrs, slog.String("source", event.Metadata.Source))
	}

	args := make([]any, len(attrs))
	for i, attr := range attrs {
		args[i] = attr
	}
	l.WithContext(ctx).InfoContext(ctx, msg, args...)
}

// LogSessionCreated logs session creation
func (l *Logger) LogSessionCreated(ctx context.Context, session protocol.SessionInfo) {
	l.WithContext(ctx).InfoContext(ctx, "Session created",
		slog.String("session_id", session.ID),
		slog.String("session_name", session.Name),
		slog.String("agent", session.Agent),
		slog.String("status", string(session.Status)),
		slog.String("environment_id", session.EnvironmentID),
	)
}

// LogSessionDeleted logs session deletion
func (l *Logger) LogSessionDeleted(ctx context.Context, sessionID string) {
	l.WithContext(ctx).InfoContext(ctx, "Session deleted",
		slog.String("session_id", sessionID),
	)
}

// LogStatusChange logs session status changes
func (l *Logger) LogStatusChange(ctx context.Context, sessionID string, oldStatus, newStatus protocol.SessionStatus) {
	l.WithContext(ctx).InfoContext(ctx, "Session status changed",
		slog.String("session_id", sessionID),
		slog.String("old_status", string(oldStatus)),
		slog.String("new_status", string(newStatus)),
	)
}

// LogSecurityEvent logs security-related events
func (l *Logger) LogSecurityEvent(ctx context.Context, eventType string, details map[string]interface{}) {
	attrs := []slog.Attr{
		slog.String("security_event", eventType),
	}

	for k, v := range details {
		attrs = append(attrs, slog.Any(k, v))
	}

	args := make([]any, len(attrs))
	for i, attr := range attrs {
		args[i] = attr
	}
	l.WithContext(ctx).WarnContext(ctx, "Security event", args...)
}

// LogRateLimitExceeded logs rate limit violations
func (l *Logger) LogRateLimitExceeded(ctx context.Context, sessionID string) {
	l.WithContext(ctx).WarnContext(ctx, "Rate limit exceeded",
		slog.String("session_id", sessionID),
	)
}

// LogHealthCheck logs health check results
func (l *Logger) LogHealthCheck(ctx context.Context, healthy bool, details map[string]interface{}) {
	level := slog.LevelInfo
	if !healthy {
		level = slog.LevelWarn
	}

	attrs := []slog.Attr{
		slog.Bool("healthy", healthy),
	}

	for k, v := range details {
		attrs = append(attrs, slog.Any(k, v))
	}

	args := make([]any, len(attrs))
	for i, attr := range attrs {
		args[i] = attr
	}
	l.WithContext(ctx).Log(ctx, level, "Health check", args...)
}

// WithError creates a logger with an error field
func (l *Logger) WithError(err error) *Logger {
	return &Logger{
		Logger: l.With(slog.String("error", err.Error())),
	}
}

// WithSession creates a logger with session context
func (l *Logger) WithSession(sessionID string) *Logger {
	return &Logger{
		Logger: l.With(slog.String("session_id", sessionID)),
	}
}

// WithCommand creates a logger with command context
func (l *Logger) WithCommand(commandID string) *Logger {
	return &Logger{
		Logger: l.With(slog.String("command_id", commandID)),
	}
}