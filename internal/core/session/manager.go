// Package session manages agent sessions
package session

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// Manager implements session management
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*engine.Session
	ordered  []string // Maintains insertion order

	containers engine.ContainerManager
	logger     *logging.Logger
}

// NewManager creates a new session manager
func NewManager(containers engine.ContainerManager, logger *logging.Logger) *Manager {
	return &Manager{
		sessions:   make(map[string]*engine.Session),
		ordered:    make([]string, 0),
		containers: containers,
		logger:     logger,
	}
}

// Create creates a new session
func (m *Manager) Create(ctx context.Context, req protocol.CreateSessionCommand) (*engine.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Generate session ID
	sessionID := ulid.Make().String()

	// Create container environment
	containerReq := engine.ContainerRequest{
		Name:        fmt.Sprintf("trails-%s", req.Name),
		Source:      ".", // Current directory
		Environment: req.Environment,
	}

	container, err := m.containers.CreateEnvironment(ctx, containerReq)
	if err != nil {
		return nil, fmt.Errorf("failed to create container environment: %w", err)
	}

	// Create session
	session := &engine.Session{
		ID:            sessionID,
		Name:          req.Name,
		Agent:         req.Agent,
		Status:        protocol.StatusReady,
		EnvironmentID: container.ID,
		Branch:        req.Branch,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		LastActivity:  time.Now(),
		Environment:   req.Environment,
	}

	// Store session
	m.sessions[sessionID] = session
	m.ordered = append(m.ordered, sessionID)

	m.logger.LogSessionCreated(ctx, protocol.SessionInfo{
		ID:            session.ID,
		Name:          session.Name,
		Agent:         session.Agent,
		Status:        session.Status,
		EnvironmentID: session.EnvironmentID,
		Branch:        session.Branch,
		CreatedAt:     session.CreatedAt,
		UpdatedAt:     session.UpdatedAt,
	})

	return session, nil
}

// Delete removes a session
func (m *Manager) Delete(ctx context.Context, sessionID string, force bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Check if session can be deleted
	if !force && session.Status == protocol.StatusWorking {
		return fmt.Errorf("session %s is currently working, use force=true to delete", sessionID)
	}

	// Destroy container environment
	if err := m.containers.DestroyEnvironment(ctx, session.EnvironmentID); err != nil {
		m.logger.WithError(err).Warn("Failed to destroy container environment",
			"session_id", sessionID,
			"environment_id", session.EnvironmentID,
		)
		// Continue with session deletion even if container cleanup fails
	}

	// Remove from ordered list
	for i, id := range m.ordered {
		if id == sessionID {
			m.ordered = append(m.ordered[:i], m.ordered[i+1:]...)
			break
		}
	}

	// Remove session
	delete(m.sessions, sessionID)

	m.logger.LogSessionDeleted(ctx, sessionID)

	return nil
}

// Update modifies a session
func (m *Manager) Update(ctx context.Context, sessionID string, updates map[string]interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Apply updates using thread-safe method
	session.Update(updates)

	return nil
}

// Get retrieves a session by ID
func (m *Manager) Get(ctx context.Context, sessionID string) (*engine.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	// Update last activity
	session.UpdateLastActivity()

	return session, nil
}

// List returns sessions matching the filter
func (m *Manager) List(ctx context.Context, filter protocol.SessionFilter) ([]*engine.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var results []*engine.Session

	// Iterate in order
	for _, sessionID := range m.ordered {
		session := m.sessions[sessionID]
		if m.matchesFilter(session, filter) {
			// Create a copy to avoid race conditions
			sessionCopy := *session
			results = append(results, &sessionCopy)
		}
	}

	return results, nil
}

// SetStatus updates a session's status
func (m *Manager) SetStatus(ctx context.Context, sessionID string, status protocol.SessionStatus) error {
	m.mu.RLock()
	session, exists := m.sessions[sessionID]
	m.mu.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	oldStatus := session.GetStatus()
	session.SetStatus(status)
	session.UpdateLastActivity()

	m.logger.LogStatusChange(ctx, sessionID, oldStatus, status)

	return nil
}

// matchesFilter checks if a session matches the given filter
func (m *Manager) matchesFilter(session *engine.Session, filter protocol.SessionFilter) bool {
	// Filter by status
	if len(filter.Status) > 0 {
		match := false
		for _, status := range filter.Status {
			if session.Status == status {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}

	// Filter by agent
	if filter.Agent != "" && session.Agent != filter.Agent {
		return false
	}

	// Filter by branch
	if filter.Branch != "" && session.Branch != filter.Branch {
		return false
	}

	// TODO: Add more filter criteria as needed

	return true
}

// GetCount returns the current number of sessions
func (m *Manager) GetCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.sessions)
}

// GetSessionsByStatus returns sessions with a specific status
func (m *Manager) GetSessionsByStatus(status protocol.SessionStatus) []*engine.Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var results []*engine.Session
	for _, session := range m.sessions {
		if session.Status == status {
			sessionCopy := *session
			results = append(results, &sessionCopy)
		}
	}

	return results
}