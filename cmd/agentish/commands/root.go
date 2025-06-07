package commands

import (
	"fmt"
	"log"
	"os"

	"github.com/maybe-good/agentish/internal/config"
	"github.com/maybe-good/agentish/internal/session"
	"github.com/maybe-good/agentish/internal/state"
	"github.com/maybe-good/agentish/internal/ui"
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "agentish",
	Short: "agentish is a tool for managing AI agents",
	Long:  `agentish is a tool for managing AI agents in a local development environment.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		// If no subcommand is given, run the TUI.
		// This is the main entry point for the TUI mode.
		// We set up all dependencies here and ensure they are properly closed.
		
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

		// Load state
		st, closeState, err := state.Load(cwd)
		if err != nil {
			return fmt.Errorf("failed to load state: %w", err)
		}
		defer closeState()

		// Create session manager
		sm, closeManager, err := session.NewManager(cwd)
		if err != nil {
			return fmt.Errorf("failed to create session manager: %w", err)
		}
		defer closeManager()

		// Initialize and run TUI
		app, err := ui.NewApp(cmd.Context(), cfg, st, sm)
		if err != nil {
			return fmt.Errorf("failed to create app: %w", err)
		}

		log.Printf("Starting agentish in %s", cwd)
		return app.Run()
	},
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
} 