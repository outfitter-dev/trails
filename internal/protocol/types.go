// Package protocol defines the message types and contracts for UI-Core communication.
//
// The protocol package implements a type-safe, versioned messaging system for communication
// between the terminal UI and the core engine. It supports command/event messaging with
// structured payloads, validation, and JSON serialization.
//
// # Architecture
//
// The protocol uses a command-response pattern:
//   - Commands flow from UI to Core (user actions, requests)
//   - Events flow from Core to UI (status updates, responses, notifications)
//
// # Message Types
//
// All messages are strongly typed with validation and serialization support:
//   - Command: User-initiated actions requiring processing
//   - Event: System-generated notifications and responses
//   - EnhancedEvent: Events with additional metadata and correlation
//
// # Example Usage
//
//	// Create a command
//	cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
//		Name:  "my-session",
//		Agent: "claude",
//	})
//	
//	// Process and respond with event
//	event := protocol.NewEventBuilder(protocol.EventSessionCreated).
//		WithCommandID(cmd.ID).
//		WithPayload(protocol.SessionCreatedEvent{
//			Session: sessionInfo,
//		}).
//		Build()
package protocol

import (
	"time"

	"github.com/oklog/ulid/v2"
)

// Command represents a message from UI to Core requesting an action.
// Commands are the primary mechanism for user interactions and system requests.
// Each command has a unique ID for correlation with response events.
//
// Example:
//	cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
//		Name:  "workspace-session",
//		Agent: "claude",
//	})
type Command struct {
	// ID is a unique identifier for the command (ULID format)
	ID        string      `json:"id"`
	
	// Type specifies the command operation to perform
	Type      CommandType `json:"type"`
	
	// Timestamp when the command was created
	Timestamp time.Time   `json:"timestamp"`
	
	// Payload contains the command-specific data
	Payload   interface{} `json:"payload"`
}

// Event represents a message from Core to UI providing information or responses.
// Events are generated in response to commands or as system notifications.
// They can be correlated to originating commands via CommandID.
//
// Example:
//	event := protocol.Event{
//		ID:        ulid.Make().String(),
//		CommandID: originalCommand.ID,
//		Type:      protocol.EventSessionCreated,
//		Timestamp: time.Now(),
//		Payload:   sessionData,
//	}
type Event struct {
	// ID is a unique identifier for the event (ULID format)
	ID        string    `json:"id"`
	
	// CommandID links this event to the originating command (optional)
	CommandID string    `json:"command_id,omitempty"`
	
	// Type specifies the event category and meaning
	Type      EventType `json:"type"`
	
	// Timestamp when the event was generated
	Timestamp time.Time `json:"timestamp"`
	
	// Payload contains the event-specific data
	Payload   interface{} `json:"payload"`
}

// CommandType represents the type of command being requested.
// Command types are organized by functional area and follow a hierarchical naming convention.
type CommandType string

const (
	// Session Management Commands
	
	// CmdCreateSession creates a new AI agent session with specified configuration.
	// Payload: CreateSessionCommand
	CmdCreateSession CommandType = "session.create"
	
	// CmdDeleteSession removes a session and cleans up associated resources.
	// Payload: DeleteSessionCommand  
	CmdDeleteSession CommandType = "session.delete"
	
	// CmdUpdateSession modifies properties of an existing session.
	// Payload: UpdateSessionCommand
	CmdUpdateSession CommandType = "session.update"
	
	// CmdListSessions retrieves sessions matching filter criteria.
	// Payload: ListSessionsCommand (optional)
	CmdListSessions  CommandType = "session.list"

	// Agent Operations Commands
	
	// CmdStartAgent launches the AI agent process for a session.
	// Payload: StartAgentCommand
	CmdStartAgent   CommandType = "agent.start"
	
	// CmdStopAgent terminates the AI agent process for a session.
	// Payload: StopAgentCommand
	CmdStopAgent    CommandType = "agent.stop"
	
	// CmdRestartAgent stops and restarts an AI agent process.
	// Payload: RestartAgentCommand
	CmdRestartAgent CommandType = "agent.restart"

	// Navigation Commands
	
	// CmdSetFocus changes the UI focus to a specific session.
	// Payload: SetFocusCommand
	CmdSetFocus       CommandType = "nav.focus"
	
	// CmdNextActionable finds the next session requiring user attention.
	// Payload: none (empty struct)
	CmdNextActionable CommandType = "nav.next_actionable"

	// UI Preference Commands
	
	// CmdToggleMinimal switches between normal and minimal UI modes.
	// Payload: none (empty struct)
	CmdToggleMinimal CommandType = "ui.toggle_minimal"
	
	// CmdSetPreference updates a user preference setting.
	// Payload: SetPreferenceCommand
	CmdSetPreference CommandType = "ui.set_preference"

	// System Commands
	
	// CmdShutdown initiates graceful engine shutdown.
	// Payload: none (empty struct)
	CmdShutdown    CommandType = "system.shutdown"
	
	// CmdHealthCheck retrieves current engine health status.
	// Payload: HealthCheckCommand (optional)
	CmdHealthCheck CommandType = "system.health"
)

// EventType represents the category and meaning of an event.
// Event types are organized by functional area and indicate the nature of the notification.
type EventType string

const (
	// Session Events - notifications about session lifecycle changes
	
	// EventSessionCreated indicates a new session was successfully created.
	// Payload: SessionCreatedEvent
	EventSessionCreated EventType = "session.created"
	
	// EventSessionDeleted indicates a session was removed and cleaned up.
	// Payload: SessionDeletedEvent
	EventSessionDeleted EventType = "session.deleted"
	
	// EventSessionUpdated indicates session properties were modified.
	// Payload: SessionUpdatedEvent
	EventSessionUpdated EventType = "session.updated"
	
	// EventSessionList provides a list of sessions matching criteria.
	// Payload: SessionListEvent
	EventSessionList    EventType = "session.list"

	// Status Events - notifications about state and progress changes
	
	// EventStatusChanged indicates a session status transition occurred.
	// Payload: StatusChangedEvent
	EventStatusChanged  EventType = "status.changed"
	
	// EventProgressUpdate provides progress information for long-running operations.
	// Payload: ProgressUpdateEvent
	EventProgressUpdate EventType = "status.progress"

	// Environment Events - notifications about container environment state
	
	// EventEnvironmentReady indicates a container environment is ready for use.
	// Payload: EnvironmentReadyEvent
	EventEnvironmentReady EventType = "env.ready"
	
	// EventEnvironmentError indicates a problem with a container environment.
	// Payload: EnvironmentErrorEvent
	EventEnvironmentError EventType = "env.error"

	// System Events - general system notifications and health information
	
	// EventError indicates an error occurred during command processing.
	// Payload: ErrorEvent
	EventError            EventType = "system.error"
	
	// EventWarning indicates a warning condition that doesn't prevent operation.
	// Payload: WarningEvent
	EventWarning          EventType = "system.warning"
	
	// EventInfo provides informational messages and notifications.
	// Payload: InfoEvent
	EventInfo             EventType = "system.info"
	
	// EventStateSnapshot provides a complete snapshot of system state.
	// Payload: StateSnapshotEvent
	EventStateSnapshot    EventType = "system.state_snapshot"
	
	// EventHealthStatus provides current engine health and performance metrics.
	// Payload: HealthStatusEvent
	EventHealthStatus     EventType = "system.health_status"
	
	// EventPreferenceChange indicates a user preference was updated.
	// Payload: PreferenceChangeEvent
	EventPreferenceChange EventType = "system.preference_change"
)

// SessionStatus represents the current operational state of an AI agent session.
// Status transitions indicate the session lifecycle and determine available actions.
type SessionStatus string

const (
	// StatusReady indicates the session is created and ready to start an agent.
	// Valid transitions: -> StatusWorking
	StatusReady    SessionStatus = "ready"
	
	// StatusWorking indicates the AI agent is actively running and processing.
	// Valid transitions: -> StatusReady, StatusWaiting, StatusError, StatusThinking
	StatusWorking  SessionStatus = "working"
	
	// StatusWaiting indicates the agent is waiting for user input or external action.
	// Valid transitions: -> StatusWorking, StatusReady, StatusError
	StatusWaiting  SessionStatus = "waiting"
	
	// StatusError indicates an error occurred that requires user intervention.
	// Valid transitions: -> StatusReady (after manual recovery)
	StatusError    SessionStatus = "error"
	
	// StatusThinking indicates the agent is processing and formulating a response.
	// Valid transitions: -> StatusWorking, StatusWaiting, StatusError
	StatusThinking SessionStatus = "thinking"
)

// NewCommand creates a new command with generated ID and current timestamp.
// This is the standard way to create commands for sending to the engine.
//
// Parameters:
//   - cmdType: The type of command to create
//   - payload: The command-specific data (must match expected type for cmdType)
//
// Returns a fully initialized Command ready for transmission.
//
// Example:
//	cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
//		Name:  "my-session",
//		Agent: "claude",
//	})
func NewCommand(cmdType CommandType, payload interface{}) Command {
	return Command{
		ID:        ulid.Make().String(),
		Type:      cmdType,
		Timestamp: time.Now(),
		Payload:   payload,
	}
}

// NewEvent creates a new event with generated ID and current timestamp.
// This is used for creating system-generated events and notifications.
//
// Parameters:
//   - eventType: The type of event to create  
//   - payload: The event-specific data (must match expected type for eventType)
//
// Returns a fully initialized Event ready for transmission.
//
// Example:
//	event := protocol.NewEvent(protocol.EventInfo, protocol.InfoEvent{
//		Message: "System status update",
//	})
func NewEvent(eventType EventType, payload interface{}) Event {
	return Event{
		ID:        ulid.Make().String(),
		Type:      eventType,
		Timestamp: time.Now(),
		Payload:   payload,
	}
}

// NewEventForCommand creates a new event in response to a specific command.
// This establishes correlation between the command and its response event.
//
// Parameters:
//   - eventType: The type of event to create
//   - commandID: The ID of the command this event responds to
//   - payload: The event-specific data
//
// Returns a fully initialized Event with CommandID set for correlation.
//
// Example:
//	event := protocol.NewEventForCommand(
//		protocol.EventSessionCreated, 
//		originalCommand.ID,
//		protocol.SessionCreatedEvent{Session: sessionInfo},
//	)
func NewEventForCommand(eventType EventType, commandID string, payload interface{}) Event {
	event := NewEvent(eventType, payload)
	event.CommandID = commandID
	return event
}