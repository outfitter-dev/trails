package protocol

import (
	"time"
)

// Event Payload Types
//
// These types define the structured data that accompanies each event type.
// Event payloads contain the specific information being communicated from
// the engine to the UI.

// SessionCreatedEvent indicates a new session was successfully created.
// Used with EventSessionCreated event type.
type SessionCreatedEvent struct {
	// Session contains the complete information about the created session
	Session SessionInfo `json:"session"`
}

// SessionDeletedEvent indicates a session was removed and cleaned up.
// Used with EventSessionDeleted event type.
type SessionDeletedEvent struct {
	// SessionID is the unique identifier of the deleted session
	SessionID string `json:"session_id"`
}

// SessionUpdatedEvent indicates session properties were modified.
// Used with EventSessionUpdated event type.
type SessionUpdatedEvent struct {
	// Session contains the updated session information
	Session SessionInfo `json:"session"`
}

// SessionListEvent provides a list of sessions matching query criteria.
// Used with EventSessionList event type.
type SessionListEvent struct {
	// Sessions is the array of sessions matching the filter criteria
	Sessions []SessionInfo `json:"sessions"`
}

// SessionInfo represents the public view of session data used in events.
// This excludes internal runtime state and sensitive information.
type SessionInfo struct {
	// ID is the unique identifier for the session (ULID format)
	ID            string        `json:"id"`
	
	// Name is the human-readable identifier for the session
	Name          string        `json:"name"`
	
	// Agent specifies which AI agent is used for this session
	Agent         string        `json:"agent"`
	
	// Status represents the current operational state
	Status        SessionStatus `json:"status"`
	
	// EnvironmentID links to the container environment
	EnvironmentID string        `json:"environment_id"`
	
	// Branch is the git branch the session is working on
	Branch        string        `json:"branch"`
	
	// CreatedAt is when the session was first created
	CreatedAt     time.Time     `json:"created_at"`
	
	// UpdatedAt is when the session was last modified
	UpdatedAt     time.Time     `json:"updated_at"`
}

// StatusChangedEvent indicates a session underwent a status transition.
// Used with EventStatusChanged event type.
type StatusChangedEvent struct {
	// SessionID is the unique identifier of the session
	SessionID string        `json:"session_id"`
	
	// OldStatus is the previous status before the transition
	OldStatus SessionStatus `json:"old_status"`
	
	// NewStatus is the current status after the transition
	NewStatus SessionStatus `json:"new_status"`
	
	// Reason provides context for why the status changed (optional)
	Reason    string        `json:"reason,omitempty"`
}

// ProgressUpdateEvent provides progress information for long-running operations.
// Used with EventProgressUpdate event type.
type ProgressUpdateEvent struct {
	// SessionID is the unique identifier of the session (optional)
	SessionID   string `json:"session_id"`
	
	// Progress is the completion percentage (0-100)
	Progress    int    `json:"progress"`
	// Message describes the current operation or progress
	Message     string `json:"message"`
	
	// TotalSteps is the total number of steps in the operation (optional)
	TotalSteps  int    `json:"total_steps,omitempty"`
	
	// CurrentStep is the current step being executed (optional)
	CurrentStep int    `json:"current_step,omitempty"`
}

// EnvironmentReadyEvent indicates a container environment is ready for use.
// Used with EventEnvironmentReady event type.
type EnvironmentReadyEvent struct {
	// SessionID is the unique identifier of the session
	SessionID     string `json:"session_id"`
	
	// EnvironmentID is the unique identifier of the container environment
	EnvironmentID string `json:"environment_id"`
	
	// Details provides additional information about the environment (optional)
	Details       string `json:"details,omitempty"`
}

// EnvironmentErrorEvent indicates a problem with a container environment.
// Used with EventEnvironmentError event type.
type EnvironmentErrorEvent struct {
	// SessionID is the unique identifier of the session
	SessionID     string `json:"session_id"`
	
	// EnvironmentID is the unique identifier of the container environment
	EnvironmentID string `json:"environment_id"`
	
	// Error describes the problem that occurred
	Error         string `json:"error"`
	
	// Recoverable indicates whether the error can be automatically resolved
	Recoverable   bool   `json:"recoverable"`
}

// StateSnapshotEvent provides a complete snapshot of system state.
// Used with EventStateSnapshot event type for UI initialization and recovery.
type StateSnapshotEvent struct {
	// Sessions is the complete list of current sessions
	Sessions    []SessionInfo          `json:"sessions"`
	
	// FocusedID is the ID of the currently focused session (if any)
	FocusedID   string                 `json:"focused_id"`
	
	// MinimalMode indicates whether the UI is in minimal mode
	MinimalMode bool                   `json:"minimal_mode"`
	
	// Preferences contains user preference settings
	Preferences map[string]interface{} `json:"preferences"`
}

// ErrorEvent indicates an error occurred during command processing.
// Used with EventError event type for error reporting and user notification.
type ErrorEvent struct {
	// Code is a machine-readable error identifier
	Code        string `json:"code"`
	
	// Message is a human-readable error description
	Message     string `json:"message"`
	
	// Details provides additional error context (optional)
	Details     string `json:"details,omitempty"`
	
	// Recoverable indicates whether the user can retry the operation
	Recoverable bool   `json:"recoverable"`
}

// WarningEvent indicates a warning condition that doesn't prevent operation.
// Used with EventWarning event type for non-critical issues.
type WarningEvent struct {
	// Code is a machine-readable warning identifier
	Code    string `json:"code"`
	
	// Message is a human-readable warning description
	Message string `json:"message"`
	
	// Details provides additional warning context (optional)
	Details string `json:"details,omitempty"`
}

// InfoEvent provides informational messages and notifications.
// Used with EventInfo event type for general user communication.
type InfoEvent struct {
	// Message is the informational content
	Message string `json:"message"`
	
	// Details provides additional context (optional)
	Details string `json:"details,omitempty"`
}

// PreferenceChangeEvent indicates a user preference was updated.
// Used with EventPreferenceChange event type to notify UI of setting changes.
type PreferenceChangeEvent struct {
	// Key is the preference name that was changed
	Key      string      `json:"key"`
	
	// Value is the new preference value
	Value    interface{} `json:"value"`
	
	// Previous is the old preference value (optional)
	Previous interface{} `json:"previous,omitempty"`
}

// HealthStatusEvent provides current engine health and performance metrics.
// Used with EventHealthStatus event type in response to health check commands.
type HealthStatusEvent struct {
	// Healthy indicates overall system health status
	Healthy bool                   `json:"healthy"`
	
	// Details contains specific health metrics and information (optional)
	// Common fields: "uptime", "active_sessions", "worker_count", "memory_usage"
	Details map[string]interface{} `json:"details,omitempty"`
}