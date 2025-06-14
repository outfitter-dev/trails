// Package state manages application state persistence
package state

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// Manager implements state persistence
type Manager struct {
	mu       sync.RWMutex
	filePath string
	state    *State
	sessions engine.SessionManager
	logger   *logging.Logger
}

// State represents the persistent application state
type State struct {
	Version      string                     `json:"version"`
	Sessions     []SessionState             `json:"sessions"`
	FocusedID    string                     `json:"focused_id"`
	MinimalMode  bool                       `json:"minimal_mode"`
	Preferences  map[string]interface{}     `json:"preferences"`
	LastSaved    time.Time                  `json:"last_saved"`
}

// SessionState represents persisted session state
type SessionState struct {
	ID            string                    `json:"id"`
	Name          string                    `json:"name"`
	Agent         string                    `json:"agent"`
	Status        protocol.SessionStatus   `json:"status"`
	EnvironmentID string                    `json:"environment_id"`
	Branch        string                    `json:"branch"`
	CreatedAt     time.Time                 `json:"created_at"`
	UpdatedAt     time.Time                 `json:"updated_at"`
	LastActivity  time.Time                 `json:"last_activity"`
	Environment   map[string]string         `json:"environment,omitempty"`
}

// NewManager creates a new state manager
func NewManager(filePath string, sessions engine.SessionManager, logger *logging.Logger) *Manager {
	return &Manager{
		filePath: filePath,
		state: &State{
			Version:     "1.0.0",
			Sessions:    make([]SessionState, 0),
			Preferences: make(map[string]interface{}),
		},
		sessions: sessions,
		logger:   logger,
	}
}

// Load reads state from disk
func (m *Manager) Load(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(m.filePath), 0755); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}

	// Check if file exists
	if _, err := os.Stat(m.filePath); os.IsNotExist(err) {
		m.logger.Info("State file does not exist, starting with empty state",
			"file_path", m.filePath,
		)
		return nil
	}

	// Read file
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return fmt.Errorf("read state file: %w", err)
	}

	// Parse JSON
	if err := json.Unmarshal(data, m.state); err != nil {
		return fmt.Errorf("parse state file: %w", err)
	}

	m.logger.Info("State loaded successfully",
		"file_path", m.filePath,
		"version", m.state.Version,
		"session_count", len(m.state.Sessions),
		"last_saved", m.state.LastSaved,
	)

	return nil
}

// Save writes state to disk
func (m *Manager) Save(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Update state with current sessions
	if err := m.updateSessionState(ctx); err != nil {
		return fmt.Errorf("update session state: %w", err)
	}

	m.state.LastSaved = time.Now()

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(m.filePath), 0755); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}

	// Marshal to JSON
	data, err := json.MarshalIndent(m.state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}

	// Write to temporary file first
	tempPath := m.filePath + ".tmp"
	if err := os.WriteFile(tempPath, data, 0644); err != nil {
		return fmt.Errorf("write temporary state file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tempPath, m.filePath); err != nil {
		return fmt.Errorf("rename state file: %w", err)
	}

	m.logger.Debug("State saved successfully",
		"file_path", m.filePath,
		"session_count", len(m.state.Sessions),
	)

	return nil
}

// GetSnapshot returns a state snapshot for events
func (m *Manager) GetSnapshot() (*protocol.StateSnapshotEvent, error) {
	// Copy current state under lock to avoid holding lock during external calls
	m.mu.RLock()
	focusedID := m.state.FocusedID
	minimalMode := m.state.MinimalMode
	preferences := make(map[string]interface{})
	for k, v := range m.state.Preferences {
		preferences[k] = v
	}
	m.mu.RUnlock()

	// Get current sessions without holding state lock
	sessions, err := m.sessions.List(context.Background(), protocol.SessionFilter{})
	if err != nil {
		return nil, fmt.Errorf("get sessions for snapshot: %w", err)
	}

	// Convert to session info
	sessionInfos := make([]protocol.SessionInfo, len(sessions))
	for i, session := range sessions {
		sessionInfos[i] = protocol.SessionInfo{
			ID:            session.ID,
			Name:          session.Name,
			Agent:         session.Agent,
			Status:        session.Status,
			EnvironmentID: session.EnvironmentID,
			Branch:        session.Branch,
			CreatedAt:     session.CreatedAt,
			UpdatedAt:     session.UpdatedAt,
		}
	}

	return &protocol.StateSnapshotEvent{
		Sessions:    sessionInfos,
		FocusedID:   focusedID,
		MinimalMode: minimalMode,
		Preferences: preferences,
	}, nil
}

// RestoreFromSnapshot restores state from a snapshot
func (m *Manager) RestoreFromSnapshot(snapshot *protocol.StateSnapshotEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.state.FocusedID = snapshot.FocusedID
	m.state.MinimalMode = snapshot.MinimalMode
	m.state.Preferences = snapshot.Preferences

	m.logger.Info("State restored from snapshot",
		"session_count", len(snapshot.Sessions),
		"focused_id", snapshot.FocusedID,
		"minimal_mode", snapshot.MinimalMode,
	)

	return nil
}

// SetFocusedSession sets the currently focused session
func (m *Manager) SetFocusedSession(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.state.FocusedID = sessionID
}

// GetFocusedSession returns the currently focused session ID
func (m *Manager) GetFocusedSession() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	return m.state.FocusedID
}

// SetMinimalMode sets the minimal mode preference
func (m *Manager) SetMinimalMode(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.state.MinimalMode = enabled
}

// IsMinimalMode returns whether minimal mode is enabled
func (m *Manager) IsMinimalMode() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	return m.state.MinimalMode
}

// SetPreference sets a user preference
func (m *Manager) SetPreference(key string, value interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.state.Preferences[key] = value
}

// GetPreference gets a user preference
func (m *Manager) GetPreference(key string) (interface{}, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	value, exists := m.state.Preferences[key]
	return value, exists
}

// updateSessionState syncs the state with current sessions
func (m *Manager) updateSessionState(ctx context.Context) error {
	// Get current sessions
	sessions, err := m.sessions.List(ctx, protocol.SessionFilter{})
	if err != nil {
		return fmt.Errorf("get current sessions: %w", err)
	}

	// Convert to session state
	sessionStates := make([]SessionState, len(sessions))
	for i, session := range sessions {
		sessionStates[i] = SessionState{
			ID:            session.ID,
			Name:          session.Name,
			Agent:         session.Agent,
			Status:        session.Status,
			EnvironmentID: session.EnvironmentID,
			Branch:        session.Branch,
			CreatedAt:     session.CreatedAt,
			UpdatedAt:     session.UpdatedAt,
			LastActivity:  session.LastActivity,
			Environment:   session.Environment,
		}
	}

	m.state.Sessions = sessionStates
	return nil
}

// CleanupStaleSessions removes session state for sessions that no longer exist
func (m *Manager) CleanupStaleSessions(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Get current session IDs
	sessions, err := m.sessions.List(ctx, protocol.SessionFilter{})
	if err != nil {
		return fmt.Errorf("get current sessions: %w", err)
	}

	currentIDs := make(map[string]bool)
	for _, session := range sessions {
		currentIDs[session.ID] = true
	}

	// Filter state sessions
	var validSessions []SessionState
	removedCount := 0

	for _, sessionState := range m.state.Sessions {
		if currentIDs[sessionState.ID] {
			validSessions = append(validSessions, sessionState)
		} else {
			removedCount++
		}
	}

	m.state.Sessions = validSessions

	if removedCount > 0 {
		m.logger.Info("Cleaned up stale session state",
			"removed_count", removedCount,
		)
	}

	return nil
}