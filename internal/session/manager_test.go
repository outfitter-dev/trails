package session

import (
	"context"
	"errors"
	"testing"

	"github.com/outfitter-dev/trails/internal/containeruse"
)

// MockProvider for testing
type MockProvider struct {
	createFunc  func(ctx context.Context, req containeruse.CreateEnvironmentRequest) (*containeruse.Environment, error)
	destroyFunc func(ctx context.Context, envID string) error
	getFunc     func(ctx context.Context, envID string) (*containeruse.Environment, error)
	spawnFunc   func(ctx context.Context, envID, agentType string) error
}

func (m *MockProvider) CreateEnvironment(ctx context.Context, req containeruse.CreateEnvironmentRequest) (*containeruse.Environment, error) {
	if m.createFunc != nil {
		return m.createFunc(ctx, req)
	}
	return &containeruse.Environment{
		ID:     "test-env-id",
		Name:   req.Name,
		Source: req.Source,
		Status: "ready",
	}, nil
}

func (m *MockProvider) DestroyEnvironment(ctx context.Context, envID string) error {
	if m.destroyFunc != nil {
		return m.destroyFunc(ctx, envID)
	}
	return nil
}

func (m *MockProvider) GetEnvironment(ctx context.Context, envID string) (*containeruse.Environment, error) {
	if m.getFunc != nil {
		return m.getFunc(ctx, envID)
	}
	return &containeruse.Environment{
		ID:     envID,
		Status: "ready",
	}, nil
}

func (m *MockProvider) SpawnAgent(ctx context.Context, envID, agentType string) error {
	if m.spawnFunc != nil {
		return m.spawnFunc(ctx, envID, agentType)
	}
	return nil
}

func TestManager_CreateSession(t *testing.T) {
	tests := []struct {
		name        string
		sessionName string
		agent       string
		mockFunc    func(ctx context.Context, req containeruse.CreateEnvironmentRequest) (*containeruse.Environment, error)
		wantErr     bool
	}{
		{
			name:        "successful creation",
			sessionName: "test-session",
			agent:       "claude",
			mockFunc: func(ctx context.Context, req containeruse.CreateEnvironmentRequest) (*containeruse.Environment, error) {
				return &containeruse.Environment{
					ID:     "test-env-123",
					Name:   req.Name,
					Source: req.Source,
					Status: "ready",
				}, nil
			},
			wantErr: false,
		},
		{
			name:        "environment creation fails",
			sessionName: "test-session",
			agent:       "claude",
			mockFunc: func(ctx context.Context, req containeruse.CreateEnvironmentRequest) (*containeruse.Environment, error) {
				return nil, errors.New("environment creation failed")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &MockProvider{
				createFunc: tt.mockFunc,
			}

			m := NewManagerWithProvider("/test/repo", mock, nil)

			ctx := context.Background()
			session, err := m.CreateSession(ctx, tt.sessionName, tt.agent)

			if (err != nil) != tt.wantErr {
				t.Errorf("CreateSession() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				if session == nil {
					t.Error("CreateSession() returned nil session")
					return
				}
				if session.Name != tt.sessionName {
					t.Errorf("Session name = %v, want %v", session.Name, tt.sessionName)
				}
				if session.Agent != tt.agent {
					t.Errorf("Session agent = %v, want %v", session.Agent, tt.agent)
				}
				if session.Status != StatusReady {
					t.Errorf("Session status = %v, want %v", session.Status, StatusReady)
				}
				if session.EnvironmentID == "" {
					t.Error("Session environment ID is empty")
				}
			}
		})
	}
}

func TestManager_DestroySession(t *testing.T) {
	tests := []struct {
		name         string
		sessionEnvID string
		mockFunc     func(ctx context.Context, envID string) error
		wantErr      bool
	}{
		{
			name:         "successful destruction",
			sessionEnvID: "test-env-123",
			mockFunc: func(ctx context.Context, envID string) error {
				return nil
			},
			wantErr: false,
		},
		{
			name:         "empty environment ID",
			sessionEnvID: "",
			wantErr:      false, // Should not error for empty env ID
		},
		{
			name:         "environment destruction fails",
			sessionEnvID: "test-env-123",
			mockFunc: func(ctx context.Context, envID string) error {
				return errors.New("destroy failed")
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &MockProvider{
				destroyFunc: tt.mockFunc,
			}

			m := NewManagerWithProvider("/test/repo", mock, nil)

			session := &Session{
				ID:            "test-session-id",
				EnvironmentID: NewEnvironmentID(tt.sessionEnvID),
			}

			ctx := context.Background()
			err := m.DestroySession(ctx, session)

			if (err != nil) != tt.wantErr {
				t.Errorf("DestroySession() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestManager_StartAgent(t *testing.T) {
	tests := []struct {
		name         string
		sessionEnvID string
		agent        string
		mockFunc     func(ctx context.Context, envID, agentType string) error
		wantErr      bool
		wantStatus   Status
	}{
		{
			name:         "successful start",
			sessionEnvID: "test-env-123",
			agent:        "claude",
			mockFunc: func(ctx context.Context, envID, agentType string) error {
				return nil
			},
			wantErr:    false,
			wantStatus: StatusWorking,
		},
		{
			name:         "empty environment ID",
			sessionEnvID: "",
			agent:        "claude",
			wantErr:      true,
		},
		{
			name:         "spawn agent fails",
			sessionEnvID: "test-env-123",
			agent:        "claude",
			mockFunc: func(ctx context.Context, envID, agentType string) error {
				return errors.New("spawn failed")
			},
			wantErr:    true,
			wantStatus: StatusError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &MockProvider{
				spawnFunc: tt.mockFunc,
			}

			m := NewManagerWithProvider("/test/repo", mock, nil)

			session := &Session{
				ID:            "test-session-id",
				EnvironmentID: NewEnvironmentID(tt.sessionEnvID),
				Agent:         tt.agent,
				Status:        StatusReady,
			}

			ctx := context.Background()
			err := m.StartAgent(ctx, session)

			if (err != nil) != tt.wantErr {
				t.Errorf("StartAgent() error = %v, wantErr %v", err, tt.wantErr)
			}

			if tt.wantStatus != 0 && session.Status != tt.wantStatus {
				t.Errorf("Session status = %v, want %v", session.Status, tt.wantStatus)
			}
		})
	}
}
