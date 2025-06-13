package bubbletea

import (
	"context"
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/outfitter-dev/trails/internal/config"
	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// App wraps the BubbleTea program
type App struct {
	program *tea.Program
	model   *Model
}

// NewApp creates a new BubbleTea application
func NewApp(ctx context.Context, cfg *config.Config, logger *logging.Logger, commandSender chan<- protocol.Command, eventReceiver <-chan protocol.EnhancedEvent) (*App, error) {
	model := New(ctx, cfg, logger, commandSender, eventReceiver)
	
	program := tea.NewProgram(model, tea.WithAltScreen())
	
	return &App{
		program: program,
		model:   model,
	}, nil
}

// Run starts the BubbleTea application
func (a *App) Run() error {
	if _, err := a.program.Run(); err != nil {
		return fmt.Errorf("error running program: %w", err)
	}
	return nil
}

// Shutdown gracefully shuts down the application
func (a *App) Shutdown() {
	a.program.Quit()
}