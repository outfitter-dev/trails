# Protocol-Based Architecture Addendum

## Critical Improvements and Security Enhancements

> **Context**: This document extends the [Protocol-Based Architecture Refactor](./protocol-based-refactor.md) with critical security, resilience, and operational enhancements identified during architecture review.

Based on comprehensive review and 2025 best practices research, the following improvements should be incorporated into the protocol-based architecture:

## 1. Security Layer

### Authentication and Authorization

```go
// internal/protocol/security.go
package protocol

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
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

// Rate limiting
type RateLimiter struct {
    requests map[string]*rate.Limiter
    mu       sync.RWMutex
    limit    rate.Limit
    burst    int
}

func NewRateLimiter(limit rate.Limit, burst int) *RateLimiter {
    return &RateLimiter{
        requests: make(map[string]*rate.Limiter),
        limit:    limit,
        burst:    burst,
    }
}

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
```

### Audit Trail

```go
// internal/core/audit/audit.go
package audit

type AuditLogger struct {
    store AuditStore
}

type AuditEntry struct {
    ID          string    `json:"id"`
    Timestamp   time.Time `json:"timestamp"`
    UserID      string    `json:"user_id"`
    SessionID   string    `json:"session_id"`
    CommandType string    `json:"command_type"`
    CommandID   string    `json:"command_id"`
    Result      string    `json:"result"`
    Error       string    `json:"error,omitempty"`
    Duration    int64     `json:"duration_ms"`
    Metadata    map[string]interface{} `json:"metadata"`
}

func (a *AuditLogger) LogCommand(cmd protocol.Command, result error, duration time.Duration) {
    entry := AuditEntry{
        ID:          ulid.Make().String(),
        Timestamp:   time.Now(),
        CommandType: string(cmd.Type),
        CommandID:   cmd.ID,
        Duration:    duration.Milliseconds(),
    }
    
    if result != nil {
        entry.Result = "error"
        entry.Error = result.Error()
    } else {
        entry.Result = "success"
    }
    
    a.store.Write(entry)
}
```

## 2. Protocol Versioning and Capability Discovery

```go
// internal/protocol/version.go
package protocol

import "github.com/Masterminds/semver/v3"

type ProtocolVersion struct {
    Version      *semver.Version `json:"version"`
    MinSupported *semver.Version `json:"min_supported"`
}

// Capability discovery
type CapabilityRequest struct {
    ClientVersion *semver.Version `json:"client_version"`
}

type CapabilityResponse struct {
    ServerVersion   *semver.Version   `json:"server_version"`
    MinClientVersion *semver.Version  `json:"min_client_version"`
    Commands        []CommandInfo     `json:"commands"`
    Events          []EventInfo       `json:"events"`
    Extensions      []ExtensionInfo   `json:"extensions"`
    Features        map[string]bool   `json:"features"`
}

type CommandInfo struct {
    Type        CommandType `json:"type"`
    Description string      `json:"description"`
    Schema      interface{} `json:"schema"`
    Since       string      `json:"since"`
    Deprecated  bool        `json:"deprecated"`
}

// Version negotiation
func NegotiateVersion(client, server *semver.Version) (*semver.Version, error) {
    constraint, _ := semver.NewConstraint(">= 1.0.0")
    
    if !constraint.Check(client) {
        return nil, errors.New("client version too old")
    }
    
    // Use the lower of client/server versions
    if client.LessThan(server) {
        return client, nil
    }
    return server, nil
}
```

## 3. Enhanced Error Recovery

```go
// internal/core/resilience/circuit_breaker.go
package resilience

import (
    "github.com/sony/gobreaker"
)

type CircuitBreaker struct {
    breaker *gobreaker.CircuitBreaker
}

func NewCircuitBreaker(name string) *CircuitBreaker {
    settings := gobreaker.Settings{
        Name:        name,
        MaxRequests: 5,
        Interval:    10 * time.Second,
        Timeout:     30 * time.Second,
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
            return counts.Requests >= 3 && failureRatio >= 0.6
        },
    }
    
    return &CircuitBreaker{
        breaker: gobreaker.NewCircuitBreaker(settings),
    }
}

func (cb *CircuitBreaker) Execute(fn func() error) error {
    _, err := cb.breaker.Execute(func() (interface{}, error) {
        return nil, fn()
    })
    return err
}

// Retry with exponential backoff
type RetryPolicy struct {
    MaxRetries int
    BaseDelay  time.Duration
    MaxDelay   time.Duration
}

func (p RetryPolicy) Execute(ctx context.Context, fn func() error) error {
    var err error
    delay := p.BaseDelay
    
    for i := 0; i <= p.MaxRetries; i++ {
        if err = fn(); err == nil {
            return nil
        }
        
        if i == p.MaxRetries {
            break
        }
        
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(delay):
            delay *= 2
            if delay > p.MaxDelay {
                delay = p.MaxDelay
            }
        }
    }
    
    return fmt.Errorf("after %d retries: %w", p.MaxRetries, err)
}
```

## 4. Event Metadata and Correlation

```go
// internal/protocol/metadata.go
package protocol

type EventMetadata struct {
    EventID      string            `json:"event_id"`
    CommandID    string            `json:"command_id,omitempty"`
    CorrelationID string           `json:"correlation_id"`
    CausationID   string           `json:"causation_id"`
    Timestamp     time.Time        `json:"timestamp"`
    Source        string           `json:"source"`
    UserID        string           `json:"user_id,omitempty"`
    SessionID     string           `json:"session_id,omitempty"`
    Tags          map[string]string `json:"tags,omitempty"`
}

// Enhanced Event with metadata
type EnhancedEvent struct {
    Metadata EventMetadata `json:"metadata"`
    Type     EventType     `json:"type"`
    Payload  interface{}   `json:"payload"`
}

// Event builder with fluent interface
type EventBuilder struct {
    event EnhancedEvent
}

func NewEvent(eventType EventType) *EventBuilder {
    return &EventBuilder{
        event: EnhancedEvent{
            Metadata: EventMetadata{
                EventID:   ulid.Make().String(),
                Timestamp: time.Now(),
                Source:    "trails-engine",
            },
            Type: eventType,
        },
    }
}

func (b *EventBuilder) WithCommandID(id string) *EventBuilder {
    b.event.Metadata.CommandID = id
    return b
}

func (b *EventBuilder) WithCorrelation(id string) *EventBuilder {
    b.event.Metadata.CorrelationID = id
    return b
}

func (b *EventBuilder) WithPayload(payload interface{}) *EventBuilder {
    b.event.Payload = payload
    return b
}

func (b *EventBuilder) Build() EnhancedEvent {
    return b.event
}
```

## 5. Interface Segregation Improvements

```go
// internal/core/interfaces/session.go
package interfaces

// Segregated interfaces following ISP
type SessionReader interface {
    Get(ctx context.Context, id string) (*Session, error)
    List(ctx context.Context, filter SessionFilter) ([]*Session, error)
    Count(ctx context.Context) (int, error)
}

type SessionWriter interface {
    Create(ctx context.Context, session *Session) error
    Update(ctx context.Context, id string, updates SessionUpdate) error
    Delete(ctx context.Context, id string) error
}

type SessionStore interface {
    SessionReader
    SessionWriter
}

// Separate concerns for containers
type ContainerAllocator interface {
    Allocate(ctx context.Context, spec ContainerSpec) (*Container, error)
}

type ContainerManager interface {
    Start(ctx context.Context, id string) error
    Stop(ctx context.Context, id string) error
    Restart(ctx context.Context, id string) error
}

type ContainerInspector interface {
    Status(ctx context.Context, id string) (ContainerStatus, error)
    Logs(ctx context.Context, id string, opts LogOptions) (io.ReadCloser, error)
}

type ContainerProvider interface {
    ContainerAllocator
    ContainerManager
    ContainerInspector
}
```

## 6. Enhanced Observability

```go
// internal/telemetry/tracing.go
package telemetry

import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/trace"
    "go.opentelemetry.io/otel/attribute"
)

type TracedEngine struct {
    *Engine
    tracer trace.Tracer
}

func NewTracedEngine(engine *Engine) *TracedEngine {
    return &TracedEngine{
        Engine: engine,
        tracer: otel.Tracer("trails/engine"),
    }
}

func (e *TracedEngine) ProcessCommand(ctx context.Context, cmd Command) error {
    ctx, span := e.tracer.Start(ctx, "ProcessCommand",
        trace.WithAttributes(
            attribute.String("command.id", cmd.ID),
            attribute.String("command.type", string(cmd.Type)),
        ),
    )
    defer span.End()
    
    // Add command to span context
    ctx = context.WithValue(ctx, "command_id", cmd.ID)
    
    // Process with tracing
    err := e.Engine.ProcessCommand(ctx, cmd)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
    }
    
    return err
}

// Structured logging with context
type ContextLogger struct {
    logger *slog.Logger
}

func (l *ContextLogger) LogCommand(ctx context.Context, msg string, cmd Command) {
    l.logger.InfoContext(ctx, msg,
        slog.String("command_id", cmd.ID),
        slog.String("command_type", string(cmd.Type)),
        slog.String("correlation_id", GetCorrelationID(ctx)),
        slog.Time("timestamp", time.Now()),
    )
}
```

## 7. Resource Management

```go
// internal/core/resources/limits.go
package resources

type ResourceLimits struct {
    MaxSessionsPerUser     int
    MaxConcurrentSessions  int
    MaxSessionDuration     time.Duration
    MaxEnvironmentSize     int64 // bytes
    MaxCommandQueueSize    int
}

type ResourceManager struct {
    limits  ResourceLimits
    usage   map[string]*UserUsage
    mu      sync.RWMutex
}

type UserUsage struct {
    ActiveSessions int
    TotalStorage   int64
    LastActivity   time.Time
}

func (rm *ResourceManager) CanCreateSession(userID string) error {
    rm.mu.RLock()
    defer rm.mu.RUnlock()
    
    usage, exists := rm.usage[userID]
    if !exists {
        return nil
    }
    
    if usage.ActiveSessions >= rm.limits.MaxSessionsPerUser {
        return errors.New("session limit exceeded")
    }
    
    totalSessions := 0
    for _, u := range rm.usage {
        totalSessions += u.ActiveSessions
    }
    
    if totalSessions >= rm.limits.MaxConcurrentSessions {
        return errors.New("system session limit exceeded")
    }
    
    return nil
}

// Garbage collection for stale sessions
type SessionGarbageCollector struct {
    store      SessionStore
    maxAge     time.Duration
    checkEvery time.Duration
}

func (gc *SessionGarbageCollector) Start(ctx context.Context) {
    ticker := time.NewTicker(gc.checkEvery)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            gc.collectGarbage(ctx)
        }
    }
}

func (gc *SessionGarbageCollector) collectGarbage(ctx context.Context) {
    sessions, err := gc.store.List(ctx, SessionFilter{
        OlderThan: time.Now().Add(-gc.maxAge),
        Status:    []Status{StatusError, StatusInactive},
    })
    
    if err != nil {
        return
    }
    
    for _, session := range sessions {
        if err := gc.store.Delete(ctx, session.ID); err != nil {
            // Log error but continue
            continue
        }
    }
}
```

## 8. Event Replay and Recovery

```go
// internal/core/replay/replay.go
package replay

type EventStore interface {
    Append(ctx context.Context, event Event) error
    GetEvents(ctx context.Context, after time.Time) ([]Event, error)
    GetSnapshot(ctx context.Context) (*StateSnapshot, error)
    SaveSnapshot(ctx context.Context, snapshot *StateSnapshot) error
}

type EventReplayer struct {
    store  EventStore
    engine *Engine
}

func (r *EventReplayer) ReplayFromSnapshot(ctx context.Context) error {
    // Get latest snapshot
    snapshot, err := r.store.GetSnapshot(ctx)
    if err != nil {
        return fmt.Errorf("get snapshot: %w", err)
    }
    
    // Restore state from snapshot
    if err := r.engine.RestoreState(snapshot.State); err != nil {
        return fmt.Errorf("restore state: %w", err)
    }
    
    // Replay events after snapshot
    events, err := r.store.GetEvents(ctx, snapshot.Timestamp)
    if err != nil {
        return fmt.Errorf("get events: %w", err)
    }
    
    for _, event := range events {
        if err := r.engine.ReplayEvent(ctx, event); err != nil {
            return fmt.Errorf("replay event %s: %w", event.ID, err)
        }
    }
    
    return nil
}

// Snapshot creation
type Snapshotter struct {
    store    EventStore
    engine   *Engine
    interval time.Duration
}

func (s *Snapshotter) Start(ctx context.Context) {
    ticker := time.NewTicker(s.interval)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            s.createSnapshot(ctx)
        }
    }
}
```

## Implementation Priority

### Phase 0: Security Foundation (Week 0)
1. Implement authentication/authorization layer
2. Add rate limiting
3. Set up audit logging
4. Add input validation and sanitization

### Phase 1-4: (As originally planned)
Continue with the [original implementation plan](./protocol-based-refactor.md#implementation-plan), incorporating these enhancements as you build each component.

## Integration with Base Architecture

These enhancements integrate with the base architecture as follows:

1. **Security Layer** - Wraps all protocol commands before processing
2. **Protocol Versioning** - Negotiated during initial connection handshake
3. **Circuit Breakers** - Protect each command handler and external service call
4. **Event Metadata** - Added to all events in the core engine
5. **Resource Management** - Enforced at session creation and throughout lifecycle
6. **Observability** - Integrated at protocol, engine, and UI layers

See the [main architecture document](./protocol-based-refactor.md) for the complete implementation context.

## Testing Additions

```go
// Protocol conformance tests
func TestProtocolConformance(t *testing.T) {
    // Test all command types
    for _, cmdType := range AllCommandTypes {
        t.Run(string(cmdType), func(t *testing.T) {
            cmd := NewCommand(cmdType)
            assert.NoError(t, cmd.Validate())
            
            // Verify serialization roundtrip
            data, err := json.Marshal(cmd)
            assert.NoError(t, err)
            
            var decoded Command
            assert.NoError(t, json.Unmarshal(data, &decoded))
            assert.Equal(t, cmd, decoded)
        })
    }
}

// Chaos testing
func TestEngineUnderChaos(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping chaos test")
    }
    
    engine := setupTestEngine()
    chaos := NewChaosMonkey(engine)
    
    // Run normal operations
    go simulateNormalLoad(engine)
    
    // Inject failures
    chaos.RandomlyKillConnections()
    chaos.SimulateHighLatency()
    chaos.CorruptRandomMessages()
    
    // Verify system recovers
    assert.Eventually(t, func() bool {
        return engine.IsHealthy()
    }, 30*time.Second, time.Second)
}
```

This addendum addresses all critical gaps identified in the review while maintaining the clean architecture of the original design.