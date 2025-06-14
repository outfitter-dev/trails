package commands

import (
	"fmt"
	"log"
	"os"

	"github.com/outfitter-dev/trails/internal/config"
	"github.com/outfitter-dev/trails/internal/core/container"
	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/core/session"
	"github.com/outfitter-dev/trails/internal/core/state"
	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
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

		ctx := cmd.Context()

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

		// Set up logging
		logger := logging.Default()

		// Create and start core engine
		engineConfig := engine.DefaultConfig()
		
		// Create protocol channels with engine config buffer sizes
		commandChan := make(chan protocol.Command, engineConfig.CommandBufferSize)
		eventChan := make(chan protocol.EnhancedEvent, engineConfig.EventBufferSize)

		// Create managers
		containerManager := container.NewManager(logger)
		sessionManager := session.NewManager(containerManager, logger)
		stateManager := state.NewManager(cwd, sessionManager, logger)

		// Create metrics collector
		metrics := engine.NewInMemoryMetrics()

		eng, err := engine.New(engineConfig, commandChan, eventChan, sessionManager, stateManager, containerManager, metrics, logger)
		if err != nil {
			return fmt.Errorf("failed to create engine: %w", err)
		}

		if err := eng.Start(ctx); err != nil {
			return fmt.Errorf("failed to start engine: %w", err)
		}
		defer func() {
			if err := eng.Stop(); err != nil {
				logger.Error("engine shutdown failed", "error", err)
			}
		}()

		// Initialize and run TUI
		log.Printf("Starting trails in %s", cwd)
		logger.Info("Trails started", "working_directory", cwd)

		app, err := ui.NewApp(ctx, cfg, logger, commandChan, eventChan)
		if err != nil {
			return fmt.Errorf("failed to create app: %w", err)
		}
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
