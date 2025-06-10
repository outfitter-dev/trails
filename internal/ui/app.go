package ui

import (
	"context"
	"fmt"
	"log"

	"github.com/jesseduffield/gocui"
	"github.com/outfitter-dev/trails/internal/config"
	"github.com/outfitter-dev/trails/internal/session"
	"github.com/outfitter-dev/trails/internal/state"
)

// App represents the main application
type App struct {
	ctx            context.Context
	cancel         context.CancelFunc
	gui            *gocui.Gui
	config         *config.Config
	state          *state.State
	sessionManager *session.Manager
}

// NewApp creates a new application instance
func NewApp(ctx context.Context, cfg *config.Config, st *state.State, sm *session.Manager) (*App, error) {
	// Create cancellable context to ensure proper cleanup
	appCtx, cancel := context.WithCancel(ctx)

	g := gocui.NewGui()

	// Use terminal default colors
	g.FgColor = gocui.ColorDefault
	g.BgColor = gocui.ColorDefault

	app := &App{
		ctx:            appCtx,
		cancel:         cancel,
		gui:            g,
		config:         cfg,
		state:          st,
		sessionManager: sm,
	}

	// Apply config preferences to state if not overridden
	if st.MinimalMode == false && cfg.GetMinimalMode() {
		st.MinimalMode = true
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

	log.Printf("Loaded %d existing sessions", len(a.state.Sessions))

	if err := a.gui.MainLoop(); err != nil && err != gocui.ErrQuit {
		return fmt.Errorf("GUI main loop error: %w", err)
	}

	return nil
}

// layout defines the main GUI layout
func (a *App) layout(g *gocui.Gui) error {
	maxX, maxY := g.Size()

	// In minimal mode, only show the status bar
	if a.state.MinimalMode {
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
		g.DeleteView("main")
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
