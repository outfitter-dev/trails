# Test Helpers Package

This package provides utilities for testing the trails application, including mock implementations, test data generators, and assertion helpers.

## Components

### Test Data Generators

- `TestCommand()` - Creates test commands with generated IDs
- `TestEvent()` - Creates test events  
- `TestEnhancedEvent()` - Creates enhanced events with metadata
- `TestSession()` - Creates test sessions with options
- `TestContext()` - Creates test contexts with timeout

### Mock Implementations

- `MockSessionManager` - Mock implementation of `engine.SessionManager`
- `MockStateManager` - Mock implementation of `engine.StateManager`
- `MockContainerManager` - Mock implementation of `engine.ContainerManager`
- `MockMetricsCollector` - Mock implementation of `engine.MetricsCollector`

### Test Builders

- `EngineBuilder` - Fluent builder for creating test engine instances
- `CommandSequence` - Builder for creating sequences of commands
- `TestScenario` - Structure for defining and running test scenarios

### Assertion Helpers

- `AssertEventType()` - Check event types
- `AssertCommandType()` - Check command types
- `AssertSessionStatus()` - Check session status
- `AssertNoError()` / `AssertError()` - Error assertions
- `EventMatcher` - Fluent assertions for event sequences

### Channel Utilities

- `TestChannels()` - Create test command/event channels
- `DrainEvents()` - Collect all events from a channel
- `WaitForEvent()` - Wait for specific event type

## Usage Examples

### Using Test Scenarios

```go
testhelpers.RunScenario(t, testhelpers.TestScenario{
    Name: "Create and start session",
    Sessions: []*engine.Session{existingSession},
    Commands: testhelpers.NewCommandSequence().
        CreateSession("new-session", "claude-3-sonnet").
        StartAgent("session-id").
        Build(),
    Assertions: func(t *testing.T, events []protocol.EnhancedEvent) {
        testhelpers.NewEventMatcher(t, events).
            ExpectType(protocol.EventSessionCreated).
            ExpectType(protocol.EventStatusChanged).
            ExpectNoErrors()
    },
})
```

### Using Mocks Directly

```go
// Create mock
sessionMgr := testhelpers.NewMockSessionManager()

// Configure behavior
sessionMgr.CreateError = fmt.Errorf("quota exceeded")

// Build engine with mock
engine, _, _ := testhelpers.NewEngineBuilder(t).
    WithSessionManager(sessionMgr).
    Build()

// Verify calls
if len(sessionMgr.CreateCalls) != 1 {
    t.Error("expected create to be called")
}
```

### Testing Events

```go
// Wait for specific event
event := testhelpers.WaitForEvent(events, protocol.EventError, 2*time.Second)
if event == nil {
    t.Fatal("expected error event")
}

// Drain all events
allEvents := testhelpers.DrainEvents(events, time.Second)
```

## Best Practices

1. Use `TestScenario` for integration-style tests
2. Use mocks directly for unit tests
3. Always use `TestContext()` to ensure proper cleanup
4. Use `EventMatcher` for complex event assertions
5. Configure mock errors to test error paths