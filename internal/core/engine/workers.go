package engine

import (
	"time"

	"github.com/outfitter-dev/trails/internal/protocol"
)

// stateManager periodically saves state and sends snapshots
func (e *Engine) stateManager() {
	defer e.wg.Done()

	ticker := time.NewTicker(30 * time.Second) // Save state every 30 seconds
	defer ticker.Stop()

	e.logger.Info("State manager started")

	for {
		select {
		case <-e.ctx.Done():
			e.logger.Info("State manager stopping")
			return

		case <-ticker.C:
			if err := e.state.Save(e.ctx); err != nil {
				e.logger.WithError(err).Error("Failed to save state")
				e.metrics.RecordError("state_save", err)
			}

			// Send periodic state snapshot
			if err := e.sendStateSnapshot(); err != nil {
				e.logger.WithError(err).Warn("Failed to send state snapshot")
			}
		}
	}
}

// healthMonitor monitors system health and reports issues
func (e *Engine) healthMonitor() {
	defer e.wg.Done()

	ticker := time.NewTicker(60 * time.Second) // Check health every minute
	defer ticker.Stop()

	e.logger.Info("Health monitor started")

	for {
		select {
		case <-e.ctx.Done():
			e.logger.Info("Health monitor stopping")
			return

		case <-ticker.C:
			e.performHealthCheck()
		}
	}
}

// cleanupWorker performs periodic cleanup tasks
func (e *Engine) cleanupWorker() {
	defer e.wg.Done()

	ticker := time.NewTicker(5 * time.Minute) // Cleanup every 5 minutes
	defer ticker.Stop()

	e.logger.Info("Cleanup worker started")

	for {
		select {
		case <-e.ctx.Done():
			e.logger.Info("Cleanup worker stopping")
			return

		case <-ticker.C:
			e.performCleanup()
		}
	}
}

// sendStateSnapshot creates and sends a state snapshot event
func (e *Engine) sendStateSnapshot() error {
	snapshot, err := e.state.GetSnapshot()
	if err != nil {
		return err
	}

	event := protocol.NewEventBuilder(protocol.EventStateSnapshot).
		WithSource("engine-state-manager").
		WithPayload(*snapshot).
		Build()

	e.sendEvent(event)
	return nil
}

// performHealthCheck checks system health
func (e *Engine) performHealthCheck() {
	health := e.Health()
	
	// Log health metrics
	e.logger.LogHealthCheck(e.ctx, true, health)

	// Update metrics
	if sessionsInterface, ok := health["active_sessions"]; ok {
		if sessions, ok := sessionsInterface.(int); ok {
			e.metrics.RecordSessionCount(sessions)
		}
	}

	// Check for potential issues
	e.checkHealthIssues(health)
}

// checkHealthIssues identifies potential health problems
func (e *Engine) checkHealthIssues(health map[string]interface{}) {
	// Check session count
	if sessionsInterface, ok := health["active_sessions"]; ok {
		if sessions, ok := sessionsInterface.(int); ok {
			if sessions >= e.config.MaxConcurrentSessions {
				e.logger.Warn("Maximum concurrent sessions reached",
					"active_sessions", sessions,
					"max_sessions", e.config.MaxConcurrentSessions,
				)

				event := protocol.NewEventBuilder(protocol.EventWarning).
					WithSource("health-monitor").
					WithPayload(protocol.WarningEvent{
						Code:    "MAX_SESSIONS",
						Message: "Maximum concurrent sessions reached",
						Details: "Consider increasing MaxConcurrentSessions or cleaning up inactive sessions",
					}).
					Build()

				e.sendEvent(event)
			}
		}
	}

	// Check rate limiter size
	if limitersInterface, ok := health["rate_limiters"]; ok {
		if limiters, ok := limitersInterface.(int); ok {
			if limiters > 1000 { // Arbitrary threshold
				e.logger.Warn("High number of rate limiters",
					"rate_limiters", limiters,
				)

				event := protocol.NewEventBuilder(protocol.EventWarning).
					WithSource("health-monitor").
					WithPayload(protocol.WarningEvent{
						Code:    "HIGH_RATE_LIMITERS",
						Message: "High number of rate limiters detected",
						Details: "Rate limiter cleanup may need to be more aggressive",
					}).
					Build()

				e.sendEvent(event)
			}
		}
	}
}

// performCleanup runs various cleanup tasks
func (e *Engine) performCleanup() {
	// Clean up old rate limiters
	removed := e.rateLimiter.Cleanup(1 * time.Hour) // Remove limiters older than 1 hour
	if removed > 0 {
		e.logger.Info("Cleaned up rate limiters",
			"removed_count", removed,
		)
	}

	// TODO: Clean up stale sessions
	e.cleanupStaleSessions()

	// TODO: Clean up old container environments
	e.cleanupStaleContainers()
}

// cleanupStaleSessions removes sessions that haven't been active
func (e *Engine) cleanupStaleSessions() {
	sessions, err := e.sessions.List(e.ctx, protocol.SessionFilter{})
	if err != nil {
		e.logger.WithError(err).Error("Failed to list sessions for cleanup")
		return
	}

	staleThreshold := time.Now().Add(-24 * time.Hour) // 24 hours
	cleanedCount := 0

	for _, session := range sessions {
		if session.LastActivity.Before(staleThreshold) && 
		   session.Status == protocol.StatusError {
			
			e.logger.Info("Cleaning up stale session",
				"session_id", session.ID,
				"session_name", session.Name,
				"last_activity", session.LastActivity,
				"status", session.Status,
			)

			if err := e.sessions.Delete(e.ctx, session.ID, true); err != nil {
				e.logger.WithError(err).Error("Failed to delete stale session",
					"session_id", session.ID,
				)
				continue
			}

			// Send deletion event
			event := protocol.NewEventBuilder(protocol.EventSessionDeleted).
				WithSource("cleanup-worker").
				WithSessionID(session.ID).
				WithPayload(protocol.SessionDeletedEvent{
					SessionID: session.ID,
				}).
				Build()

			e.sendEvent(event)
			cleanedCount++
		}
	}

	if cleanedCount > 0 {
		e.logger.Info("Cleaned up stale sessions",
			"cleaned_count", cleanedCount,
		)
	}
}

// cleanupStaleContainers removes unused container environments
func (e *Engine) cleanupStaleContainers() {
	// TODO: Implement container cleanup
	// This would involve:
	// 1. Listing all containers
	// 2. Checking which ones are not associated with active sessions
	// 3. Destroying unused containers
	// 4. Logging cleanup actions
}