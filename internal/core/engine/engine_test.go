package engine

import (
	"context"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// Mock implementations for testing

type mockSessionManager struct {
	sessions map[string]*Session
}

func (m *mockSessionManager) Create(ctx context.Context, req protocol.CreateSessionCommand) (*Session, error) {
	session := &Session{
		ID:            ulid.Make().String(),
		Name:          req.Name,
		Agent:         req.Agent,
		Status:        protocol.StatusReady,
		EnvironmentID: "mock-env-123",
		Branch:        req.Branch,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		LastActivity:  time.Now(),
		Environment:   req.Environment,
	}
	
	if m.sessions == nil {
		m.sessions = make(map[string]*Session)
	}
	m.sessions[session.ID] = session
	
	return session, nil
}

func (m *mockSessionManager) Delete(ctx context.Context, sessionID string, force bool) error {
	if m.sessions != nil {
		delete(m.sessions, sessionID)
	}
	return nil
}

func (m *mockSessionManager) Update(ctx context.Context, sessionID string, updates map[string]interface{}) error {
	if m.sessions != nil && m.sessions[sessionID] != nil {
		session := m.sessions[sessionID]
		if name, ok := updates["name"].(string); ok {
			session.Name = name
		}
		session.UpdatedAt = time.Now()
	}
	return nil
}

func (m *mockSessionManager) Get(ctx context.Context, sessionID string) (*Session, error) {
	if m.sessions != nil && m.sessions[sessionID] != nil {
		return m.sessions[sessionID], nil
	}
	return nil, protocol.ErrInvalidSessionID
}

func (m *mockSessionManager) List(ctx context.Context, filter protocol.SessionFilter) ([]*Session, error) {
	var sessions []*Session
	if m.sessions != nil {
		for _, session := range m.sessions {
			sessions = append(sessions, session)
		}
	}
	return sessions, nil
}

func (m *mockSessionManager) SetStatus(ctx context.Context, sessionID string, status protocol.SessionStatus) error {
	if m.sessions != nil && m.sessions[sessionID] != nil {
		m.sessions[sessionID].Status = status
	}
	return nil
}

type mockStateManager struct {
	loaded bool
	saved  bool
}

func (m *mockStateManager) Load(ctx context.Context) error {
	m.loaded = true
	return nil
}

func (m *mockStateManager) Save(ctx context.Context) error {
	m.saved = true
	return nil
}

func (m *mockStateManager) GetSnapshot() (*protocol.StateSnapshotEvent, error) {
	return &protocol.StateSnapshotEvent{
		Sessions:    []protocol.SessionInfo{},
		FocusedID:   "",
		MinimalMode: false,
		Preferences: make(map[string]interface{}),
	}, nil
}

func (m *mockStateManager) RestoreFromSnapshot(snapshot *protocol.StateSnapshotEvent) error {
	return nil
}

type mockContainerManager struct{}

func (m *mockContainerManager) CreateEnvironment(ctx context.Context, req ContainerRequest) (*Container, error) {
	return &Container{
		ID:        "mock-container-123",
		Name:      req.Name,
		Status:    ContainerStatusReady,
		CreatedAt: time.Now(),
		Metadata:  map[string]string{},
	}, nil
}

func (m *mockContainerManager) DestroyEnvironment(ctx context.Context, envID string) error {
	return nil
}

func (m *mockContainerManager) GetEnvironmentStatus(ctx context.Context, envID string) (ContainerStatus, error) {
	return ContainerStatusReady, nil
}

func createTestEngine(t *testing.T) (*Engine, chan protocol.Command, chan protocol.EnhancedEvent) {
	config := DefaultConfig()
	config.WorkerCount = 1 // Use single worker for deterministic tests
	
	commands := make(chan protocol.Command, config.CommandBufferSize)
	events := make(chan protocol.EnhancedEvent, config.EventBufferSize)
	
	sessionManager := &mockSessionManager{}
	stateManager := &mockStateManager{}
	containerManager := &mockContainerManager{}
	metrics := NewInMemoryMetrics()
	logger := logging.Default()
	
	engine, err := New(
		config,
		commands,
		events,
		sessionManager,
		stateManager,
		containerManager,
		metrics,
		logger,
	)
	require.NoError(t, err)
	
	return engine, commands, events
}

func TestEngine_New(t *testing.T) {
	t.Run("valid configuration", func(t *testing.T) {
		engine, _, _ := createTestEngine(t)
		assert.NotNil(t, engine)
		assert.Equal(t, 1, engine.config.WorkerCount)
	})

	t.Run("nil commands channel", func(t *testing.T) {
		config := DefaultConfig()
		events := make(chan protocol.EnhancedEvent, config.EventBufferSize)
		
		engine, err := New(
			config,
			nil, // nil commands
			events,
			&mockSessionManager{},
			&mockStateManager{},
			&mockContainerManager{},
			NewInMemoryMetrics(),
			logging.Default(),
		)
		
		assert.Nil(t, engine)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "commands channel cannot be nil")
	})

	t.Run("nil events channel", func(t *testing.T) {
		config := DefaultConfig()
		commands := make(chan protocol.Command, config.CommandBufferSize)
		
		engine, err := New(
			config,
			commands,
			nil, // nil events
			&mockSessionManager{},
			&mockStateManager{},
			&mockContainerManager{},
			NewInMemoryMetrics(),
			logging.Default(),
		)
		
		assert.Nil(t, engine)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "events channel cannot be nil")
	})
}

func TestEngine_StartStop(t *testing.T) {
	engine, _, _ := createTestEngine(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start engine
	err := engine.Start(ctx)
	assert.NoError(t, err)

	// Give it a moment to start
	time.Sleep(10 * time.Millisecond)

	// Stop engine
	err = engine.Stop()
	assert.NoError(t, err)
}

func TestEngine_CreateSession(t *testing.T) {
	engine, commands, events := createTestEngine(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start engine
	err := engine.Start(ctx)
	require.NoError(t, err)
	defer func() {
		if err := engine.Stop(); err != nil {
			t.Errorf("engine.Stop() failed: %v", err)
		}
	}()

	// Create command
	cmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
		Name:  "test-session",
		Agent: "claude",
	})

	// Send command
	commands <- cmd

	// Wait for event
	select {
	case event := <-events:
		// Skip state snapshot event
		if event.Type == protocol.EventStateSnapshot {
			event = <-events
		}
		
		assert.Equal(t, protocol.EventSessionCreated, event.Type)
		assert.Equal(t, cmd.ID, event.Metadata.CommandID)
		
		payload, ok := event.Payload.(protocol.SessionCreatedEvent)
		require.True(t, ok)
		assert.Equal(t, "test-session", payload.Session.Name)
		assert.Equal(t, "claude", payload.Session.Agent)

	case <-time.After(time.Second):
		t.Fatal("timeout waiting for session created event")
	}
}

func TestEngine_DeleteSession(t *testing.T) {
	engine, commands, events := createTestEngine(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start engine
	err := engine.Start(ctx)
	require.NoError(t, err)
	defer func() {
		if err := engine.Stop(); err != nil {
			t.Errorf("engine.Stop() failed: %v", err)
		}
	}()

	// First create a session
	createCmd := protocol.NewCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
		Name:  "test-session",
		Agent: "claude",
	})
	commands <- createCmd

	// Get the session created event
	var sessionID string
	select {
	case event := <-events:
		// Skip state snapshot event
		if event.Type == protocol.EventStateSnapshot {
			event = <-events
		}
		
		payload, ok := event.Payload.(protocol.SessionCreatedEvent)
		require.True(t, ok)
		sessionID = payload.Session.ID
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for session created event")
	}

	// Now delete the session
	deleteCmd := protocol.NewCommand(protocol.CmdDeleteSession, protocol.DeleteSessionCommand{
		SessionID: sessionID,
		Force:     false,
	})
	commands <- deleteCmd

	// Wait for delete event
	select {
	case event := <-events:
		assert.Equal(t, protocol.EventSessionDeleted, event.Type)
		assert.Equal(t, deleteCmd.ID, event.Metadata.CommandID)
		
		payload, ok := event.Payload.(protocol.SessionDeletedEvent)
		require.True(t, ok)
		assert.Equal(t, sessionID, payload.SessionID)

	case <-time.After(time.Second):
		t.Fatal("timeout waiting for session deleted event")
	}
}

func TestEngine_HealthCheck(t *testing.T) {
	engine, commands, events := createTestEngine(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start engine
	err := engine.Start(ctx)
	require.NoError(t, err)
	defer func() {
		if err := engine.Stop(); err != nil {
			t.Errorf("engine.Stop() failed: %v", err)
		}
	}()

	// Create health check command
	cmd := protocol.NewCommand(protocol.CmdHealthCheck, protocol.HealthCheckCommand{
		IncludeDetails: true,
	})

	// Send command
	commands <- cmd

	// Wait for event
	select {
	case event := <-events:
		// Skip state snapshot event
		if event.Type == protocol.EventStateSnapshot {
			event = <-events
		}
		
		assert.Equal(t, protocol.EventHealthStatus, event.Type)
		assert.Equal(t, cmd.ID, event.Metadata.CommandID)
		
		payload, ok := event.Payload.(protocol.HealthStatusEvent)
		require.True(t, ok)
		assert.True(t, payload.Healthy)
		assert.NotNil(t, payload.Details)

	case <-time.After(time.Second):
		t.Fatal("timeout waiting for health status event")
	}
}

func TestEngine_InvalidCommand(t *testing.T) {
	engine, commands, events := createTestEngine(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start engine
	err := engine.Start(ctx)
	require.NoError(t, err)
	defer func() {
		if err := engine.Stop(); err != nil {
			t.Errorf("engine.Stop() failed: %v", err)
		}
	}()

	// Create invalid command (missing required fields)
	cmd := protocol.Command{
		ID:   "", // Invalid - empty ID
		Type: protocol.CmdCreateSession,
		Payload: protocol.CreateSessionCommand{
			Name:  "test",
			Agent: "claude",
		},
	}

	// Send command
	commands <- cmd

	// Wait for error event
	select {
	case event := <-events:
		// Skip state snapshot event
		if event.Type == protocol.EventStateSnapshot {
			event = <-events
		}
		
		assert.Equal(t, protocol.EventError, event.Type)
		
		payload, ok := event.Payload.(protocol.ErrorEvent)
		require.True(t, ok)
		assert.Equal(t, "CMD_ERROR", payload.Code)
		assert.Contains(t, payload.Details, "validation failed")

	case <-time.After(time.Second):
		t.Fatal("timeout waiting for error event")
	}
}

func TestEngine_Health(t *testing.T) {
	engine, _, _ := createTestEngine(t)

	health := engine.Health()
	
	assert.Equal(t, "healthy", health["status"])
	assert.Contains(t, health, "active_sessions")
	assert.Contains(t, health, "rate_limiters")
	assert.Contains(t, health, "worker_count")
	assert.Contains(t, health, "max_sessions")
}