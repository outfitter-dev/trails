package ui

import (
	"log"

	"github.com/jesseduffield/gocui"
	"github.com/outfitter-dev/trails/internal/protocol"
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
	// Send shutdown command
	a.sendCommand(protocol.CmdShutdown, nil)
	return gocui.ErrQuit
}

// moveDown navigates to the next session
func (a *App) moveDown(g *gocui.Gui, v *gocui.View) error {
	newIndex := a.uiState.FocusIndex + 1
	if newIndex < len(a.uiState.Sessions) {
		a.sendCommand(protocol.CmdSetFocus, protocol.SetFocusCommand{
			SessionID: a.uiState.Sessions[newIndex].ID,
		})
	}
	return nil
}

// moveUp navigates to the previous session
func (a *App) moveUp(g *gocui.Gui, v *gocui.View) error {
	newIndex := a.uiState.FocusIndex - 1
	if newIndex >= 0 {
		a.sendCommand(protocol.CmdSetFocus, protocol.SetFocusCommand{
			SessionID: a.uiState.Sessions[newIndex].ID,
		})
	}
	return nil
}

// createSession creates a new agent session
func (a *App) createSession(g *gocui.Gui, v *gocui.View) error {
	defaultAgent := a.config.GetDefaultAgent()
	sessionName := "session"

	log.Printf("Creating new session: %s with agent: %s", sessionName, defaultAgent)

	a.sendCommand(protocol.CmdCreateSession, protocol.CreateSessionCommand{
		Name:        sessionName,
		Agent:       defaultAgent,
		Branch:      "main",
		Environment: make(map[string]string),
	})

	return nil
}

// deleteSession removes the current session
func (a *App) deleteSession(g *gocui.Gui, v *gocui.View) error {
	if a.uiState.FocusIndex >= 0 && a.uiState.FocusIndex < len(a.uiState.Sessions) {
		focused := a.uiState.Sessions[a.uiState.FocusIndex]
		log.Printf("Deleting session: %s", focused.GetDisplayName())

		a.sendCommand(protocol.CmdDeleteSession, protocol.DeleteSessionCommand{
			SessionID: focused.ID,
		})
	}
	return nil
}

// nextActionable focuses the next session that needs attention
func (a *App) nextActionable(g *gocui.Gui, v *gocui.View) error {
	// Find the next actionable session
	for i := a.uiState.FocusIndex + 1; i < len(a.uiState.Sessions); i++ {
		if a.uiState.Sessions[i].IsActionable() {
			a.sendCommand(protocol.CmdSetFocus, protocol.SetFocusCommand{
				SessionID: a.uiState.Sessions[i].ID,
			})
			log.Printf("Focused next actionable session")
			return nil
		}
	}

	// Search from the beginning if not found
	for i := 0; i <= a.uiState.FocusIndex; i++ {
		if a.uiState.Sessions[i].IsActionable() {
			a.sendCommand(protocol.CmdSetFocus, protocol.SetFocusCommand{
				SessionID: a.uiState.Sessions[i].ID,
			})
			log.Printf("Focused next actionable session")
			return nil
		}
	}

	log.Printf("No actionable sessions found")
	return nil
}

// startAgent starts the AI agent for the focused session
func (a *App) startAgent(g *gocui.Gui, v *gocui.View) error {
	if a.uiState.FocusIndex >= 0 && a.uiState.FocusIndex < len(a.uiState.Sessions) {
		focused := a.uiState.Sessions[a.uiState.FocusIndex]
		log.Printf("Starting agent for session: %s", focused.GetDisplayName())

		a.sendCommand(protocol.CmdStartAgent, protocol.StartAgentCommand{
			SessionID: focused.ID,
		})
	}
	return nil
}

// toggleMinimal toggles minimal status bar mode
func (a *App) toggleMinimal(g *gocui.Gui, v *gocui.View) error {
	a.sendCommand(protocol.CmdToggleMinimal, nil)
	log.Printf("Toggling minimal mode")

	// Force layout refresh to show/hide main content
	return nil
}
