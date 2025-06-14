# Engine Component

The Engine is the core orchestration component of Trails, responsible for processing commands, managing state, and coordinating between the UI and underlying systems.

## Overview

The Engine implements a **worker pool pattern** with concurrent command processing, rate limiting, and comprehensive error handling. It serves as the central hub for all system operations.

### Key Responsibilities

- **Command Processing**: Validate, route, and execute commands from the UI
- **Session Coordination**: Manage session lifecycle through SessionManager
- **State Management**: Persist and restore system state
- **Event Distribution**: Send status updates and responses back to UI
- **Resource Management**: Rate limiting, cleanup, and health monitoring

## Architecture

```go
type Engine struct {
    // Communication channels
    commands <-chan protocol.Command      // Incoming commands from UI
    events   chan<- protocol.EnhancedEvent // Outgoing events to UI

    // Core components
    sessions   SessionManager    // Manages agent session lifecycle
    state      StateManager      // Handles state persistence
    containers ContainerManager  // Manages container environments

    // Infrastructure
    logger      *logging.Logger              // Structured logging
    rateLimiter *protocol.LRURateLimiter     // Rate limiting with LRU eviction
    metrics     MetricsCollector             // Performance metrics

    // Runtime
    ctx    context.Context    // Engine context for shutdown
    cancel context.CancelFunc // Cancel function for graceful shutdown
    wg     sync.WaitGroup     // Tracks worker goroutines
}
```

## Command Processing

### Worker Pool

The engine runs multiple worker goroutines for concurrent command processing:

```go
func (e *Engine) commandWorker(workerID int) {
    defer e.wg.Done()
    
    for {
        select {
        case <-e.ctx.Done():
            return
        case cmd := <-e.commands:
            e.processCommand(cmd, logger)
        }
    }
}
```

**Benefits:**
- **Parallelism**: Multiple commands processed simultaneously
- **Isolation**: Worker failures don't affect others
- **Load Balancing**: Commands distributed across workers
- **Graceful Shutdown**: All workers stop cleanly

### Command Lifecycle

1. **Receive**: Command received from UI channel
2. **Validate**: Structure and required fields checked
3. **Rate Limit**: Per-session limits applied
4. **Route**: Command dispatched to appropriate handler
5. **Execute**: Business logic performed
6. **Respond**: Success/error event sent to UI
7. **Metrics**: Performance data recorded

### Supported Commands

| Command | Purpose | Handler |
|---------|---------|---------|
| `CreateSession` | Create new AI agent session | `handleCreateSession` |
| `DeleteSession` | Remove session and cleanup | `handleDeleteSession` |
| `UpdateSession` | Modify session properties | `handleUpdateSession` |
| `ListSessions` | Query sessions with filters | `handleListSessions` |
| `StartAgent` | Launch AI agent process | `handleStartAgent` |
| `StopAgent` | Terminate AI agent process | `handleStopAgent` |
| `RestartAgent` | Restart unresponsive agent | `handleRestartAgent` |
| `SetFocus` | Change UI focus to session | `handleSetFocus` |
| `NextActionable` | Find next session needing attention | `handleNextActionable` |
| `ToggleMinimal` | Switch UI minimal mode | `handleToggleMinimal` |
| `SetPreference` | Update user preference | `handleSetPreference` |
| `HealthCheck` | Get engine health status | `handleHealthCheck` |
| `Shutdown` | Graceful engine shutdown | `handleShutdown` |

## Rate Limiting

### LRU Rate Limiter

The engine uses an LRU-based rate limiter to prevent abuse:

```go
type LRURateLimiter struct {
    rate     int           // Requests per second
    burst    int           // Maximum burst size
    limiters *lru.Cache    // LRU cache of token buckets
    maxSize  int           // Maximum cache size
}
```

**Features:**
- **Per-Session Limits**: Each session has independent rate limit
- **Token Bucket**: Allows bursts while maintaining sustained rate
- **LRU Eviction**: Prevents unbounded memory growth
- **Configurable**: Rate and burst size configurable per deployment

### Rate Limit Configuration

```go
config := engine.DefaultConfig()
config.RateLimitPerSecond = 10    // 10 commands per second sustained
config.RateLimitBurst = 20        // Up to 20 commands in burst
```

## Error Handling

### Error Categories

1. **Validation Errors**: Malformed commands, missing fields
2. **Business Logic Errors**: Invalid state transitions, resource conflicts
3. **Resource Errors**: Container failures, storage issues
4. **System Errors**: Network failures, service unavailability

### Error Response

All errors generate structured error events:

```go
type ErrorEvent struct {
    Code        string `json:"code"`        // Machine-readable error code
    Message     string `json:"message"`     // Human-readable message
    Details     string `json:"details"`     // Detailed error information
    Recoverable bool   `json:"recoverable"` // Whether error is recoverable
}
```

### Recovery Strategies

- **Retries**: Transient failures retried with exponential backoff
- **Circuit Breaking**: Repeated failures trigger circuit breaker
- **Graceful Degradation**: Non-critical failures don't stop engine
- **State Preservation**: Critical errors preserve state before shutdown

## Metrics and Monitoring

### Built-in Metrics

The engine collects comprehensive metrics for monitoring:

```go
type MetricsCollector interface {
    RecordCommand(cmdType protocol.CommandType)
    RecordCommandDuration(cmdType protocol.CommandType, duration time.Duration)
    RecordError(operation string, err error)
    RecordSessionCount(count int)
    IncrementCounter(name string, tags map[string]string)
}
```

### Prometheus Integration

When enabled, metrics are exposed via Prometheus:

```go
config := engine.DefaultConfig()
config.Prometheus.Enabled = true
config.Prometheus.Port = 9090

engine, metrics, err := engine.NewWithPrometheusMetrics(config, ...)
```

**Available Metrics:**
- `trails_commands_total` - Command counts by type
- `trails_command_duration_seconds` - Command latency histograms
- `trails_command_errors_total` - Error counts by type
- `trails_sessions_active` - Current active sessions
- `trails_rate_limit_hits_total` - Rate limit violations
- `trails_events_dropped_total` - Dropped events due to saturation

### Health Monitoring

The engine provides health status via `/health` endpoint and health commands:

```go
health := engine.Health()
// Returns:
// {
//   "status": "healthy",
//   "active_sessions": 5,
//   "rate_limiters": 12,
//   "worker_count": 3,
//   "max_sessions": 10,
//   "uptime_seconds": 3600
// }
```

## Configuration

### Engine Configuration

```go
type Config struct {
    MaxConcurrentSessions int           // Session limit
    CommandBufferSize     int           // Command channel buffer
    EventBufferSize       int           // Event channel buffer
    StateFile             string        // State persistence file
    WorkerCount           int           // Number of worker goroutines
    ShutdownTimeout       time.Duration // Graceful shutdown timeout
    RateLimitPerSecond    int           // Rate limit sustained rate
    RateLimitBurst        int           // Rate limit burst size
    LogLevel              string        // Logging verbosity
    Prometheus            PrometheusConfig // Metrics configuration
}
```

### Default Configuration

```go
config := engine.DefaultConfig()
// Provides sensible defaults for development:
// - 3 workers
// - 10 max concurrent sessions
// - 100 command buffer, 5000 event buffer
// - 30 second shutdown timeout
// - 10 req/sec rate limit with 20 burst
// - Info-level logging
// - Prometheus disabled
```

## Lifecycle Management

### Startup Sequence

1. **Validation**: All dependencies validated (channels, managers, logger)
2. **State Loading**: Persistent state loaded from disk
3. **Worker Startup**: Command worker goroutines started
4. **Background Tasks**: State manager, health monitor, cleanup workers started
5. **Metrics Server**: Prometheus server started if enabled
6. **Initial Events**: State snapshot sent to UI

### Shutdown Sequence

1. **Context Cancellation**: All workers notified to stop
2. **Metrics Cleanup**: Prometheus server stopped gracefully
3. **Worker Termination**: Wait for workers with timeout
4. **State Persistence**: Final state saved to disk
5. **Resource Cleanup**: All resources released

### Background Tasks

The engine runs several background goroutines:

- **State Manager**: Periodic state persistence (every 30 seconds)
- **Health Monitor**: Session health checks and metrics updates (every 60 seconds)
- **Cleanup Worker**: Rate limiter cleanup and stale resource removal (every minute)

## Testing

### Unit Tests

The engine includes comprehensive unit tests covering:

- Command processing for all command types
- Error handling and validation
- Rate limiting behavior
- Graceful startup and shutdown
- Metrics collection

### Chaos Testing

Chaos tests verify engine behavior under stress:

- **Malformed Payloads**: Invalid JSON, wrong types, nil payloads
- **Channel Saturation**: Command and event channel overload
- **Rate Limiting**: Burst behavior and limit enforcement
- **Resource Exhaustion**: Memory and CPU pressure testing

Example chaos test:

```go
func TestEngine_ChaosTestChannelSaturation(t *testing.T) {
    // Create engine with tiny buffers
    config := DefaultConfig()
    config.CommandBufferSize = 2
    
    // Flood channels and verify graceful handling
    // ...
}
```

## Best Practices

### Configuration
- **Environment-Specific**: Use different configs for dev/staging/prod
- **Resource Limits**: Set appropriate session and buffer limits
- **Monitoring**: Enable Prometheus metrics in production
- **Logging**: Use structured logging with appropriate verbosity

### Error Handling
- **Fail Fast**: Validate inputs early and return clear errors
- **Recovery**: Implement retry logic for transient failures
- **Monitoring**: Alert on error rate increases
- **Documentation**: Document error codes and recovery procedures

### Performance
- **Worker Tuning**: Adjust worker count based on CPU cores
- **Buffer Sizing**: Size channels based on expected load
- **Rate Limiting**: Set limits to prevent resource exhaustion
- **Metrics**: Monitor command latency and adjust accordingly

### Security
- **Input Validation**: Validate all command inputs
- **Rate Limiting**: Prevent DoS attacks via rate limits
- **Isolation**: Ensure session isolation through container boundaries
- **Secrets**: Never log sensitive data or credentials

## Troubleshooting

### Common Issues

**Engine Won't Start**
- Check state file permissions and validity
- Verify all dependencies are provided
- Check for port conflicts (Prometheus)

**High Command Latency**
- Increase worker count
- Check for database/storage bottlenecks
- Monitor session manager performance

**Rate Limit Errors**
- Adjust rate limit configuration
- Check for client bugs causing command floods
- Monitor session command patterns

**Memory Growth**
- Check rate limiter cache size
- Monitor session cleanup
- Verify event channel drainage

### Debug Logging

Enable debug logging for detailed troubleshooting:

```go
config := engine.DefaultConfig()
config.LogLevel = "debug"
```

Debug logs include:
- Command processing details
- Rate limiter hits and cache state
- Background task execution
- Detailed error context

## Related Documentation

- [Protocol Design](../architecture/protocol.md) - Command and event specifications
- [Session Management](./sessions.md) - Session lifecycle and state
- [Monitoring](../operations/monitoring.md) - Production monitoring setup
- [Configuration](../operations/configuration.md) - Deployment configuration options