// Package protocol defines the message types and contracts for UI-Core communication
package protocol

import (
	"time"

	"github.com/oklog/ulid/v2"
)

// Command represents UI → Core messages
type Command struct {
	ID        string      `json:"id"`
	Type      CommandType `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	Payload   interface{} `json:"payload"`
}

// Event represents Core → UI messages
type Event struct {
	ID        string    `json:"id"`
	CommandID string    `json:"command_id,omitempty"`
	Type      EventType `json:"type"`
	Timestamp time.Time `json:"timestamp"`
	Payload   interface{} `json:"payload"`
}

// CommandType enumeration
type CommandType string

const (
	// Session Management
	CmdCreateSession CommandType = "session.create"
	CmdDeleteSession CommandType = "session.delete"
	CmdUpdateSession CommandType = "session.update"
	CmdListSessions  CommandType = "session.list"

	// Agent Operations
	CmdStartAgent   CommandType = "agent.start"
	CmdStopAgent    CommandType = "agent.stop"
	CmdRestartAgent CommandType = "agent.restart"

	// Navigation
	CmdSetFocus       CommandType = "nav.focus"
	CmdNextActionable CommandType = "nav.next_actionable"

	// UI Preferences
	CmdToggleMinimal CommandType = "ui.toggle_minimal"
	CmdSetPreference CommandType = "ui.set_preference"

	// System
	CmdShutdown    CommandType = "system.shutdown"
	CmdHealthCheck CommandType = "system.health"
)

// EventType enumeration
type EventType string

const (
	// Session Events
	EventSessionCreated EventType = "session.created"
	EventSessionDeleted EventType = "session.deleted"
	EventSessionUpdated EventType = "session.updated"
	EventSessionList    EventType = "session.list"

	// Status Events
	EventStatusChanged  EventType = "status.changed"
	EventProgressUpdate EventType = "status.progress"

	// Environment Events
	EventEnvironmentReady EventType = "env.ready"
	EventEnvironmentError EventType = "env.error"

	// System Events
	EventError            EventType = "system.error"
	EventWarning          EventType = "system.warning"
	EventInfo             EventType = "system.info"
	EventStateSnapshot    EventType = "system.state_snapshot"
	EventHealthStatus     EventType = "system.health_status"
	EventPreferenceChange EventType = "system.preference_change"
)

// SessionStatus enumeration
type SessionStatus string

const (
	StatusReady    SessionStatus = "ready"
	StatusWorking  SessionStatus = "working"
	StatusWaiting  SessionStatus = "waiting"
	StatusError    SessionStatus = "error"
	StatusThinking SessionStatus = "thinking"
)

// NewCommand creates a new command with generated ID and timestamp
func NewCommand(cmdType CommandType, payload interface{}) Command {
	return Command{
		ID:        ulid.Make().String(),
		Type:      cmdType,
		Timestamp: time.Now(),
		Payload:   payload,
	}
}

// NewEvent creates a new event with generated ID and timestamp
func NewEvent(eventType EventType, payload interface{}) Event {
	return Event{
		ID:        ulid.Make().String(),
		Type:      eventType,
		Timestamp: time.Now(),
		Payload:   payload,
	}
}

// NewEventForCommand creates a new event in response to a command
func NewEventForCommand(eventType EventType, commandID string, payload interface{}) Event {
	event := NewEvent(eventType, payload)
	event.CommandID = commandID
	return event
}