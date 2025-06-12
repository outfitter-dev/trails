package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/outfitter-dev/trails/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// captureLogger creates a logger that writes to a buffer for testing
func captureLogger(jsonOutput bool) (*Logger, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	opts := &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}

	var handler slog.Handler
	if jsonOutput {
		handler = slog.NewJSONHandler(buf, opts)
	} else {
		handler = slog.NewTextHandler(buf, opts)
	}

	logger := &Logger{
		Logger: slog.New(handler),
	}

	return logger, buf
}

func TestLogCommand(t *testing.T) {
	logger, buf := captureLogger(true)
	ctx := context.Background()

	cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
		Name:  "test-session",
		Agent: "claude",
	})

	logger.LogCommand(ctx, "Processing command", cmd)

	// Parse JSON output
	var log map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &log)
	require.NoError(t, err)

	assert.Equal(t, "Processing command", log["msg"])
	assert.Equal(t, cmd.ID, log["command_id"])
	assert.Equal(t, string(cmd.Type), log["command_type"])
	assert.NotEmpty(t, log["timestamp"])
}

func TestLogCommandWithContext(t *testing.T) {
	logger, buf := captureLogger(true)
	
	ctx := context.Background()
	ctx = WithRequestID(ctx, "req-123")
	ctx = WithSessionID(ctx, "session-456")

	cmd := protocol.NewCommand(protocol.CmdStartAgent, protocol.StartAgentCommand{
		SessionID: "session-456",
	})

	logger.LogCommand(ctx, "Starting agent", cmd)

	// Parse JSON output
	var log map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &log)
	require.NoError(t, err)

	assert.Equal(t, "req-123", log["request_id"])
	assert.Equal(t, "session-456", log["session_id"])
}

func TestLogCommandProcessed(t *testing.T) {
	logger, buf := captureLogger(true)
	ctx := context.Background()

	cmd := protocol.NewCommand(protocol.CmdHealthCheck, nil)
	duration := 100 * time.Millisecond

	logger.LogCommandProcessed(ctx, cmd, duration)

	// Parse JSON output
	var log map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &log)
	require.NoError(t, err)

	assert.Equal(t, "Command processed", log["msg"])
	assert.Equal(t, cmd.ID, log["command_id"])
	assert.Equal(t, float64(100000000), log["duration"]) // nanoseconds
}

func TestLogCommandError(t *testing.T) {
	logger, buf := captureLogger(true)
	ctx := context.Background()

	cmd := protocol.NewCommand(protocol.CmdDeleteSession, protocol.DeleteSessionCommand{
		SessionID: "invalid-id",
	})
	testErr := errors.New("session not found")
	duration := 50 * time.Millisecond

	logger.LogCommandError(ctx, cmd, testErr, duration)

	// Parse JSON output
	var log map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &log)
	require.NoError(t, err)

	assert.Equal(t, "Command failed", log["msg"])
	assert.Equal(t, "ERROR", log["level"])
	assert.Equal(t, "session not found", log["error"])
}

func TestLogEvent(t *testing.T) {
	logger, buf := captureLogger(true)
	ctx := context.Background()

	event := protocol.NewEventForCommand(
		protocol.EventSessionCreated,
		"cmd-123",
		protocol.SessionCreatedEvent{
			Session: protocol.SessionInfo{
				ID:     "session-789",
				Name:   "test-session",
				Agent:  "claude",
				Status: protocol.StatusReady,
			},
		},
	)

	logger.LogEvent(ctx, "Session created event", event)

	// Parse JSON output
	var log map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &log)
	require.NoError(t, err)

	assert.Equal(t, "Session created event", log["msg"])
	assert.Equal(t, event.ID, log["event_id"])
	assert.Equal(t, "cmd-123", log["command_id"])
}

func TestLogSessionCreated(t *testing.T) {
	logger, buf := captureLogger(true)
	ctx := context.Background()

	session := protocol.SessionInfo{
		ID:            "session-123",
		Name:          "test-session",
		Agent:         "claude",
		Status:        protocol.StatusReady,
		EnvironmentID: "env-456",
	}

	logger.LogSessionCreated(ctx, session)

	// Parse JSON output
	var log map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &log)
	require.NoError(t, err)

	assert.Equal(t, "Session created", log["msg"])
	assert.Equal(t, "session-123", log["session_id"])
	assert.Equal(t, "test-session", log["session_name"])
	assert.Equal(t, "claude", log["agent"])
}

func TestLogSecurityEvent(t *testing.T) {
	logger, buf := captureLogger(true)
	ctx := context.Background()

	details := map[string]interface{}{
		"session_id": "session-123",
		"action":     "rate_limit_exceeded",
		"limit":      100,
		"current":    150,
	}

	logger.LogSecurityEvent(ctx, "rate_limit", details)

	// Parse JSON output
	var log map[string]interface{}
	err := json.Unmarshal(buf.Bytes(), &log)
	require.NoError(t, err)

	assert.Equal(t, "Security event", log["msg"])
	assert.Equal(t, "WARN", log["level"])
	assert.Equal(t, "rate_limit", log["security_event"])
	assert.Equal(t, "session-123", log["session_id"])
}

func TestLogHealthCheck(t *testing.T) {
	t.Run("healthy", func(t *testing.T) {
		logger, buf := captureLogger(true)
		ctx := context.Background()

		details := map[string]interface{}{
			"sessions_active": 5,
			"memory_mb":       128,
			"uptime_seconds":  3600,
		}

		logger.LogHealthCheck(ctx, true, details)

		var log map[string]interface{}
		err := json.Unmarshal(buf.Bytes(), &log)
		require.NoError(t, err)

		assert.Equal(t, "Health check", log["msg"])
		assert.Equal(t, "INFO", log["level"])
		assert.Equal(t, true, log["healthy"])
	})

	t.Run("unhealthy", func(t *testing.T) {
		logger, buf := captureLogger(true)
		ctx := context.Background()

		details := map[string]interface{}{
			"error": "database connection failed",
		}

		logger.LogHealthCheck(ctx, false, details)

		var log map[string]interface{}
		err := json.Unmarshal(buf.Bytes(), &log)
		require.NoError(t, err)

		assert.Equal(t, "WARN", log["level"])
		assert.Equal(t, false, log["healthy"])
	})
}

func TestWithHelpers(t *testing.T) {
	logger, buf := captureLogger(false)

	// Test WithError
	err := errors.New("test error")
	logger.WithError(err).Info("Error occurred")
	assert.Contains(t, buf.String(), "error=\"test error\"")

	buf.Reset()

	// Test WithSession
	logger.WithSession("session-123").Info("Session operation")
	assert.Contains(t, buf.String(), "session_id=session-123")

	buf.Reset()

	// Test WithCommand
	logger.WithCommand("cmd-456").Info("Command operation")
	assert.Contains(t, buf.String(), "command_id=cmd-456")
}

func TestTextOutput(t *testing.T) {
	logger, buf := captureLogger(false)

	logger.Info("Test message", slog.String("key", "value"))

	output := buf.String()
	assert.Contains(t, output, "Test message")
	assert.Contains(t, output, "key=value")
}

func TestDefault(t *testing.T) {
	logger := Default()
	assert.NotNil(t, logger)
	
	// Test that INFO level is enabled
	assert.True(t, logger.Handler().Enabled(context.Background(), slog.LevelInfo))
	
	// Test that DEBUG level is disabled (since default is INFO)
	assert.False(t, logger.Handler().Enabled(context.Background(), slog.LevelDebug))
}