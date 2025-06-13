package engine

import (
	"time"

	"github.com/outfitter-dev/trails/internal/protocol"
)

// stateManager is a background goroutine that periodically saves state.
// It runs every 30 seconds to persist the current state to disk
// and send state snapshots to the UI for synchronization.
func (e *Engine) stateManager() {
	defer e.wg.Done()

	ticker := time.NewTicker(StateManagerInterval) // Save state every 30 seconds
	defer ticker.Stop()

	e.logger.Debug("State manager started")

	for {
		select {
		case <-e.ctx.Done():
			e.logger.Debug("State manager stopping")
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

// healthMonitor is a background goroutine that checks system health.
// It runs every minute to collect metrics, detect issues,
// and send warning events when problems are detected.
func (e *Engine) healthMonitor() {
	defer e.wg.Done()

	ticker := time.NewTicker(HealthMonitorInterval) // Check health every minute
	defer ticker.Stop()

	e.logger.Debug("Health monitor started")

	for {
		select {
		case <-e.ctx.Done():
			e.logger.Debug("Health monitor stopping")
			return

		case <-ticker.C:
			e.performHealthCheck()
		}
	}
}

// cleanupWorker is a background goroutine that performs maintenance.
// It removes stale rate limiters, cleans up error sessions,
// and will eventually clean up unused containers.
func (e *Engine) cleanupWorker() {
	defer e.wg.Done()

	ticker := time.NewTicker(CleanupInterval)
	defer ticker.Stop()

	e.logger.Debug("Cleanup worker started")

	for {
		select {
		case <-e.ctx.Done():
			e.logger.Debug("Cleanup worker stopping")
			return

		case <-ticker.C:
			e.performCleanup()
		}
	}
}

// sendStateSnapshot retrieves the current state and sends it as an event.
// This is used for UI synchronization after state changes.
// Returns error if state cannot be retrieved.
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

// performHealthCheck gathers health metrics and logs them.
// Updates the metrics collector with current session count
// and checks for potential issues that need attention.
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

// checkHealthIssues analyzes health metrics for problems.
// Sends warning events when issues are detected such as:
// - Maximum concurrent sessions reached
// - High number of rate limiters (potential memory issue)
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

// performCleanup executes maintenance tasks to prevent resource leaks.
// This includes cleaning up old rate limiters, stale sessions,
// and logging warnings when resources grow too large.
func (e *Engine) performCleanup() {
	// Clean up old rate limiters more aggressively
	// Remove limiters that haven't been accessed in 5 minutes
	removed := e.rateLimiter.Cleanup(RateLimiterCleanupAge)
	if removed > 0 {
		e.logger.Debug("Cleaned up rate limiters",
			"removed_count", removed,
		)
	}
	
	// Log current size for monitoring
	currentSize := e.rateLimiter.Size()
	if currentSize > RateLimiterWarningSize {
		e.logger.Warn("Rate limiter size is large",
			"size", currentSize,
		)
	}

	// TODO: Clean up stale sessions
	e.cleanupStaleSessions()

	// TODO: Clean up old container environments
	e.cleanupStaleContainers()
}

// cleanupStaleSessions removes error sessions that have been inactive.
// Only cleans up sessions in error state that haven't been active
// for the configured timeout period. Sends deletion events for each.
func (e *Engine) cleanupStaleSessions() {
	sessions, err := e.sessions.List(e.ctx, protocol.SessionFilter{})
	if err != nil {
		e.logger.WithError(err).Error("Failed to list sessions for cleanup")
		return
	}

	staleThreshold := time.Now().Add(-StaleSessionTimeout)
	cleanedCount := 0

	for _, session := range sessions {
		if session.LastActivity.Before(staleThreshold) && 
		   session.Status == protocol.StatusError {
			
			e.logger.Debug("Cleaning up stale session",
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
		e.logger.Debug("Cleaned up stale sessions",
			"cleaned_count", cleanedCount,
		)
	}
}

// cleanupStaleContainers removes container environments not linked to active sessions.
// TODO: Implement this to prevent container resource leaks.
// Should list containers, check session associations, and destroy orphans.
func (e *Engine) cleanupStaleContainers() {
	// TODO: Implement container cleanup
	// This would involve:
	// 1. Listing all containers
	// 2. Checking which ones are not associated with active sessions
	// 3. Destroying unused containers
	// 4. Logging cleanup actions
}