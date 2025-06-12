# Trails Logging Package

This package provides structured logging for the Trails application using Go's standard `log/slog` package.

## Features

- Structured logging with JSON or text output
- Context-aware logging with request/command/session IDs
- Specialized methods for common operations
- Security event logging
- Performance tracking

## Usage

### Basic Usage

```go
// Create a logger
logger := logging.Default()

// Or with custom settings
logger := logging.New(slog.LevelDebug, true) // JSON output

// Log messages
logger.Info("Starting application")
logger.Error("Failed to connect", slog.String("error", err.Error()))
```

### Context-Aware Logging

```go
// Add context values
ctx := logging.WithRequestID(ctx, "req-123")
ctx = logging.WithSessionID(ctx, "session-456")

// Log with context
logger.WithContext(ctx).Info("Processing request")
```

### Command Logging

```go
// Log command processing
logger.LogCommand(ctx, "Processing command", cmd)

// Log success
logger.LogCommandProcessed(ctx, cmd, duration)

// Log failure
logger.LogCommandError(ctx, cmd, err, duration)
```

### Session Operations

```go
// Log session lifecycle
logger.LogSessionCreated(ctx, sessionInfo)
logger.LogSessionDeleted(ctx, sessionID)
logger.LogStatusChange(ctx, sessionID, oldStatus, newStatus)
```

### Security Events

```go
// Log security-related events
logger.LogSecurityEvent(ctx, "unauthorized_access", map[string]interface{}{
    "user_id": userID,
    "resource": resourceID,
    "action": "read",
})

// Log rate limiting
logger.LogRateLimitExceeded(ctx, sessionID)
```

### Health Checks

```go
// Log health status
logger.LogHealthCheck(ctx, healthy, map[string]interface{}{
    "uptime": uptime,
    "memory": memUsage,
    "sessions": activeSessions,
})
```

## Context Keys

The package uses the following context keys:
- `request_id` - Unique request identifier
- `command_id` - Command being processed
- `session_id` - Session identifier
- `user_id` - User identifier
- `correlation_id` - For tracing related operations

## Best Practices

1. Always use structured logging (key-value pairs)
2. Include context IDs for traceability
3. Use appropriate log levels
4. Log at boundaries (entry/exit of major operations)
5. Include duration for performance-critical operations