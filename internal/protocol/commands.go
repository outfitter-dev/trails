package protocol

// CreateSessionCommand payload
type CreateSessionCommand struct {
	Name        string            `json:"name"`
	Agent       string            `json:"agent"`
	Branch      string            `json:"branch,omitempty"`
	Environment map[string]string `json:"environment,omitempty"`
}

// DeleteSessionCommand payload
type DeleteSessionCommand struct {
	SessionID string `json:"session_id"`
	Force     bool   `json:"force"`
}

// UpdateSessionCommand payload
type UpdateSessionCommand struct {
	SessionID string                 `json:"session_id"`
	Updates   map[string]interface{} `json:"updates"`
}

// ListSessionsCommand payload
type ListSessionsCommand struct {
	Filter SessionFilter `json:"filter,omitempty"`
}

// SessionFilter for listing sessions
type SessionFilter struct {
	Status    []SessionStatus `json:"status,omitempty"`
	Agent     string          `json:"agent,omitempty"`
	Branch    string          `json:"branch,omitempty"`
	CreatedBy string          `json:"created_by,omitempty"`
}

// SetFocusCommand payload
type SetFocusCommand struct {
	SessionID string `json:"session_id"`
}

// StartAgentCommand payload
type StartAgentCommand struct {
	SessionID     string   `json:"session_id"`
	InitialPrompt string   `json:"initial_prompt,omitempty"`
	Arguments     []string `json:"arguments,omitempty"`
}

// StopAgentCommand payload
type StopAgentCommand struct {
	SessionID string `json:"session_id"`
	Graceful  bool   `json:"graceful"`
}

// RestartAgentCommand payload
type RestartAgentCommand struct {
	SessionID string `json:"session_id"`
}

// SetPreferenceCommand payload
type SetPreferenceCommand struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

// HealthCheckCommand payload
type HealthCheckCommand struct {
	IncludeDetails bool `json:"include_details"`
}