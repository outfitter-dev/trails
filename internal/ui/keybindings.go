package ui

import (
	"log"

	"github.com/jesseduffield/gocui"
)

// setupKeybindings configures all keyboard shortcuts
func (a *App) setupKeybindings() error {
	// Quit
	if err := a.gui.SetKeybinding("", gocui.KeyCtrlC, gocui.ModNone, a.quit); err != nil {
		return err
	}
	if err := a.gui.SetKeybinding("", 'q', gocui.ModNone, a.quit); err != nil {
		return err
	}

	// Navigation
	if err := a.gui.SetKeybinding("", 'j', gocui.ModNone, a.moveDown); err != nil {
		return err
	}
	if err := a.gui.SetKeybinding("", 'k', gocui.ModNone, a.moveUp); err != nil {
		return err
	}

	// Session management
	if err := a.gui.SetKeybinding("", 'c', gocui.ModNone, a.createSession); err != nil {
		return err
	}
	if err := a.gui.SetKeybinding("", 'd', gocui.ModNone, a.deleteSession); err != nil {
		return err
	}

	// Navigation shortcuts
	if err := a.gui.SetKeybinding("", 'n', gocui.ModNone, a.nextActionable); err != nil {
		return err
	}

	// Session actions
	if err := a.gui.SetKeybinding("", gocui.KeyEnter, gocui.ModNone, a.startAgent); err != nil {
		return err
	}

	// UI toggles
	if err := a.gui.SetKeybinding("", 'm', gocui.ModNone, a.toggleMinimal); err != nil {
		return err
	}

	return nil
}

// quit exits the application
func (a *App) quit(g *gocui.Gui, v *gocui.View) error {
	// Save state before quitting
	if err := a.state.Save(); err != nil {
		log.Printf("Failed to save state: %v", err)
	}
	return gocui.ErrQuit
}

// moveDown navigates to the next session
func (a *App) moveDown(g *gocui.Gui, v *gocui.View) error {
	a.state.MoveFocus(1)
	return nil
}

// moveUp navigates to the previous session
func (a *App) moveUp(g *gocui.Gui, v *gocui.View) error {
	a.state.MoveFocus(-1)
	return nil
}

// createSession creates a new agent session
func (a *App) createSession(g *gocui.Gui, v *gocui.View) error {
	defaultAgent := a.config.GetDefaultAgent()
	sessionName := "session"

	log.Printf("Creating new session: %s with agent: %s", sessionName, defaultAgent)

	// Create session with container-use environment
	sess, err := a.sessionManager.CreateSession(a.ctx, sessionName, defaultAgent)
	if err != nil {
		log.Printf("Failed to create session: %v", err)
		return nil // Don't crash the UI
	}

	a.state.AddSession(sess)
	log.Printf("Created session: %s with environment: %s", sess.GetDisplayName(), sess.EnvironmentID.String())

	return nil
}

// deleteSession removes the current session
func (a *App) deleteSession(g *gocui.Gui, v *gocui.View) error {
	focused := a.state.GetFocusedSession()
	if focused == nil {
		return nil
	}

	log.Printf("Deleting session: %s", focused.GetDisplayName())

	// Destroy container-use environment
	if err := a.sessionManager.DestroySession(a.ctx, focused); err != nil {
		log.Printf("Failed to destroy session environment: %v", err)
		// Continue with removal from state even if environment cleanup fails
	}

	a.state.RemoveSession(focused.ID)
	return nil
}

// nextActionable focuses the next session that needs attention
func (a *App) nextActionable(g *gocui.Gui, v *gocui.View) error {
	if a.state.FocusNextActionable() {
		log.Printf("Focused next actionable session")
	} else {
		log.Printf("No actionable sessions found")
	}
	return nil
}

// startAgent starts the AI agent for the focused session
func (a *App) startAgent(g *gocui.Gui, v *gocui.View) error {
	focused := a.state.GetFocusedSession()
	if focused == nil {
		return nil
	}

	log.Printf("Starting agent for session: %s", focused.GetDisplayName())

	if err := a.sessionManager.StartAgent(a.ctx, focused); err != nil {
		log.Printf("Failed to start agent: %v", err)
		return nil // Don't crash the UI
	}

	log.Printf("Started %s agent in environment: %s", focused.Agent, focused.EnvironmentID.String())
	return nil
}

// toggleMinimal toggles minimal status bar mode
func (a *App) toggleMinimal(g *gocui.Gui, v *gocui.View) error {
	a.state.MinimalMode = !a.state.MinimalMode
	log.Printf("Minimal mode: %v", a.state.MinimalMode)

	// Force layout refresh to show/hide main content
	return nil
}
