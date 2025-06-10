package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/outfitter-dev/trails/internal/security"
	"github.com/outfitter-dev/trails/internal/session"
)

// State represents the current application state
type State struct {
	mu             sync.RWMutex                `json:"-"`
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
	s.mu.Lock()
	defer s.mu.Unlock()

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
	s.mu.Lock()
	defer s.mu.Unlock()

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

// GetFocusedSession returns a copy of the currently focused session
func (s *State) GetFocusedSession() *session.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.FocusedSession == "" {
		return nil
	}

	sess, exists := s.Sessions[s.FocusedSession]
	if !exists {
		return nil
	}

	return sess.DeepCopy()
}

// GetOrderedSessions returns deep copies of sessions in display order
func (s *State) GetOrderedSessions() []*session.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()

	sessions := make([]*session.Session, 0, len(s.SessionOrder))
	for _, id := range s.SessionOrder {
		if sess, exists := s.Sessions[id]; exists {
			sessions = append(sessions, sess.DeepCopy())
		}
	}
	return sessions
}

// GetActionableSessions returns deep copies of sessions that need attention
func (s *State) GetActionableSessions() []*session.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var actionable []*session.Session
	for _, sess := range s.Sessions {
		if sess.IsActionable() {
			actionable = append(actionable, sess.DeepCopy())
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
	s.mu.Lock()
	defer s.mu.Unlock()

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

	s.mu.Lock()
	defer s.mu.Unlock()
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
	s.mu.Lock()
	defer s.mu.Unlock()

	s.LastSaved = time.Now().Unix()

	statePath := filepath.Join(s.RepoPath, ".trails")
	if err := os.MkdirAll(statePath, security.SecureDirPerm); err != nil {
		return fmt.Errorf("failed to create .trails directory: %w", err)
	}

	// Ensure permissions are correct even if directory existed
	if err := os.Chmod(statePath, security.SecureDirPerm); err != nil {
		return fmt.Errorf("failed to enforce permissions on %s: %w", statePath, err)
	}

	stateFile := filepath.Join(statePath, "state.json")
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal state: %w", err)
	}

	// Use secure file permissions (owner read/write only)
	return os.WriteFile(stateFile, data, security.SecureFilePerm)
}

// Load reads the state from disk and returns the state and a close function
func Load(repoPath string) (*State, func() error, error) {
	stateFile := filepath.Join(repoPath, ".trails", "state.json")
	data, err := os.ReadFile(stateFile)
	if err != nil {
		if os.IsNotExist(err) {
			// Return new state if file doesn't exist
			state := NewState(repoPath)
			return state, state.Save, nil
		}
		return nil, nil, fmt.Errorf("failed to read state file: %w", err)
	}

	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal state: %w", err)
	}

	// Ensure repo path matches (in case state file was moved)
	state.RepoPath = repoPath

	return &state, state.Save, nil
}
