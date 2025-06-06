package session

import (
	"crypto/rand"
	"time"

	"github.com/oklog/ulid/v2"
)

// Status represents the current state of a session
type Status int

const (
	StatusReady Status = iota
	StatusWorking
	StatusWaiting
	StatusError
	StatusThinking
)

func (s Status) String() string {
	switch s {
	case StatusReady:
		return "ready"
	case StatusWorking:
		return "working"
	case StatusWaiting:
		return "waiting"
	case StatusError:
		return "error"
	case StatusThinking:
		return "thinking"
	default:
		return "unknown"
	}
}

// Session represents an active agent session
type Session struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Agent         string            `json:"agent"`
	Status        Status            `json:"status"`
	EnvironmentID EnvironmentID     `json:"environment_id"`
	Branch        string            `json:"branch,omitempty"`
	LastActivity  time.Time         `json:"last_activity"`
	CreatedAt     time.Time         `json:"created_at"`
	Summary       string            `json:"summary,omitempty"`
	Position      int               `json:"position"`
	Expanded      bool              `json:"expanded"`
	Environment   map[string]string `json:"environment,omitempty"`
}

// NewSession creates a new session
func NewSession(name, agent string) *Session {
	now := time.Now()
	id := ulid.MustNew(ulid.Timestamp(now), rand.Reader)
	return &Session{
		ID:           id.String(),
		Name:         name,
		Agent:        agent,
		Status:       StatusReady,
		LastActivity: now,
		CreatedAt:    now,
		Expanded:     false,
		Environment:  make(map[string]string),
	}
}

// UpdateStatus updates the session status and last activity time
func (s *Session) UpdateStatus(status Status) {
	s.Status = status
	s.LastActivity = time.Now()
}

// SetSummary updates the session summary
func (s *Session) SetSummary(summary string) {
	s.Summary = summary
	s.LastActivity = time.Now()
}

// GetDisplayName returns the name to show in the tab
func (s *Session) GetDisplayName() string {
	if s.Name != "" {
		return s.Name
	}
	return s.Agent
}

// GetStatusDisplay returns the status string for display
func (s *Session) GetStatusDisplay() string {
	if s.Summary != "" && s.Status == StatusWorking {
		return s.Summary
	}
	return s.Status.String()
}

// IsActionable returns true if the session needs user attention
func (s *Session) IsActionable() bool {
	return s.Status == StatusReady || s.Status == StatusError
}
