package containeruse

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// Client represents a container-use MCP client
type Client struct {
	// Could add configuration here in the future
}

// NewClient creates a new container-use client
func NewClient() *Client {
	return &Client{}
}

// Environment represents a container-use environment
type Environment struct {
	ID          string            `json:"environment_id"`
	Name        string            `json:"name"`
	Source      string            `json:"source"`
	Status      string            `json:"status"`
	CreatedAt   string            `json:"created_at"`
	UpdatedAt   string            `json:"updated_at"`
	Environment map[string]string `json:"environment,omitempty"`
}

// CreateEnvironmentRequest represents the request to create an environment
type CreateEnvironmentRequest struct {
	Name        string            `json:"name"`
	Source      string            `json:"source"`
	Explanation string            `json:"explanation"`
	Environment map[string]string `json:"environment,omitempty"`
}

// CreateEnvironment creates a new container-use environment
func (c *Client) CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error) {
	// Check if container-use is available
	if _, err := exec.LookPath("container-use"); err != nil {
		return nil, fmt.Errorf("container-use CLI not found: %w. Please install container-use from https://github.com/dagger/container-use", err)
	}

	// For now, we'll use the MCP container-use CLI
	// In the future, we could use direct MCP protocol communication

	cmd := exec.CommandContext(ctx, "container-use", "environment", "create",
		"--name", req.Name,
		"--source", req.Source)

	if req.Explanation != "" {
		cmd.Args = append(cmd.Args, "--explanation", req.Explanation)
	}

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("container-use create failed (exit %d): %s", exitErr.ExitCode(), string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("failed to execute container-use create: %w", err)
	}

	// Parse the output to extract environment ID
	// This is a simplified implementation - real container-use output parsing would be more robust
	lines := strings.Split(string(output), "\n")
	var envID string
	for _, line := range lines {
		if strings.Contains(line, "Environment ID:") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				envID = strings.TrimSpace(parts[1])
				break
			}
		}
	}

	if envID == "" {
		return nil, fmt.Errorf("failed to extract environment ID from container-use output: %s", string(output))
	}

	return &Environment{
		ID:          envID,
		Name:        req.Name,
		Source:      req.Source,
		Status:      "ready",
		Environment: req.Environment,
	}, nil
}

// DestroyEnvironment destroys a container-use environment
func (c *Client) DestroyEnvironment(ctx context.Context, envID string) error {
	if envID == "" {
		return fmt.Errorf("environment ID cannot be empty")
	}

	cmd := exec.CommandContext(ctx, "container-use", "environment", "destroy", envID)

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("container-use destroy failed for environment %s (exit %d): %s", envID, exitErr.ExitCode(), string(exitErr.Stderr))
		}
		return fmt.Errorf("failed to execute container-use destroy for environment %s: %w", envID, err)
	}

	return nil
}

// ListEnvironments lists all container-use environments
func (c *Client) ListEnvironments(ctx context.Context) ([]*Environment, error) {
	cmd := exec.CommandContext(ctx, "container-use", "environment", "list", "--format", "json")

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list environments: %w", err)
	}

	var envs []*Environment
	if err := json.Unmarshal(output, &envs); err != nil {
		return nil, fmt.Errorf("failed to parse environment list: %w", err)
	}

	return envs, nil
}

// GetEnvironment gets details about a specific environment
func (c *Client) GetEnvironment(ctx context.Context, envID string) (*Environment, error) {
	cmd := exec.CommandContext(ctx, "container-use", "environment", "get", envID, "--format", "json")

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get environment %s: %w", envID, err)
	}

	var env Environment
	if err := json.Unmarshal(output, &env); err != nil {
		return nil, fmt.Errorf("failed to parse environment details: %w", err)
	}

	return &env, nil
}

// RunCommand runs a command in the specified environment
func (c *Client) RunCommand(ctx context.Context, envID, command string, background bool) error {
	args := []string{"environment", "run", envID}

	if background {
		args = append(args, "--background")
	}

	args = append(args, command)

	cmd := exec.CommandContext(ctx, "container-use", args...)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to run command in environment %s: %w", envID, err)
	}

	return nil
}

// SpawnAgent spawns an AI agent in the specified environment
func (c *Client) SpawnAgent(ctx context.Context, envID, agentType string) error {
	var command string

	switch agentType {
	case "claude":
		command = "claude-code"
	case "aider":
		command = "aider"
	case "codex":
		command = "codex"
	default:
		return fmt.Errorf("unsupported agent type: %s", agentType)
	}

	return c.RunCommand(ctx, envID, command, true)
}
