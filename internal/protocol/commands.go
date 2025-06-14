package protocol

// Command Payload Types
//
// These types define the structured data that accompanies each command type.
// Each command payload contains the specific parameters needed to execute
// the corresponding operation.

// CreateSessionCommand contains parameters for creating a new AI agent session.
// Used with CmdCreateSession command type.
type CreateSessionCommand struct {
	// Name is a human-readable identifier for the session (required)
	Name        string            `json:"name"`
	
	// Agent specifies which AI agent to use (e.g., "claude", "gpt-4") (required)
	Agent       string            `json:"agent"`
	
	// Branch is the git branch to work on (optional, defaults to current branch)
	Branch      string            `json:"branch,omitempty"`
	
	// Environment contains environment variables for the session (optional)
	Environment map[string]string `json:"environment,omitempty"`
}

// DeleteSessionCommand contains parameters for removing a session.
// Used with CmdDeleteSession command type.
type DeleteSessionCommand struct {
	// SessionID is the unique identifier of the session to delete (required)
	SessionID string `json:"session_id"`
	
	// Force indicates whether to delete even if the agent is running (optional)
	Force     bool   `json:"force"`
}

// UpdateSessionCommand contains parameters for modifying session properties.
// Used with CmdUpdateSession command type.
type UpdateSessionCommand struct {
	// SessionID is the unique identifier of the session to update (required)
	SessionID string                 `json:"session_id"`
	
	// Updates is a map of property names to new values (required)
	// Supported properties: "name", "branch", "environment"
	Updates   map[string]interface{} `json:"updates"`
}

// ListSessionsCommand contains parameters for querying sessions.
// Used with CmdListSessions command type.
type ListSessionsCommand struct {
	// Filter specifies criteria for filtering sessions (optional)
	// If not provided, all sessions are returned
	Filter SessionFilter `json:"filter,omitempty"`
}

// SessionFilter defines criteria for filtering session queries.
// All filter criteria are applied as AND conditions.
type SessionFilter struct {
	// Status filters sessions by their current status (optional)
	// Multiple statuses are combined with OR logic
	Status    []SessionStatus `json:"status,omitempty"`
	
	// Agent filters sessions by agent type (optional)
	Agent     string          `json:"agent,omitempty"`
	
	// Branch filters sessions by git branch (optional)
	Branch    string          `json:"branch,omitempty"`
	
	// CreatedBy filters sessions by creator (optional)
	CreatedBy string          `json:"created_by,omitempty"`
}

// SetFocusCommand contains parameters for changing UI focus.
// Used with CmdSetFocus command type.
type SetFocusCommand struct {
	// SessionID is the unique identifier of the session to focus (required)
	SessionID string `json:"session_id"`
}

// StartAgentCommand contains parameters for launching an AI agent.
// Used with CmdStartAgent command type.
type StartAgentCommand struct {
	// SessionID is the unique identifier of the session (required)
	SessionID     string   `json:"session_id"`
	
	// InitialPrompt is the first message to send to the agent (optional)
	InitialPrompt string   `json:"initial_prompt,omitempty"`
	
	// Arguments are additional command-line arguments for the agent (optional)
	Arguments     []string `json:"arguments,omitempty"`
}

// StopAgentCommand contains parameters for terminating an AI agent.
// Used with CmdStopAgent command type.
type StopAgentCommand struct {
	// SessionID is the unique identifier of the session (required)
	SessionID string `json:"session_id"`
	// Graceful indicates whether to wait for clean shutdown (optional)
	Graceful  bool   `json:"graceful"`
}

// RestartAgentCommand contains parameters for restarting an AI agent.
// Used with CmdRestartAgent command type.
type RestartAgentCommand struct {
	// SessionID is the unique identifier of the session (required)
	SessionID string `json:"session_id"`
}

// SetPreferenceCommand contains parameters for updating user preferences.
// Used with CmdSetPreference command type.
type SetPreferenceCommand struct {
	// Key is the preference name to update (required)
	// Common keys: "theme", "auto_save", "default_agent", "minimal_mode"
	Key   string      `json:"key"`
	
	// Value is the new preference value (required)
	// Type depends on the preference key
	Value interface{} `json:"value"`
}

// HealthCheckCommand contains parameters for engine health queries.
// Used with CmdHealthCheck command type.
type HealthCheckCommand struct {
	// IncludeDetails indicates whether to include detailed metrics (optional)
	// If false, only basic health status is returned
	IncludeDetails bool `json:"include_details"`
}