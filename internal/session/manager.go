package session

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/maybe-good/agentish/internal/containeruse"
)

// Manager handles session lifecycle and container-use integration
type Manager struct {
	containerClient *containeruse.Client
	repoPath        string
}

// NewManager creates a new session manager
func NewManager(repoPath string) *Manager {
	return &Manager{
		containerClient: containeruse.NewClient(),
		repoPath:        repoPath,
	}
}

// CreateSession creates a new session with container-use environment
func (m *Manager) CreateSession(ctx context.Context, name, agent string) (*Session, error) {
	session := NewSession(name, agent)

	// Create container-use environment
	envReq := containeruse.CreateEnvironmentRequest{
		Name:        fmt.Sprintf("agentish-%s", session.ID),
		Source:      m.repoPath,
		Explanation: fmt.Sprintf("Environment for %s agent session: %s", agent, name),
		Environment: map[string]string{
			"AGENTISH_SESSION_ID": session.ID,
			"AGENTISH_AGENT_TYPE": agent,
		},
	}

	env, err := m.containerClient.CreateEnvironment(ctx, envReq)
	if err != nil {
		return nil, fmt.Errorf("failed to create container environment: %w", err)
	}

	session.EnvironmentID = env.ID
	session.UpdateStatus(StatusReady)

	return session, nil
}

// DestroySession destroys a session and its container-use environment
func (m *Manager) DestroySession(ctx context.Context, session *Session) error {
	if session.EnvironmentID != "" {
		if err := m.containerClient.DestroyEnvironment(ctx, session.EnvironmentID); err != nil {
			return fmt.Errorf("failed to destroy container environment: %w", err)
		}
	}

	return nil
}

// StartAgent starts the AI agent in the session's environment
func (m *Manager) StartAgent(ctx context.Context, session *Session) error {
	if session.EnvironmentID == "" {
		return fmt.Errorf("session has no environment ID")
	}

	session.UpdateStatus(StatusWorking)

	if err := m.containerClient.SpawnAgent(ctx, session.EnvironmentID, session.Agent); err != nil {
		session.UpdateStatus(StatusError)
		return fmt.Errorf("failed to spawn agent: %w", err)
	}

	return nil
}

// GetEnvironmentStatus checks the status of a session's environment
func (m *Manager) GetEnvironmentStatus(ctx context.Context, session *Session) error {
	if session.EnvironmentID == "" {
		return nil
	}

	env, err := m.containerClient.GetEnvironment(ctx, session.EnvironmentID)
	if err != nil {
		session.UpdateStatus(StatusError)
		return fmt.Errorf("failed to get environment status: %w", err)
	}

	// Update session based on environment status
	switch env.Status {
	case "ready":
		if session.Status == StatusWorking {
			// Keep working status if agent is running
		} else {
			session.UpdateStatus(StatusReady)
		}
	case "error":
		session.UpdateStatus(StatusError)
	default:
		session.UpdateStatus(StatusWaiting)
	}

	return nil
}

// GetRepoPath returns the repository path
func (m *Manager) GetRepoPath() string {
	return m.repoPath
}

// GetRelativePath converts an absolute path to relative from repo root
func (m *Manager) GetRelativePath(absolutePath string) (string, error) {
	return filepath.Rel(m.repoPath, absolutePath)
}
