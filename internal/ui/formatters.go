package ui

import (
	"strings"

	"github.com/outfitter-dev/trails/internal/session"
)

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
		focusedBuilder.WriteString("\\033[1m")
		focusedBuilder.WriteString(display)
		focusedBuilder.WriteString("\\033[0m")
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