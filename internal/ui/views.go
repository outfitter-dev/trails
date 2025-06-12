package ui

import (
	"fmt"

	"github.com/jesseduffield/gocui"
	"github.com/outfitter-dev/trails/internal/session"
)

// drawTabs renders the session tabs
func (a *App) drawTabs(v *gocui.View) {
	v.Clear()

	if len(a.uiState.Sessions) == 0 {
		fmt.Fprint(v, "No active sessions - press 'c' to create one")
		return
	}

	// Check if we should use minimal mode
	if a.uiState.MinimalMode {
		a.drawMinimalTabs(v, a.uiState.Sessions)
		return
	}

	for i, sess := range a.uiState.Sessions {
		if i > 0 {
			fmt.Fprint(v, " ")
		}

		isFocused := i == a.uiState.FocusIndex
		display := FormatSessionTab(sess, isFocused)

		if isFocused {
			// Use magenta for focused tab for better visibility
			fmt.Fprintf(v, "%s %s", colorize("▶", "magenta"), colorize(display, "magenta"))
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

	var focused *session.Session
	if a.uiState.FocusIndex >= 0 && a.uiState.FocusIndex < len(a.uiState.Sessions) {
		focused = a.uiState.Sessions[a.uiState.FocusIndex]
	}

	if focused == nil {
		fmt.Fprintln(v, "Welcome to Trails!")
		fmt.Fprintln(v)
		fmt.Fprintln(v, "Commands:")
		fmt.Fprintln(v, "  c - Create new session")
		fmt.Fprintln(v, "  q - Quit")
		return
	}

	fmt.Fprintf(v, "Session: %s\n", focused.GetDisplayName())
	fmt.Fprintf(v, "Agent: %s\n", focused.Agent)
	fmt.Fprintf(v, "Status: %s\n", focused.GetStatusDisplay())
	fmt.Fprintf(v, "Environment: %s\n", focused.EnvironmentID.String())
	fmt.Fprintf(v, "Branch: %s\n", focused.Branch)
	fmt.Fprintf(v, "Created: %s\n", focused.CreatedAt.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(v, "Last Activity: %s\n", focused.LastActivity.Format("2006-01-02 15:04:05"))

	fmt.Fprintln(v)
	fmt.Fprintln(v, "Commands:")
	fmt.Fprintln(v, "  j/k - Navigate sessions")
	fmt.Fprintln(v, "  c - Create new session")
	fmt.Fprintln(v, "  d - Delete current session")
	fmt.Fprintln(v, "  Enter - Start agent")
	fmt.Fprintln(v, "  n - Next actionable session")
	fmt.Fprintln(v, "  m - Toggle minimal mode")
	fmt.Fprintln(v, "  q - Quit")
}
