// Package testhelpers provides utilities for testing the trails application.
// It includes mock implementations, test data generators, and assertion helpers.
package testhelpers

import (
	"context"
	"testing"
	"time"

	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/protocol"
	"github.com/oklog/ulid/v2"
)

// TestCommand creates a test command with the given type and payload.
// Generates a unique ID and sets timestamp to current time.
func TestCommand(cmdType protocol.CommandType, payload interface{}) protocol.Command {
	return protocol.Command{
		ID:        ulid.Make().String(),
		Type:      cmdType,
		Payload:   payload,
		Timestamp: time.Now(),
	}
}

// TestEvent creates a test event with the given type and payload.
// Generates a unique ID and sets timestamp to current time.
func TestEvent(eventType protocol.EventType, payload interface{}) protocol.Event {
	return protocol.Event{
		ID:        ulid.Make().String(),
		Type:      eventType,
		Payload:   payload,
		Timestamp: time.Now(),
	}
}

// TestEnhancedEvent creates a test enhanced event with full metadata.
// Includes correlation ID and proper event builder metadata.
func TestEnhancedEvent(eventType protocol.EventType, payload interface{}) protocol.EnhancedEvent {
	return protocol.NewEventBuilder(eventType).
		WithPayload(payload).
		WithSource("test-source").
		Build()
}

// TestSession creates a test session with default values.
// Can be customized by passing options.
func TestSession(opts ...SessionOption) *engine.Session {
	session := &engine.Session{
		ID:            ulid.Make().String(),
		Name:          "test-session",
		Agent:         "test-agent",
		Status:        protocol.StatusReady,
		EnvironmentID: "test-env-" + ulid.Make().String(),
		Branch:        "test-branch",
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		LastActivity:  time.Now(),
		Environment:   make(map[string]string),
	}

	for _, opt := range opts {
		opt(session)
	}

	return session
}

// SessionOption is a function that modifies a test session.
type SessionOption func(*engine.Session)

// WithSessionName sets the session name.
func WithSessionName(name string) SessionOption {
	return func(s *engine.Session) {
		s.Name = name
	}
}

// WithSessionStatus sets the session status.
func WithSessionStatus(status protocol.SessionStatus) SessionOption {
	return func(s *engine.Session) {
		s.Status = status
	}
}

// WithSessionID sets a specific session ID.
func WithSessionID(id string) SessionOption {
	return func(s *engine.Session) {
		s.ID = id
	}
}

// WithSessionAgent sets the agent type.
func WithSessionAgent(agent string) SessionOption {
	return func(s *engine.Session) {
		s.Agent = agent
	}
}

// TestContext creates a test context with timeout.
// Default timeout is 5 seconds.
func TestContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// AssertEventType checks if an event has the expected type.
func AssertEventType(t *testing.T, event protocol.EnhancedEvent, expected protocol.EventType) {
	t.Helper()
	if event.Type != expected {
		t.Errorf("expected event type %s, got %s", expected, event.Type)
	}
}

// AssertCommandType checks if a command has the expected type.
func AssertCommandType(t *testing.T, cmd protocol.Command, expected protocol.CommandType) {
	t.Helper()
	if cmd.Type != expected {
		t.Errorf("expected command type %s, got %s", expected, cmd.Type)
	}
}

// AssertSessionStatus checks if a session has the expected status.
func AssertSessionStatus(t *testing.T, session *engine.Session, expected protocol.SessionStatus) {
	t.Helper()
	actual := session.GetStatus()
	if actual != expected {
		t.Errorf("expected session status %s, got %s", expected, actual)
	}
}

// AssertNoError fails the test if err is not nil.
func AssertNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// AssertError fails the test if err is nil.
func AssertError(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected error but got nil")
	}
}

// DrainEvents drains all events from a channel within timeout.
// Returns the collected events.
func DrainEvents(events <-chan protocol.EnhancedEvent, timeout time.Duration) []protocol.EnhancedEvent {
	var collected []protocol.EnhancedEvent
	deadline := time.After(timeout)

	for {
		select {
		case event := <-events:
			collected = append(collected, event)
		case <-deadline:
			return collected
		default:
			// Check if there are more events without blocking
			select {
			case event := <-events:
				collected = append(collected, event)
			default:
				return collected
			}
		}
	}
}

// WaitForEvent waits for a specific event type on the channel.
// Returns the event if found within timeout, or nil if not found.
func WaitForEvent(events <-chan protocol.EnhancedEvent, eventType protocol.EventType, timeout time.Duration) *protocol.EnhancedEvent {
	deadline := time.After(timeout)

	for {
		select {
		case event := <-events:
			if event.Type == eventType {
				return &event
			}
		case <-deadline:
			return nil
		}
	}
}

// TestChannels creates command and event channels for testing.
// Returns command sender, event receiver, and cleanup function.
func TestChannels(bufferSize int) (chan<- protocol.Command, <-chan protocol.EnhancedEvent, func()) {
	commands := make(chan protocol.Command, bufferSize)
	events := make(chan protocol.EnhancedEvent, bufferSize)
	
	cleanup := func() {
		close(commands)
		// Don't close events as the engine writes to it
	}
	
	return commands, events, cleanup
}