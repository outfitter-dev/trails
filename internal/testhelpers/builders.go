package testhelpers

import (
	"context"
	"testing"
	"time"

	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// EngineBuilder helps construct engine instances for testing.
type EngineBuilder struct {
	t          *testing.T
	config     engine.Config
	sessions   engine.SessionManager
	state      engine.StateManager
	containers engine.ContainerManager
	metrics    engine.MetricsCollector
	logger     *logging.Logger
	commands   chan protocol.Command
	events     chan protocol.EnhancedEvent
}

// NewEngineBuilder creates a new engine builder.
func NewEngineBuilder(t *testing.T) *EngineBuilder {
	return &EngineBuilder{
		t:          t,
		config:     engine.DefaultConfig(),
		sessions:   NewMockSessionManager(),
		state:      NewMockStateManager(),
		containers: NewMockContainerManager(),
		metrics:    NewMockMetricsCollector(),
		logger:     logging.NewTestLogger(),
		commands:   make(chan protocol.Command, 10),
		events:     make(chan protocol.EnhancedEvent, 10),
	}
}

// WithConfig sets a custom configuration.
func (b *EngineBuilder) WithConfig(config engine.Config) *EngineBuilder {
	b.config = config
	return b
}

// WithSessionManager sets a custom session manager.
func (b *EngineBuilder) WithSessionManager(sessions engine.SessionManager) *EngineBuilder {
	b.sessions = sessions
	return b
}

// WithStateManager sets a custom state manager.
func (b *EngineBuilder) WithStateManager(state engine.StateManager) *EngineBuilder {
	b.state = state
	return b
}

// WithContainerManager sets a custom container manager.
func (b *EngineBuilder) WithContainerManager(containers engine.ContainerManager) *EngineBuilder {
	b.containers = containers
	return b
}

// WithMetricsCollector sets a custom metrics collector.
func (b *EngineBuilder) WithMetricsCollector(metrics engine.MetricsCollector) *EngineBuilder {
	b.metrics = metrics
	return b
}

// WithLogger sets a custom logger.
func (b *EngineBuilder) WithLogger(logger *logging.Logger) *EngineBuilder {
	b.logger = logger
	return b
}

// WithChannels sets custom command and event channels.
func (b *EngineBuilder) WithChannels(commands chan protocol.Command, events chan protocol.EnhancedEvent) *EngineBuilder {
	b.commands = commands
	b.events = events
	return b
}

// Build creates the engine instance.
// Also starts the engine and registers cleanup.
func (b *EngineBuilder) Build() (*engine.Engine, <-chan protocol.Command, <-chan protocol.EnhancedEvent) {
	b.t.Helper()
	
	eng, err := engine.New(
		b.config,
		b.commands,
		b.events,
		b.sessions,
		b.state,
		b.containers,
		b.metrics,
		b.logger,
	)
	if err != nil {
		b.t.Fatalf("failed to create engine: %v", err)
	}
	
	ctx := TestContext(b.t)
	if err := eng.Start(ctx); err != nil {
		b.t.Fatalf("failed to start engine: %v", err)
	}
	
	b.t.Cleanup(func() {
		if err := eng.Stop(); err != nil {
			b.t.Errorf("failed to stop engine: %v", err)
		}
	})
	
	return eng, b.commands, b.events
}

// TestScenario represents a test scenario with predefined sessions and state.
type TestScenario struct {
	Name        string
	Sessions    []*engine.Session
	InitialState func(*MockSessionManager, *MockStateManager)
	Commands    []protocol.Command
	Assertions  func(*testing.T, []protocol.EnhancedEvent)
}

// RunScenario executes a test scenario.
func RunScenario(t *testing.T, scenario TestScenario) {
	t.Helper()
	t.Run(scenario.Name, func(t *testing.T) {
		// Setup
		sessionMgr := NewMockSessionManager()
		stateMgr := NewMockStateManager()
		
		// Add initial sessions
		for _, session := range scenario.Sessions {
			sessionMgr.AddSession(session)
		}
		
		// Apply initial state
		if scenario.InitialState != nil {
			scenario.InitialState(sessionMgr, stateMgr)
		}
		
		// Build engine
		builder := NewEngineBuilder(t).
			WithSessionManager(sessionMgr).
			WithStateManager(stateMgr)
		
		engine, commands, events := builder.Build()
		_ = engine // Engine is started and will be stopped by cleanup
		
		// Execute commands
		for _, cmd := range scenario.Commands {
			select {
			case commands <- cmd:
			case <-time.After(time.Second):
				t.Fatal("timeout sending command")
			}
		}
		
		// Collect events
		collectedEvents := DrainEvents(events, 2*time.Second)
		
		// Run assertions
		if scenario.Assertions != nil {
			scenario.Assertions(t, collectedEvents)
		}
	})
}

// CommandSequence helps build a sequence of commands for testing.
type CommandSequence struct {
	commands []protocol.Command
}

// NewCommandSequence creates a new command sequence builder.
func NewCommandSequence() *CommandSequence {
	return &CommandSequence{
		commands: []protocol.Command{},
	}
}

// CreateSession adds a create session command.
func (cs *CommandSequence) CreateSession(name, agent string) *CommandSequence {
	cs.commands = append(cs.commands, TestCommand(
		protocol.CommandCreateSession,
		protocol.CreateSessionCommand{
			Name:  name,
			Agent: agent,
		},
	))
	return cs
}

// DeleteSession adds a delete session command.
func (cs *CommandSequence) DeleteSession(sessionID string, force bool) *CommandSequence {
	cs.commands = append(cs.commands, TestCommand(
		protocol.CommandDeleteSession,
		protocol.DeleteSessionCommand{
			SessionID: sessionID,
			Force:     force,
		},
	))
	return cs
}

// StartAgent adds a start agent command.
func (cs *CommandSequence) StartAgent(sessionID string) *CommandSequence {
	cs.commands = append(cs.commands, TestCommand(
		protocol.CommandStartAgent,
		protocol.StartAgentCommand{
			SessionID: sessionID,
		},
	))
	return cs
}

// StopAgent adds a stop agent command.
func (cs *CommandSequence) StopAgent(sessionID string) *CommandSequence {
	cs.commands = append(cs.commands, TestCommand(
		protocol.CommandStopAgent,
		protocol.StopAgentCommand{
			SessionID: sessionID,
		},
	))
	return cs
}

// HealthCheck adds a health check command.
func (cs *CommandSequence) HealthCheck(includeDetails bool) *CommandSequence {
	cs.commands = append(cs.commands, TestCommand(
		protocol.CommandHealthCheck,
		protocol.HealthCheckCommand{
			IncludeDetails: includeDetails,
		},
	))
	return cs
}

// Build returns the command sequence.
func (cs *CommandSequence) Build() []protocol.Command {
	return cs.commands
}

// EventMatcher helps assert events in test scenarios.
type EventMatcher struct {
	t      *testing.T
	events []protocol.EnhancedEvent
}

// NewEventMatcher creates a new event matcher.
func NewEventMatcher(t *testing.T, events []protocol.EnhancedEvent) *EventMatcher {
	return &EventMatcher{
		t:      t,
		events: events,
	}
}

// ExpectCount asserts the number of events.
func (em *EventMatcher) ExpectCount(count int) *EventMatcher {
	em.t.Helper()
	if len(em.events) != count {
		em.t.Errorf("expected %d events, got %d", count, len(em.events))
	}
	return em
}

// ExpectType asserts that an event of the given type exists.
func (em *EventMatcher) ExpectType(eventType protocol.EventType) *EventMatcher {
	em.t.Helper()
	found := false
	for _, event := range em.events {
		if event.Type == eventType {
			found = true
			break
		}
	}
	if !found {
		em.t.Errorf("expected event of type %s, but not found", eventType)
	}
	return em
}

// ExpectSequence asserts events appear in a specific order.
func (em *EventMatcher) ExpectSequence(types ...protocol.EventType) *EventMatcher {
	em.t.Helper()
	if len(em.events) < len(types) {
		em.t.Errorf("expected at least %d events for sequence, got %d", len(types), len(em.events))
		return em
	}
	
	for i, expectedType := range types {
		if em.events[i].Type != expectedType {
			em.t.Errorf("expected event %d to be type %s, got %s", i, expectedType, em.events[i].Type)
		}
	}
	return em
}

// ExpectNoErrors asserts no error events were generated.
func (em *EventMatcher) ExpectNoErrors() *EventMatcher {
	em.t.Helper()
	for _, event := range em.events {
		if event.Type == protocol.EventError {
			em.t.Errorf("unexpected error event: %+v", event)
		}
	}
	return em
}