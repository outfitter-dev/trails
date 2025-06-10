package session

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/outfitter-dev/trails/internal/containeruse"
	"github.com/outfitter-dev/trails/internal/security"
)

// ValidAgentTypes defines the supported AI agent types
var ValidAgentTypes = map[string]bool{
	"claude": true,
	"aider":  true,
	"codex":  true,
}

// Manager handles session lifecycle and container integration
type Manager struct {
	environmentProvider containeruse.Provider
	repoPath            string
	auditLogger         *security.AuditLogger
}

// NewManager creates a new session manager
func NewManager(repoPath string) (*Manager, func() error, error) {
	// Create audit logger
	auditLogger, closeLogger, err := security.NewAuditLogger(repoPath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create audit logger: %w", err)
	}

	// Create container provider
	providerType := containeruse.GetDefaultProviderType()
	provider, closeProvider, err := containeruse.NewProvider(providerType, auditLogger)
	if err != nil {
		closeLogger()
		return nil, nil, fmt.Errorf("failed to create container provider: %w", err)
	}

	// Create cleanup function that closes both logger and provider
	cleanup := func() error {
		if err := closeProvider(); err != nil {
			closeLogger()
			return err
		}
		return closeLogger()
	}

	return &Manager{
		environmentProvider: provider,
		repoPath:            repoPath,
		auditLogger:         auditLogger,
	}, cleanup, nil
}

// NewManagerWithProvider creates a new session manager with custom provider
func NewManagerWithProvider(repoPath string, provider containeruse.Provider, auditLogger *security.AuditLogger) *Manager {
	return &Manager{
		environmentProvider: provider,
		repoPath:            repoPath,
		auditLogger:         auditLogger,
	}
}

// CreateSession creates a new session with container-use environment
func (m *Manager) CreateSession(ctx context.Context, name, agent string) (*Session, error) {
	// Validate inputs
	if name == "" {
		return nil, fmt.Errorf("session name cannot be empty")
	}
	if agent == "" {
		return nil, fmt.Errorf("agent type cannot be empty")
	}
	if m.repoPath == "" {
		return nil, fmt.Errorf("repository path not configured")
	}

	// Validate agent type
	if !ValidAgentTypes[agent] {
		return nil, fmt.Errorf("unsupported agent type: %s", agent)
	}

	session := NewSession(name, agent)

	// Create container-use environment
	envReq := containeruse.CreateEnvironmentRequest{
		Name:        fmt.Sprintf("trails-%s", strings.ToLower(session.ID)),
		Source:      m.repoPath,
		Explanation: fmt.Sprintf("Environment for %s agent session %s", agent, name),
		Environment: map[string]string{
			"TRAILS_SESSION_ID": session.ID,
			"TRAILS_AGENT_TYPE": agent,
		},
	}

	// Create environment with timeout to prevent hangs
	createCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	env, err := m.environmentProvider.CreateEnvironment(createCtx, envReq)

	// Audit log the session creation attempt
	if m.auditLogger != nil {
		m.auditLogger.LogSessionCreate(session.ID, agent, err == nil, err)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create container environment for session %s: %w", session.ID, err)
	}

	if env == nil {
		return nil, fmt.Errorf("environment provider returned nil environment")
	}
	if env.ID == "" {
		return nil, fmt.Errorf("environment provider returned empty environment ID")
	}

	session.EnvironmentID = NewEnvironmentID(env.ID)
	session.UpdateStatus(StatusReady)

	return session, nil
}

// DestroySession destroys a session and its container-use environment
func (m *Manager) DestroySession(ctx context.Context, session *Session) error {
	if session == nil {
		return fmt.Errorf("session cannot be nil")
	}

	var err error
	if !session.EnvironmentID.IsEmpty() {
		err = m.environmentProvider.DestroyEnvironment(ctx, session.EnvironmentID.String())
	}

	// Audit log the session destruction attempt
	if m.auditLogger != nil {
		m.auditLogger.LogSessionDestroy(session.ID, err == nil, err)
	}

	if err != nil {
		return fmt.Errorf("failed to destroy container environment %s for session %s: %w",
			session.EnvironmentID.String(), session.ID, err)
	}

	return nil
}

// StartAgent starts the AI agent in the session's environment
func (m *Manager) StartAgent(ctx context.Context, session *Session) error {
	if session == nil {
		return fmt.Errorf("session cannot be nil")
	}
	if session.EnvironmentID.IsEmpty() {
		return fmt.Errorf("session %s has no environment ID", session.ID)
	}
	if session.Agent == "" {
		return fmt.Errorf("session %s has no agent type configured", session.ID)
	}

	session.UpdateStatus(StatusWorking)

	err := m.environmentProvider.SpawnAgent(ctx, session.EnvironmentID.String(), session.Agent)

	// Audit log the agent start attempt
	if m.auditLogger != nil {
		m.auditLogger.LogAgentStart(session.ID, session.Agent, session.EnvironmentID.String(), err == nil, err)
	}

	if err != nil {
		session.UpdateStatus(StatusError)
		return fmt.Errorf("failed to spawn %s agent in environment %s for session %s: %w",
			session.Agent, session.EnvironmentID.String(), session.ID, err)
	}

	return nil
}

// GetEnvironmentStatus checks the status of a session's environment
func (m *Manager) GetEnvironmentStatus(ctx context.Context, session *Session) error {
	if session.EnvironmentID.IsEmpty() {
		return nil
	}

	env, err := m.environmentProvider.GetEnvironment(ctx, session.EnvironmentID.String())
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
