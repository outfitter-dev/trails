package ui

import (
	"github.com/jesseduffield/gocui"
	"github.com/outfitter-dev/trails/internal/session"
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

var colorMap = map[string]string{
	"reset":   "\033[0m",
	"red":     "\033[31m",
	"green":   "\033[32m",
	"yellow":  "\033[33m",
	"blue":    "\033[34m",
	"magenta": "\033[35m",
	"cyan":    "\033[36m",
	"white":   "\033[37m",
}

func colorize(text, color string) string {
	code, exists := colorMap[color]
	if !exists {
		return text
	}
	return code + text + colorMap["reset"]
}

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
