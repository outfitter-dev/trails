package protocol

import (
	"time"
)

// SessionCreatedEvent payload
type SessionCreatedEvent struct {
	Session SessionInfo `json:"session"`
}

// SessionDeletedEvent payload
type SessionDeletedEvent struct {
	SessionID string `json:"session_id"`
}

// SessionUpdatedEvent payload
type SessionUpdatedEvent struct {
	Session SessionInfo `json:"session"`
}

// SessionListEvent payload
type SessionListEvent struct {
	Sessions []SessionInfo `json:"sessions"`
}

// SessionInfo represents session data in events
type SessionInfo struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Agent         string        `json:"agent"`
	Status        SessionStatus `json:"status"`
	EnvironmentID string        `json:"environment_id"`
	Branch        string        `json:"branch"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

// StatusChangedEvent payload
type StatusChangedEvent struct {
	SessionID string        `json:"session_id"`
	OldStatus SessionStatus `json:"old_status"`
	NewStatus SessionStatus `json:"new_status"`
	Reason    string        `json:"reason,omitempty"`
}

// ProgressUpdateEvent payload
type ProgressUpdateEvent struct {
	SessionID   string `json:"session_id"`
	Progress    int    `json:"progress"`
	Message     string `json:"message"`
	TotalSteps  int    `json:"total_steps,omitempty"`
	CurrentStep int    `json:"current_step,omitempty"`
}

// EnvironmentReadyEvent payload
type EnvironmentReadyEvent struct {
	SessionID     string `json:"session_id"`
	EnvironmentID string `json:"environment_id"`
	Details       string `json:"details,omitempty"`
}

// EnvironmentErrorEvent payload
type EnvironmentErrorEvent struct {
	SessionID     string `json:"session_id"`
	EnvironmentID string `json:"environment_id"`
	Error         string `json:"error"`
	Recoverable   bool   `json:"recoverable"`
}

// StateSnapshotEvent provides complete state
type StateSnapshotEvent struct {
	Sessions    []SessionInfo          `json:"sessions"`
	FocusedID   string                 `json:"focused_id"`
	MinimalMode bool                   `json:"minimal_mode"`
	Preferences map[string]interface{} `json:"preferences"`
}

// ErrorEvent for error reporting
type ErrorEvent struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	Details     string `json:"details,omitempty"`
	Recoverable bool   `json:"recoverable"`
}

// WarningEvent for warnings
type WarningEvent struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// InfoEvent for informational messages
type InfoEvent struct {
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// PreferenceChangeEvent for preference/setting changes
type PreferenceChangeEvent struct {
	Key      string      `json:"key"`
	Value    interface{} `json:"value"`
	Previous interface{} `json:"previous,omitempty"`
}

// HealthStatusEvent payload
type HealthStatusEvent struct {
	Healthy bool                   `json:"healthy"`
	Details map[string]interface{} `json:"details,omitempty"`
}