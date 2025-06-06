package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/maybe-good/agentish/internal/config"
	"github.com/maybe-good/agentish/internal/session"
	"github.com/maybe-good/agentish/internal/state"
)

// CLI represents the command-line interface
type CLI struct {
	repoPath string
	config   *config.Config
	state    *state.State
	manager  *session.Manager
}

// NewCLI creates a new CLI instance
func NewCLI() (*CLI, error) {
	wd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get working directory: %w", err)
	}

	cfg, err := config.Load(wd)
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	st, err := state.Load(wd)
	if err != nil {
		return nil, fmt.Errorf("failed to load state: %w", err)
	}

	return &CLI{
		repoPath: wd,
		config:   cfg,
		state:    st,
		manager:  session.NewManager(wd),
	}, nil
}

// runCLI handles command-line operations
func runCLI() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: %s <command> [args]", os.Args[0])
	}

	command := os.Args[1]
	
	cli, err := NewCLI()
	if err != nil {
		return err
	}

	ctx := context.Background()

	switch command {
	case "create-session":
		return cli.createSession(ctx, os.Args[2:])
	case "list-sessions":
		return cli.listSessions()
	case "delete-session":
		return cli.deleteSession(ctx, os.Args[2:])
	case "start-agent":
		return cli.startAgent(ctx, os.Args[2:])
	case "status":
		return cli.status()
	default:
		return fmt.Errorf("unknown command: %s", command)
	}
}

func (c *CLI) createSession(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("create-session", flag.ExitOnError)
	name := fs.String("name", "session", "Session name")
	agent := fs.String("agent", c.config.GetDefaultAgent(), "Agent type")
	
	if err := fs.Parse(args); err != nil {
		return err
	}

	sess, err := c.manager.CreateSession(ctx, *name, *agent)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	c.state.AddSession(sess)
	if err := c.state.Save(); err != nil {
		return fmt.Errorf("failed to save state: %w", err)
	}

	fmt.Printf("Created session: %s (ID: %s)\n", sess.GetDisplayName(), sess.ID)
	fmt.Printf("Environment: %s\n", sess.EnvironmentID.String())
	
	return nil
}

func (c *CLI) listSessions() error {
	sessions := c.state.GetOrderedSessions()
	
	if len(sessions) == 0 {
		fmt.Println("No active sessions")
		return nil
	}

	for _, sess := range sessions {
		status := "●"
		if sess.Status == session.StatusReady {
			status = "○"
		} else if sess.Status == session.StatusError {
			status = "✗"
		}
		
		fmt.Printf("%s %s (%s) - %s [%s]\n", 
			status, 
			sess.GetDisplayName(), 
			sess.Agent,
			sess.GetStatusDisplay(),
			sess.EnvironmentID.String())
	}
	
	return nil
}

func (c *CLI) deleteSession(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("session ID required")
	}
	
	sessionID := args[0]
	sess, exists := c.state.Sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if err := c.manager.DestroySession(ctx, sess); err != nil {
		return fmt.Errorf("failed to destroy session: %w", err)
	}

	c.state.RemoveSession(sessionID)
	if err := c.state.Save(); err != nil {
		return fmt.Errorf("failed to save state: %w", err)
	}

	fmt.Printf("Deleted session: %s\n", sess.GetDisplayName())
	
	return nil
}

func (c *CLI) startAgent(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("session ID required")
	}
	
	sessionID := args[0]
	sess, exists := c.state.Sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if err := c.manager.StartAgent(ctx, sess); err != nil {
		return fmt.Errorf("failed to start agent: %w", err)
	}

	if err := c.state.Save(); err != nil {
		return fmt.Errorf("failed to save state: %w", err)
	}

	fmt.Printf("Started %s agent for session: %s\n", sess.Agent, sess.GetDisplayName())
	
	return nil
}

func (c *CLI) status() error {
	sessions := c.state.GetOrderedSessions()
	focused := c.state.GetFocusedSession()
	actionable := c.state.GetActionableSessions()

	status := map[string]interface{}{
		"repo_path":         c.repoPath,
		"total_sessions":    len(sessions),
		"focused_session":   nil,
		"actionable_count":  len(actionable),
		"minimal_mode":      c.state.MinimalMode,
		"last_saved":        c.state.LastSaved,
	}

	if focused != nil {
		status["focused_session"] = map[string]interface{}{
			"id":            focused.ID,
			"name":          focused.GetDisplayName(),
			"agent":         focused.Agent,
			"status":        focused.Status.String(),
			"environment":   focused.EnvironmentID.String(),
		}
	}

	output, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal status: %w", err)
	}

	fmt.Println(string(output))
	
	return nil
}