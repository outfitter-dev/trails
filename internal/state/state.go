package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/maybe-good/agentish/internal/session"
)

// State represents the current application state
type State struct {
	RepoPath       string                      `json:"repo_path"`
	Sessions       map[string]*session.Session `json:"sessions"`
	FocusedSession string                      `json:"focused_session"`
	MinimalMode    bool                        `json:"minimal_mode"`
	LastSaved      int64                       `json:"last_saved"`
	SessionOrder   []string                    `json:"session_order"`
}

// NewState creates a new application state
func NewState(repoPath string) *State {
	return &State{
		RepoPath:     repoPath,
		Sessions:     make(map[string]*session.Session),
		MinimalMode:  false,
		SessionOrder: make([]string, 0),
	}
}

// AddSession adds a new session to the state
func (s *State) AddSession(sess *session.Session) {
	s.Sessions[sess.ID] = sess
	s.SessionOrder = append(s.SessionOrder, sess.ID)

	// Update positions
	s.updatePositions()

	// Focus the new session if it's the first one
	if len(s.Sessions) == 1 {
		s.FocusedSession = sess.ID
	}
}

// RemoveSession removes a session from the state
func (s *State) RemoveSession(sessionID string) {
	delete(s.Sessions, sessionID)

	// Remove from order
	for i, id := range s.SessionOrder {
		if id == sessionID {
			s.SessionOrder = append(s.SessionOrder[:i], s.SessionOrder[i+1:]...)
			break
		}
	}

	// Update positions
	s.updatePositions()

	// Update focused session if necessary
	if s.FocusedSession == sessionID {
		if len(s.SessionOrder) > 0 {
			s.FocusedSession = s.SessionOrder[0]
		} else {
			s.FocusedSession = ""
		}
	}
}

// GetFocusedSession returns the currently focused session
func (s *State) GetFocusedSession() *session.Session {
	if s.FocusedSession == "" {
		return nil
	}
	return s.Sessions[s.FocusedSession]
}

// GetOrderedSessions returns sessions in display order
func (s *State) GetOrderedSessions() []*session.Session {
	sessions := make([]*session.Session, 0, len(s.SessionOrder))
	for _, id := range s.SessionOrder {
		if sess, exists := s.Sessions[id]; exists {
			sessions = append(sessions, sess)
		}
	}
	return sessions
}

// GetActionableSessions returns sessions that need attention
func (s *State) GetActionableSessions() []*session.Session {
	var actionable []*session.Session
	for _, sess := range s.Sessions {
		if sess.IsActionable() {
			actionable = append(actionable, sess)
		}
	}

	// Sort by last activity (most recent first)
	sort.Slice(actionable, func(i, j int) bool {
		return actionable[i].LastActivity.After(actionable[j].LastActivity)
	})

	return actionable
}

// MoveFocus moves focus to the next/previous session
func (s *State) MoveFocus(direction int) {
	if len(s.SessionOrder) == 0 {
		return
	}

	currentIndex := 0
	for i, id := range s.SessionOrder {
		if id == s.FocusedSession {
			currentIndex = i
			break
		}
	}

	newIndex := currentIndex + direction
	if newIndex < 0 {
		newIndex = len(s.SessionOrder) - 1
	} else if newIndex >= len(s.SessionOrder) {
		newIndex = 0
	}

	s.FocusedSession = s.SessionOrder[newIndex]
}

// FocusNextActionable focuses the next session that needs attention
func (s *State) FocusNextActionable() bool {
	actionable := s.GetActionableSessions()
	if len(actionable) == 0 {
		return false
	}

	s.FocusedSession = actionable[0].ID
	return true
}

func (s *State) updatePositions() {
	for i, id := range s.SessionOrder {
		if sess, exists := s.Sessions[id]; exists {
			sess.Position = i
		}
	}
}

// Save persists the state to disk
func (s *State) Save() error {
	statePath := filepath.Join(s.RepoPath, ".agentish")
	if err := os.MkdirAll(statePath, 0755); err != nil {
		return fmt.Errorf("failed to create .agentish directory: %w", err)
	}

	stateFile := filepath.Join(statePath, "state.json")
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal state: %w", err)
	}

	return os.WriteFile(stateFile, data, 0644)
}

// Load reads the state from disk
func Load(repoPath string) (*State, error) {
	stateFile := filepath.Join(repoPath, ".agentish", "state.json")
	data, err := os.ReadFile(stateFile)
	if err != nil {
		if os.IsNotExist(err) {
			// Return new state if file doesn't exist
			return NewState(repoPath), nil
		}
		return nil, fmt.Errorf("failed to read state file: %w", err)
	}

	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("failed to unmarshal state: %w", err)
	}

	// Ensure repo path matches (in case state file was moved)
	state.RepoPath = repoPath

	return &state, nil
}
