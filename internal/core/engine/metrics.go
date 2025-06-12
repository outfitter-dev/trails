package engine

import (
	"sync"
	"time"

	"github.com/outfitter-dev/trails/internal/protocol"
)

// InMemoryMetrics implements MetricsCollector with in-memory storage
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

// NewInMemoryMetrics creates a new in-memory metrics collector
func NewInMemoryMetrics() *InMemoryMetrics {
	return &InMemoryMetrics{
		commandCounts:    make(map[protocol.CommandType]int64),
		commandDurations: make(map[protocol.CommandType][]time.Duration),
		errorCounts:      make(map[string]int64),
		startTime:        time.Now(),
	}
}

// RecordCommand increments the count for a command type
func (m *InMemoryMetrics) RecordCommand(cmdType protocol.CommandType) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.commandCounts[cmdType]++
}

// RecordCommandDuration records the duration of a command
func (m *InMemoryMetrics) RecordCommandDuration(cmdType protocol.CommandType, duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.commandDurations[cmdType] = append(m.commandDurations[cmdType], duration)
	
	// Keep only the last 100 durations to prevent unbounded memory growth
	if len(m.commandDurations[cmdType]) > 100 {
		m.commandDurations[cmdType] = m.commandDurations[cmdType][1:]
	}
}

// RecordError increments the count for an error type
func (m *InMemoryMetrics) RecordError(operation string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.errorCounts[operation]++
}

// RecordSessionCount updates the current session count
func (m *InMemoryMetrics) RecordSessionCount(count int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.currentSessionCount = count
	if count > m.maxSessionCount {
		m.maxSessionCount = count
	}
}

// GetMetrics returns a snapshot of all metrics
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

// MetricsSnapshot represents a point-in-time view of metrics
type MetricsSnapshot struct {
	CommandCounts       map[protocol.CommandType]int64   `json:"command_counts"`
	CommandDurations    map[protocol.CommandType]DurationStats `json:"command_durations"`
	ErrorCounts         map[string]int64                 `json:"error_counts"`
	CurrentSessionCount int                              `json:"current_session_count"`
	MaxSessionCount     int                              `json:"max_session_count"`
	Uptime              time.Duration                    `json:"uptime"`
	Timestamp           time.Time                        `json:"timestamp"`
}

// DurationStats holds statistical information about durations
type DurationStats struct {
	Count   int           `json:"count"`
	Mean    time.Duration `json:"mean"`
	Min     time.Duration `json:"min"`
	Max     time.Duration `json:"max"`
	P50     time.Duration `json:"p50"`
	P95     time.Duration `json:"p95"`
	P99     time.Duration `json:"p99"`
}

// calculateDurationStats computes statistics for a slice of durations
func calculateDurationStats(durations []time.Duration) DurationStats {
	if len(durations) == 0 {
		return DurationStats{}
	}

	// Sort durations for percentile calculations
	sorted := make([]time.Duration, len(durations))
	copy(sorted, durations)
	
	// Simple bubble sort (good enough for small arrays)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[i] > sorted[j] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

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

// Reset clears all metrics (useful for testing)
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