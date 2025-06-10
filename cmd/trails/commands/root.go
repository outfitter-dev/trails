package commands

import (
	"fmt"
	"log"
	"os"

	"github.com/outfitter-dev/trails/internal/config"
	"github.com/outfitter-dev/trails/internal/session"
	"github.com/outfitter-dev/trails/internal/state"
	"github.com/outfitter-dev/trails/internal/ui"
	"github.com/spf13/cobra"
)

var (
	devMode bool
)

var rootCmd = &cobra.Command{
	Use:   "trails",
	Short: "trails is a tool for managing AI coding guides",
	Long:  `trails is a tool for managing AI coding guides in isolated containerized environments.`,
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
		var sm *session.Manager
		var closeManager func() error

		if devMode {
			// Use mock provider in development mode
			log.Println("Running in development mode with mock container provider")
			os.Setenv("TRAILS_PROVIDER", "mock")
		}

		// Create session manager (it will use the appropriate provider based on env)
		sm, closeManager, err = session.NewManager(cwd)
		if err != nil {
			return fmt.Errorf("failed to create session manager: %w", err)
		}
		defer closeManager()

		// Initialize and run TUI
		app, err := ui.NewApp(cmd.Context(), cfg, st, sm)
		if err != nil {
			return fmt.Errorf("failed to create app: %w", err)
		}

		log.Printf("Starting trails in %s", cwd)
		return app.Run()
	},
}

func init() {
	rootCmd.PersistentFlags().BoolVar(&devMode, "dev", false, "Run in development mode with mock container provider")
}

// Execute adds all child commands to the root command and sets flags appropriately.
// This is called by main.main(). It only needs to happen once to the rootCmd.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}
