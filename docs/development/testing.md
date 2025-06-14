# Testing Strategy

This document outlines the comprehensive testing approach for Trails, including unit testing, integration testing, and chaos engineering.

## Testing Philosophy

Trails follows a **reliability-first** testing approach:

1. **Fail Fast**: Catch issues early in development
2. **Real-World Scenarios**: Test production-like conditions
3. **Chaos Engineering**: Verify behavior under stress and failure
4. **Automated**: All tests run in CI/CD pipeline
5. **Comprehensive**: Cover happy paths, edge cases, and failure modes

## Test Types

### Unit Tests

Unit tests verify individual components in isolation.

**Coverage Requirements:**
- **Core Logic**: 90%+ coverage for engine, protocol, session management
- **Error Paths**: All error conditions must be tested
- **Edge Cases**: Boundary conditions and null inputs
- **Concurrency**: Thread safety and race condition prevention

**Example:**
```go
func TestEngine_CreateSession(t *testing.T) {
    engine, commands, events := createTestEngine(t)
    
    // Start engine
    err := engine.Start(ctx)
    require.NoError(t, err)
    defer engine.Stop()
    
    // Send create command
    cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
        Name:  "test-session",
        Agent: "claude",
    })
    commands <- cmd
    
    // Verify success event
    event := <-events
    assert.Equal(t, protocol.EventSessionCreated, event.Type)
}
```

### Integration Tests

Integration tests verify component interactions and system behavior.

**Scope:**
- **Command Flow**: Full command processing pipeline
- **State Persistence**: State save/load across restarts
- **Container Integration**: Session-container coordination
- **Event Distribution**: UI event delivery

**Test Helpers:**
```go
func TestScenario(t *testing.T, scenario TestScenario) {
    // Setup engine with mock dependencies
    sessionMgr := NewMockSessionManager()
    stateMgr := NewMockStateManager()
    
    // Apply initial state
    scenario.InitialState(sessionMgr, stateMgr)
    
    // Execute command sequence
    for _, cmd := range scenario.Commands {
        commands <- cmd
    }
    
    // Collect and verify events
    events := DrainEvents(eventChan, 2*time.Second)
    scenario.Assertions(t, events)
}
```

### Chaos Testing

Chaos tests verify system behavior under stress and failure conditions.

#### Malformed Input Testing

Tests engine resilience to invalid inputs:

```go
func TestEngine_ChaosTestMalformedPayloads(t *testing.T) {
    t.Run("invalid payload type", func(t *testing.T) {
        // Send command with string payload instead of struct
        cmd := protocol.Command{
            ID:      ulid.Make().String(),
            Type:    protocol.CmdCreateSession,
            Payload: "invalid-payload-type",
        }
        
        commands <- cmd
        
        // Should get error event
        event := <-events
        assert.Equal(t, protocol.EventError, event.Type)
    })
    
    t.Run("nil payload", func(t *testing.T) {
        // Send command with nil payload
        cmd := protocol.Command{
            ID:      ulid.Make().String(),
            Type:    protocol.CmdCreateSession,
            Payload: nil,
        }
        
        commands <- cmd
        
        // Should get error event
        event := <-events
        assert.Equal(t, protocol.EventError, event.Type)
    })
}
```

#### Channel Saturation Testing

Tests behavior when channels are overwhelmed:

```go
func TestEngine_ChaosTestChannelSaturation(t *testing.T) {
    // Create engine with tiny buffers
    config := DefaultConfig()
    config.CommandBufferSize = 2
    config.EventBufferSize = 2
    
    engine := createTestEngineWithConfig(t, config)
    
    // Flood command channel
    for i := 0; i < 10; i++ {
        cmd := protocol.NewCommand(protocol.CmdHealthCheck, protocol.HealthCheckCommand{})
        
        select {
        case commands <- cmd:
            // Command accepted
        case <-time.After(100 * time.Millisecond):
            // Expected - channel is full
            t.Logf("Channel saturated after %d commands", i)
            break
        }
    }
    
    // Engine should remain responsive
    health := engine.Health()
    assert.Equal(t, "healthy", health["status"])
}
```

#### Rate Limiting Stress Tests

Tests rate limiter behavior under load:

```go
func TestEngine_ChaosTestRateLimiting(t *testing.T) {
    // Configure very low rate limit
    config := DefaultConfig()
    config.RateLimitPerSecond = 2
    
    engine := createTestEngineWithConfig(t, config)
    
    // Create session first
    sessionID := createTestSession(t, engine)
    
    // Rapid-fire commands (should be rate limited)
    rateLimitedCount := 0
    for i := 0; i < 10; i++ {
        cmd := protocol.NewCommand(protocol.CmdStartAgent, protocol.StartAgentCommand{
            SessionID: sessionID,
        })
        commands <- cmd
        
        // Check for rate limit errors
        select {
        case event := <-events:
            if event.Type == protocol.EventError {
                payload := event.Payload.(protocol.ErrorEvent)
                if strings.Contains(payload.Details, "rate limit exceeded") {
                    rateLimitedCount++
                }
            }
        case <-time.After(50 * time.Millisecond):
            // Continue
        }
    }
    
    assert.Greater(t, rateLimitedCount, 0, "should have rate limited some commands")
}
```

#### Resource Exhaustion Tests

Tests behavior under resource pressure:

```go
func TestEngine_ChaosTestResourceExhaustion(t *testing.T) {
    t.Run("session limit exhaustion", func(t *testing.T) {
        config := DefaultConfig()
        config.MaxConcurrentSessions = 2 // Very low limit
        
        engine := createTestEngineWithConfig(t, config)
        
        // Create sessions up to limit
        for i := 0; i < config.MaxConcurrentSessions+2; i++ {
            cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
                Name:  fmt.Sprintf("session-%d", i),
                Agent: "claude",
            })
            commands <- cmd
            
            event := <-events
            if i >= config.MaxConcurrentSessions {
                // Should get error for exceeded limit
                assert.Equal(t, protocol.EventError, event.Type)
            } else {
                // Should succeed
                assert.Equal(t, protocol.EventSessionCreated, event.Type)
            }
        }
    })
}
```

## Test Utilities

### Test Builders

Use builder pattern for complex test setup:

```go
func TestComplexScenario(t *testing.T) {
    scenario := NewTestScenario("multi-session-workflow").
        WithSessions(
            &Session{ID: "session-1", Name: "test-1", Status: protocol.StatusReady},
            &Session{ID: "session-2", Name: "test-2", Status: protocol.StatusWorking},
        ).
        WithCommands(
            NewCommandSequence().
                StartAgent("session-1").
                CreateSession("new-session", "claude").
                StopAgent("session-2").
                Build()...,
        ).
        WithAssertion(func(t *testing.T, events []protocol.EnhancedEvent) {
            // Verify expected event sequence
            matcher := NewEventMatcher(t, events)
            matcher.ExpectCount(3).
                   ExpectSequence(protocol.EventStatusChanged, 
                                 protocol.EventSessionCreated,
                                 protocol.EventStatusChanged).
                   ExpectNoErrors()
        })
        
    RunScenario(t, scenario)
}
```

### Mock Implementations

Comprehensive mocks for isolated testing:

```go
type MockSessionManager struct {
    sessions map[string]*Session
    mu       sync.RWMutex
}

func (m *MockSessionManager) Create(ctx context.Context, req protocol.CreateSessionCommand) (*Session, error) {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    session := &Session{
        ID:            ulid.Make().String(),
        Name:          req.Name,
        Agent:         req.Agent,
        Status:        protocol.StatusReady,
        EnvironmentID: "mock-env-" + ulid.Make().String(),
        CreatedAt:     time.Now(),
        UpdatedAt:     time.Now(),
    }
    
    m.sessions[session.ID] = session
    return session, nil
}

// Additional mock methods...
```

### Test Helpers

Utility functions for common test operations:

```go
// DrainEvents collects events from channel with timeout
func DrainEvents(events <-chan protocol.EnhancedEvent, timeout time.Duration) []protocol.EnhancedEvent {
    var collected []protocol.EnhancedEvent
    deadline := time.After(timeout)
    
    for {
        select {
        case event := <-events:
            collected = append(collected, event)
        case <-deadline:
            return collected
        }
    }
}

// TestContext creates context with test timeout
func TestContext(t *testing.T) context.Context {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    t.Cleanup(cancel)
    return ctx
}

// WaitForCondition polls until condition is true
func WaitForCondition(t *testing.T, condition func() bool, timeout time.Duration) {
    deadline := time.After(timeout)
    ticker := time.NewTicker(10 * time.Millisecond)
    defer ticker.Stop()
    
    for {
        select {
        case <-ticker.C:
            if condition() {
                return
            }
        case <-deadline:
            t.Fatal("condition not met within timeout")
        }
    }
}
```

## Benchmarks

Performance benchmarks ensure system scalability:

```go
func BenchmarkEngine_CommandProcessing(b *testing.B) {
    engine, commands, events := createBenchmarkEngine(b)
    defer engine.Stop()
    
    // Drain events to prevent channel blocking
    go func() {
        for range events {
            // Discard events
        }
    }()
    
    b.ResetTimer()
    
    for i := 0; i < b.N; i++ {
        cmd := protocol.NewCommand(protocol.CmdHealthCheck, protocol.HealthCheckCommand{})
        commands <- cmd
    }
}

func BenchmarkEngine_SessionCreation(b *testing.B) {
    engine, commands, events := createBenchmarkEngine(b)
    defer engine.Stop()
    
    // Drain events
    go func() {
        for range events {
        }
    }()
    
    b.ResetTimer()
    
    for i := 0; i < b.N; i++ {
        cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
            Name:  fmt.Sprintf("session-%d", i),
            Agent: "claude",
        })
        commands <- cmd
    }
}
```

## Property-Based Testing

Use property-based testing for protocol validation:

```go
func TestProtocol_JSONRoundtrip(t *testing.T) {
    // Test that any valid command can be marshaled and unmarshaled
    for _, cmdType := range protocol.AllCommandTypes {
        t.Run(string(cmdType), func(t *testing.T) {
            // Generate random valid command
            cmd := generateRandomCommand(cmdType)
            
            // Marshal to JSON
            data, err := protocol.MarshalCommand(cmd)
            require.NoError(t, err)
            
            // Unmarshal back
            unmarshaled, err := protocol.UnmarshalCommand(data)
            require.NoError(t, err)
            
            // Should be equivalent
            assert.Equal(t, cmd.Type, unmarshaled.Type)
            assert.Equal(t, cmd.ID, unmarshaled.ID)
            // Payload comparison depends on type...
        })
    }
}
```

## Continuous Integration

### Test Pipeline

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Go
      uses: actions/setup-go@v3
      with:
        go-version: '1.23'
    
    - name: Unit Tests
      run: go test -v -race -coverprofile=coverage.out ./...
    
    - name: Chaos Tests
      run: go test -v -tags=chaos ./internal/core/engine/
    
    - name: Benchmarks
      run: go test -bench=. -benchmem ./internal/core/engine/
    
    - name: Coverage Report
      run: go tool cover -html=coverage.out -o coverage.html
    
    - name: Upload Coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage.out
```

### Test Categories

Use build tags to categorize tests:

```go
//go:build chaos
// +build chaos

func TestChaosScenarios(t *testing.T) {
    // Long-running chaos tests
}
```

```go
//go:build integration
// +build integration

func TestFullSystemIntegration(t *testing.T) {
    // Tests requiring external dependencies
}
```

## Test Data Management

### Fixtures

Use JSON fixtures for complex test data:

```go
func loadTestSession(t *testing.T, name string) *Session {
    data, err := os.ReadFile(fmt.Sprintf("testdata/sessions/%s.json", name))
    require.NoError(t, err)
    
    var session Session
    err = json.Unmarshal(data, &session)
    require.NoError(t, err)
    
    return &session
}
```

### Factories

Generate test data with factories:

```go
type SessionFactory struct {
    id     string
    name   string
    agent  string
    status protocol.SessionStatus
}

func NewSessionFactory() *SessionFactory {
    return &SessionFactory{
        id:     ulid.Make().String(),
        name:   "test-session",
        agent:  "claude",
        status: protocol.StatusReady,
    }
}

func (f *SessionFactory) WithName(name string) *SessionFactory {
    f.name = name
    return f
}

func (f *SessionFactory) WithStatus(status protocol.SessionStatus) *SessionFactory {
    f.status = status
    return f
}

func (f *SessionFactory) Build() *Session {
    return &Session{
        ID:           f.id,
        Name:         f.name,
        Agent:        f.agent,
        Status:       f.status,
        CreatedAt:    time.Now(),
        UpdatedAt:    time.Now(),
        LastActivity: time.Now(),
    }
}
```

## Best Practices

### Test Organization
- **Package-level tests**: Test public APIs and integration points
- **Internal tests**: Test internal logic with access to private methods
- **Separate chaos tests**: Use build tags for long-running stress tests
- **Clear naming**: Test names should describe behavior, not implementation

### Test Quality
- **Deterministic**: Tests should not depend on timing or external state
- **Fast**: Unit tests should run in milliseconds
- **Isolated**: Tests should not affect each other
- **Comprehensive**: Cover all error paths and edge cases

### Mock Strategy
- **Minimal mocks**: Only mock external dependencies
- **Behavior verification**: Assert on behavior, not implementation details
- **Realistic responses**: Mocks should behave like real implementations
- **Error injection**: Use mocks to test error conditions

### Assertion Patterns
- **Specific assertions**: Check exact values, not just presence
- **Error testing**: Verify error messages and types
- **Async testing**: Use channels and timeouts for async operations
- **State verification**: Check side effects and state changes

## Troubleshooting Tests

### Common Issues

**Flaky Tests**
- Check for race conditions
- Verify proper cleanup
- Use deterministic time.Sleep alternatives
- Ensure isolation between tests

**Slow Tests**
- Profile test execution
- Reduce timeout values
- Parallelize independent tests
- Mock expensive operations

**Test Failures in CI**
- Check for environment differences
- Verify resource limits
- Use build constraints for platform-specific tests
- Add retry logic for transient failures

### Debug Techniques

**Test Debugging**
```go
func TestWithDebug(t *testing.T) {
    if testing.Verbose() {
        // Enable debug logging
        config.LogLevel = "debug"
    }
    
    // Test logic...
}
```

**Event Tracing**
```go
func traceEvents(t *testing.T, events <-chan protocol.EnhancedEvent) {
    go func() {
        for event := range events {
            t.Logf("Event: %s - %+v", event.Type, event.Payload)
        }
    }()
}
```

## Related Documentation

- [Engine Component](../components/engine.md) - Component being tested
- [Protocol Design](../architecture/protocol.md) - Protocol test scenarios
- [Contributing](./contributing.md) - Development workflow
- [Monitoring](../operations/monitoring.md) - Production monitoring setup