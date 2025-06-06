package ui

import (
	"context"
	"fmt"
	"log"

	"github.com/jesseduffield/gocui"
	"github.com/maybe-good/agentish/internal/config"
	"github.com/maybe-good/agentish/internal/session"
	"github.com/maybe-good/agentish/internal/state"
)

// App represents the main application
type App struct {
	ctx            context.Context
	gui            *gocui.Gui
	config         *config.Config
	state          *state.State
	sessionManager *session.Manager
}

// NewApp creates a new application instance
func NewApp(ctx context.Context, cfg *config.Config) (*App, error) {
	g := gocui.NewGui()

	// Load existing state or create new
	st, err := state.Load(cfg.RepoPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load state: %w", err)
	}

	app := &App{
		ctx:            ctx,
		gui:            g,
		config:         cfg,
		state:          st,
		sessionManager: session.NewManager(cfg.RepoPath),
	}

	// Apply config preferences to state if not overridden
	if st.MinimalMode == false && cfg.GetMinimalMode() {
		st.MinimalMode = true
	}

	// Set up GUI
	g.SetLayout(app.layout)
	if err := app.setupKeybindings(); err != nil {
		return nil, fmt.Errorf("failed to setup keybindings: %w", err)
	}

	return app, nil
}

// Run starts the application
func (a *App) Run() error {
	if err := a.gui.Init(); err != nil {
		return fmt.Errorf("failed to initialize GUI: %w", err)
	}
	defer a.gui.Close()

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
		a.drawTabs(v)
	}

	// Main content area
	if v, err := g.SetView("main", 0, 3, maxX-1, maxY-1); err != nil {
		if err != gocui.ErrUnknownView {
			return err
		}
		v.Title = "Agentish"
		v.Wrap = true
		a.drawMainContent(v)
	}

	return nil
}

// drawTabs renders the session tabs
func (a *App) drawTabs(v *gocui.View) {
	v.Clear()

	if len(a.state.Sessions) == 0 {
		fmt.Fprint(v, "No active sessions - press 'c' to create one")
		return
	}

	sessions := a.state.GetOrderedSessions()
	focused := a.state.GetFocusedSession()

	// Check if we should use minimal mode
	if a.state.MinimalMode {
		a.drawMinimalTabs(v, sessions)
		return
	}

	for i, sess := range sessions {
		if i > 0 {
			fmt.Fprint(v, " ")
		}

		isFocused := focused != nil && sess.ID == focused.ID
		display := FormatSessionTab(sess, isFocused)

		if isFocused {
			fmt.Fprintf(v, "▶ %s", display) // Arrow for focused session
		} else {
			fmt.Fprint(v, display)
		}
	}
}

// drawMinimalTabs renders tabs in minimal mode
func (a *App) drawMinimalTabs(v *gocui.View, sessions []*session.Session) {
	for i, sess := range sessions {
		if i > 0 {
			fmt.Fprint(v, " ")
		}
		fmt.Fprint(v, FormatMinimalSession(sess))
	}
}

// drawMainContent renders the main content area
func (a *App) drawMainContent(v *gocui.View) {
	v.Clear()

	focused := a.state.GetFocusedSession()
	if focused == nil {
		fmt.Fprint(v, "Welcome to Agentish!\n\n")
		fmt.Fprint(v, "Commands:\n")
		fmt.Fprint(v, "  c - Create new session\n")
		fmt.Fprint(v, "  q - Quit\n")
		return
	}

	fmt.Fprintf(v, "Session: %s\n", focused.GetDisplayName())
	fmt.Fprintf(v, "Agent: %s\n", focused.Agent)
	fmt.Fprintf(v, "Status: %s\n", focused.GetStatusDisplay())
	fmt.Fprintf(v, "Environment: %s\n", focused.EnvironmentID.String())
	fmt.Fprintf(v, "Branch: %s\n", focused.Branch)
	fmt.Fprintf(v, "Created: %s\n", focused.CreatedAt.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(v, "Last Activity: %s\n", focused.LastActivity.Format("2006-01-02 15:04:05"))

	fmt.Fprint(v, "\nCommands:\n")
	fmt.Fprint(v, "  j/k - Navigate sessions\n")
	fmt.Fprint(v, "  c - Create new session\n")
	fmt.Fprint(v, "  d - Delete current session\n")
	fmt.Fprint(v, "  Enter - Start agent\n")
	fmt.Fprint(v, "  n - Next actionable session\n")
	fmt.Fprint(v, "  m - Toggle minimal mode\n")
	fmt.Fprint(v, "  q - Quit\n")
}
