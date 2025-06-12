package engine

import (
	"context"
	"fmt"
	"time"

	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// commandWorker processes commands from the command channel
func (e *Engine) commandWorker(workerID int) {
	defer e.wg.Done()

	workerLogger := e.logger.WithCommand(fmt.Sprintf("worker-%d", workerID))
	workerLogger.Info("Command worker started")

	for {
		select {
		case <-e.ctx.Done():
			workerLogger.Info("Command worker stopping")
			return

		case cmd := <-e.commands:
			e.processCommand(cmd, workerLogger)
		}
	}
}

// processCommand handles a single command
func (e *Engine) processCommand(cmd protocol.Command, logger *logging.Logger) {
	start := time.Now()
	
	// Create command context
	ctx := logging.WithCommandID(e.ctx, cmd.ID)
	ctx = logging.WithNewRequestID(ctx)
	
	cmdLogger := logger.WithCommand(cmd.ID)
	cmdLogger.LogCommand(ctx, "Processing command", cmd)

	// Record metrics
	e.metrics.RecordCommand(cmd.Type)

	// Validate command
	if err := protocol.ValidateCommand(cmd); err != nil {
		e.handleCommandError(ctx, cmd, fmt.Errorf("validation failed: %w", err), start, cmdLogger)
		return
	}

	// Check rate limiting (extract session ID from payload if available)
	sessionID := e.extractSessionID(cmd)
	if sessionID != "" && !e.rateLimiter.Allow(sessionID) {
		e.handleCommandError(ctx, cmd, fmt.Errorf("rate limit exceeded for session %s", sessionID), start, cmdLogger)
		e.logger.LogRateLimitExceeded(ctx, sessionID)
		return
	}

	// Route to appropriate handler
	var err error
	switch cmd.Type {
	case protocol.CmdCreateSession:
		err = e.handleCreateSession(ctx, cmd)
	case protocol.CmdDeleteSession:
		err = e.handleDeleteSession(ctx, cmd)
	case protocol.CmdUpdateSession:
		err = e.handleUpdateSession(ctx, cmd)
	case protocol.CmdListSessions:
		err = e.handleListSessions(ctx, cmd)
	case protocol.CmdStartAgent:
		err = e.handleStartAgent(ctx, cmd)
	case protocol.CmdStopAgent:
		err = e.handleStopAgent(ctx, cmd)
	case protocol.CmdRestartAgent:
		err = e.handleRestartAgent(ctx, cmd)
	case protocol.CmdSetFocus:
		err = e.handleSetFocus(ctx, cmd)
	case protocol.CmdNextActionable:
		err = e.handleNextActionable(ctx, cmd)
	case protocol.CmdToggleMinimal:
		err = e.handleToggleMinimal(ctx, cmd)
	case protocol.CmdSetPreference:
		err = e.handleSetPreference(ctx, cmd)
	case protocol.CmdHealthCheck:
		err = e.handleHealthCheck(ctx, cmd)
	case protocol.CmdShutdown:
		err = e.handleShutdown(ctx, cmd)
	default:
		err = fmt.Errorf("unknown command type: %s", cmd.Type)
	}

	duration := time.Since(start)
	e.metrics.RecordCommandDuration(cmd.Type, duration)

	if err != nil {
		e.handleCommandError(ctx, cmd, err, start, cmdLogger)
	} else {
		cmdLogger.LogCommandProcessed(ctx, cmd, duration)
	}
}

// extractSessionID attempts to extract session ID from command payload
func (e *Engine) extractSessionID(cmd protocol.Command) string {
	switch payload := cmd.Payload.(type) {
	case protocol.DeleteSessionCommand:
		return payload.SessionID
	case protocol.UpdateSessionCommand:
		return payload.SessionID
	case protocol.SetFocusCommand:
		return payload.SessionID
	case protocol.StartAgentCommand:
		return payload.SessionID
	case protocol.StopAgentCommand:
		return payload.SessionID
	case protocol.RestartAgentCommand:
		return payload.SessionID
	default:
		return ""
	}
}

// handleCommandError handles command processing errors
func (e *Engine) handleCommandError(ctx context.Context, cmd protocol.Command, err error, start time.Time, logger *logging.Logger) {
	duration := time.Since(start)
	
	logger.LogCommandError(ctx, cmd, err, duration)
	e.metrics.RecordError("command_processing", err)

	// Send error event
	errorEvent := protocol.NewEventBuilder(protocol.EventError).
		WithCommandID(cmd.ID).
		WithPayload(protocol.ErrorEvent{
			Code:        "CMD_ERROR",
			Message:     "Command processing failed",
			Details:     err.Error(),
			Recoverable: true,
		}).
		Build()

	e.sendEvent(errorEvent)
}

// Session command handlers

func (e *Engine) handleCreateSession(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.CreateSessionCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for CreateSession")
	}

	// Check session limits
	sessions, err := e.sessions.List(ctx, protocol.SessionFilter{})
	if err != nil {
		return fmt.Errorf("failed to list sessions: %w", err)
	}

	if len(sessions) >= e.config.MaxConcurrentSessions {
		return fmt.Errorf("maximum concurrent sessions reached (%d)", e.config.MaxConcurrentSessions)
	}

	// Create session
	session, err := e.sessions.Create(ctx, payload)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	// Send success event
	event := protocol.NewEventBuilder(protocol.EventSessionCreated).
		WithCommandID(cmd.ID).
		WithSessionID(session.ID).
		WithPayload(protocol.SessionCreatedEvent{
			Session: e.sessionToInfo(session),
		}).
		Build()

	e.sendEvent(event)

	return nil
}

func (e *Engine) handleDeleteSession(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.DeleteSessionCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for DeleteSession")
	}

	ctx = logging.WithSessionID(ctx, payload.SessionID)

	// Delete session
	if err := e.sessions.Delete(ctx, payload.SessionID, payload.Force); err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}

	// Send success event
	event := protocol.NewEventBuilder(protocol.EventSessionDeleted).
		WithCommandID(cmd.ID).
		WithSessionID(payload.SessionID).
		WithPayload(protocol.SessionDeletedEvent{
			SessionID: payload.SessionID,
		}).
		Build()

	e.sendEvent(event)

	return nil
}

func (e *Engine) handleUpdateSession(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.UpdateSessionCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for UpdateSession")
	}

	ctx = logging.WithSessionID(ctx, payload.SessionID)

	// Update session
	if err := e.sessions.Update(ctx, payload.SessionID, payload.Updates); err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	// Get updated session
	session, err := e.sessions.Get(ctx, payload.SessionID)
	if err != nil {
		return fmt.Errorf("failed to get updated session: %w", err)
	}

	// Send success event
	event := protocol.NewEventBuilder(protocol.EventSessionUpdated).
		WithCommandID(cmd.ID).
		WithSessionID(payload.SessionID).
		WithPayload(protocol.SessionUpdatedEvent{
			Session: e.sessionToInfo(session),
		}).
		Build()

	e.sendEvent(event)

	return nil
}

func (e *Engine) handleListSessions(ctx context.Context, cmd protocol.Command) error {
	filter := protocol.SessionFilter{}
	if payload, ok := cmd.Payload.(protocol.ListSessionsCommand); ok {
		filter = payload.Filter
	}

	// List sessions
	sessions, err := e.sessions.List(ctx, filter)
	if err != nil {
		return fmt.Errorf("failed to list sessions: %w", err)
	}

	// Convert to info objects
	sessionInfos := make([]protocol.SessionInfo, len(sessions))
	for i, session := range sessions {
		sessionInfos[i] = e.sessionToInfo(session)
	}

	// Send success event
	event := protocol.NewEventBuilder(protocol.EventSessionList).
		WithCommandID(cmd.ID).
		WithPayload(protocol.SessionListEvent{
			Sessions: sessionInfos,
		}).
		Build()

	e.sendEvent(event)

	return nil
}

// Agent command handlers

func (e *Engine) handleStartAgent(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.StartAgentCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for StartAgent")
	}

	ctx = logging.WithSessionID(ctx, payload.SessionID)

	// Get session
	session, err := e.sessions.Get(ctx, payload.SessionID)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}

	if session.Status != protocol.StatusReady {
		return fmt.Errorf("session %s is not ready (current status: %s)", payload.SessionID, session.Status)
	}

	// Set status to working
	if err := e.sessions.SetStatus(ctx, payload.SessionID, protocol.StatusWorking); err != nil {
		return fmt.Errorf("failed to set session status: %w", err)
	}

	// Send status change event
	event := protocol.NewEventBuilder(protocol.EventStatusChanged).
		WithCommandID(cmd.ID).
		WithSessionID(payload.SessionID).
		WithPayload(protocol.StatusChangedEvent{
			SessionID: payload.SessionID,
			OldStatus: protocol.StatusReady,
			NewStatus: protocol.StatusWorking,
			Reason:    "Agent started",
		}).
		Build()

	e.sendEvent(event)

	// TODO: Actually start the agent process
	// This would involve creating an agent process, setting up communication, etc.

	return nil
}

func (e *Engine) handleStopAgent(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.StopAgentCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for StopAgent")
	}

	ctx = logging.WithSessionID(ctx, payload.SessionID)

	// Set status to ready
	if err := e.sessions.SetStatus(ctx, payload.SessionID, protocol.StatusReady); err != nil {
		return fmt.Errorf("failed to set session status: %w", err)
	}

	// Send status change event
	event := protocol.NewEventBuilder(protocol.EventStatusChanged).
		WithCommandID(cmd.ID).
		WithSessionID(payload.SessionID).
		WithPayload(protocol.StatusChangedEvent{
			SessionID: payload.SessionID,
			OldStatus: protocol.StatusWorking,
			NewStatus: protocol.StatusReady,
			Reason:    "Agent stopped",
		}).
		Build()

	e.sendEvent(event)

	return nil
}

func (e *Engine) handleRestartAgent(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.RestartAgentCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for RestartAgent")
	}

	ctx = logging.WithSessionID(ctx, payload.SessionID)
	
	e.logger.LogCommand(ctx, "Restarting agent", cmd)

	// This is essentially stop + start
	// TODO: Implement proper restart logic

	// Send status change event
	event := protocol.NewEventBuilder(protocol.EventStatusChanged).
		WithCommandID(cmd.ID).
		WithSessionID(payload.SessionID).
		WithPayload(protocol.StatusChangedEvent{
			SessionID: payload.SessionID,
			OldStatus: protocol.StatusWorking,
			NewStatus: protocol.StatusWorking,
			Reason:    "Agent restarted",
		}).
		Build()

	e.sendEvent(event)

	return nil
}

// UI command handlers

func (e *Engine) handleSetFocus(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.SetFocusCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for SetFocus")
	}

	// Verify session exists
	_, err := e.sessions.Get(ctx, payload.SessionID)
	if err != nil {
		return fmt.Errorf("session not found: %w", err)
	}

	// Focus is handled by UI state, just acknowledge
	// In a full implementation, this might update a focus state

	return nil
}

func (e *Engine) handleNextActionable(ctx context.Context, cmd protocol.Command) error {
	// Find next actionable session
	sessions, err := e.sessions.List(ctx, protocol.SessionFilter{})
	if err != nil {
		return fmt.Errorf("failed to list sessions: %w", err)
	}

	// Find first actionable session (simplified logic)
	for _, session := range sessions {
		if session.Status == protocol.StatusError || session.Status == protocol.StatusWaiting {
			// Send focus event for this session
			event := protocol.NewEventBuilder(protocol.EventInfo).
				WithCommandID(cmd.ID).
				WithPayload(protocol.InfoEvent{
					Message: fmt.Sprintf("Next actionable session: %s", session.Name),
					Details: fmt.Sprintf("Session ID: %s, Status: %s", session.ID, session.Status),
				}).
				Build()

			e.sendEvent(event)
			return nil
		}
	}

	// No actionable sessions found
	event := protocol.NewEventBuilder(protocol.EventInfo).
		WithCommandID(cmd.ID).
		WithPayload(protocol.InfoEvent{
			Message: "No actionable sessions found",
		}).
		Build()

	e.sendEvent(event)

	return nil
}

func (e *Engine) handleToggleMinimal(ctx context.Context, cmd protocol.Command) error {
	// This would typically update UI preferences
	// For now, just acknowledge the command
	return nil
}

func (e *Engine) handleSetPreference(ctx context.Context, cmd protocol.Command) error {
	payload, ok := cmd.Payload.(protocol.SetPreferenceCommand)
	if !ok {
		return fmt.Errorf("invalid payload type for SetPreference")
	}

	// TODO: Store preference in state manager
	_ = payload // Avoid unused variable error

	return nil
}

// System command handlers

func (e *Engine) handleHealthCheck(ctx context.Context, cmd protocol.Command) error {
	includeDetails := false
	if payload, ok := cmd.Payload.(protocol.HealthCheckCommand); ok {
		includeDetails = payload.IncludeDetails
	}

	health := e.Health()
	if !includeDetails {
		// Remove detailed information
		health = map[string]interface{}{
			"status": health["status"],
		}
	}

	event := protocol.NewEventBuilder(protocol.EventHealthStatus).
		WithCommandID(cmd.ID).
		WithPayload(protocol.HealthStatusEvent{
			Healthy: true,
			Details: health,
		}).
		Build()

	e.sendEvent(event)

	return nil
}

func (e *Engine) handleShutdown(ctx context.Context, cmd protocol.Command) error {
	e.logger.Info("Shutdown command received")

	// Send shutdown event
	event := protocol.NewEventBuilder(protocol.EventInfo).
		WithCommandID(cmd.ID).
		WithPayload(protocol.InfoEvent{
			Message: "Shutdown initiated",
		}).
		Build()

	e.sendEvent(event)

	// Initiate graceful shutdown
	go func() {
		time.Sleep(100 * time.Millisecond) // Allow event to be sent
		e.cancel()
	}()

	return nil
}

// Helper methods

func (e *Engine) sessionToInfo(session *Session) protocol.SessionInfo {
	return protocol.SessionInfo{
		ID:            session.ID,
		Name:          session.Name,
		Agent:         session.Agent,
		Status:        session.Status,
		EnvironmentID: session.EnvironmentID,
		Branch:        session.Branch,
		CreatedAt:     session.CreatedAt,
		UpdatedAt:     session.UpdatedAt,
	}
}

func (e *Engine) sendEvent(event protocol.EnhancedEvent) {
	select {
	case e.events <- event:
		// Event sent successfully
	case <-e.ctx.Done():
		// Engine is shutting down
	default:
		// Event channel is full, log warning
		e.logger.Warn("Event channel full, dropping event",
			"event_type", event.Type,
			"event_id", event.Metadata.EventID,
		)
	}
}