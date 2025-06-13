package testhelpers_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/protocol"
	"github.com/outfitter-dev/trails/internal/testhelpers"
)

// ExampleTestScenario demonstrates how to use the test helpers.
func TestExampleScenario(t *testing.T) {
	// Define test sessions
	session1 := testhelpers.TestSession(
		testhelpers.WithSessionName("frontend-dev"),
		testhelpers.WithSessionStatus(protocol.StatusReady),
	)
	
	session2 := testhelpers.TestSession(
		testhelpers.WithSessionName("backend-api"),
		testhelpers.WithSessionStatus(protocol.StatusWorking),
	)
	
	// Create command sequence
	commands := testhelpers.NewCommandSequence().
		CreateSession("new-session", "claude-3-sonnet").
		StartAgent(session1.ID).
		HealthCheck(true).
		Build()
	
	// Run scenario
	testhelpers.RunScenario(t, testhelpers.TestScenario{
		Name:     "Multiple sessions with health check",
		Sessions: []*engine.Session{session1, session2},
		Commands: commands,
		Assertions: func(t *testing.T, events []protocol.EnhancedEvent) {
			// Use event matcher for assertions
			testhelpers.NewEventMatcher(t, events).
				ExpectType(protocol.EventSessionCreated).
				ExpectType(protocol.EventStatusChanged).
				ExpectType(protocol.EventHealthStatus).
				ExpectNoErrors()
		},
	})
}

// TestMockUsage demonstrates direct mock usage.
func TestMockUsage(t *testing.T) {
	// Create mocks
	sessionMgr := testhelpers.NewMockSessionManager()
	stateMgr := testhelpers.NewMockStateManager()
	
	// Configure mock behavior
	sessionMgr.CreateError = fmt.Errorf("quota exceeded")
	
	// Build engine with mocks
	engine, commands, events := testhelpers.NewEngineBuilder(t).
		WithSessionManager(sessionMgr).
		WithStateManager(stateMgr).
		Build()
	_ = engine
	
	// Send command
	cmd := testhelpers.TestCommand(
		protocol.CmdCreateSession,
		protocol.CreateSessionCommand{
			Name:  "test-session",
			Agent: "test-agent",
		},
	)
	
	select {
	case commands <- cmd:
	case <-time.After(time.Second):
		t.Fatal("timeout sending command")
	}
	
	// Wait for error event
	event := testhelpers.WaitForEvent(events, protocol.EventError, 2*time.Second)
	if event == nil {
		t.Fatal("expected error event")
	}
	
	// Verify mock was called
	if len(sessionMgr.CreateCalls) != 1 {
		t.Errorf("expected 1 create call, got %d", len(sessionMgr.CreateCalls))
	}
}

// TestCommandBuilder demonstrates the command builder.
func TestCommandBuilder(t *testing.T) {
	// Build a complex command sequence
	commands := testhelpers.NewCommandSequence().
		CreateSession("session-1", "claude-3-sonnet").
		CreateSession("session-2", "gpt-4").
		StartAgent("session-1-id").
		StartAgent("session-2-id").
		StopAgent("session-1-id").
		DeleteSession("session-2-id", true).
		HealthCheck(false).
		Build()
	
	// Verify sequence
	if len(commands) != 7 {
		t.Errorf("expected 7 commands, got %d", len(commands))
	}
	
	// Check command types
	expectedTypes := []protocol.CommandType{
		protocol.CmdCreateSession,
		protocol.CmdCreateSession,
		protocol.CmdStartAgent,
		protocol.CmdStartAgent,
		protocol.CmdStopAgent,
		protocol.CmdDeleteSession,
		protocol.CmdHealthCheck,
	}
	
	for i, cmd := range commands {
		if cmd.Type != expectedTypes[i] {
			t.Errorf("command %d: expected type %s, got %s", i, expectedTypes[i], cmd.Type)
		}
	}
}