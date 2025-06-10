package containeruse

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"dagger.io/dagger"
	"github.com/oklog/ulid/v2"
	"github.com/outfitter-dev/trails/internal/security"
)

// DaggerClient represents a Dagger-based container provider
type DaggerClient struct {
	dag         *dagger.Client
	auditLogger *security.AuditLogger
	mu          sync.RWMutex
	containers  map[string]*dagger.Container // Track containers by environment ID, guarded by mu
}

// NewDaggerClient creates a new Dagger-based client
func NewDaggerClient(auditLogger *security.AuditLogger) (*DaggerClient, error) {
	ctx := context.Background()

	// Connect to Dagger with optional log output
	var logOutput io.Writer
	if os.Getenv("DAGGER_LOG") != "" {
		logOutput = os.Stderr
	}

	dag, err := dagger.Connect(ctx, dagger.WithLogOutput(logOutput))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Dagger: %w\n\nMake sure Docker or another container runtime is running.\nFor more info, see: https://docs.dagger.io/install", err)
	}

	return &DaggerClient{
		dag:         dag,
		auditLogger: auditLogger,
		containers:  make(map[string]*dagger.Container),
	}, nil
}

// Close closes the Dagger client connection
func (c *DaggerClient) Close() error {
	if c.dag != nil {
		return c.dag.Close()
	}
	return nil
}

// CreateEnvironment creates a new containerized environment using Dagger
func (c *DaggerClient) CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error) {
	// Validate inputs (reuse existing validation)
	if err := validateInput(req.Name, "name", c.auditLogger); err != nil {
		return nil, fmt.Errorf("invalid name: %w", err)
	}
	if err := validateInput(req.Source, "source", c.auditLogger); err != nil {
		return nil, fmt.Errorf("invalid source: %w", err)
	}

	// Create a unique environment ID to avoid collisions
	entropy := ulid.Monotonic(rand.Reader, 0)
	ulid := ulid.MustNew(ulid.Timestamp(time.Now()), entropy)
	envID := fmt.Sprintf("env-%s-%s", req.Name, ulid.String())

	// Determine base image based on agent type
	baseImage := "ubuntu:latest"
	if agentType, ok := req.Environment["TRAILS_AGENT_TYPE"]; ok {
		switch agentType {
		case "claude":
			baseImage = "node:20" // Claude Code typically needs Node.js
		case "aider":
			baseImage = "python:3.11" // Aider needs Python
		case "codex":
			baseImage = "ubuntu:latest" // Generic for now
		}
	}

	// Create container with mounted source directory
	container := c.dag.Container().
		From(baseImage).
		WithWorkdir("/workspace")

	// Mount the source directory if it's a local path
	if strings.HasPrefix(req.Source, "/") || strings.HasPrefix(req.Source, "./") {
		absPath, err := filepath.Abs(req.Source)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve source path: %w", err)
		}
		container = container.WithMountedDirectory("/workspace", c.dag.Host().Directory(absPath))
	}

	// Set environment variables
	for key, value := range req.Environment {
		container = container.WithEnvVariable(key, value)
	}

	// Install basic tools and clean up apt cache
	container = container.
		WithExec([]string{"sh", "-c", "apt-get update && apt-get install -y git curl wget tmux vim && apt-get clean && rm -rf /var/lib/apt/lists/*"})

	// Store the container
	c.mu.Lock()
	c.containers[envID] = container
	c.mu.Unlock()

	return &Environment{
		ID:          envID,
		Name:        req.Name,
		Source:      req.Source,
		Status:      "ready",
		Environment: req.Environment,
	}, nil
}

// DestroyEnvironment destroys a containerized environment
func (c *DaggerClient) DestroyEnvironment(ctx context.Context, envID string) error {
	c.mu.Lock()
	container, exists := c.containers[envID]
	if exists {
		delete(c.containers, envID)
	}
	c.mu.Unlock()

	if exists {
		// Note: Dagger containers are automatically cleaned up when the client closes
		// or when the container object goes out of scope. For explicit cleanup in the future,
		// we could add container.Stop() or similar if Dagger SDK provides it.
		_ = container // Keep reference to avoid "unused variable" warning
	}

	return nil
}

// GetEnvironment gets details about a specific environment
func (c *DaggerClient) GetEnvironment(ctx context.Context, envID string) (*Environment, error) {
	c.mu.RLock()
	_, exists := c.containers[envID]
	c.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("environment %s not found", envID)
	}

	return &Environment{
		ID:     envID,
		Status: "ready",
	}, nil
}

// SpawnAgent spawns an AI agent in the specified environment
func (c *DaggerClient) SpawnAgent(ctx context.Context, envID, agentType string) error {
	c.mu.RLock()
	container, exists := c.containers[envID]
	c.mu.RUnlock()

	if !exists {
		return fmt.Errorf("environment %s not found", envID)
	}

	// Map agent type to command
	var agentCmd []string
	switch agentType {
	case "claude":
		// For Claude Code, we'd typically set up the environment
		// but the actual agent runs on the host connecting via MCP
		agentCmd = []string{"echo", "Claude Code environment ready"}
	case "aider":
		agentCmd = []string{"aider"}
	case "codex":
		agentCmd = []string{"echo", "Codex environment ready"}
	default:
		return fmt.Errorf("unsupported agent type: %s", agentType)
	}

	// Execute the agent command in background
	// Note: For real implementation, we'd need to handle long-running processes
	updatedContainer := container.WithExec(agentCmd)
	c.mu.Lock()
	c.containers[envID] = updatedContainer
	c.mu.Unlock()

	// Log the agent start
	if c.auditLogger != nil {
		c.auditLogger.LogAgentStart("", agentType, envID, true, nil)
	}

	return nil
}

// RunCommand runs a command in the specified environment
func (c *DaggerClient) RunCommand(ctx context.Context, envID string, command []string) (string, error) {
	c.mu.RLock()
	container, exists := c.containers[envID]
	c.mu.RUnlock()

	if !exists {
		return "", fmt.Errorf("environment %s not found", envID)
	}

	// Execute command and capture output
	result := container.WithExec(command)
	output, err := result.Stdout(ctx)
	if err != nil {
		return "", fmt.Errorf("command execution failed: %w", err)
	}

	// Update the container state
	c.mu.Lock()
	c.containers[envID] = result
	c.mu.Unlock()

	return output, nil
}

// GetTerminal opens an interactive terminal to the environment
func (c *DaggerClient) GetTerminal(ctx context.Context, envID string) error {
	c.mu.RLock()
	container, exists := c.containers[envID]
	c.mu.RUnlock()

	if !exists {
		return fmt.Errorf("environment %s not found", envID)
	}

	// For now, we'll use the Terminal() method which opens an interactive session
	// In production, this might need to be handled differently
	_, err := container.Terminal().Sync(ctx)
	return err
}
