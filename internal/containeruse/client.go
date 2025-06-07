package containeruse

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"

	"github.com/maybe-good/agentish/internal/security"
)

// Client represents a container-use MCP client
type Client struct {
	auditLogger *security.AuditLogger
}

// Input validation patterns - compiled once for performance
var (
	// validNamePattern restricts names to alphanumeric, hyphens, and underscores
	validNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	// validSourcePattern restricts sources to safe filesystem paths and URLs (including git URLs)
	validSourcePattern = regexp.MustCompile(`^[a-zA-Z0-9_./:@?=-]+$`)
	// validEnvIDPattern restricts environment IDs to safe alphanumeric strings
	validEnvIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	// validExplanationPattern allows basic text, numbers, and common punctuation.
	validExplanationPattern = regexp.MustCompile(`^[a-zA-Z0-9\s.,!?'"-]+$`)
)

// Security constants
const (
	// Dangerous characters that could be used for command injection
	dangerousChars = ";|&$`'\"\\n\\r(){}[]<>*?"
)

// Safe commands allowlist - only these commands are permitted for execution
var safeCommands = map[string]bool{
	"claude-code": true,
	"aider":       true,
	"codex":       true,
	"amp":         true,
	"jules":       true,
}

// validateInput sanitizes and validates user input to prevent command injection
func validateInput(input, inputType string, auditLogger *security.AuditLogger) error {
	if input == "" {
		err := fmt.Errorf("%s cannot be empty", inputType)
		if auditLogger != nil {
			auditLogger.LogSecurityViolation("input_validation", input, err.Error(), map[string]interface{}{
				"input_type": inputType,
				"violation":  "empty_input",
			})
		}
		return err
	}
	
	// Check for dangerous characters, now using a more restrictive pattern approach
	if strings.ContainsAny(input, dangerousChars) {
		err := fmt.Errorf("%s contains characters that are not allowed", inputType)
		if auditLogger != nil {
			auditLogger.LogSecurityViolation("input_validation", input, err.Error(), map[string]interface{}{
				"input_type": inputType,
				"violation":  "dangerous_characters",
			})
		}
		return err
	}
	
	switch inputType {
	case "name":
		if !validNamePattern.MatchString(input) {
			err := fmt.Errorf("name must contain only alphanumeric characters, hyphens, and underscores")
			if auditLogger != nil {
				auditLogger.LogSecurityViolation("input_validation", input, err.Error(), map[string]interface{}{
					"input_type": inputType,
					"violation":  "invalid_name_pattern",
				})
			}
			return err
		}
	case "source":
		if !validSourcePattern.MatchString(input) {
			err := fmt.Errorf("source path contains invalid characters")
			if auditLogger != nil {
				auditLogger.LogSecurityViolation("input_validation", input, err.Error(), map[string]interface{}{
					"input_type": inputType,
					"violation":  "invalid_source_pattern",
				})
			}
			return err
		}
	case "envID":
		if !validEnvIDPattern.MatchString(input) {
			err := fmt.Errorf("environment ID contains invalid characters")
			if auditLogger != nil {
				auditLogger.LogSecurityViolation("input_validation", input, err.Error(), map[string]interface{}{
					"input_type": inputType,
					"violation":  "invalid_envid_pattern",
				})
			}
			return err
		}
	case "explanation":
		if !validExplanationPattern.MatchString(input) {
			err := fmt.Errorf("explanation contains invalid characters")
			if auditLogger != nil {
				auditLogger.LogSecurityViolation("input_validation", input, err.Error(), map[string]interface{}{
					"input_type": inputType,
					"violation":  "invalid_explanation_pattern",
				})
			}
			return err
		}
	}
	
	return nil
}

// NewClient creates a new container-use client
func NewClient() *Client {
	return &Client{}
}

// NewClientWithAudit creates a new container-use client with audit logging
// auditLogger can be nil and will be safely handled throughout the client
func NewClientWithAudit(auditLogger *security.AuditLogger) *Client {
	return &Client{
		auditLogger: auditLogger,
	}
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
	// Validate all inputs to prevent command injection
	if err := validateInput(req.Name, "name", c.auditLogger); err != nil {
		return nil, fmt.Errorf("invalid name: %w", err)
	}
	if err := validateInput(req.Source, "source", c.auditLogger); err != nil {
		return nil, fmt.Errorf("invalid source: %w", err)
	}
	if req.Explanation != "" {
		if err := validateInput(req.Explanation, "explanation", c.auditLogger); err != nil {
			return nil, fmt.Errorf("invalid explanation: %w", err)
		}
	}

	// Check if container-use is available
	if _, err := exec.LookPath("container-use"); err != nil {
		return nil, fmt.Errorf("container-use CLI not found: %w. Please install container-use from https://github.com/dagger/container-use", err)
	}

	// Use JSON format for reliable parsing
	cmd := exec.CommandContext(ctx, "container-use", "environment", "create",
		"--name", req.Name,
		"--source", req.Source,
		"--format", "json")

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

	// Parse JSON response instead of text parsing
	var env Environment
	if err := json.Unmarshal(output, &env); err != nil {
		return nil, fmt.Errorf("failed to parse container-use create response: %w. Output: %s", err, string(output))
	}

	// Set additional fields if not provided by the response
	if env.Name == "" {
		env.Name = req.Name
	}
	if env.Source == "" {
		env.Source = req.Source
	}
	if env.Status == "" {
		env.Status = "ready"
	}
	if env.Environment == nil && req.Environment != nil {
		env.Environment = req.Environment
	}

	return &env, nil
}

// DestroyEnvironment destroys a container-use environment
func (c *Client) DestroyEnvironment(ctx context.Context, envID string) error {
	// Validate environment ID to prevent command injection
	if err := validateInput(envID, "envID", c.auditLogger); err != nil {
		return fmt.Errorf("invalid environment ID: %w", err)
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
	// Validate environment ID to prevent command injection
	if err := validateInput(envID, "envID", c.auditLogger); err != nil {
		return nil, fmt.Errorf("invalid environment ID: %w", err)
	}

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
	// Validate environment ID to prevent command injection
	if err := validateInput(envID, "envID", c.auditLogger); err != nil {
		return fmt.Errorf("invalid environment ID: %w", err)
	}
	
	// Validate command - only allow predefined safe commands
	if !safeCommands[command] {
		err := fmt.Errorf("command '%s' is not in the allowlist of safe commands", command)
		if c.auditLogger != nil {
			c.auditLogger.LogSecurityViolation("command_execution", envID, err.Error(), map[string]interface{}{
				"attempted_command": command,
				"environment_id":    envID,
			})
		}
		return err
	}

	args := []string{"environment", "run", envID}

	if background {
		args = append(args, "--background")
	}

	args = append(args, command)

	cmd := exec.CommandContext(ctx, "container-use", args...)

	err := cmd.Run()
	if c.auditLogger != nil {
		c.auditLogger.LogCommandExecution(envID, command, err == nil, err)
	}
	
	if err != nil {
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
	case "amp":
		command = "amp"
	case "jules":
		command = "jules"
	default:
		return fmt.Errorf("unsupported agent type: %s", agentType)
	}

	return c.RunCommand(ctx, envID, command, true)
}
