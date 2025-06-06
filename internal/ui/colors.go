package ui

import (
	"strings"

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

// FormatSessionTab formats a session tab with colors
func FormatSessionTab(sess *session.Session, focused bool) string {
	var builder strings.Builder
	
	builder.WriteString(sess.Agent)
	builder.WriteString(":")
	builder.WriteString(sess.GetDisplayName())
	builder.WriteString(" [")
	builder.WriteString(sess.GetStatusDisplay())
	builder.WriteString("]")
	
	display := builder.String()

	if focused {
		var focusedBuilder strings.Builder
		focusedBuilder.WriteString("\033[1m")
		focusedBuilder.WriteString(display)
		focusedBuilder.WriteString("\033[0m")
		return focusedBuilder.String()
	}

	return display
}

// FormatMinimalSession formats a session for minimal mode
func FormatMinimalSession(sess *session.Session) string {
	var builder strings.Builder
	
	builder.WriteString(sess.Agent)
	builder.WriteString(":")
	builder.WriteString(sess.GetDisplayName())
	builder.WriteString("[")
	builder.WriteString(sess.Status.String())
	builder.WriteString("]")
	
	return builder.String()
}
