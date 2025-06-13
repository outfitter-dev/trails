package testhelpers

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/protocol"
	"github.com/oklog/ulid/v2"
)

// MockSessionManager is a mock implementation of engine.SessionManager for testing.
type MockSessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*engine.Session
	
	// Control behavior
	CreateError error
	DeleteError error
	UpdateError error
	GetError    error
	ListError   error
	StatusError error
	
	// Track calls
	CreateCalls []protocol.CreateSessionCommand
	DeleteCalls []string
	UpdateCalls []UpdateCall
	StatusCalls []StatusCall
}

// UpdateCall tracks Update method calls.
type UpdateCall struct {
	SessionID string
	Updates   map[string]interface{}
}

// StatusCall tracks SetStatus method calls.
type StatusCall struct {
	SessionID string
	Status    protocol.SessionStatus
}

// NewMockSessionManager creates a new mock session manager.
func NewMockSessionManager() *MockSessionManager {
	return &MockSessionManager{
		sessions: make(map[string]*engine.Session),
	}
}

// Create implements engine.SessionManager.
func (m *MockSessionManager) Create(ctx context.Context, req protocol.CreateSessionCommand) (*engine.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.CreateCalls = append(m.CreateCalls, req)
	
	if m.CreateError != nil {
		return nil, m.CreateError
	}
	
	session := TestSession(
		WithSessionName(req.Name),
		WithSessionAgent(req.Agent),
	)
	
	m.sessions[session.ID] = session
	return session, nil
}

// Delete implements engine.SessionManager.
func (m *MockSessionManager) Delete(ctx context.Context, sessionID string, force bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.DeleteCalls = append(m.DeleteCalls, sessionID)
	
	if m.DeleteError != nil {
		return m.DeleteError
	}
	
	if _, exists := m.sessions[sessionID]; !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	
	delete(m.sessions, sessionID)
	return nil
}

// Update implements engine.SessionManager.
func (m *MockSessionManager) Update(ctx context.Context, sessionID string, updates map[string]interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.UpdateCalls = append(m.UpdateCalls, UpdateCall{
		SessionID: sessionID,
		Updates:   updates,
	})
	
	if m.UpdateError != nil {
		return m.UpdateError
	}
	
	session, exists := m.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	
	session.Update(updates)
	return nil
}

// Get implements engine.SessionManager.
func (m *MockSessionManager) Get(ctx context.Context, sessionID string) (*engine.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	if m.GetError != nil {
		return nil, m.GetError
	}
	
	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}
	
	// Return a copy to prevent external modification
	copy := session.Clone()
	return &copy, nil
}

// List implements engine.SessionManager.
func (m *MockSessionManager) List(ctx context.Context, filter protocol.SessionFilter) ([]*engine.Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	if m.ListError != nil {
		return nil, m.ListError
	}
	
	var sessions []*engine.Session
	for _, session := range m.sessions {
		// Apply filter if needed
		if filter.Status != "" && session.GetStatus() != filter.Status {
			continue
		}
		if filter.Agent != "" && session.Agent != filter.Agent {
			continue
		}
		
		copy := session.Clone()
		sessions = append(sessions, &copy)
	}
	
	return sessions, nil
}

// SetStatus implements engine.SessionManager.
func (m *MockSessionManager) SetStatus(ctx context.Context, sessionID string, status protocol.SessionStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.StatusCalls = append(m.StatusCalls, StatusCall{
		SessionID: sessionID,
		Status:    status,
	})
	
	if m.StatusError != nil {
		return m.StatusError
	}
	
	session, exists := m.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	
	session.SetStatus(status)
	return nil
}

// AddSession adds a session directly for testing.
func (m *MockSessionManager) AddSession(session *engine.Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[session.ID] = session
}

// MockStateManager is a mock implementation of engine.StateManager for testing.
type MockStateManager struct {
	mu       sync.RWMutex
	snapshot *protocol.StateSnapshotEvent
	
	// Control behavior
	LoadError     error
	SaveError     error
	SnapshotError error
	RestoreError  error
	
	// Track calls
	LoadCalls    int
	SaveCalls    int
	RestoreCalls int
}

// NewMockStateManager creates a new mock state manager.
func NewMockStateManager() *MockStateManager {
	return &MockStateManager{
		snapshot: &protocol.StateSnapshotEvent{
			Sessions: []protocol.SessionInfo{},
		},
	}
}

// Load implements engine.StateManager.
func (m *MockStateManager) Load(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.LoadCalls++
	return m.LoadError
}

// Save implements engine.StateManager.
func (m *MockStateManager) Save(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.SaveCalls++
	return m.SaveError
}

// GetSnapshot implements engine.StateManager.
func (m *MockStateManager) GetSnapshot() (*protocol.StateSnapshotEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	if m.SnapshotError != nil {
		return nil, m.SnapshotError
	}
	
	return m.snapshot, nil
}

// RestoreFromSnapshot implements engine.StateManager.
func (m *MockStateManager) RestoreFromSnapshot(snapshot *protocol.StateSnapshotEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.RestoreCalls++
	
	if m.RestoreError != nil {
		return m.RestoreError
	}
	
	m.snapshot = snapshot
	return nil
}

// SetSnapshot sets the snapshot for testing.
func (m *MockStateManager) SetSnapshot(snapshot *protocol.StateSnapshotEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.snapshot = snapshot
}

// MockContainerManager is a mock implementation of engine.ContainerManager for testing.
type MockContainerManager struct {
	mu         sync.RWMutex
	containers map[string]*engine.Container
	
	// Control behavior
	CreateError  error
	DestroyError error
	StatusError  error
	
	// Track calls
	CreateCalls  []engine.ContainerRequest
	DestroyCalls []string
	StatusCalls  []string
}

// NewMockContainerManager creates a new mock container manager.
func NewMockContainerManager() *MockContainerManager {
	return &MockContainerManager{
		containers: make(map[string]*engine.Container),
	}
}

// CreateEnvironment implements engine.ContainerManager.
func (m *MockContainerManager) CreateEnvironment(ctx context.Context, req engine.ContainerRequest) (*engine.Container, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.CreateCalls = append(m.CreateCalls, req)
	
	if m.CreateError != nil {
		return nil, m.CreateError
	}
	
	container := &engine.Container{
		ID:        "container-" + ulid.Make().String(),
		Name:      req.Name,
		Status:    engine.ContainerStatusReady,
		CreatedAt: time.Now(),
		Metadata:  make(map[string]string),
	}
	
	m.containers[container.ID] = container
	return container, nil
}

// DestroyEnvironment implements engine.ContainerManager.
func (m *MockContainerManager) DestroyEnvironment(ctx context.Context, envID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.DestroyCalls = append(m.DestroyCalls, envID)
	
	if m.DestroyError != nil {
		return m.DestroyError
	}
	
	if _, exists := m.containers[envID]; !exists {
		return fmt.Errorf("container not found: %s", envID)
	}
	
	delete(m.containers, envID)
	return nil
}

// GetEnvironmentStatus implements engine.ContainerManager.
func (m *MockContainerManager) GetEnvironmentStatus(ctx context.Context, envID string) (engine.ContainerStatus, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	m.StatusCalls = append(m.StatusCalls, envID)
	
	if m.StatusError != nil {
		return "", m.StatusError
	}
	
	container, exists := m.containers[envID]
	if !exists {
		return "", fmt.Errorf("container not found: %s", envID)
	}
	
	return container.Status, nil
}

// MockMetricsCollector is a mock implementation of engine.MetricsCollector for testing.
type MockMetricsCollector struct {
	mu sync.RWMutex
	
	// Track calls
	CommandCalls         []protocol.CommandType
	CommandDurationCalls []DurationCall
	ErrorCalls           []ErrorCall
	SessionCountCalls    []int
	CounterCalls         []CounterCall
}

// DurationCall tracks RecordCommandDuration calls.
type DurationCall struct {
	CommandType protocol.CommandType
	Duration    time.Duration
}

// ErrorCall tracks RecordError calls.
type ErrorCall struct {
	Operation string
	Error     error
}

// CounterCall tracks IncrementCounter calls.
type CounterCall struct {
	Name string
	Tags map[string]string
}

// NewMockMetricsCollector creates a new mock metrics collector.
func NewMockMetricsCollector() *MockMetricsCollector {
	return &MockMetricsCollector{}
}

// RecordCommand implements engine.MetricsCollector.
func (m *MockMetricsCollector) RecordCommand(cmdType protocol.CommandType) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CommandCalls = append(m.CommandCalls, cmdType)
}

// RecordCommandDuration implements engine.MetricsCollector.
func (m *MockMetricsCollector) RecordCommandDuration(cmdType protocol.CommandType, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CommandDurationCalls = append(m.CommandDurationCalls, DurationCall{
		CommandType: cmdType,
		Duration:    duration,
	})
}

// RecordError implements engine.MetricsCollector.
func (m *MockMetricsCollector) RecordError(operation string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ErrorCalls = append(m.ErrorCalls, ErrorCall{
		Operation: operation,
		Error:     err,
	})
}

// RecordSessionCount implements engine.MetricsCollector.
func (m *MockMetricsCollector) RecordSessionCount(count int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SessionCountCalls = append(m.SessionCountCalls, count)
}

// IncrementCounter implements engine.MetricsCollector.
func (m *MockMetricsCollector) IncrementCounter(name string, tags map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CounterCalls = append(m.CounterCalls, CounterCall{
		Name: name,
		Tags: tags,
	})
}