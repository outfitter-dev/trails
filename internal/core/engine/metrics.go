package engine

import (
	"sort"
	"sync"
	"time"

	"github.com/outfitter-dev/trails/internal/protocol"
)

// InMemoryMetrics implements MetricsCollector with in-memory storage.
// This is a simple implementation suitable for development and testing.
// For production, consider using a proper metrics backend.
type InMemoryMetrics struct {
	mu sync.RWMutex

	// Command metrics
	commandCounts    map[protocol.CommandType]int64
	commandDurations map[protocol.CommandType][]time.Duration

	// Error metrics
	errorCounts map[string]int64

	// Session metrics
	currentSessionCount int
	maxSessionCount     int

	// General metrics
	startTime time.Time
}

// NewInMemoryMetrics creates a new in-memory metrics collector.
// The collector starts tracking time from creation.
func NewInMemoryMetrics() *InMemoryMetrics {
	return &InMemoryMetrics{
		commandCounts:    make(map[protocol.CommandType]int64),
		commandDurations: make(map[protocol.CommandType][]time.Duration),
		errorCounts:      make(map[string]int64),
		startTime:        time.Now(),
	}
}

// RecordCommand increments the count for a command type.
// Thread-safe method for tracking command frequency.
func (m *InMemoryMetrics) RecordCommand(cmdType protocol.CommandType) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.commandCounts[cmdType]++
}

// RecordCommandDuration records the duration of a command execution.
// Maintains a sliding window of recent durations to prevent unbounded growth.
// Thread-safe method for tracking command performance.
func (m *InMemoryMetrics) RecordCommandDuration(cmdType protocol.CommandType, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.commandDurations[cmdType] = append(m.commandDurations[cmdType], duration)
	
	// Keep only the configured number of durations to prevent unbounded memory growth
	if len(m.commandDurations[cmdType]) > MetricsDurationHistorySize {
		m.commandDurations[cmdType] = m.commandDurations[cmdType][1:]
	}
}

// RecordError increments the error count for a specific operation.
// The operation string should identify where the error occurred.
// Thread-safe method for tracking error rates.
func (m *InMemoryMetrics) RecordError(operation string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.errorCounts[operation]++
}

// RecordSessionCount updates the current and maximum session counts.
// Called periodically by the health monitor.
// Thread-safe method for tracking session metrics.
func (m *InMemoryMetrics) RecordSessionCount(count int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.currentSessionCount = count
	if count > m.maxSessionCount {
		m.maxSessionCount = count
	}
}

// GetMetrics returns a point-in-time snapshot of all collected metrics.
// The snapshot includes command statistics, error counts, and session metrics.
// Thread-safe method that creates a consistent view of metrics.
func (m *InMemoryMetrics) GetMetrics() MetricsSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Copy command counts
	commandCounts := make(map[protocol.CommandType]int64)
	for k, v := range m.commandCounts {
		commandCounts[k] = v
	}

	// Calculate command duration statistics
	commandStats := make(map[protocol.CommandType]DurationStats)
	for cmdType, durations := range m.commandDurations {
		if len(durations) > 0 {
			stats := calculateDurationStats(durations)
			commandStats[cmdType] = stats
		}
	}

	// Copy error counts
	errorCounts := make(map[string]int64)
	for k, v := range m.errorCounts {
		errorCounts[k] = v
	}

	return MetricsSnapshot{
		CommandCounts:       commandCounts,
		CommandDurations:    commandStats,
		ErrorCounts:         errorCounts,
		CurrentSessionCount: m.currentSessionCount,
		MaxSessionCount:     m.maxSessionCount,
		Uptime:              time.Since(m.startTime),
		Timestamp:           time.Now(),
	}
}

// MetricsSnapshot represents a point-in-time view of all metrics.
// This is used for reporting and monitoring the engine's performance.
type MetricsSnapshot struct {
	CommandCounts       map[protocol.CommandType]int64   `json:"command_counts"`
	CommandDurations    map[protocol.CommandType]DurationStats `json:"command_durations"`
	ErrorCounts         map[string]int64                 `json:"error_counts"`
	CurrentSessionCount int                              `json:"current_session_count"`
	MaxSessionCount     int                              `json:"max_session_count"`
	Uptime              time.Duration                    `json:"uptime"`
	Timestamp           time.Time                        `json:"timestamp"`
}

// DurationStats holds statistical information about command durations.
// Includes percentiles for understanding performance distribution.
type DurationStats struct {
	Count   int           `json:"count"`
	Mean    time.Duration `json:"mean"`
	Min     time.Duration `json:"min"`
	Max     time.Duration `json:"max"`
	P50     time.Duration `json:"p50"`
	P95     time.Duration `json:"p95"`
	P99     time.Duration `json:"p99"`
}

// calculateDurationStats computes statistics for a slice of durations.
// Returns percentiles (p50, p95, p99) along with min, max, and mean.
// Assumes the input slice is not empty.
func calculateDurationStats(durations []time.Duration) DurationStats {
	if len(durations) == 0 {
		return DurationStats{}
	}

	// Sort durations for percentile calculations
	sorted := make([]time.Duration, len(durations))
	copy(sorted, durations)
	
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i] < sorted[j]
	})

	// Calculate basic stats
	var total time.Duration
	min := sorted[0]
	max := sorted[len(sorted)-1]

	for _, d := range sorted {
		total += d
	}

	mean := total / time.Duration(len(sorted))

	// Calculate percentiles
	p50 := sorted[len(sorted)*50/100]
	p95 := sorted[len(sorted)*95/100]
	p99 := sorted[len(sorted)*99/100]

	return DurationStats{
		Count: len(sorted),
		Mean:  mean,
		Min:   min,
		Max:   max,
		P50:   p50,
		P95:   p95,
		P99:   p99,
	}
}

// Reset clears all metrics and resets the start time.
// This is primarily useful for testing scenarios.
// Thread-safe method that reinitializes all tracking.
func (m *InMemoryMetrics) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.commandCounts = make(map[protocol.CommandType]int64)
	m.commandDurations = make(map[protocol.CommandType][]time.Duration)
	m.errorCounts = make(map[string]int64)
	m.currentSessionCount = 0
	m.maxSessionCount = 0
	m.startTime = time.Now()
}

// IncrementCounter increments a named counter with optional tags.
// Currently only tracks dropped events, but can be extended.
// Thread-safe method for custom metric tracking.
func (m *InMemoryMetrics) IncrementCounter(name string, tags map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// For now, we'll just track errors in errorCounts
	// In a full implementation, this would support arbitrary counters
	if name == "events.dropped" {
		if eventType, ok := tags["type"]; ok {
			m.errorCounts["dropped_event_"+eventType]++
		} else {
			m.errorCounts["dropped_event_unknown"]++
		}
	}
}