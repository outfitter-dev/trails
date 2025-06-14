package ui

import (
	"context"
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// Message types

// eventMsg wraps a protocol event
type eventMsg struct {
	event protocol.EnhancedEvent
}

// errMsg wraps an error
type errMsg struct {
	err error
}

// Commands

// waitForEvent returns a command that waits for an event from the channel
func waitForEvent(eventChan <-chan protocol.EnhancedEvent) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-eventChan
		if !ok {
			return errMsg{err: nil} // Channel closed
		}
		return eventMsg{event: event}
	}
}

// sendCommand sends a command to the command channel with context
func sendCommand(ctx context.Context, commandChan chan<- protocol.Command, cmd protocol.Command) tea.Cmd {
	return func() tea.Msg {
		select {
		case commandChan <- cmd:
			// Command sent successfully
		case <-ctx.Done():
			// Context cancelled
			return errMsg{err: ctx.Err()}
		case <-time.After(engine.CommandSendTimeout):
			// Timeout after configured duration
			return errMsg{err: fmt.Errorf("timeout sending command")}
		}
		return nil
	}
}

// requestInitialState sends a health check to get initial state
func requestInitialState(ctx context.Context, commandChan chan<- protocol.Command) tea.Cmd {
	return func() tea.Msg {
		cmd, err := protocol.HealthCheck(true).Build()
		if err != nil {
			return errMsg{err: err}
		}
		
		select {
		case commandChan <- cmd:
			// Command sent successfully
		case <-ctx.Done():
			// Context cancelled
			return errMsg{err: ctx.Err()}
		case <-time.After(engine.InitialStateTimeout):
			// Timeout for initial request
			return errMsg{err: fmt.Errorf("timeout requesting initial state")}
		}
		return nil
	}
}