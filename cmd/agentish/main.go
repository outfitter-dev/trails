package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/maybe-good/agentish/internal/config"
	"github.com/maybe-good/agentish/internal/ui"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	// Check if running in CLI mode
	if len(os.Args) > 1 {
		return runCLI()
	}

	ctx := context.Background()

	// Get current working directory (repo root)
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get current directory: %w", err)
	}

	// Load configuration
	cfg, err := config.Load(cwd)
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Initialize and run TUI
	app, err := ui.NewApp(ctx, cfg)
	if err != nil {
		return fmt.Errorf("failed to create app: %w", err)
	}

	log.Printf("Starting agentish in %s", cwd)
	return app.Run()
}
