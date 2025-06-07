package ui

import (
	"github.com/jesseduffield/gocui"
	"github.com/maybe-good/agentish/internal/session"
)

// Color constants for different status types
const (
	ColorReady    = gocui.ColorGreen
	ColorWorking  = gocui.ColorYellow
	ColorWaiting  = gocui.ColorCyan
	ColorError    = gocui.ColorRed
	ColorThinking = gocui.ColorMagenta
	ColorFocused  = gocui.ColorWhite
)

// GetStatusColor returns the appropriate color for a session status
func GetStatusColor(status session.Status) gocui.Attribute {
	switch status {
	case session.StatusReady:
		return ColorReady
	case session.StatusWorking:
		return ColorWorking
	case session.StatusWaiting:
		return ColorWaiting
	case session.StatusError:
		return ColorError
	case session.StatusThinking:
		return ColorThinking
	default:
		return gocui.ColorDefault
	}
}
