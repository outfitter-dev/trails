package ui

import (
	"context"
	"fmt"
	"log"

	"github.com/jesseduffield/gocui"
	"github.com/outfitter-dev/trails/internal/config"
	"github.com/outfitter-dev/trails/internal/protocol"
	"github.com/outfitter-dev/trails/internal/session"
)

// UIState holds the current state for UI rendering
type UIState struct {
	Sessions     []*session.Session
	FocusIndex   int
	MinimalMode  bool
}

// App represents the main application
type App struct {
	ctx            context.Context
	cancel         context.CancelFunc
	gui            *gocui.Gui
	config         *config.Config
	commandSender  chan<- protocol.Command
	eventReceiver  <-chan protocol.EnhancedEvent
	uiState        *UIState
}

// NewApp creates a new application instance
func NewApp(ctx context.Context, cfg *config.Config, commandSender chan<- protocol.Command, eventReceiver <-chan protocol.EnhancedEvent) (*App, error) {
	// Create cancellable context to ensure proper cleanup
	appCtx, cancel := context.WithCancel(ctx)

	g := gocui.NewGui()

	// Use terminal default colors
	g.FgColor = gocui.ColorDefault
	g.BgColor = gocui.ColorDefault

	app := &App{
		ctx:           appCtx,
		cancel:        cancel,
		gui:           g,
		config:        cfg,
		commandSender: commandSender,
		eventReceiver: eventReceiver,
		uiState: &UIState{
			Sessions:    make([]*session.Session, 0),
			FocusIndex:  0,
			MinimalMode: cfg.GetMinimalMode(),
		},
	}

	// Set up GUI
	g.SetLayout(app.layout)
	if err := app.setupKeybindings(); err != nil {
		cancel() // Clean up context on error
		return nil, fmt.Errorf("failed to setup keybindings: %w", err)
	}

	return app, nil
}

// Run starts the application
func (a *App) Run() error {
	if err := a.gui.Init(); err != nil {
		a.cancel()
		return fmt.Errorf("failed to initialize GUI: %w", err)
	}
	defer a.gui.Close()
	defer a.cancel() // Ensure context is cancelled on exit

	// Start event processing goroutine
	go a.processEvents()

	// Request initial state
	a.sendCommand(protocol.CmdHealthCheck, nil)

	log.Printf("UI started with %d sessions", len(a.uiState.Sessions))

	if err := a.gui.MainLoop(); err != nil && err != gocui.ErrQuit {
		return fmt.Errorf("GUI main loop error: %w", err)
	}

	return nil
}

// layout defines the main GUI layout
func (a *App) layout(g *gocui.Gui) error {
	maxX, maxY := g.Size()

	// In minimal mode, only show the status bar
	if a.uiState.MinimalMode {
		if v, err := g.SetView("tabs", 0, 0, maxX-1, 0); err != nil {
			if err != gocui.ErrUnknownView {
				return err
			}
			v.Frame = false
			v.Wrap = false
			v.BgColor = gocui.ColorDefault
			a.drawTabs(v)
		}

		// Hide main view in minimal mode
		if err := g.DeleteView("main"); err != nil && err != gocui.ErrUnknownView {
			return err
		}
		return nil
	}

	// Tab bar at the top
	if v, err := g.SetView("tabs", 0, 0, maxX-1, 2); err != nil {
		if err != gocui.ErrUnknownView {
			return err
		}
		v.Frame = false
		v.Wrap = false
		v.BgColor = gocui.ColorDefault
		a.drawTabs(v)
	}

	// Main content area
	if v, err := g.SetView("main", 0, 3, maxX-1, maxY-1); err != nil {
		if err != gocui.ErrUnknownView {
			return err
		}
		v.Title = "Trails"
		v.Wrap = true
		v.BgColor = gocui.ColorDefault
		a.drawMainContent(v)
	}

	return nil
}

// sendCommand sends a command to the core engine
func (a *App) sendCommand(cmdType protocol.CommandType, payload interface{}) {
	cmd := protocol.NewCommand(cmdType, payload)
	select {
	case a.commandSender <- cmd:
	case <-a.ctx.Done():
		log.Printf("Failed to send command %s: context cancelled", cmdType)
	}
}

// processEvents handles incoming events from the core engine
func (a *App) processEvents() {
	for {
		select {
		case event := <-a.eventReceiver:
			a.handleEvent(event)
		case <-a.ctx.Done():
			return
		}
	}
}

// handleEvent processes a single event and updates UI state
func (a *App) handleEvent(event protocol.EnhancedEvent) {
	switch event.Type {
	case protocol.EventSessionCreated:
		a.handleSessionCreated(event)
	case protocol.EventSessionDeleted:
		a.handleSessionDeleted(event)
	case protocol.EventStatusChanged:
		a.handleSessionStatusChanged(event)
	case protocol.EventError:
		a.handleError(event)
	default:
		log.Printf("Unhandled event type: %s", event.Type)
	}

	// Update GUI after processing event - force a redraw
	// Note: gocui doesn't have Update method, layout will be called on next cycle
}

// handleSessionCreated processes session creation events
func (a *App) handleSessionCreated(event protocol.EnhancedEvent) {
	// This would need to extract session data from event payload
	// For now, just log
	log.Printf("Session created: %s", event.Metadata.EventID)
}

// handleSessionDeleted processes session deletion events
func (a *App) handleSessionDeleted(event protocol.EnhancedEvent) {
	// This would need to extract session ID from event payload
	// For now, just log
	log.Printf("Session deleted: %s", event.Metadata.EventID)
}

// handleSessionStatusChanged processes session status change events
func (a *App) handleSessionStatusChanged(event protocol.EnhancedEvent) {
	// This would need to extract session ID and new status from event payload
	// For now, just log
	log.Printf("Session status changed: %s", event.Metadata.EventID)
}

// handleError processes error events
func (a *App) handleError(event protocol.EnhancedEvent) {
	log.Printf("Error event: %s", event.Metadata.EventID)
}
